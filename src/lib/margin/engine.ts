import { 
  MARGIN_MATURITY_BUCKETS, 
  ASSET_GROUPS, 
  COLLATERAL_HAIRCUT_RATES, 
  BASE_COLLATERAL_CURRENCIES,
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
  totalRequiredMargin: number;
  totalCollateralValue: number;
  excessMargin: number;
  missingMargin: number;
  coverageRatio: number;
  totalMtmLoss: number; // Only counting losses for Margin Call calculation
  marginCallRatio: number; // Loss / Collateral Value
  status: 'SAFE' | 'DEFICIT' | 'MARGIN_CALL' | 'WARNING_60' | 'STOP_LOSS_80';
  isDeficitOver1Million: boolean;
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
   * Calculate effective margin rate considering Cross-Collateral rules.
   * If collateral is different from trade pairs and NOT in base currencies (TRY, USD, EUR).
   * Procedure: baseRate + (baseRate * collateralRate) OR baseRate + (baseRate * haircut)
   */
  public static getEffectiveMarginRate(tradeBaseRate: number, collateralCode: string, days: number): number {
    const cashCurrency = collateralCode.startsWith('Nakit-') ? collateralCode.slice('Nakit-'.length) : null;
    const isBaseCashCollateral = cashCurrency != null && BASE_COLLATERAL_CURRENCIES.includes(cashCurrency);
    const isPreciousMetalCashCollateral = cashCurrency === 'XAU' || cashCurrency === 'XAG';
    const isFund = cashCurrency == null;
    
    // Procedure Example 2: DOL fon teminata vermek
    if (isFund) {
      const fundHaircut = COLLATERAL_HAIRCUT_RATES[collateralCode] || 0.25; // Default to 25% if unknown
      return tradeBaseRate + (tradeBaseRate * fundHaircut);
    }
    
    // Procedure Example 1: TL teminat vermek
    if (collateralCode === 'Nakit-TRY') {
      const tlRate = this.getBaseMarginRate('TRY', days);
      return tradeBaseRate + (tradeBaseRate * tlRate);
    }

    if (isBaseCashCollateral || isPreciousMetalCashCollateral) {
      return tradeBaseRate;
    }

    return tradeBaseRate;
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
    let totalRequiredMargin = 0;
    let totalMtmLoss = 0;

    for (const pos of positions) {
      const baseRate = pos.marginRate ?? this.getBaseMarginRate(pos.underlying, pos.initialDaysToExpiry);
      
      if (pos.position === 'Short') {
        const baseMargin = pos.usdNotional * baseRate;
        totalRequiredMargin += (baseMargin + pos.intrinsicLoss);
        
        // Zarar/Teminat oranı (risk eşikleri için) sadece riskli olan Short yönlü müşteri zararlarını topluyoruz
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

    // Margin Call Ratio = Zarar / Teminat Değeri (risk eşikleri bunun üzerinden tetiklenir)
    const marginCallRatio = totalCollateralValue > 0 ? (totalMtmLoss / totalCollateralValue) : (totalMtmLoss > 0 ? 1 : 0);

    // Zarar artık gerekli teminatın içine gömülü olduğu için (exposureNotional üzerinden), burada
    // ikinci kez düşülmüyor — tek, tutarlı bir teminat rakamı.
    const excessMargin = Math.max(0, totalCollateralValue - totalRequiredMargin);
    const missingMargin = Math.max(0, totalRequiredMargin - totalCollateralValue);
    const coverageRatio = totalRequiredMargin > 0 ? (totalCollateralValue / totalRequiredMargin) : (totalCollateralValue > 0 ? 1 : 0);

    let status: MarginResult['status'] = 'SAFE';
    
    if (marginCallRatio > RISK_THRESHOLDS.STOP_LOSS_IMMEDIATE) {
      status = 'STOP_LOSS_80';
    } else if (marginCallRatio > RISK_THRESHOLDS.STOP_LOSS_WARNING) {
      status = 'WARNING_60';
    } else if (marginCallRatio > RISK_THRESHOLDS.MARGIN_CALL) {
      status = 'MARGIN_CALL';
    } else if (missingMargin > 0) {
      status = 'DEFICIT';
    }

    const missingMarginTl = missingMargin * usdTryRate;
    const isDeficitOver1Million = missingMarginTl > RISK_THRESHOLDS.DEFICIT_THRESHOLD_TL;

    return {
      totalRequiredMargin,
      totalCollateralValue,
      excessMargin,
      missingMargin,
      coverageRatio,
      totalMtmLoss,
      marginCallRatio,
      status,
      isDeficitOver1Million
    };
  }
}
