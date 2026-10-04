/** Sunucuya doğrudan gelen istekler de form ile aynı kurallara tabidir. */
export interface ManualTradeInput {
  tradeDate: string;
  expiryDate: string;
  underlying: string;
  type: string;
  position: string;
  spot: number | string;
  strike: number | string;
  volatility?: number | string;
  contractSize: number | string;
  premium: number | string;
  manualMarginRate?: number | string;
  initialCollateral?: number | string;
  collateralAssetCode?: string;
  isBarrier?: boolean;
  barrierType?: string;
  barrierLevel?: number | string;
  barrierStyle?: string;
  barrierStartDate?: string;
  barrierEndDate?: string;
}

export function finiteNumber(value: unknown, label: string, allowZero = false): number {
  // Number(null), Number(true), Number("") gibi örtük dönüşümlere izin verme.
  if (
    typeof value !== 'number' &&
    (typeof value !== 'string' || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim()))
  ) {
    throw new Error(`${label}: geçerli bir sayı girin.`);
  }
  const result = Number(value);
  if (!Number.isFinite(result) || (allowZero ? result < 0 : result <= 0)) {
    throw new Error(`${label}: ${allowZero ? 'sıfır veya pozitif' : 'pozitif'} ve sonlu bir sayı girin.`);
  }
  return result;
}

export function validateId(value: unknown, label = 'Müşteri'): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} seçimi geçersiz.`);
}

function dateOnly(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${label}: geçerli bir tarih girin.`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error(`${label}: geçerli bir tarih girin.`);
  }
  return value;
}

const collateralCurrencies = { 'Nakit-USD': 'USD', 'Nakit-XAU': 'XAU', 'Nakit-XAG': 'XAG' } as const;

export function validateCollateral(data: { assetCode: string; currency?: string; nominalQuantity: unknown }) {
  if (!data || !Object.hasOwn(collateralCurrencies, data.assetCode)) {
    throw new Error('Teminat türü USD, XAU veya XAG olmalı.');
  }
  const assetCode = data.assetCode as keyof typeof collateralCurrencies;
  const currency = collateralCurrencies[assetCode];
  if (data.currency !== undefined && data.currency !== currency) {
    throw new Error('Teminat türü ile para birimi uyuşmuyor.');
  }
  return { assetCode, currency, nominalQuantity: finiteNumber(data.nominalQuantity, 'Teminat miktarı') };
}

const omitted = (value: unknown) => value === undefined || (typeof value === 'string' && value.trim() === '');

export function validateManualTrade(data: ManualTradeInput) {
  if (!data || typeof data !== 'object') throw new Error('Geçersiz işlem verisi.');
  if (data.type !== 'Call' && data.type !== 'Put') throw new Error('İşlem tipi Call veya Put olmalı.');
  if (data.position !== 'Long' && data.position !== 'Short') throw new Error('İşlem yönü Long veya Short olmalı.');
  if (typeof data.underlying !== 'string' || !/^[A-Z0-9][A-Z0-9._/-]{0,19}$/i.test(data.underlying.trim())) {
    throw new Error('Geçerli bir ürün kodu girin.');
  }
  const underlying = data.underlying.trim().toUpperCase();
  const tradeDate = dateOnly(data.tradeDate, 'İşlem tarihi');
  const expiryDate = dateOnly(data.expiryDate, 'Vade tarihi');
  if (expiryDate < tradeDate) throw new Error('Vade tarihi işlem tarihinden önce olamaz.');
  const spot = finiteNumber(data.spot, 'Spot');
  const strike = finiteNumber(data.strike, 'Kullanım fiyatı');
  const contractSize = finiteNumber(data.contractSize, 'Miktar');
  const premium = finiteNumber(data.premium, 'Prim', true);
  const volatility = omitted(data.volatility) ? 0.15 : finiteNumber(data.volatility, 'Oynaklık');
  if (![spot * contractSize, strike * contractSize, premium / contractSize].every(Number.isFinite)) {
    throw new Error('İşlem tutarı hesaplanabilir sayı aralığını aşıyor.');
  }
  const manualMarginRate = omitted(data.manualMarginRate)
    ? undefined
    : finiteNumber(data.manualMarginRate, 'Teminat oranı', true);
  if (manualMarginRate !== undefined && manualMarginRate > 1)
    throw new Error('Teminat oranı %0 ile %100 arasında olmalı.');
  const initialCollateral = omitted(data.initialCollateral)
    ? 0
    : finiteNumber(data.initialCollateral, 'Başlangıç teminatı', true);
  const collateral =
    initialCollateral > 0
      ? validateCollateral({
          assetCode: data.collateralAssetCode ?? 'Nakit-USD',
          nominalQuantity: initialCollateral,
        })
      : undefined;
  if (data.isBarrier !== undefined && typeof data.isBarrier !== 'boolean') throw new Error('Bariyer seçimi geçersiz.');
  let barrier: {
    barrierType?: string;
    barrierLevel?: number;
    barrierStyle?: string;
    barrierStartDate?: string;
    barrierEndDate?: string;
  } = {};
  if (data.isBarrier) {
    if (!['Knock Out Up', 'Knock Out Down', 'Knock In Up', 'Knock In Down'].includes(data.barrierType ?? '')) {
      throw new Error('Bariyer türü geçersiz.');
    }
    if (data.barrierStyle !== 'Amerikan' && data.barrierStyle !== 'Avrupa')
      throw new Error('Bariyer gözlem tipi geçersiz.');
    const barrierStartDate = dateOnly(data.barrierStartDate || tradeDate, 'Bariyer başlangıcı');
    const barrierEndDate = dateOnly(data.barrierEndDate || expiryDate, 'Bariyer bitişi');
    if (barrierStartDate < tradeDate || barrierEndDate > expiryDate || barrierEndDate < barrierStartDate) {
      throw new Error('Bariyer gözlem aralığı işlem ve vade tarihleri arasında olmalı.');
    }
    const barrierLevel = finiteNumber(data.barrierLevel, 'Bariyer seviyesi');
    // Yeni sözleşme bariyerin henüz değilmemiş tarafında başlar ve prim taşır.
    const up = data.barrierType!.endsWith('Up');
    if (up ? spot >= barrierLevel : spot <= barrierLevel)
      throw new Error('Spot bariyerin ötesinde; bariyerli işlem bu seviyeyle kaydedilemez.');
    if (!(premium > 0)) throw new Error('Bariyerli işlemde prim sıfır olamaz.');
    barrier = {
      barrierType: data.barrierType,
      barrierLevel,
      barrierStyle: data.barrierStyle,
      barrierStartDate,
      barrierEndDate,
    };
  }
  return {
    underlying,
    type: data.type as 'Call' | 'Put',
    position: data.position as 'Long' | 'Short',
    tradeDate,
    expiryDate,
    spot,
    strike,
    contractSize,
    premium,
    volatility,
    manualMarginRate,
    collateral,
    ...barrier,
  };
}
