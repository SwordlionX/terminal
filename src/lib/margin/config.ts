export interface MaturityBucket {
  minDays: number;
  maxDays: number;
  rates: {
    group1: number; // USD, EUR, GBP, CHF, JPY
    group2: number; // TRY, CNY, RUB, AUD
    group3: number; // XAU, XAG, XPD, XPT
  };
}

// GÜNCEL TEMİNAT ORANLARIMIZ Tablosu
export const MARGIN_MATURITY_BUCKETS: MaturityBucket[] = [
  { minDays: 1, maxDays: 7, rates: { group1: 0.02, group2: 0.05, group3: 0.08 } },
  { minDays: 8, maxDays: 15, rates: { group1: 0.03, group2: 0.07, group3: 0.14 } },
  { minDays: 16, maxDays: 29, rates: { group1: 0.03, group2: 0.09, group3: 0.20 } },
  { minDays: 30, maxDays: 92, rates: { group1: 0.05, group2: 0.16, group3: 0.32 } },
  { minDays: 93, maxDays: 184, rates: { group1: 0.08, group2: 0.22, group3: 0.48 } },
  { minDays: 185, maxDays: 365, rates: { group1: 0.11, group2: 0.31, group3: 0.68 } },
];

export const ASSET_GROUPS = {
  group1: ['USD', 'EUR', 'GBP', 'CHF', 'JPY'],
  group2: ['TRY', 'CNY', 'RUB', 'AUD'],
  group3: ['XAU', 'XAG', 'XPD', 'XPT']
};

// EK TEMİNAT Hair Cut Oranları
export const COLLATERAL_HAIRCUT_RATES: Record<string, number> = {
  'Bono-EB-Repo': 0.00,
  'IDL-LKT-MPF': 0.05,
  'MPD-MJL': 0.10,
  'DİBS-EB-SUKUK': 0.10,
  'ONN-NKL': 0.10,
  'DOL': 0.15,
  'DigerFonlar': 0.25, // %25 (Tahsis + Hazine Uygunluğu)
  'Nakit-TRY': 0.00,
  'Nakit-USD': 0.00,
  'Nakit-EUR': 0.00,
  'Nakit-XAU': 0.00,
  'Nakit-XAG': 0.00,
};

// Türev işleme konu döviz çiftinden biri dışında teminata verebileceğiniz döviz çiftleri: TRY, USD, EUR
export const BASE_COLLATERAL_CURRENCIES = ['TRY', 'USD', 'EUR'];

export const RISK_THRESHOLDS = {
  MARGIN_CALL: 0.40, // Zarar/Teminat > %40
  STOP_LOSS_WARNING: 0.60, // Zarar/Teminat > %60
  STOP_LOSS_IMMEDIATE: 0.80, // Zarar/Teminat > %80
  DEFICIT_THRESHOLD_TL: 1000000 // 1,000,000 TL (Altı: Şube Müdürü, Üstü: Genel Müdür onayı)
};
