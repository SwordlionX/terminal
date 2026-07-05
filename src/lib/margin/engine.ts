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
  daysToExpiry: number;
  usdNotional: number; // For simplicity, all risk is standardized in USD
  mtm: number;
}

export interface CollateralAsset {
  id: string;
  assetCode: string; // e.g., "IDL-LKT-MPF" or "Nakit-TRY" or "DOL"
  currency: string;
  marketValueUsd: number;
}

export interface MarginResult {
  totalRequiredMargin: number;
  totalCollateralValue: number;
  excessMargin: number;
  missingMargin: number;
  coverageRatio: number;
  totalMtmLoss: number; // Only counting losses for Margin Call calculation
  marginCallRatio: number; // Loss / Collateral Value
  status: 'SAFE' | 'MARGIN_CALL' | 'WARNING_60' | 'STOP_LOSS_80';
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
    const isFund = collateralCode !== 'Nakit-TRY' && collateralCode !== 'Nakit-USD' && collateralCode !== 'Nakit-EUR';
    
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

    return tradeBaseRate;
  }

  /**
   * Calculate the discounted value of a collateral asset (Haircut).
   */
  public static getCollateralDiscountedValue(asset: CollateralAsset): number {
    const haircut = COLLATERAL_HAIRCUT_RATES[asset.assetCode] ?? 1.0; // 100% haircut if totally unapproved
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

    // We assume the portfolio gives the worst-case collateral match for conservatism,
    // or just calculate base required margin and apply haircuts to collaterals.
    // To strictly follow the "cross collateral" we check if any collateral applies penalty.
    // For simplicity in this engine, we calculate Required Margin based on trade pairs,
    // and apply standard Haircuts to Collateral. Cross-margin logic is isolated.
    
    for (const pos of positions) {
      const baseRate = this.getBaseMarginRate(pos.underlying, pos.daysToExpiry);
      // Determine if cross penalty applies (checking if all collaterals are Funds or TRY)
      // In a real system, you map specific collateral to specific trades. 
      // We will assume standard baseRate for required margin, and apply haircut to collaterals.
      totalRequiredMargin += (pos.usdNotional * baseRate);
      
      if (pos.mtm < 0) {
        totalMtmLoss += Math.abs(pos.mtm);
      }
    }

    let totalCollateralValue = 0;
    for (const col of collaterals) {
      totalCollateralValue += this.getCollateralDiscountedValue(col);
    }

    // Net required after MTM (if MTM is positive, it does NOT reduce required margin per standard conservative rules, 
    // but if MTM is negative, it consumes collateral).
    // Margin Call Ratio = Loss / Collateral Value
    const marginCallRatio = totalCollateralValue > 0 ? (totalMtmLoss / totalCollateralValue) : (totalMtmLoss > 0 ? 1 : 0);
    
    const availableMargin = totalCollateralValue - totalMtmLoss;
    const excessMargin = Math.max(0, availableMargin - totalRequiredMargin);
    const missingMargin = Math.max(0, totalRequiredMargin - availableMargin);
    const coverageRatio = totalRequiredMargin > 0 ? (availableMargin / totalRequiredMargin) : (availableMargin > 0 ? 1 : 0);

    let status: MarginResult['status'] = 'SAFE';
    
    if (marginCallRatio > RISK_THRESHOLDS.STOP_LOSS_IMMEDIATE) {
      status = 'STOP_LOSS_80';
    } else if (marginCallRatio > RISK_THRESHOLDS.STOP_LOSS_WARNING) {
      status = 'WARNING_60';
    } else if (marginCallRatio > RISK_THRESHOLDS.MARGIN_CALL) {
      status = 'MARGIN_CALL';
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
