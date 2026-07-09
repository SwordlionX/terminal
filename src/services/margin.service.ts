import { MarginEngine, MarginResult, TradePosition, CollateralAsset } from "@/lib/margin/engine";
import { collateralRepository } from "@/repositories/collateral.repository";
import { db } from "@/services/mockDb";
import { getSpot } from "@/services/market.service";
import { Trade } from "@/types";

/**
 * Müşteri aleyhine oluşan basit (Black-Scholes/smile'suz) zarar: portfolio.service.ts'teki PnL
 * formülüyle birebir aynı mantık (intrinsic değer − prim, pozisyon yönüne göre işaretlenir),
 * sadece vade spotu yerine canlı spot kullanılır. PnL negatifse (müşteri aleyhineyse) bu kadar
 * ek zarar teminata eklenir; PnL pozitif/sıfırsa (kâr veya nötr) ek zarar yoktur.
 * NOT: Önceki sürüm sadece position==='Long' işlemler için zarar hesaplıyordu ve primi hiç
 * netleştirmiyordu — bu yüzden 'Short' işlemlerde (ör. müşterinin yazdığı Put'lar) canlı zarar
 * teminata hiç yansımıyordu. Artık her iki yön için de PnL ile tutarlı hesaplanıyor.
 */
function intrinsicLossFor(t: Trade, currentSpot: number): number {
  const diff = t.type === 'Put' ? t.strike - currentSpot : currentSpot - t.strike;
  const intrinsicValue = Math.max(0, diff) * t.contractSize;
  const payout = t.position === 'Long' ? intrinsicValue : -intrinsicValue;
  const premiumAdjustment = t.position === 'Long' ? -t.premium : t.premium;
  const pnl = payout + premiumAdjustment;
  return Math.max(0, -pnl);
}

export interface TradeCollateral {
  tradeId: string;
  customerId: string;
  currentSpot: number;
  spotIsLive: boolean;
  entryNotional: number;   // sabit giriş notional'i (contractSize * giriş spotu)
  intrinsicLoss: number;   // canlı spota göre müşteri aleyhine basit zarar
  marginRate: number;
  requiredCollateral: number; // marginRate * (entryNotional + intrinsicLoss)
}

/**
 * Açık işlemler için gerekli teminatı hesaplar — Black-Scholes/smile YOK, sadece canlı spot + strike.
 * NOT: portfolio.service.ts'e (tam MTM yeniden fiyatlama) bağımlı değildir; bu yüzden smile verisi
 * güncellenmemiş/hata veriyor olsa bile teminat hesaplanmaya devam eder.
 */
async function buildTradeCollaterals(trades: Trade[]): Promise<TradeCollateral[]> {
  const open = trades.filter(t => t.status === 'Open' || t.status === 'Near Expiry');
  const products = [...new Set(open.map(t => t.underlying.toUpperCase()))];
  const spotMap: Record<string, number> = {};
  await Promise.all(products.map(async (p) => {
    const live = await getSpot(p);
    spotMap[p] = live?.price ?? 0; // 0 ise aşağıda giriş spotuna düşülür
  }));

  return open.map(t => {
    const prod = t.underlying.toUpperCase();
    const live = spotMap[prod] > 0;
    const currentSpot = live ? spotMap[prod] : t.spot; // canlı yoksa giriş spotu (basit hesap için yeterli)
    
    // 1. Müşteri Ziyanı (Customer PnL < 0)
    const customerLoss = intrinsicLossFor(t, currentSpot);
    
    const initialDaysToExpiry = Math.max(1, (new Date(t.expiryDate).getTime() - new Date(t.tradeDate).getTime()) / (1000 * 3600 * 24));
    const marginRate = t.marginRate ?? MarginEngine.getBaseMarginRate(prod, initialDaysToExpiry);
    
    // 2. Doğru Nominal ve Teminat (Margin) Hesabı
    let nominal = 0;
    let requiredCollateral = 0;
    
    if (t.position === 'Short') {
      // Short Call: Risk piyasanın yükselmesidir (Canlı Spot)
      // Short Put: Risk piyasanın çakılmasıdır (Strike)
      nominal = t.type === 'Call' 
        ? currentSpot * t.contractSize 
        : t.strike * t.contractSize;
        
      const baseMargin = nominal * marginRate;
      requiredCollateral = baseMargin + customerLoss;
    } else {
      // Long Pozisyonlar (Müşteri Alış) teminat gerektirmez
      nominal = 0;
      requiredCollateral = 0;
    }

    return {
      tradeId: t.id,
      customerId: t.customerId,
      currentSpot,
      spotIsLive: live,
      entryNotional: nominal, // Engine uyumluluğu için nominal'i gönderiyoruz (önceden entryNotional idi)
      intrinsicLoss: customerLoss,
      marginRate,
      requiredCollateral,
    };
  });
}

export class MarginService {
  /**
   * Müşterinin tüm teminat ve açık işlem verilerini toplayarak Margin Engine'e gönderir.
   */
  async evaluateCustomerMargin(customerId: string, usdTryRate: number = 35.0): Promise<MarginResult> {
    const trades = await db.trades.findByCustomerId(customerId);
    const collateralItems = await collateralRepository.findByCustomerId(customerId);
    const tradeCollaterals = await buildTradeCollaterals(trades);

    const positions: TradePosition[] = trades
      .filter(t => t.status === 'Open' || t.status === 'Near Expiry')
      .map(t => {
        const tc = tradeCollaterals.find(c => c.tradeId === t.id)!;
        return {
          id: t.id,
          underlying: t.underlying,
          initialDaysToExpiry: Math.max(1, (new Date(t.expiryDate).getTime() - new Date(t.tradeDate).getTime()) / (1000 * 3600 * 24)),
          marginRate: tc.marginRate,
          usdNotional: tc.entryNotional,
          position: t.position,
          intrinsicLoss: tc.intrinsicLoss,
          premium: t.premium,
        };
      });

    const collaterals: CollateralAsset[] = collateralItems.map(c => ({
      id: c.id,
      assetCode: c.assetCode,
      currency: c.currency,
      marketValueUsd: c.marketValueUsd,
      haircut: c.haircut
    }));

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

  /**
   * Tüm açık işlemler için, işlem bazında gerekli teminatı döndürür (Trades Blotter için) —
   * her satır için ayrı canlı spot fetch etmemek adına tüm açık işlemleri tek seferde işler.
   */
  async evaluateAllTradeCollaterals(): Promise<TradeCollateral[]> {
    const trades = await db.trades.findMany();
    return buildTradeCollaterals(trades);
  }
}

export const marginService = new MarginService();
