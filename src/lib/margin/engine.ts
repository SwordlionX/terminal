import {
  MARGIN_MATURITY_BUCKETS,
  ASSET_GROUPS,
  COLLATERAL_HAIRCUT_RATES,
  RISK_THRESHOLDS
} from './config';

export interface TradePosition {
  id: string;
  underlying: string; // e.g., "XAU/USD"
  initialDaysToExpiry: number;
  marginRate?: number; // Override if trade was created with a manual or locked margin rate
  usdNotional: number; // Girişteki SABİT notional (contractSize * giriş spotu) — Black-Scholes/smile'a bağımlı değil
  position: 'Long' | 'Short'; // Bankanın yönü: Long = banka aldı (müşteri yazdı/sattı), Short = banka sattı (müşteri aldı)
  intrinsicLoss: number; // Müşteri aleyhine basit içsel zarar (canlı spot vs strike, contractSize ile çarpılmış). Sadece
                         // Long'da ve spot aleyhineyse >0; Short'ta veya spot lehineyse 0. Black-Scholes/smile kullanmaz.
  premium: number; // Müşterinin ödediği veya aldığı prim
}

export interface CollateralAsset {
  id: string;
  assetCode: string; // e.g., "IDL-LKT-MPF" or "Nakit-TRY" or "DOL"
  currency: string;
  marketValueUsd: number;
  haircut?: number;
}

export interface MarginResult {
  totalCollateralValue: number;   // Haircut sonrası, canlı teminat değeri (USD)
  totalMtmLoss: number;           // Brüt intrinsic zarar (prim HARİÇ), müşteri aleyhine — Short pozisyonlar
  marginCallRatio: number;        // Zarar / Teminat — TEK headline metrik; risk eşikleri bunun üzerinden
  cureAmount: number;             // Oranı CURE_TARGET'a indirmek için gereken ek teminat = max(0, zarar/hedef − teminat)
  status: 'SAFE' | 'MARGIN_CALL' | 'WARNING_60' | 'STOP_LOSS_80';
  isDeficitOver1Million: boolean; // cureAmount × usdTry > 1M TL (Şube Müdürü vs Genel Müdür onay eşiği)
}

export class MarginEngine {
  
  /**
   * Determine the margin rate for a specific asset and maturity bucket.
   */
  public static getBaseMarginRate(asset: string, days: number): number {
    const bucket = MARGIN_MATURITY_BUCKETS.find(b => days >= b.minDays && days <= b.maxDays);
    if (!bucket) {
      // Default to longest maturity if exceeded
      return MARGIN_MATURITY_BUCKETS[MARGIN_MATURITY_BUCKETS.length - 1].rates.group3;
    }

    // Parse pairs like XAU/USD
    const pairs = asset.split('/');
    let maxRate = 0;

    for (const p of pairs) {
      let rate = bucket.rates.group1;
      if (ASSET_GROUPS.group2.includes(p)) rate = bucket.rates.group2;
      else if (ASSET_GROUPS.group3.includes(p)) rate = bucket.rates.group3;
      
      if (rate > maxRate) maxRate = rate;
    }

    return maxRate;
  }

  /**
   * Calculate the discounted value of a collateral asset (Haircut).
   */
  public static getCollateralDiscountedValue(asset: CollateralAsset): number {
    const haircut = asset.haircut ?? COLLATERAL_HAIRCUT_RATES[asset.assetCode] ?? 1.0; // 100% haircut if totally unapproved
    return asset.marketValueUsd * (1 - haircut);
  }

  /**
   * Pure function to calculate entire portfolio margin status.
   * @param positions List of all open trades
   * @param collaterals List of all posted collaterals
   * @param usdTryRate Current USD/TRY rate to evaluate the 1,000,000 TL limit
   */
  public static calculatePortfolioMargin(
    positions: TradePosition[], 
    collaterals: CollateralAsset[],
    usdTryRate: number
  ): MarginResult {
    // Banka teminat mantığı (resmi prosedür): TEK metrik = zarar / teminat.
    // Zarar = pozisyonun brüt intrinsic zararı (prim HARİÇ); yalnızca müşteri aleyhine olan
    // Short pozisyonlarda oluşur. Notional×kaldıraç oranı tabanlı "gerekli teminat" kavramı
    // KULLANILMIYOR — kaldıraç oranı yalnızca işlem açılışında yatırılan teminatı belirler.
    let totalMtmLoss = 0;
    for (const pos of positions) {
      if (pos.position === 'Short') {
        totalMtmLoss += pos.intrinsicLoss;
      }
    }

    let totalCollateralValue = 0;
    for (const col of collaterals) {
      totalCollateralValue += this.getCollateralDiscountedValue(col);
    }

    // Long (Müşteri Alış) işlemlerinde ödenen primi teminat olarak kabul et
    for (const pos of positions) {
      if (pos.position === 'Long') {
        totalCollateralValue += pos.premium;
      }
    }

    // Zarar / Teminat — risk eşikleri (%39/%60/%80) bunun üzerinden tetiklenir.
    const marginCallRatio = totalCollateralValue > 0 ? (totalMtmLoss / totalCollateralValue) : (totalMtmLoss > 0 ? 1 : 0);

    // Teminat çağrısı karşılığı: oranı CURE_TARGET'a (%35) indirmek için gereken ek teminat.
    // zarar / (teminat + X) = hedef  →  X = zarar/hedef − teminat.
    const cureAmount = totalMtmLoss > 0
      ? Math.max(0, totalMtmLoss / RISK_THRESHOLDS.CURE_TARGET - totalCollateralValue)
      : 0;

    let status: MarginResult['status'] = 'SAFE';
    if (marginCallRatio > RISK_THRESHOLDS.STOP_LOSS_IMMEDIATE) {
      status = 'STOP_LOSS_80';
    } else if (marginCallRatio > RISK_THRESHOLDS.STOP_LOSS_WARNING) {
      status = 'WARNING_60';
    } else if (marginCallRatio > RISK_THRESHOLDS.MARGIN_CALL) {
      status = 'MARGIN_CALL';
    }

    // 1M TL eşiği artık gereken ek teminat (cureAmount) üzerinden (PDF: "eksik teminat tutarı")
    const isDeficitOver1Million = (cureAmount * usdTryRate) > RISK_THRESHOLDS.DEFICIT_THRESHOLD_TL;

    return {
      totalCollateralValue,
      totalMtmLoss,
      marginCallRatio,
      cureAmount,
      status,
      isDeficitOver1Million
    };
  }
}
