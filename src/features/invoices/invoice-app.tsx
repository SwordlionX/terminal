'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import {
  ArrowDownToLine,
  Building2,
  Check,
  ChevronLeft,
  ChevronRight,
  FileText,
  History,
  LockKeyhole,
  LogOut,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Upload,
  X,
} from 'lucide-react';
import { AppSwitcher } from '@/components/app-switcher';
import { InstallInvoiceApp } from './install-app';
import { CURRENCIES, formatMoney, parseMoney, STATUS_LABELS, todayInTurkey, csvCell } from './model';
import type { DocumentSummary, Invoice, InvoiceAccount, InvoiceCompany, InvoiceEvent, InvoiceSnapshot } from './model';
import { readUploadQueue, MAX_UPLOAD_FILES } from './upload-queue';

class RequestError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    cache: 'no-store',
    ...options,
    headers: {
      ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...options.headers,
    },
  });
  const data = await res.json().catch(() => ({ error: 'Sunucu yanıtı okunamadı.' }));
  if (!res.ok) throw new RequestError(data.error || 'İşlem tamamlanamadı.', res.status);
  return data as T;
}
const post = (body: Record<string, unknown>) =>
  api<{ ok: boolean; id?: string }>('/api/fatura', { method: 'POST', body: JSON.stringify(body) });
const day = (value: string) => value.split('-').reverse().join('.');
type Session = { account: InvoiceAccount | null; setupRequired: boolean };
type Extracted = {
  companyName: string | null;
  companyId: string | null;
  number: string | null;
  date: string | null;
  amountCents: number | null;
  currency: string | null;
  numberLabel: string;
  document: DocumentSummary;
  warnings: string[];
  /** Server signature over the read fields; required to keep a QR agreement claim. */
  proof?: string;
};
type Modal =
  | { type: 'new'; extracted?: Extracted }
  | { type: 'batch'; documents: ReviewItem[]; failures?: string[] }
  | { type: 'edit'; invoice: Invoice }
  | { type: 'usage'; invoice: Invoice }
  | { type: 'company' }
  | { type: 'accounts' }
  | { type: 'duplicate'; invoices: Invoice[] }
  | null;

type ReviewItem = { fileName: string; value: Extracted | { duplicates: Invoice[] } };

function ModalFrame({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="invoice-dialog"
      aria-label={title}
      onCancel={e => {
        e.preventDefault();
        onClose();
      }}
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="invoice-dialog-inner">
        <div className="invoice-dialog-heading">
          <h2>{title}</h2>
          <button type="button" className="inv-icon" onClick={onClose} aria-label="Pencereyi kapat">
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
function PinInput({ name = 'code', label = '4 haneli hesap kodu' }: { name?: string; label?: string }) {
  return (
    <label className="inv-field">
      {label}
      <input
        name={name}
        className="inv-pin"
        type="password"
        inputMode="numeric"
        pattern="[0-9]{4}"
        minLength={4}
        maxLength={4}
        autoComplete="off"
        required
        placeholder="••••"
      />
    </label>
  );
}
function Login({
  setupRequired,
  setupToken,
  onLogin,
}: {
  setupRequired: boolean;
  setupToken: string;
  onLogin: (account: InvoiceAccount) => void;
}) {
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const setup = setupRequired && !!setupToken;
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const f = new FormData(e.currentTarget);
    try {
      if (setup && f.get('code') !== f.get('confirm')) throw new Error('Girdiğin kodlar aynı değil.');
      const result = await api<{ account: InvoiceAccount }>('/api/fatura/oturum', {
        method: 'POST',
        body: JSON.stringify({
          action: setup ? 'setup' : 'login',
          code: f.get('code'),
          name: f.get('name'),
          setupToken,
        }),
      });
      window.history.replaceState(null, '', '/fatura-takip');
      onLogin(result.account);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="inv-login">
      <div className="inv-login-intro">
        <span className="inv-eyebrow">3N FİNANS</span>
        <FileText size={42} strokeWidth={1.3} />
        <h1>
          Fatura takip <br />
          çalışma alanı
        </h1>
        <p>Firmaların faturalarını, kullanılan tutarları ve kalan bakiyeleri birlikte takip edin.</p>
        <div className="inv-login-note">
          <ShieldCheck size={20} />
          <span>
            Her hesap için ayrı erişim.
            <br />
            Her kullanım için işlem geçmişi.
          </span>
        </div>
      </div>
      <div className="inv-login-form">
        <span className="inv-lock">
          <LockKeyhole size={24} />
        </span>
        <h2>{setup ? 'Yönetici hesabını oluştur' : 'Çalışma alanına giriş'}</h2>
        <p>
          {setup
            ? 'Adını ve kullanmak istediğin 4 haneli kodu belirle. Diğer kişilerin kodlarını giriş yaptıktan sonra oluşturabilirsin.'
            : setupRequired
              ? 'Yönetici kurulumu henüz tamamlanmamış. Sana verilen ilk kurulum bağlantısını kullan.'
              : 'Sana özel 4 haneli hesap koduyla giriş yap.'}
        </p>
        {(!setupRequired || setup) && (
          <form onSubmit={submit}>
            {setup && (
              <label className="inv-field">
                Adın
                <input name="name" autoComplete="name" maxLength={80} required />
              </label>
            )}
            <PinInput />
            {setup && <PinInput name="confirm" label="Kodu tekrar yaz" />}
            {error && (
              <p className="inv-error" role="alert">
                {error}
              </p>
            )}
            <button className="inv-primary" disabled={busy}>
              {busy ? 'Giriş yapılıyor…' : setup ? 'Hesabımı oluştur' : 'Giriş yap'}
            </button>
            <small>Bu tarayıcıda oturumun 90 gün açık kalır. Ortak bilgisayarda işin bitince çıkış yap.</small>
          </form>
        )}
      </div>
    </main>
  );
}

export function InvoiceApp() {
  const [session, setSession] = useState<Session | null>(null),
    [authError, setAuthError] = useState(''),
    [setupToken, setSetupToken] = useState('');
  const checkSession = useCallback(async () => {
    try {
      const nextSession = await api<Session>('/api/fatura/oturum');
      setSession(nextSession);
      setSetupToken(new URL(window.location.href).searchParams.get('kurulum') || '');
      setAuthError('');
    } catch (error) {
      setAuthError((error as Error).message);
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    api<Session>('/api/fatura/oturum', { signal: controller.signal })
      .then(nextSession => {
        setSession(nextSession);
        setSetupToken(new URL(window.location.href).searchParams.get('kurulum') || '');
      })
      .catch(error => {
        if (error.name !== 'AbortError') setAuthError(error.message);
      });
    return () => controller.abort();
  }, []);
  return (
    <div className="invoice-app">
      <header className="invoice-topbar">
        <AppSwitcher />
        <div className="inv-topbar-right">
          {session?.account ? (
            <>
              <span className="inv-account-name">
                <span className="inv-avatar">{session.account.name.slice(0, 1)}</span>
                {session.account.name}
              </span>
              <button
                className="inv-secondary"
                onClick={async () => {
                  try {
                    await api('/api/fatura/oturum', { method: 'DELETE' });
                    setSession({ account: null, setupRequired: false });
                  } catch (error) {
                    setAuthError((error as Error).message);
                  }
                }}
              >
                <LogOut size={15} />
                Çıkış
              </button>
            </>
          ) : (
            <span className="inv-private">
              <LockKeyhole size={14} />
              Yetkili erişimi
            </span>
          )}
        </div>
      </header>
      <InstallInvoiceApp />
      {authError ? (
        <div className="inv-access-error">
          <p role="alert">{authError}</p>
          <button className="inv-secondary" onClick={() => void checkSession()}>
            <RefreshCw size={16} />
            Tekrar dene
          </button>
        </div>
      ) : !session ? (
        <div className="inv-loading" role="status">
          Oturum kontrol ediliyor…
        </div>
      ) : session.account ? (
        <Workspace account={session.account} onExpired={() => setSession({ account: null, setupRequired: false })} />
      ) : (
        <Login
          setupRequired={session.setupRequired}
          setupToken={setupToken}
          onLogin={account => setSession({ account, setupRequired: false })}
        />
      )}
    </div>
  );
}

function Workspace({ account, onExpired }: { account: InvoiceAccount; onExpired: () => void }) {
  const [snapshot, setSnapshot] = useState<InvoiceSnapshot | null>(null),
    [companyId, setCompanyId] = useState(''),
    [search, setSearch] = useState(''),
    [query, setQuery] = useState(''),
    [status, setStatus] = useState(''),
    [currencyFilter, setCurrencyFilter] = useState(''),
    [offset, setOffset] = useState(0),
    [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [modal, setModal] = useState<Modal>(null),
    [historyId, setHistoryId] = useState(''),
    [reading, setReading] = useState(false),
    [readingStage, setReadingStage] = useState(''),
    [drag, setDrag] = useState(false);
  const upload = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search);
      setOffset(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      setError('');
      try {
        const q = new URLSearchParams({
          company: companyId,
          search: query,
          status,
          currency: currencyFilter,
          offset: String(offset),
        });
        const result = await api<InvoiceSnapshot>('/api/fatura?' + q, { signal: controller.signal });
        setSnapshot(result);
      } catch (error) {
        if ((error as Error).name === 'AbortError') return;
        if (error instanceof RequestError && error.status === 401) onExpired();
        else setError((error as Error).message);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [companyId, query, status, currencyFilter, offset, revision, onExpired]);
  // Refresh shared records when returning to the tab; data stays on the server.
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible') setRevision(v => v + 1);
    };
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, []);
  const selected = snapshot?.companies.find(c => c.id === companyId);
  const balances = (selected?.balances || snapshot?.balances || []).filter(
    b => !currencyFilter || b.currency === currencyFilter,
  );
  const saved = () => {
    setModal(null);
    setRevision(v => v + 1);
    setNotice('Kayıt kaydedildi.');
  };
  async function readFiles(files: File[]) {
    if (!files.length || reading) return;
    setReading(true);
    setError('');
    setNotice('');
    try {
      if (files.length > MAX_UPLOAD_FILES) throw new Error('Bir seferde en fazla 10 dosya yükle.');
      const { readDocumentQr } = await import('./read-qr');
      type Scan = Awaited<ReturnType<typeof readDocumentQr>>;
      const { results, failures } = await readUploadQueue<Extracted | { duplicates: Invoice[] }, Scan>(
        files,
        async (file, index, prepared) => {
          const progress = `${index + 1} / ${files.length} · ${file.name}`;
          setReadingStage(`${progress} — QR ve PDF metni kontrol ediliyor…`);
          // The next file's local scan already ran while the previous file was on the server.
          const qr = prepared ?? (await readDocumentQr(file));
          const form = new FormData();
          form.append('file', file);
          form.append('qrCodes', JSON.stringify(qr.codes));
          if (qr.pdfPages) form.append('pdfPages', JSON.stringify(qr.pdfPages));
          setReadingStage(`${progress} — Bilgiler doğrulanıyor; gerekirse ayrıntılı okunuyor…`);
          const data = await api<
            Extracted | { duplicates: Invoice[] } | { documents: (Extracted & { duplicates?: Invoice[] })[] }
          >('/api/fatura/mesnet', { method: 'POST', body: form, signal: AbortSignal.timeout(65000) });
          return 'documents' in data ? data.documents : [data];
        },
        error => error instanceof RequestError && error.status === 401,
        file => readDocumentQr(file),
      );
      if (results.length) setModal({ type: 'batch', documents: results, failures });
      else setError(failures.join('\n'));
    } catch (error) {
      if (error instanceof RequestError && error.status === 401) onExpired();
      else
        setError(
          (error as Error).name === 'TimeoutError'
            ? 'Belge okuma süresi doldu. Biraz sonra yeniden dene.'
            : (error as Error).message,
        );
    } finally {
      setReading(false);
      if (upload.current) upload.current.value = '';
    }
  }
  async function exportCsv() {
    setError('');
    try {
      const rows: Invoice[] = [];
      let start = 0,
        total = 1;
      while (start < total) {
        const q = new URLSearchParams({
          company: companyId,
          search: query,
          status,
          currency: currencyFilter,
          offset: String(start),
        });
        const result = await api<InvoiceSnapshot>('/api/fatura?' + q);
        total = result.total;
        rows.push(...result.invoices);
        start += 50;
      }
      const lines = [
        [
          'Firma',
          'Fatura Tarihi',
          'Fatura Numarası',
          'Para Birimi',
          'Fatura Tutarı',
          'Kullanılan Tutar',
          'Kalan Tutar',
          'Durum',
        ],
        ...rows.map(r => [
          r.companyName,
          day(r.date),
          r.number,
          r.currency,
          ...[r.amountCents, r.usedCents, r.remainingCents].map(v => (v / 100).toFixed(2).replace('.', ',')),
          STATUS_LABELS[r.status],
        ]),
      ];
      const url = URL.createObjectURL(
        new Blob(['\uFEFF' + lines.map(r => r.map(csvCell).join(';')).join('\r\n')], {
          type: 'text/csv;charset=utf-8',
        }),
      );
      const a = document.createElement('a');
      a.href = url;
      a.download = 'fatura-takip.csv';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      setError((error as Error).message);
    }
  }
  return (
    <div className="inv-workspace">
      <aside className="inv-company-sidebar">
        <p className="inv-sidebar-label">FATURA TAKİBİ</p>
        <button
          className="inv-company-button"
          aria-current={!companyId ? 'page' : undefined}
          onClick={() => {
            setCompanyId('');
            setOffset(0);
          }}
        >
          <span className="inv-company-icon">
            <Building2 size={17} />
          </span>
          <span>
            Tüm firmalar<small>Genel özet</small>
          </span>
          <span className="inv-count">{snapshot?.companies.length ?? '—'}</span>
        </button>
        <div className="inv-firms-heading">
          <p className="inv-sidebar-label">FİRMALAR</p>
          {account.role === 'admin' && (
            <button className="inv-icon" onClick={() => setModal({ type: 'company' })} aria-label="Firma ekle">
              <Plus size={16} />
            </button>
          )}
        </div>
        {snapshot?.companies.map(c => (
          <button
            key={c.id}
            className="inv-company-button"
            aria-current={companyId === c.id ? 'page' : undefined}
            onClick={() => {
              setCompanyId(c.id);
              setOffset(0);
            }}
          >
            <span className="inv-company-initial">{c.name[0]}</span>
            <span>
              {c.name}
              <small>
                {c.balances.length
                  ? c.balances.map(b => formatMoney(b.remainingCents, b.currency)).join(' · ') + ' kalan'
                  : 'Henüz fatura yok'}
              </small>
            </span>
            <span className="inv-count">{c.openCount}</span>
          </button>
        ))}
        <div className="inv-sidebar-bottom">
          <ShieldCheck size={16} />
          <p>
            Ortak çalışma alanı<small>Değişiklikler tüm hesaplarda görünür.</small>
          </p>
        </div>
      </aside>
      <main className="inv-main">
        <div className="inv-page-heading">
          <div>
            <span className="inv-eyebrow">FATURA TAKİP</span>
            <h1>{selected?.name || 'Tüm firmalar'}</h1>
            <p>Faturaları ve kullanım bakiyelerini takip et.</p>
          </div>
          <div className="inv-heading-actions">
            {account.role === 'admin' && (
              <button className="inv-secondary" onClick={() => setModal({ type: 'accounts' })}>
                <ShieldCheck size={16} />
                Hesaplar
              </button>
            )}
            <button className="inv-primary" onClick={() => setModal({ type: 'new' })} disabled={!snapshot}>
              <Plus size={17} />
              Fatura ekle
            </button>
          </div>
        </div>
        {notice && (
          <div className="inv-success" role="status">
            <Check size={16} />
            {notice}
            <button className="inv-icon" aria-label="Bildirimi kapat" onClick={() => setNotice('')}>
              <X size={15} />
            </button>
          </div>
        )}
        {error && (
          <div className="inv-error" role="alert">
            {error}{' '}
            <button onClick={() => setRevision(v => v + 1)} className="inv-text-button">
              Yenile
            </button>
          </div>
        )}
        <div className="inv-currency-summaries" aria-label="Para birimine göre fatura özeti">
          {balances.length === 0 && (
            <p className="inv-muted">{loading ? 'Özet yükleniyor…' : 'Bu seçimde henüz fatura bakiyesi yok.'}</p>
          )}
          {balances.map(totals => (
            <section key={totals.currency} aria-label={totals.currency + ' özeti'}>
              <h2 className="inv-currency-title">{totals.currency} bakiyeleri</h2>
              <div className="inv-metrics">
                {[
                  ['Toplam fatura', formatMoney(totals.amountCents, totals.currency)],
                  ['Kullanılan tutar', formatMoney(totals.usedCents, totals.currency)],
                  ['Kalan tutar', formatMoney(totals.remainingCents, totals.currency)],
                  ['Açık fatura', String(totals.openCount)],
                ].map(([label, value], i) => (
                  <div className={'inv-metric ' + (i === 2 ? 'inv-metric-accent' : '')} key={label}>
                    <span>{label}</span>
                    <strong>{value}</strong>
                    {i === 3 && <small>Kalan tutarı sıfırdan büyük</small>}
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
        <section
          className={`inv-upload ${drag ? 'inv-drag' : ''} ${reading ? 'inv-upload-busy' : ''}`}
          onDragOver={e => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={e => {
            e.preventDefault();
            setDrag(false);
            void readFiles(Array.from(e.dataTransfer.files));
          }}
          aria-busy={reading}
        >
          <span className="inv-upload-icon">
            <Upload size={23} />
          </span>
          <div>
            <h2>{reading ? 'Mesnet okunuyor…' : 'Mesnedi buraya bırak'}</h2>
            <p>
              {reading
                ? readingStage || 'Belge hazırlanıyor…'
                : 'En fazla 10 PDF veya fotoğraf seç. Her dosya en fazla 3 MB, her dosyada en fazla 10 mesnet olabilir.'}
            </p>
          </div>
          <button className="inv-secondary" onClick={() => upload.current?.click()} disabled={reading}>
            Dosya seç
          </button>
          <input
            hidden
            ref={upload}
            type="file"
            multiple
            accept="application/pdf,image/png,image/jpeg,image/webp"
            onChange={e => void readFiles(Array.from(e.target.files || []))}
          />
        </section>
        <section className="inv-records">
          <div className="inv-records-heading">
            <h2>
              Faturalar <span>{snapshot?.total ?? '—'}</span>
            </h2>
            <div>
              <button className="inv-secondary" onClick={() => void exportCsv()} disabled={!snapshot || loading}>
                <ArrowDownToLine size={15} />
                CSV indir
              </button>
              <button
                className="inv-icon"
                onClick={() => setRevision(v => v + 1)}
                aria-label="Faturaları yenile"
                disabled={loading}
              >
                <RefreshCw size={16} />
              </button>
            </div>
          </div>
          <div className="inv-toolbar">
            <label className="inv-search">
              <Search size={17} />
              <input
                aria-label="Fatura numarası ara"
                placeholder="Fatura numarası ara…"
                maxLength={100}
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
              {search && (
                <button className="inv-icon" aria-label="Aramayı temizle" onClick={() => setSearch('')}>
                  <X size={14} />
                </button>
              )}
            </label>
            <label className="inv-status-filter">
              <span>Durum</span>
              <select
                value={status}
                onChange={e => {
                  setStatus(e.target.value);
                  setOffset(0);
                }}
              >
                <option value="">Tümü</option>
                <option value="unused">Kullanılmamış</option>
                <option value="partial">Kısmen kullanılmış</option>
                <option value="closed">Tamamı kullanılmış</option>
              </select>
            </label>
            <label className="inv-status-filter">
              <span>Para birimi</span>
              <select
                value={currencyFilter}
                onChange={e => {
                  setCurrencyFilter(e.target.value);
                  setOffset(0);
                }}
              >
                <option value="">Tümü</option>
                {CURRENCIES.map(unit => (
                  <option key={unit} value={unit}>
                    {unit}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="inv-table-wrap" aria-busy={loading}>
            <table>
              <thead>
                <tr>
                  <th>Fatura / Firma</th>
                  <th>Tarih</th>
                  <th>Fatura tutarı</th>
                  <th>Kullanılan</th>
                  <th>Kalan</th>
                  <th>Durum</th>
                  <th>
                    <span className="inv-sr-only">İşlemler</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {!loading &&
                  snapshot?.invoices.map(r => (
                    <tr key={r.id} className={r.status === 'closed' ? 'inv-closed' : ''}>
                      <td>
                        <button className="inv-invoice-link" onClick={() => setHistoryId(r.id)}>
                          {r.number}
                        </button>
                        <small>{r.companyName}</small>
                      </td>
                      <td>{day(r.date)}</td>
                      <td className="inv-money">{formatMoney(r.amountCents, r.currency)}</td>
                      <td className="inv-money">{formatMoney(r.usedCents, r.currency)}</td>
                      <td className="inv-money inv-remaining">{formatMoney(r.remainingCents, r.currency)}</td>
                      <td>
                        <span className={'inv-badge inv-' + r.status}>{STATUS_LABELS[r.status]}</span>
                      </td>
                      <td>
                        <div className="inv-row-actions">
                          <button
                            className="inv-text-button"
                            onClick={() => setModal({ type: 'usage', invoice: r })}
                            disabled={r.remainingCents === 0}
                          >
                            Kullanım ekle
                          </button>
                          <button
                            className="inv-icon"
                            onClick={() => setHistoryId(r.id)}
                            aria-label={`${r.number} kullanım geçmişi`}
                          >
                            <History size={17} />
                          </button>
                          <button className="inv-text-button" onClick={() => setModal({ type: 'edit', invoice: r })}>
                            Düzenle
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
            {loading ? (
              <div className="inv-empty" role="status">
                <RefreshCw size={23} className="inv-spin" />
                <p>Faturalar yükleniyor…</p>
              </div>
            ) : !snapshot?.invoices.length ? (
              <div className="inv-empty">
                <FileText size={30} strokeWidth={1.2} />
                <h3>
                  {search || status
                    ? 'Aramana uygun fatura bulunamadı'
                    : error
                      ? 'Faturalar yüklenemedi'
                      : 'Henüz fatura yok'}
                </h3>
                <p>
                  {search || status
                    ? 'Fatura numarasını veya filtreleri kontrol et.'
                    : 'Yeni bir fatura ekle veya mesnet dosyasını yükle.'}
                </p>
              </div>
            ) : null}
          </div>
          <div className="inv-pagination">
            <span>
              {snapshot?.total
                ? `${offset + 1}–${Math.min(offset + 50, snapshot.total)} / ${snapshot.total} kayıt`
                : '0 kayıt'}
            </span>
            <div>
              <button
                className="inv-icon"
                aria-label="Önceki sayfa"
                disabled={offset === 0 || loading}
                onClick={() => setOffset(v => v - 50)}
              >
                <ChevronLeft size={18} />
              </button>
              <button
                className="inv-icon"
                aria-label="Sonraki sayfa"
                disabled={!snapshot || offset + 50 >= snapshot.total || loading}
                onClick={() => setOffset(v => v + 50)}
              >
                <ChevronRight size={18} />
              </button>
            </div>
          </div>
        </section>
      </main>
      {modal?.type === 'accounts' ? (
        <AccountsModal account={account} onClose={() => setModal(null)} onExpired={onExpired} />
      ) : modal?.type === 'duplicate' ? (
        <DuplicateModal
          invoices={modal.invoices}
          onClose={() => setModal(null)}
          onOpen={id => {
            setModal(null);
            setHistoryId(id);
          }}
        />
      ) : modal?.type === 'batch' ? (
        <BatchReview
          documents={modal.documents}
          failures={modal.failures}
          companies={snapshot?.companies || []}
          onClose={() => setModal(null)}
          onChanged={() => setRevision(v => v + 1)}
        />
      ) : modal ? (
        <EntryModal
          modal={modal}
          companies={snapshot?.companies || []}
          selectedCompany={companyId}
          onClose={() => setModal(null)}
          onSaved={saved}
          onDuplicate={invoices => setModal({ type: 'duplicate', invoices })}
        />
      ) : null}
      {historyId && (
        <HistoryModal id={historyId} onClose={() => setHistoryId('')} onChanged={() => setRevision(v => v + 1)} />
      )}
    </div>
  );
}

function DuplicateModal({
  invoices,
  onClose,
  onOpen,
  closeLabel = 'Kapat',
}: {
  invoices: Invoice[];
  onClose: () => void;
  onOpen?: (id: string) => void;
  closeLabel?: string;
}) {
  return (
    <ModalFrame title="Bu fatura daha önce kaydedilmiş" onClose={onClose}>
      <div className="inv-duplicate-warning" role="alert">
        <strong>Bu belgeyi tekrar kaydetmedik.</strong>
        <p>Aynı belge numarası daha önce şu firmaya kaydedilmiş:</p>
      </div>
      {invoices.map(invoice => (
        <div className="inv-usage-summary" key={invoice.id}>
          <strong>{invoice.companyName}</strong>
          <span>Belge No: {invoice.number}</span>
          <p>Tarih: {day(invoice.date)}</p>
          <p>
            Belge tutarı <b>{formatMoney(invoice.amountCents, invoice.currency)}</b>
          </p>
          <p>
            Kullanılan <b>{formatMoney(invoice.usedCents, invoice.currency)}</b>
          </p>
          <p>
            Kalan <b>{formatMoney(invoice.remainingCents, invoice.currency)}</b>
          </p>
          {onOpen && (
            <button className="inv-primary" type="button" onClick={() => onOpen(invoice.id)}>
              Mevcut kaydı aç
            </button>
          )}
        </div>
      ))}
      <div className="inv-form-footer">
        <button className="inv-secondary" type="button" onClick={onClose}>
          {closeLabel}
        </button>
      </div>
    </ModalFrame>
  );
}

function BatchReview({
  documents,
  failures = [],
  companies,
  onClose,
  onChanged,
}: {
  documents: ReviewItem[];
  failures?: string[];
  companies: InvoiceCompany[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [duplicates, setDuplicates] = useState<Invoice[] | null>(null);
  const [savedCount, setSavedCount] = useState(0);
  const [errorsAcknowledged, setErrorsAcknowledged] = useState(false);
  const current = documents[index];
  const next = () => {
    setDuplicates(null);
    setIndex(i => i + 1);
  };
  if (failures.length && !errorsAcknowledged)
    return (
      <ModalFrame title="Bazı dosyalar okunamadı" onClose={onClose}>
        <ul>
          {failures.map((failure, i) => (
            <li key={i}>{failure}</li>
          ))}
        </ul>
        <p>
          Başarıyla okunan {documents.length} mesnet kontrol için hazır. Hatalı dosyaları ayrıca yeniden
          yükleyebilirsin.
        </p>
        <button className="inv-primary" onClick={() => setErrorsAcknowledged(true)}>
          Okunan mesnetleri incele
        </button>
      </ModalFrame>
    );
  if (!current)
    return (
      <ModalFrame title="Mesnet kontrolü tamamlandı" onClose={onClose}>
        <p>
          {documents.length} mesnet incelendi. {savedCount} yeni kayıt kaydedildi; diğerleri atlandı.
        </p>
        <button className="inv-primary" type="button" onClick={onClose}>
          Tamam
        </button>
      </ModalFrame>
    );
  const value = current.value;
  const found = duplicates ?? ('duplicates' in value ? value.duplicates : undefined);
  if (found?.length)
    return (
      <DuplicateModal
        invoices={found}
        onClose={next}
        closeLabel={`${current.fileName} · ${index + 1} / ${documents.length} — Bu mesnedi atla ve devam et`}
      />
    );
  if (!('document' in value)) return null;
  return (
    <EntryModal
      key={index}
      modal={{ type: 'new', extracted: value }}
      companies={companies}
      selectedCompany=""
      onDuplicate={setDuplicates}
      onClose={() => {
        if (window.confirm('Kalan mesnetleri incelemeden kapatmak istiyor musun? Kaydedilenler korunur.')) onClose();
      }}
      onSaved={() => {
        setSavedCount(n => n + 1);
        onChanged();
        next();
      }}
      progress={`${current.fileName} · ${index + 1} / ${documents.length} mesnet · ${savedCount} kaydedildi`}
      onSkip={next}
    />
  );
}

function EntryModal({
  modal,
  companies,
  selectedCompany,
  onClose,
  onSaved,
  onDuplicate,
  progress,
  onSkip,
}: {
  modal: Exclude<Modal, null | { type: 'accounts' } | { type: 'duplicate' } | { type: 'batch' }>;
  companies: InvoiceCompany[];
  selectedCompany: string;
  onClose: () => void;
  onSaved: () => void;
  onDuplicate: (invoices: Invoice[]) => void;
  progress?: string;
  onSkip?: () => void;
}) {
  const existing = modal.type === 'edit' || modal.type === 'usage' ? modal.invoice : undefined,
    extracted = modal.type === 'new' ? modal.extracted : undefined;
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [draft, setDraft] = useState<Record<string, unknown> | null>(() =>
      extracted?.companyId && extracted.number && extracted.date && extracted.amountCents && extracted.currency
        ? {
            action: 'create',
            companyId: extracted.companyId,
            number: extracted.number,
            date: extracted.date,
            amountCents: extracted.amountCents,
            currency: extracted.currency,
          }
        : null,
    ),
    [edited, setEdited] = useState(false),
    requestId = useRef<string>(crypto.randomUUID());
  const [unit, setUnit] = useState(existing?.currency || (extracted ? extracted.currency || '' : 'TRY'));
  const amount = (n: number | undefined | null) => (n == null ? '' : (n / 100).toFixed(2).replace('.', ','));
  async function saveDraft() {
    if (!draft || busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await api<{ duplicates: Invoice[] }>(
        '/api/fatura?action=duplicates&number=' + encodeURIComponent(String(draft.number)),
      );
      if (result.duplicates.length) {
        onDuplicate(result.duplicates);
        return;
      }
      await post({
        ...draft,
        source: extracted ? 'document' : 'manual',
        confirmed: true,
        document: extracted?.document
          ? { ...extracted.document, qrStatus: edited ? 'partial' : extracted.document.qrStatus }
          : null,
        ...(extracted?.proof && !edited ? { proof: extracted.proof } : {}),
      });
      onSaved();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const f = new FormData(e.currentTarget);
    try {
      const b: Record<string, unknown> =
        modal.type === 'company'
          ? { action: 'company', name: f.get('name') }
          : modal.type === 'usage'
            ? {
                action: 'usage',
                id: existing!.id,
                amountCents: parseMoney(String(f.get('amount'))),
                date: f.get('date'),
                note: f.get('note'),
                requestId: requestId.current,
              }
            : modal.type === 'edit'
              ? {
                  action: 'update',
                  id: existing!.id,
                  version: existing!.version,
                  number: f.get('number'),
                  date: f.get('date'),
                  amountCents: parseMoney(String(f.get('amount'))),
                  currency: unit,
                }
              : {
                  action: 'create',
                  companyId: f.get('company'),
                  number: f.get('number'),
                  date: f.get('date'),
                  amountCents: parseMoney(String(f.get('amount'))),
                  currency: unit,
                };
      if (modal.type === 'new') {
        const result = await api<{ duplicates: Invoice[] }>(
          '/api/fatura?action=duplicates&number=' + encodeURIComponent(String(b.number)),
        );
        if (result.duplicates.length) {
          onDuplicate(result.duplicates);
          return;
        }
        setDraft(b);
        return;
      }
      await post(b);
      onSaved();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const title =
    modal.type === 'company'
      ? 'Firma ekle'
      : modal.type === 'usage'
        ? 'Kullanım ekle'
        : modal.type === 'edit'
          ? 'Faturayı düzenle'
          : extracted
            ? 'Mesnetten fatura kaydı'
            : 'Fatura ekle';
  return (
    <ModalFrame
      title={title}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      {progress && (
        <p className="inv-muted" role="status">
          {progress}
        </p>
      )}
      {onSkip && (
        <button type="button" className="inv-secondary" disabled={busy} onClick={onSkip}>
          Bu mesnedi atla
        </button>
      )}
      {draft && (
        <div className="inv-document-confirm">
          <span className="inv-eyebrow">SON KONTROL</span>
          <h3>Bu belgeyi {companies.find(c => c.id === draft.companyId)?.name} firmasına kaydedeceğim. Doğru mu?</h3>
          <dl>
            <dt>{extracted?.numberLabel || 'Fatura No'}</dt>
            <dd>{String(draft.number)}</dd>
            <dt>Takip miktarı</dt>
            <dd>{formatMoney(Number(draft.amountCents), String(draft.currency))}</dd>
            <dt>Tarih</dt>
            <dd>{day(String(draft.date))}</dd>
            <dt>Otomatik kullanılan</dt>
            <dd>{formatMoney(Number(draft.amountCents), String(draft.currency))}</dd>
            <dt>Kalan bakiye</dt>
            <dd>{formatMoney(0, String(draft.currency))}</dd>
          </dl>
          <p>Onayladığında tutarın tamamı kullanılmış olarak kaydedilecek. Kalan bakiye sıfır olacak.</p>
          {extracted && <DocumentDetails document={extracted.document} />}
          {extracted && (
            <p className="inv-muted">
              {!edited && extracted.document.qrStatus === 'matched'
                ? 'Belge numarası ve miktar QR bilgisiyle uyumlu.'
                : 'Firma, belge numarası ve miktarı belge üzerinden kontrol et.'}
            </p>
          )}
          {extracted?.warnings.map((warning, i) => (
            <p className="inv-muted" key={i}>
              {warning}
            </p>
          ))}
          {error && (
            <p className="inv-error" role="alert">
              {error}
            </p>
          )}
          <div className="inv-form-footer">
            <button
              type="button"
              className="inv-secondary"
              disabled={busy}
              onClick={() => {
                setDraft(null);
                setError('');
              }}
            >
              Düzelt
            </button>
            <button type="button" className="inv-primary" disabled={busy} onClick={() => void saveDraft()}>
              {busy ? 'Kaydediliyor…' : 'Evet, onayla ve kaydet'}
            </button>
          </div>
        </div>
      )}
      <form
        onSubmit={submit}
        onChange={() => {
          if (extracted) setEdited(true);
        }}
        className="inv-form"
        style={draft ? { display: 'none' } : undefined}
      >
        {extracted && (
          <div className="inv-extraction-note">
            <ShieldCheck size={18} />
            <div>
              <strong>Belgeden okunan alanları kontrol et.</strong>
              <p>
                {!edited && extracted.document.qrStatus === 'matched'
                  ? 'Belge numarası ve miktar QR bilgisiyle uyumlu.'
                  : 'Firma, belge numarası ve takip miktarını belge üzerinden doğrula.'}
              </p>
              <DocumentDetails document={extracted.document} />
              {extracted.warnings.map((w, i) => (
                <p key={i}>{w}</p>
              ))}
              {!extracted.companyId && extracted.companyName && (
                <p>Belgedeki ilgili firma: {extracted.companyName}. Takip edilecek firmayı seç.</p>
              )}
            </div>
          </div>
        )}
        {modal.type === 'company' ? (
          <label className="inv-field">
            Firma adı
            <input name="name" required maxLength={100} />
          </label>
        ) : modal.type === 'usage' ? (
          <>
            <div className="inv-usage-summary">
              <strong>{existing!.number}</strong>
              <span>{existing!.companyName}</span>
              <p>
                Kalan tutar <b>{formatMoney(existing!.remainingCents, existing!.currency)}</b>
              </p>
            </div>
            <label className="inv-field">
              Kullanım miktarı ({existing!.currency})
              <input name="amount" inputMode="decimal" placeholder="Örn. 25.000,00" required />
            </label>
            <label className="inv-field">
              Kullanım tarihi
              <input name="date" type="date" defaultValue={todayInTurkey()} required />
            </label>
            <label className="inv-field">
              Açıklama / işlem referansı
              <textarea name="note" maxLength={500} rows={3} placeholder="Hangi işlem için kullanıldı?" required />
            </label>
          </>
        ) : (
          <>
            {modal.type === 'new' && (
              <label className="inv-field">
                Firma
                <select
                  name="company"
                  defaultValue={extracted ? extracted.companyId || '' : selectedCompany || ''}
                  required
                >
                  <option value="" disabled>
                    Firma seç
                  </option>
                  {companies.map(c => (
                    <option value={c.id} key={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {modal.type === 'edit' && (
              <p className="inv-muted">
                {existing!.companyName} · Kullanılan: {formatMoney(existing!.usedCents, existing!.currency)}
              </p>
            )}
            <label className="inv-field">
              {extracted?.numberLabel || 'Fatura numarası'}
              <input
                name="number"
                defaultValue={existing?.number || extracted?.number || ''}
                required
                maxLength={100}
                autoComplete="off"
              />
            </label>
            <label className="inv-field">
              Fatura tarihi
              <input
                name="date"
                type="date"
                defaultValue={existing?.date || (extracted ? extracted.date || '' : todayInTurkey())}
                required
              />
            </label>
            <label className="inv-field">
              Takip para birimi
              <select
                name="currency"
                value={unit}
                onChange={e => setUnit(e.target.value)}
                disabled={!!existing?.usedCents}
                required
              >
                <option value="" disabled>
                  Para birimi seçiniz
                </option>
                {CURRENCIES.map(c => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <small>Kullanım geçmişi olan kaydın para birimi değiştirilemez.</small>
            </label>
            <label className="inv-field">
              Takip miktarı ({unit})
              <input
                name="amount"
                inputMode="decimal"
                defaultValue={amount(existing?.amountCents ?? extracted?.amountCents)}
                required
                placeholder="Örn. 125.000,00"
              />
            </label>
            {modal.type === 'new' && (
              <p className="inv-muted">Tutarın tamamı otomatik kullanılmış sayılır; kalan bakiye 0 olur.</p>
            )}
          </>
        )}
        {error && (
          <div className="inv-error" role="alert">
            {error}
          </div>
        )}
        <div className="inv-form-footer">
          <button type="button" className="inv-secondary" onClick={onClose} disabled={busy}>
            Vazgeç
          </button>
          <button className="inv-primary" disabled={busy}>
            {busy ? 'Kontrol ediliyor…' : modal.type === 'new' ? 'Bilgileri kontrol et' : 'Kaydet'}
          </button>
        </div>
      </form>
    </ModalFrame>
  );
}

function DocumentDetails({ document: doc }: { document: DocumentSummary }) {
  return (
    <div className="inv-document-details">
      {doc.issuerName && (
        <p>
          <b>Belgeyi düzenleyen:</b> {doc.issuerName}
        </p>
      )}
      {doc.counterpartyName && (
        <p>
          <b>İlgili kişi / kuruluş:</b> {doc.counterpartyName}
        </p>
      )}
      {doc.foreignAmountCents != null && doc.foreignCurrency && (
        <p>
          <b>Döviz miktarı:</b> {formatMoney(doc.foreignAmountCents, doc.foreignCurrency)}
        </p>
      )}
      {doc.exchangeRate && (
        <p>
          <b>Belgedeki kur:</b> {doc.exchangeRate}
        </p>
      )}
      {doc.tlAmountCents != null && (
        <p>
          <b>TL karşılığı (bilgi):</b> {formatMoney(doc.tlAmountCents, 'TRY')}
        </p>
      )}
    </div>
  );
}

function HistoryModal({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const [data, setData] = useState<{ invoice: Invoice; events: InvoiceEvent[] } | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [selected, setSelected] = useState(''),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    api<{ invoice: Invoice; events: InvoiceEvent[] }>('/api/fatura?action=history&id=' + encodeURIComponent(id), {
      signal: controller.signal,
    })
      .then(setData)
      .catch(e => {
        if (e.name !== 'AbortError') setError(e.message);
      });
    return () => controller.abort();
  }, [id, revision]);
  async function reverse(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await post({ action: 'reverse', eventId: selected, note: new FormData(e.currentTarget).get('note') });
      setSelected('');
      setRevision(v => v + 1);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <ModalFrame
      title="Kullanım geçmişi"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      {error && (
        <p className="inv-error" role="alert">
          {error}
        </p>
      )}
      {!data ? (
        <p>Geçmiş yükleniyor…</p>
      ) : (
        <>
          <div className="inv-usage-summary">
            <strong>{data.invoice.number}</strong>
            <span>
              {data.invoice.companyName} · {day(data.invoice.date)}
            </span>
            <p>
              Fatura <b>{formatMoney(data.invoice.amountCents, data.invoice.currency)}</b>
            </p>
            <p>
              Kullanılan <b>{formatMoney(data.invoice.usedCents, data.invoice.currency)}</b>
            </p>
            <p>
              Kalan <b>{formatMoney(data.invoice.remainingCents, data.invoice.currency)}</b>
            </p>
          </div>
          {data.invoice.document && <DocumentDetails document={data.invoice.document} />}
          {!data.events.length ? (
            <div className="inv-empty">
              <History size={25} />
              <p>Bu fatura henüz kullanılmamış.</p>
            </div>
          ) : (
            <ol className="inv-history">
              {data.events.map(event => (
                <li key={event.id}>
                  <div className="inv-history-dot" />
                  <div>
                    <strong>
                      {event.deltaCents < 0 ? 'Kullanım iptali' : 'Kullanım'} ·{' '}
                      {formatMoney(Math.abs(event.deltaCents), data.invoice.currency)}
                    </strong>
                    <p>{event.note}</p>
                    <small>
                      {day(event.date)} · {event.accountName}
                    </small>
                    {event.reversed ? (
                      <span className="inv-muted">İptal edildi</span>
                    ) : (
                      event.deltaCents > 0 && (
                        <button
                          type="button"
                          className="inv-text-button inv-danger-text"
                          onClick={() => setSelected(event.id)}
                        >
                          Bu kullanımı iptal et
                        </button>
                      )
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
          {selected && (
            <form onSubmit={reverse} className="inv-form">
              <label className="inv-field">
                İptal nedeni
                <textarea name="note" maxLength={500} required rows={2} />
              </label>
              <small>İşlem geçmişte kalır, kullanılan tutar kadar bakiye geri açılır.</small>
              <div className="inv-form-footer">
                <button type="button" className="inv-secondary" onClick={() => setSelected('')}>
                  Vazgeç
                </button>
                <button className="inv-primary" disabled={busy}>
                  Kullanımı iptal et
                </button>
              </div>
            </form>
          )}
        </>
      )}
    </ModalFrame>
  );
}

function AccountsModal({
  account,
  onClose,
  onExpired,
}: {
  account: InvoiceAccount;
  onClose: () => void;
  onExpired: () => void;
}) {
  const [accounts, setAccounts] = useState<InvoiceAccount[]>([]),
    [meter, setMeter] = useState<{ used: number; limit: number; geminiConfigured: boolean } | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0),
    [changing, setChanging] = useState('');
  useEffect(() => {
    const c = new AbortController();
    Promise.all([
      api<{ accounts: InvoiceAccount[] }>('/api/fatura?action=accounts', { signal: c.signal }),
      api<{ used: number; limit: number; geminiConfigured: boolean }>('/api/fatura?action=limits', {
        signal: c.signal,
      }),
    ])
      .then(([r, usage]) => {
        setAccounts(r.accounts);
        setMeter(usage);
      })
      .catch(e => {
        if (e.name !== 'AbortError') setError(e.message);
      });
    return () => c.abort();
  }, [revision]);
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget),
      form = e.currentTarget;
    setBusy(true);
    setError('');
    try {
      await post(
        changing
          ? { action: 'changeCode', id: changing, code: f.get('code') }
          : { action: 'addAccount', name: f.get('name'), code: f.get('code') },
      );
      if (changing === account.id) {
        onExpired();
        return;
      }
      setChanging('');
      form.reset();
      setRevision(v => v + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function disable(id: string) {
    setBusy(true);
    setError('');
    try {
      await post({ action: 'disableAccount', id });
      setRevision(v => v + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <ModalFrame
      title="Hesaplar ve erişim"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <p className="inv-muted">
        Kodları sen belirlersin. Her kişiye farklı bir 4 haneli kod ver. Erişimi kapatınca kişinin açık oturumları da
        kapanır.
      </p>
      {meter && (
        <div className="inv-usage-summary">
          <strong>Gemini kullanım sayacı</strong>
          <p>
            Bugünkü ortak model çağrısı{' '}
            <b>
              {meter.used} / {meter.limit}
            </b>
          </p>
          <p className="inv-muted">
            Uygulama sayacı Türkiye saatiyle 00.00’da yenilenir. Asistan ve mesnet okumaları bu sınırı paylaşır. Google
            proje kotası ayrıca uygulanır.
          </p>
          {!meter.geminiConfigured && <p>Gemini bağlantısı henüz hazır değil.</p>}
        </div>
      )}
      <div className="inv-account-list">
        {accounts.map(a => (
          <div key={a.id}>
            <span>
              <strong>{a.name}</strong>
              <small>{a.role === 'admin' ? 'Yönetici' : a.active ? 'Yetkili hesap' : 'Erişim kapalı'}</small>
            </span>
            <div>
              <button className="inv-text-button" disabled={busy} onClick={() => setChanging(a.id)}>
                {a.active ? 'Kodu değiştir' : 'Yeni kodla aç'}
              </button>
              {a.active && a.role !== 'admin' && (
                <button className="inv-text-button inv-danger-text" disabled={busy} onClick={() => void disable(a.id)}>
                  Erişimi kapat
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      <form onSubmit={save} className="inv-form" key={changing || 'new'}>
        <h3>{changing ? 'Yeni hesap kodu' : 'Yetkili hesap ekle'}</h3>
        {changing ? (
          <p className="inv-muted">
            {accounts.find(a => a.id === changing)?.name} · Kod değişince eski oturumlar kapatılır.
          </p>
        ) : (
          <label className="inv-field">
            Ad / hesap adı
            <input name="name" maxLength={80} required />
          </label>
        )}
        <PinInput />
        {error && (
          <p className="inv-error" role="alert">
            {error}
          </p>
        )}
        <div className="inv-form-footer">
          {changing && (
            <button type="button" className="inv-secondary" onClick={() => setChanging('')}>
              Vazgeç
            </button>
          )}
          <button className="inv-primary" disabled={busy}>
            {busy ? 'Kaydediliyor…' : changing ? 'Kodu kaydet' : 'Hesap oluştur'}
          </button>
        </div>
      </form>
    </ModalFrame>
  );
}
