import type { Client, Transaction, Row } from '@libsql/client';
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  INITIAL_COMPANIES,
  InvoiceError,
  normalizeNumber,
  object,
  text,
  cents,
  date,
  pin,
  todayInTurkey,
} from './model';
import type { Invoice, InvoiceAccount, InvoiceCompany, InvoiceEvent, InvoiceSnapshot } from './model';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const SESSION_DAYS = 90;
const toAccount = (row: Row): InvoiceAccount => ({
  id: String(row.id),
  name: String(row.name),
  role: row.role as InvoiceAccount['role'],
  active: Boolean(row.active),
});
const invoice = (row: Row): Invoice => {
  const amount = Number(row.amount_cents),
    used = Number(row.used_cents);
  return {
    id: String(row.id),
    companyId: String(row.company_id),
    companyName: String(row.company_name),
    number: String(row.number),
    date: String(row.invoice_date),
    amountCents: amount,
    usedCents: used,
    remainingCents: amount - used,
    version: Number(row.version),
    status: used === 0 ? 'unused' : used === amount ? 'closed' : 'partial',
    updatedAt: String(row.updated_at),
  };
};
const invoiceSelect =
  'SELECT i.*, c.name AS company_name FROM invoice_records i JOIN invoice_companies c ON c.id=i.company_id';

export class InvoiceStore {
  private ready: Promise<void> | null = null;
  constructor(
    private db: Client,
    private secret: string,
  ) {
    if (secret.length < 32) throw new Error('Invoice authentication is not configured.');
  }
  private digest(code: string) {
    return createHmac('sha256', this.secret).update(code).digest('hex');
  }
  async init() {
    if (!this.ready)
      this.ready = this.initialize().catch(error => {
        this.ready = null;
        throw error;
      });
    return this.ready;
  }
  private async initialize() {
    await this.db.batch(
      [
        `CREATE TABLE IF NOT EXISTS invoice_companies (id TEXT PRIMARY KEY, name TEXT NOT NULL, normalized_name TEXT NOT NULL UNIQUE, sort_order INTEGER NOT NULL, created_at TEXT NOT NULL)`,
        `CREATE TABLE IF NOT EXISTS invoice_accounts (id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','member')), code_digest TEXT NOT NULL UNIQUE, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL)`,
        `CREATE TABLE IF NOT EXISTS invoice_sessions (token_digest TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES invoice_accounts(id), expires_at TEXT NOT NULL)`,
        `CREATE TABLE IF NOT EXISTS invoice_login_attempts (key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, resets_at TEXT NOT NULL)`,
        `CREATE TABLE IF NOT EXISTS invoice_records (id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES invoice_companies(id), number TEXT NOT NULL, normalized_number TEXT NOT NULL, invoice_date TEXT NOT NULL, amount_cents INTEGER NOT NULL CHECK(amount_cents>0), used_cents INTEGER NOT NULL DEFAULT 0 CHECK(used_cents>=0 AND used_cents<=amount_cents), version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(company_id,normalized_number))`,
        `CREATE TABLE IF NOT EXISTS invoice_events (id TEXT PRIMARY KEY, invoice_id TEXT NOT NULL REFERENCES invoice_records(id), delta_cents INTEGER NOT NULL CHECK(delta_cents<>0), event_date TEXT NOT NULL, note TEXT NOT NULL, account_id TEXT NOT NULL REFERENCES invoice_accounts(id), idempotency_key TEXT NOT NULL UNIQUE, reversal_of TEXT UNIQUE REFERENCES invoice_events(id), created_at TEXT NOT NULL)`,
        `CREATE INDEX IF NOT EXISTS invoice_records_company ON invoice_records(company_id,invoice_date)`,
        `CREATE INDEX IF NOT EXISTS invoice_events_invoice ON invoice_events(invoice_id,created_at)`,
        ...INITIAL_COMPANIES.map(([id, name], i) => ({
          sql: 'INSERT OR IGNORE INTO invoice_companies (id,name,normalized_name,sort_order,created_at) VALUES (?,?,?,?,?)',
          args: [id, name, name.toLocaleLowerCase('tr-TR'), i, new Date().toISOString()],
        })),
      ],
      'write',
    );
  }
  private async write<T>(action: (tx: Transaction) => Promise<T>) {
    await this.init();
    const tx = await this.db.transaction('write');
    try {
      const result = await action(tx);
      await tx.commit();
      return result;
    } catch (error) {
      await tx.rollback();
      throw error;
    } finally {
      tx.close();
    }
  }
  async setup(code: unknown, name: unknown, token: unknown, expectedToken: string | undefined) {
    const valid =
      typeof token === 'string' &&
      expectedToken &&
      timingSafeEqual(Buffer.from(hash(token)), Buffer.from(hash(expectedToken)));
    if (!valid) throw new InvoiceError('Kurulum bağlantısı geçersiz.', 403);
    const p = pin(code),
      accountName = text(name, 'Ad', 80);
    return this.write(async tx => {
      if ((await tx.execute('SELECT id FROM invoice_accounts LIMIT 1')).rows.length)
        throw new InvoiceError('Yönetici hesabı zaten kurulmuş. Hesap kodunla giriş yap.', 409);
      const now = new Date().toISOString();
      await tx.execute({
        sql: "INSERT INTO invoice_accounts (id,name,role,code_digest,created_at) VALUES ('owner',?,'admin',?,?)",
        args: [accountName, this.digest(p), now],
      });
      return this.issueSession(tx, 'owner');
    });
  }
  async isSetup() {
    await this.init();
    return (await this.db.execute('SELECT id FROM invoice_accounts LIMIT 1')).rows.length > 0;
  }
  private async issueSession(tx: Transaction, accountId: string) {
    const token = randomBytes(32).toString('base64url'),
      expiresAt = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
    await tx.execute({
      sql: 'INSERT INTO invoice_sessions (token_digest,account_id,expires_at) VALUES (?,?,?)',
      args: [hash(token), accountId, expiresAt],
    });
    await tx.execute({ sql: 'DELETE FROM invoice_sessions WHERE expires_at < ?', args: [new Date().toISOString()] });
    const row = (await tx.execute({ sql: 'SELECT * FROM invoice_accounts WHERE id=?', args: [accountId] })).rows[0];
    return { token, account: toAccount(row), maxAge: SESSION_DAYS * 86400 };
  }
  async login(code: unknown, address: string) {
    const p = pin(code),
      now = new Date().toISOString(),
      next = new Date(Date.now() + 30 * 60000).toISOString();
    // Both per-address and global limits live in the shared database, across instances.
    const result = await this.write(async tx => {
      const keys = [`ip:${hash(address)}`, 'global'];
      for (const key of keys) {
        const row = (await tx.execute({ sql: 'SELECT * FROM invoice_login_attempts WHERE key=?', args: [key] }))
          .rows[0];
        if (row && String(row.resets_at) > now && Number(row.attempts) >= (key === 'global' ? 20 : 5))
          return { limited: true } as const;
      }
      const row = (
        await tx.execute({
          sql: 'SELECT * FROM invoice_accounts WHERE code_digest=? AND active=1',
          args: [this.digest(p)],
        })
      ).rows[0];
      if (!row) {
        for (const key of keys)
          await tx.execute({
            sql: `INSERT INTO invoice_login_attempts (key,attempts,resets_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN resets_at<=? THEN 1 ELSE attempts+1 END,resets_at=CASE WHEN resets_at<=? THEN ? ELSE resets_at END`,
            args: [key, next, now, now, next],
          });
        return { invalid: true } as const;
      }
      await tx.execute({ sql: 'DELETE FROM invoice_login_attempts WHERE key=?', args: [keys[0]] });
      return this.issueSession(tx, String(row.id));
    });
    if ('limited' in result) throw new InvoiceError('Çok fazla giriş denemesi. 30 dakika sonra tekrar dene.', 429);
    if ('invalid' in result) throw new InvoiceError('Hesap kodu geçersiz veya erişim kapatılmış.', 401);
    return result;
  }
  async session(token: string | undefined) {
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    await this.init();
    const row = (
      await this.db.execute({
        sql: 'SELECT a.* FROM invoice_sessions s JOIN invoice_accounts a ON a.id=s.account_id WHERE s.token_digest=? AND s.expires_at>? AND a.active=1',
        args: [hash(token), new Date().toISOString()],
      })
    ).rows[0];
    return row ? toAccount(row) : null;
  }
  async logout(token: string) {
    await this.init();
    await this.db.execute({ sql: 'DELETE FROM invoice_sessions WHERE token_digest=?', args: [hash(token)] });
  }
  async accounts(actor: InvoiceAccount) {
    this.admin(actor);
    await this.init();
    return (await this.db.execute('SELECT id,name,role,active FROM invoice_accounts ORDER BY created_at')).rows.map(
      toAccount,
    );
  }
  private admin(actor: InvoiceAccount) {
    if (actor.role !== 'admin') throw new InvoiceError('Bu işlem için yönetici hesabı gerekli.', 403);
  }
  async addAccount(actor: InvoiceAccount, body: unknown) {
    this.admin(actor);
    const b = object(body),
      name = text(b.name, 'Ad', 80),
      code = pin(b.code);
    return this.write(async tx => {
      if (
        (await tx.execute({ sql: 'SELECT id FROM invoice_accounts WHERE code_digest=?', args: [this.digest(code)] }))
          .rows.length
      )
        throw new InvoiceError('Bu kod başka bir hesapta kullanılıyor.', 409);
      await tx.execute({
        sql: "INSERT INTO invoice_accounts (id,name,role,code_digest,created_at) VALUES (?,?,'member',?,?)",
        args: [randomUUID(), name, this.digest(code), new Date().toISOString()],
      });
    });
  }
  async disableAccount(actor: InvoiceAccount, id: string) {
    this.admin(actor);
    if (id === actor.id || id === 'owner') throw new InvoiceError('Yönetici hesabının erişimi buradan kapatılamaz.');
    return this.write(async tx => {
      await tx.execute({ sql: 'UPDATE invoice_accounts SET active=0 WHERE id=?', args: [id] });
      await tx.execute({ sql: 'DELETE FROM invoice_sessions WHERE account_id=?', args: [id] });
    });
  }
  async changeCode(actor: InvoiceAccount, body: unknown) {
    this.admin(actor);
    const b = object(body),
      id = text(b.id, 'Hesap'),
      code = pin(b.code);
    return this.write(async tx => {
      if (!(await tx.execute({ sql: 'SELECT id FROM invoice_accounts WHERE id=?', args: [id] })).rows.length)
        throw new InvoiceError('Hesap bulunamadı.', 404);
      if (
        (
          await tx.execute({
            sql: 'SELECT id FROM invoice_accounts WHERE code_digest=? AND id<>?',
            args: [this.digest(code), id],
          })
        ).rows.length
      )
        throw new InvoiceError('Bu kod başka bir hesapta kullanılıyor.', 409);
      await tx.execute({
        sql: 'UPDATE invoice_accounts SET code_digest=?,active=1 WHERE id=?',
        args: [this.digest(code), id],
      });
      await tx.execute({ sql: 'DELETE FROM invoice_sessions WHERE account_id=?', args: [id] });
    });
  }
  async addCompany(body: unknown) {
    const b = object(body),
      name = text(b.name, 'Firma adı', 100);
    return this.write(async tx => {
      const key = name.normalize('NFKC').toLocaleLowerCase('tr-TR').replace(/\s+/g, ' ');
      if (
        (await tx.execute({ sql: 'SELECT id FROM invoice_companies WHERE normalized_name=?', args: [key] })).rows.length
      )
        throw new InvoiceError('Bu firma zaten kayıtlı.', 409);
      await tx.execute({
        sql: 'INSERT INTO invoice_companies (id,name,normalized_name,sort_order,created_at) SELECT ?,?,?,COALESCE(MAX(sort_order),-1)+1,? FROM invoice_companies',
        args: [randomUUID(), name, key, new Date().toISOString()],
      });
    });
  }
  async snapshot(query: {
    companyId?: string;
    search?: string;
    status?: string;
    offset?: number;
  }): Promise<InvoiceSnapshot> {
    await this.init();
    const tx = await this.db.transaction('read');
    try {
      const companies = (
        await tx.execute(
          `SELECT c.id,c.name,c.sort_order,COALESCE(SUM(i.amount_cents),0) total,COALESCE(SUM(i.used_cents),0) used,COUNT(i.id) n,COALESCE(SUM(CASE WHEN i.used_cents<i.amount_cents THEN 1 ELSE 0 END),0) open FROM invoice_companies c LEFT JOIN invoice_records i ON i.company_id=c.id GROUP BY c.id ORDER BY c.sort_order,c.name`,
        )
      ).rows.map(
        r =>
          ({
            id: String(r.id),
            name: String(r.name),
            sortOrder: Number(r.sort_order),
            totalCents: Number(r.total),
            usedCents: Number(r.used),
            remainingCents: Number(r.total) - Number(r.used),
            openCount: Number(r.open),
            invoiceCount: Number(r.n),
          }) satisfies InvoiceCompany,
      );
      const conditions: string[] = [],
        args: string[] = [];
      if (query.companyId) {
        conditions.push('i.company_id=?');
        args.push(query.companyId);
      }
      if (query.search) {
        conditions.push("i.normalized_number LIKE ? ESCAPE '\\'");
        args.push('%' + normalizeNumber(query.search).replace(/[\\%_]/g, '\\$&') + '%');
      }
      if (query.status === 'unused') conditions.push('i.used_cents=0');
      if (query.status === 'partial') conditions.push('i.used_cents>0 AND i.used_cents<i.amount_cents');
      if (query.status === 'closed') conditions.push('i.used_cents=i.amount_cents');
      const where = conditions.length ? ' WHERE ' + conditions.join(' AND ') : '';
      const offset = Math.max(0, Math.min(1000000, Math.trunc(query.offset || 0)));
      const total = Number(
        (await tx.execute({ sql: 'SELECT COUNT(*) n FROM invoice_records i' + where, args })).rows[0].n,
      );
      const invoices = (
        await tx.execute({
          sql: invoiceSelect + where + ' ORDER BY i.invoice_date DESC,i.created_at DESC,i.id LIMIT 50 OFFSET ?',
          args: [...args, offset],
        })
      ).rows.map(invoice);
      await tx.commit();
      return {
        companies,
        invoices,
        total,
        totals: companies.reduce(
          (a, c) => ({
            amountCents: a.amountCents + c.totalCents,
            usedCents: a.usedCents + c.usedCents,
            remainingCents: a.remainingCents + c.remainingCents,
            openCount: a.openCount + c.openCount,
          }),
          { amountCents: 0, usedCents: 0, remainingCents: 0, openCount: 0 },
        ),
      };
    } finally {
      tx.close();
    }
  }
  async usageMeter(actor: InvoiceAccount) {
    this.admin(actor);
    await this.init();
    const key = 'assistant:calls:' + todayInTurkey();
    const hasKv =
      (await this.db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='kv'")).rows.length > 0;
    const rows = hasKv ? (await this.db.execute({ sql: 'SELECT v FROM kv WHERE k=?', args: [key] })).rows : [];
    return rows.length ? Number(rows[0].v) : 0;
  }
  async create(actor: InvoiceAccount, body: unknown) {
    const b = object(body),
      companyId = text(b.companyId, 'Firma'),
      number = text(b.number, 'Fatura numarası', 100),
      invoiceDate = date(b.date),
      amount = cents(b.amountCents),
      used = cents(b.usedCents ?? 0, true);
    if (used > amount) throw new InvoiceError('Kullanılan tutar fatura tutarını aşamaz.');
    return this.write(async tx => {
      if (!(await tx.execute({ sql: 'SELECT id FROM invoice_companies WHERE id=?', args: [companyId] })).rows.length)
        throw new InvoiceError('Firma bulunamadı.');
      if (
        (
          await tx.execute({
            sql: 'SELECT id FROM invoice_records WHERE company_id=? AND normalized_number=?',
            args: [companyId, normalizeNumber(number)],
          })
        ).rows.length
      )
        throw new InvoiceError('Bu firmada aynı numaralı fatura zaten kayıtlı. Önce mevcut kaydı kontrol et.', 409);
      const id = randomUUID(),
        now = new Date().toISOString();
      await tx.execute({
        sql: 'INSERT INTO invoice_records (id,company_id,number,normalized_number,invoice_date,amount_cents,used_cents,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)',
        args: [id, companyId, number, normalizeNumber(number), invoiceDate, amount, used, now, now],
      });
      if (used)
        await tx.execute({
          sql: 'INSERT INTO invoice_events (id,invoice_id,delta_cents,event_date,note,account_id,idempotency_key,created_at) VALUES (?,?,?,?,?,?,?,?)',
          args: [
            randomUUID(),
            id,
            used,
            todayInTurkey(),
            'Açılış bakiyesi: kayıt öncesinde kullanılmış tutar',
            actor.id,
            randomUUID(),
            now,
          ],
        });
      return { id };
    });
  }
  async update(body: unknown) {
    const b = object(body),
      id = text(b.id, 'Fatura'),
      number = text(b.number, 'Fatura numarası', 100),
      invoiceDate = date(b.date),
      amount = cents(b.amountCents);
    if (!Number.isSafeInteger(b.version)) throw new InvoiceError('Kayıt sürümü geçersiz.');
    return this.write(async tx => {
      const row = (await tx.execute({ sql: 'SELECT * FROM invoice_records WHERE id=?', args: [id] })).rows[0];
      if (!row) throw new InvoiceError('Fatura bulunamadı.', 404);
      if (Number(row.version) !== b.version)
        throw new InvoiceError('Bu kayıt başka bir işlemle güncellendi. Yenileyip tekrar kontrol et.', 409);
      if (amount < Number(row.used_cents)) throw new InvoiceError('Fatura tutarı kullanılmış tutardan az olamaz.');
      if (
        (
          await tx.execute({
            sql: 'SELECT id FROM invoice_records WHERE company_id=? AND normalized_number=? AND id<>?',
            args: [row.company_id, normalizeNumber(number), id],
          })
        ).rows.length
      )
        throw new InvoiceError('Aynı numaralı fatura zaten kayıtlı.', 409);
      await tx.execute({
        sql: 'UPDATE invoice_records SET number=?,normalized_number=?,invoice_date=?,amount_cents=?,version=version+1,updated_at=? WHERE id=?',
        args: [number, normalizeNumber(number), invoiceDate, amount, new Date().toISOString(), id],
      });
    });
  }
  async usage(actor: InvoiceAccount, body: unknown) {
    const b = object(body),
      id = text(b.id, 'Fatura'),
      amount = cents(b.amountCents),
      eventDate = date(b.date),
      note = text(b.note, 'Kullanım açıklaması', 500),
      requestId = text(b.requestId, 'İşlem anahtarı', 100);
    return this.write(async tx => {
      const previous = (
        await tx.execute({ sql: 'SELECT * FROM invoice_events WHERE idempotency_key=?', args: [requestId] })
      ).rows[0];
      if (previous) {
        if (
          previous.invoice_id !== id ||
          Number(previous.delta_cents) !== amount ||
          previous.account_id !== actor.id ||
          previous.note !== note ||
          previous.event_date !== eventDate
        )
          throw new InvoiceError('İşlem anahtarı başka bir kayıtta kullanılmış.', 409);
        return;
      }
      const row = (await tx.execute({ sql: 'SELECT * FROM invoice_records WHERE id=?', args: [id] })).rows[0];
      if (!row) throw new InvoiceError('Fatura bulunamadı.', 404);
      if (amount > Number(row.amount_cents) - Number(row.used_cents))
        throw new InvoiceError('Kullanım, faturanın kalan tutarını aşıyor. Güncel kaydı kontrol et.', 409);
      const now = new Date().toISOString();
      await tx.execute({
        sql: 'UPDATE invoice_records SET used_cents=used_cents+?,version=version+1,updated_at=? WHERE id=?',
        args: [amount, now, id],
      });
      await tx.execute({
        sql: 'INSERT INTO invoice_events (id,invoice_id,delta_cents,event_date,note,account_id,idempotency_key,created_at) VALUES (?,?,?,?,?,?,?,?)',
        args: [randomUUID(), id, amount, eventDate, note, actor.id, requestId, now],
      });
    });
  }
  async reverse(actor: InvoiceAccount, body: unknown) {
    const b = object(body),
      eventId = text(b.eventId, 'Kullanım'),
      note = text(b.note, 'İptal açıklaması', 500);
    return this.write(async tx => {
      const row = (await tx.execute({ sql: 'SELECT * FROM invoice_events WHERE id=?', args: [eventId] })).rows[0];
      if (!row || Number(row.delta_cents) <= 0) throw new InvoiceError('İptal edilecek kullanım bulunamadı.', 404);
      if ((await tx.execute({ sql: 'SELECT id FROM invoice_events WHERE reversal_of=?', args: [eventId] })).rows.length)
        throw new InvoiceError('Bu kullanım zaten iptal edilmiş.', 409);
      const now = new Date().toISOString();
      await tx.execute({
        sql: 'UPDATE invoice_records SET used_cents=used_cents-?,version=version+1,updated_at=? WHERE id=?',
        args: [row.delta_cents, now, row.invoice_id],
      });
      await tx.execute({
        sql: 'INSERT INTO invoice_events (id,invoice_id,delta_cents,event_date,note,account_id,idempotency_key,reversal_of,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
        args: [
          randomUUID(),
          row.invoice_id,
          -Number(row.delta_cents),
          todayInTurkey(),
          note,
          actor.id,
          randomUUID(),
          eventId,
          now,
        ],
      });
    });
  }
  async history(id: string): Promise<{ invoice: Invoice; events: InvoiceEvent[] }> {
    await this.init();
    const tx = await this.db.transaction('read');
    try {
      const row = (await tx.execute({ sql: invoiceSelect + ' WHERE i.id=?', args: [id] })).rows[0];
      if (!row) throw new InvoiceError('Fatura bulunamadı.', 404);
      const events = (
        await tx.execute({
          sql: 'SELECT e.*,a.name account_name,EXISTS(SELECT 1 FROM invoice_events r WHERE r.reversal_of=e.id) reversed FROM invoice_events e JOIN invoice_accounts a ON a.id=e.account_id WHERE e.invoice_id=? ORDER BY e.created_at DESC,e.id',
          args: [id],
        })
      ).rows.map(r => ({
        id: String(r.id),
        invoiceId: String(r.invoice_id),
        deltaCents: Number(r.delta_cents),
        date: String(r.event_date),
        note: String(r.note),
        accountName: String(r.account_name),
        createdAt: String(r.created_at),
        reversalOf: r.reversal_of ? String(r.reversal_of) : null,
        reversed: Boolean(r.reversed),
      }));
      await tx.commit();
      return { invoice: invoice(row), events };
    } finally {
      tx.close();
    }
  }
}
