import { MarginEngine, MarginResult, TradePosition, CollateralAsset } from "@/lib/margin/engine";
import { collateralRepository } from "@/repositories/collateral.repository";
import { db } from "@/services/mockDb";

export class MarginService {
  /**
   * Müşterinin tüm teminat ve açık işlem verilerini toplayarak Margin Engine'e gönderir.
   */
  async evaluateCustomerMargin(customerId: string, usdTryRate: number = 35.0): Promise<MarginResult> {
    // 1. Fetch from Data Access Layer (Repositories)
    const trades = await db.trades.findByCustomerId(customerId);
    const collateralItems = await collateralRepository.findByCustomerId(customerId);

    // 2. Map DB models to Pure Engine models
    const positions: TradePosition[] = trades
      .filter(t => t.status === 'Open' || t.status === 'Near Expiry')
      .map(t => ({
        id: t.id,
        underlying: t.underlying,
        daysToExpiry: Math.max(1, (new Date(t.expiryDate).getTime() - Date.now()) / (1000 * 3600 * 24)),
        usdNotional: t.contractSize * t.spot,
        mtm: t.mtm || 0
      }));

    const collaterals: CollateralAsset[] = collateralItems.map(c => ({
      id: c.id,
      assetCode: c.assetCode,
      currency: c.currency,
      marketValueUsd: c.marketValueUsd
    }));

    // 3. Run Pure Engine computations
    return MarginEngine.calculatePortfolioMargin(positions, collaterals, usdTryRate);
  }

  /**
   * Tüm müşterilerin Margin durumlarını liste halinde döndürür (Branch Dashboard için).
   */
  async evaluateAllCustomers(usdTryRate: number = 35.0) {
    const customers = await db.customers.findMany();
    const results = await Promise.all(
      customers.map(async (c) => {
        const margin = await this.evaluateCustomerMargin(c.id, usdTryRate);
        return { customer: c, margin };
      })
    );
    return results;
  }
}

export const marginService = new MarginService();
