import { createClient, Client } from '@libsql/client';
import fs from 'fs';

/**
 * Veritabanı istemcisi — Turso (bulut, Vercel için) veya yerel dosya (geliştirme).
 * Vercel'de env değişkenleri: TURSO_DATABASE_URL + TURSO_AUTH_TOKEN
 * Yerelde env yoksa otomatik olarak file:data/local.db kullanılır.
 */

let client: Client | null = null;
let readyPromise: Promise<void> | null = null;

function getClient(): Client {
  if (!client) {
    const url = process.env.TURSO_DATABASE_URL || 'file:data/local.db';
    if (url.startsWith('file:')) {
      try { fs.mkdirSync('data', { recursive: true }); } catch { /* salt-okunur FS */ }
    }
    client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
  }
  return client;
}

async function init(c: Client): Promise<void> {
  await c.batch([
    `CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY, companyName TEXT NOT NULL, customerNumber TEXT, taxNumber TEXT,
      branch TEXT, portfolioManager TEXT, relationshipManager TEXT, riskLimit REAL,
      customerSegment TEXT, notes TEXT, createdDate TEXT, updatedDate TEXT, status TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS trades (
      id TEXT PRIMARY KEY, customerId TEXT NOT NULL, tradeDate TEXT, expiryDate TEXT,
      underlying TEXT, type TEXT, position TEXT, spot REAL, strike REAL, volatility REAL,
      contractSize REAL, premium REAL, currentPremium REAL, mtm REAL, pnl REAL,
      delta REAL, gamma REAL, vega REAL, theta REAL, marginRate REAL, status TEXT,
      barrierType TEXT, barrierLevel REAL, barrierStyle TEXT, barrierStartDate TEXT, barrierEndDate TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS collaterals (
      id TEXT PRIMARY KEY, customerId TEXT NOT NULL, assetCode TEXT, currency TEXT,
      nominalQuantity REAL, marketValueUsd REAL, haircut REAL, addedAt TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS activity_log (
      id TEXT PRIMARY KEY, customerId TEXT NOT NULL, date TEXT, type TEXT, description TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT)`,
  ], 'write');

  // Daha önce oluşturulmuş (eski şemalı) veritabanları için göç — kolon zaten varsa hata yutulur.
  for (const col of ['barrierType TEXT', 'barrierLevel REAL', 'barrierStyle TEXT', 'barrierStartDate TEXT', 'barrierEndDate TEXT']) {
    try { await c.execute(`ALTER TABLE trades ADD COLUMN ${col}`); } catch { /* kolon zaten var */ }
  }

  // İlk kurulumda gerçek müşteri + işlem verisini yükle (kaynak: "YAŞAYAN OPSİYONLAR" dökümü, 06.07.2026)
  const r = await c.execute('SELECT COUNT(*) AS n FROM customers');
  if (Number(r.rows[0].n) === 0) {
    const now = new Date().toISOString();
    const note = 'İçe aktarıldı: YAŞAYAN OPSİYONLAR dökümü (06.07.2026)';
    const customers: (string | number | null)[][] = [
      ['c-22384484', 'SEVİL PARFÜMERİ KOZMETİK TİCARET VE SANAYİ ANONİM ŞİRKETİ', '22384484', '', '153', 'GÜL YAMAK', '', null, 'Kurumsal', note, now, now, 'Active'],
      ['c-2628150', 'YILMAZ KÖKSAL', '2628150', '', '153', 'FURKAN KESKİNSOY', '', null, 'Bireysel', note, now, now, 'Active'],
      ['c-21733691', 'KULE YETKİLİ MÜESSESE ANONİM ŞİRKETİ', '21733691', '', '153', 'FURKAN KESKİNSOY', '', null, 'Kurumsal', note, now, now, 'Active'],
      ['c-20919083', 'CENGİZ KARA - CENGİZ KORKMAZ', '20919083', '', '153', 'GÜL YAMAK', '', null, 'Bireysel', note, now, now, 'Active'],
      ['c-22441826', 'PLASPAK PLASTİK VE AMBALAJ SANAYİ VE TİCARET ANONİM ŞİRKETİ', '22441826', '', '153', 'GÜL YAMAK', '', null, 'Kurumsal', note, now, now, 'Active'],
    ];

    // NOT: Vade/gün, spot ve kullanım fiyatı olarak dökümdeki "Anlaşma Kuru" kullanıldı (gerçek işlem-anı
    // spot verisi dökümde yok). Volatilite dökümde yer almadığı için %15 varsayılan konuldu — canlı fiyatlama
    // ekranlarında gerçek smile/manuel vol ile güncellenebilir. Teminat oranı (marginRate) dökümdeki
    // "Gerekli Teminat Oranı" değeriyle birebir kilitlendi. Bariyer koşulları dökümdeki "Bariyer Cinsi/Tipi/Değer 1"
    // alanlarından birebir aktarıldı (barrierType/barrierLevel/barrierStyle/başlangıç-bitiş tarihleri).
    // ÖNEMLİ: premium TOPLAM tutardır (USD), currentPremium ise BİRİM (ons/kontrat başına) fiyattır —
    // portfolio.service.ts'nin yazdığı değerle aynı birimde olmalı, yoksa margin motoru teminatı
    // yüzlerce kat şişirir (premium'u contractSize'a bölmeden currentPremium'a koymak bu hataya yol açar).
    // NOT: Dökümdeki 2 USD/TRY işlemi (KULE YETKİLİ MÜESSESE, ref 888.OPS.26.004181 / 004178) bilinçli
    // olarak eklenmedi — sistemde henüz USD/TRY opsiyonları için doğru fiyatlama altyapısı (canlı kur,
    // doğru faiz eğrisi) yok, gümüş/altın motoruyla zorlamak yanlış teminat/MTM üretiyordu.
    const trades: (string | number | null)[][] = [
      ['t-005074', 'c-22384484', '2026-06-03', '2026-11-30', 'XAG', 'Put', 'Short', 78, 78, 0.15, 1256.41025641, 10000, 7.95918367, 0, 0, null, null, null, null, 0.71, 'Open', null, null, null, null, null],
      ['t-005162', 'c-2628150', '2026-06-05', '2026-09-03', 'XAG', 'Put', 'Short', 73.5, 73.5, 0.15, 1360.54421769, 5500, 4.0425, 0, 0, null, null, null, null, 0.47, 'Open', null, null, null, null, null],
      ['t-005316', 'c-20919083', '2026-06-11', '2026-09-11', 'XAG', 'Put', 'Short', 66.5, 66.5, 0.15, 30075.18, 94000.18, 3.12550681, 0, 0, null, null, null, null, 0.32, 'Open', 'Knock Out Up', 72, 'Amerikan', '2026-06-11', '2026-09-11'],
      ['t-005381', 'c-22441826', '2026-06-16', '2026-09-14', 'XAG', 'Put', 'Short', 72.5, 72.5, 0.15, 2758.62, 7000, 2.53750063, 0, 0, null, null, null, null, 0.32, 'Open', 'Knock Out Up', 75.5, 'Amerikan', '2026-06-16', '2026-09-14'],
      ['t-004896', 'c-22384484', '2026-05-22', '2026-11-18', 'XAG', 'Put', 'Short', 81, 81, 0.15, 2037.03703704, 18150, 8.91, 0, 0, null, null, null, null, 0.71, 'Open', null, null, null, null, null],
    ];

    // İşlem açılışında müşteriden alınan başlangıç nakit teminatı — dökümdeki "Gerekli Teminat Oranı"
    // ile kilitlenen sürdürme teminatının işlem anındaki karşılığı, Nakit-USD olarak müşteri hesabına
    // yazılıyor (haircut 0). Böylece "hesabımda ne kadar teminat var" sorusu artık $0 değil, gerçek
    // yatırılan tutarı gösteriyor; canlı yeniden değerleme bunun üzerinden erimeyi/açığı hesaplayacak.
    const collaterals: (string | number | null)[][] = [
      ['col-22384484', 'c-22384484', 'Nakit-USD', 'USD', 186730.00, 186730.00, 0, now],
      ['col-2628150', 'c-2628150', 'Nakit-USD', 'USD', 47000.00, 47000.00, 0, now],
      ['col-20919083', 'c-20919083', 'Nakit-USD', 'USD', 639999.83, 639999.83, 0, now],
      ['col-22441826', 'c-22441826', 'Nakit-USD', 'USD', 63999.98, 63999.98, 0, now],
    ];

    // Aktivite geçmişi tohumu — içe aktarılan müşteri/işlemler için gerçek olay kaydı
    // (fresh DB / demo reset'te timeline boş görünmesin). Olay tarihi olarak işlem tarihi kullanılır.
    const activities: (string | number | null)[][] = [
      ...customers.map((cu) => [`act-seed-${cu[0]}`, cu[0], now, 'Customer Created', 'Müşteri içe aktarıldı (YAŞAYAN OPSİYONLAR dökümü, 06.07.2026).']),
      ...trades.map((tr) => [`act-seed-${tr[0]}`, tr[1], tr[2], 'Trade Added', `İşlem içe aktarıldı: ${tr[4]} ${tr[6]} ${tr[5]} · strike ${tr[8]}`]),
    ];

    await c.batch([
      ...customers.map((args) => ({ sql: `INSERT INTO customers VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, args })),
      ...trades.map((args) => ({ sql: `INSERT INTO trades VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, args })),
      ...collaterals.map((args) => ({ sql: `INSERT INTO collaterals VALUES (?,?,?,?,?,?,?,?)`, args })),
      ...activities.map((args) => ({ sql: `INSERT INTO activity_log VALUES (?,?,?,?,?)`, args })),
    ], 'write');
  }

  // Aktivite backfill — activity_log boşsa ama müşteri/işlem varsa (özellik eklenmeden önce kurulmuş
  // DB'ler için tek seferlik). Yeni kurulumda seed zaten doldurduğu için bu blok atlanır.
  const actCount = await c.execute('SELECT COUNT(*) AS n FROM activity_log');
  if (Number(actCount.rows[0].n) === 0) {
    const cust = await c.execute('SELECT id, createdDate FROM customers');
    if (cust.rows.length) {
      const trd = await c.execute('SELECT id, customerId, tradeDate, underlying, type, position, strike FROM trades');
      await c.batch([
        ...cust.rows.map((r) => ({
          sql: 'INSERT INTO activity_log VALUES (?,?,?,?,?)',
          args: [`act-bf-${String(r.id)}`, String(r.id), String(r.createdDate ?? new Date().toISOString()), 'Customer Created', 'Müşteri kaydı (geçmiş).'],
        })),
        ...trd.rows.map((r) => ({
          sql: 'INSERT INTO activity_log VALUES (?,?,?,?,?)',
          args: [`act-bf-${String(r.id)}`, String(r.customerId), String(r.tradeDate ?? ''), 'Trade Added', `İşlem: ${String(r.underlying)} ${String(r.position)} ${String(r.type)} · strike ${Number(r.strike)}`],
        })),
      ], 'write');
    }
  }
}

/** Şeması hazır veritabanı istemcisi döndürür. */
export async function dbc(): Promise<Client> {
  const c = getClient();
  if (!readyPromise) readyPromise = init(c);
  await readyPromise;
  return c;
}
