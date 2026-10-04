import { MarginEngine, MarginResult, TradePosition, CollateralAsset } from "@/lib/margin/engine";
import { collateralRepository } from "@/repositories/collateral.repository";
import { db } from "@/services/mockDb";
import { getSpot, getUsdTryRate } from "@/services/market.service";
import { Trade } from "@/types";
import { CollateralItem } from "@/types/collateral";

/**
 * Teminatı canlı USD değerine getirir. Teminat tipleri yalnızca USD / XAU / XAG:
 *  - USD nakit → 1:1 (nominalQuantity USD tutarı).
 *  - XAU/XAG → nominalQuantity ONS cinsindendir; canlı ons fiyatıyla çarpılır.
 * Canlı spot alınamazsa DB'deki son snapshot (marketValueUsd) fallback olarak kalır.
 * Böylece gerekli teminat (canlı intrinsic zarar) ile mevcut teminat aynı anlıklıkta olur.
 */
export async function revalueCollaterals(items: CollateralItem[]): Promise<CollateralItem[]> {
  const metals = [...new Set(
    items.map(i => i.currency.toUpperCase()).filter(c => c === 'XAU' || c === 'XAG')
  )];
  const spotMap: Record<string, number> = {}, valuationWarnings: Record<string, string | undefined> = {};
  await Promise.all(metals.map(async (m) => {
    const live = await getSpot(m);
    if (live?.price) spotMap[m] = live.price;
    valuationWarnings[m] = !live?.price ? 'Metal teminat fiyatı alınamadı; kayıtlı teminat değeri kullanıldı.'
      : live.stale || !live.quoteAt || Date.now() - live.quoteAt > 86400000 ? 'Metal teminatın spot gözlemi eski veya tarihi doğrulanamıyor.' : undefined;
  }));

  return items.map(i => {
    const cur = i.currency.toUpperCase();
    if (cur === 'USD') return { ...i, marketValueUsd: i.nominalQuantity };
    if (cur === 'XAU' || cur === 'XAG') {
      return { ...i, marketValueUsd: spotMap[cur] ? i.nominalQuantity * spotMap[cur] : i.marketValueUsd, valuationWarning: valuationWarnings[cur] };
    }
    return i; // beklenmeyen tip — dokunma, snapshot kalsın
  });
}

/**
 * Teminat çağrısı için "zarar": pozisyonun vadedeki BRÜT intrinsic zararı — prim HARİÇ
 * (resmi teminat prosedürü zararı primden bağımsız, canlı spot vs strike üzerinden tanımlıyor).
 * Yalnızca müşteri aleyhine olan Short pozisyonlarda >0 olur (Long'da müşteri primi zaten ödemiş,
 * ek zarar yok → 0). DİKKAT: Bu, portfolio.service.ts'teki PnL'den (prim NETLİ, gerçek K/Z)
 * bilinçli olarak AYRIŞIR; oradaki PnL primi düşer, buradaki teminat-zararı düşmez.
 */
function intrinsicLossFor(t: Trade, currentSpot: number): number {
  const diff = t.type === 'Put' ? t.strike - currentSpot : currentSpot - t.strike;
  const intrinsicValue = Math.max(0, diff) * t.contractSize;
  const payout = t.position === 'Long' ? intrinsicValue : -intrinsicValue;
  return Math.max(0, -payout); // prim HARİÇ brüt zarar
}

export interface TradeCollateral {
  dataWarning?: string;
  tradeId: string;
  customerId: string;
  currentSpot: number;
  spotIsLive: boolean;
  intrinsicLoss: number;   // canlı spota göre müşteri aleyhine BRÜT intrinsic zarar (prim hariç)
}

/**
 * Açık işlemler için canlı spot + müşteri aleyhine brüt zararı hesaplar — Black-Scholes/smile YOK.
 * NOT: portfolio.service.ts'e (tam MTM yeniden fiyatlama) bağımlı değildir; smile verisi
 * güncellenmemiş/hata veriyor olsa bile zarar/teminat hesaplanmaya devam eder.
 */
async function buildTradeCollaterals(trades: Trade[]): Promise<TradeCollateral[]> {
  const open = trades.filter(t => t.status === 'Open' || t.status === 'Near Expiry');
  const products = [...new Set(open.map(t => t.underlying.toUpperCase()))];
  const spotMap: Record<string, number> = {}, warningMap: Record<string, string | undefined> = {};
  await Promise.all(products.map(async (p) => {
    const live = await getSpot(p);
    spotMap[p] = live?.price ?? 0; // 0 ise aşağıda giriş spotuna düşülür
    warningMap[p] = !live?.price ? 'Spot alınamadı; giriş spotu kullanıldı. Risk durumu güncel veriyle doğrulanmalı.'
      : live.stale ? 'Eski spot kaydı kullanılıyor; risk durumu güncel veriyle doğrulanmalı.'
      : live.quoteAt && Date.now() - live.quoteAt > 86400000 ? 'Spot gözlemi 24 saatten eski; veri tarihi kontrol edilmeli.'
      : !live.quoteAt ? 'Spotun piyasa gözlem zamanı doğrulanamıyor; kayıt okuma zamanı canlılığı kanıtlamaz.' : undefined;
  }));

  return open.map(t => {
    const prod = t.underlying.toUpperCase();
    const live = spotMap[prod] > 0;
    const currentSpot = live ? spotMap[prod] : t.spot; // canlı yoksa giriş spotu (basit hesap için yeterli)

    return {
      tradeId: t.id,
      customerId: t.customerId,
      currentSpot,
      spotIsLive: live,
      intrinsicLoss: intrinsicLossFor(t, currentSpot),
      dataWarning: warningMap[prod],
    };
  });
}

export class MarginService {
  /**
   * Müşterinin tüm teminat ve açık işlem verilerini toplayarak Margin Engine'e gönderir.
   * usdTryRate verilmezse Ayarlar sayfasından kaydedilen (kv tablosundaki) kalıcı kur kullanılır.
   */
  async evaluateCustomerMargin(customerId: string, usdTryRate?: number): Promise<MarginResult> {
    const rate = usdTryRate ?? await getUsdTryRate();
    const trades = await db.trades.findByCustomerId(customerId);
    const collateralItems = await revalueCollaterals(await collateralRepository.findByCustomerId(customerId));
    const tradeCollaterals = await buildTradeCollaterals(trades);

    const positions: TradePosition[] = trades
      .filter(t => t.status === 'Open' || t.status === 'Near Expiry')
      .map(t => {
        const tc = tradeCollaterals.find(c => c.tradeId === t.id)!;
        return {
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

    const margin = MarginEngine.calculatePortfolioMargin(positions, collaterals, rate);
    const warnings = [...new Set([...tradeCollaterals.flatMap(t => t.dataWarning ? [t.dataWarning] : []), ...collateralItems.flatMap(c => c.valuationWarning ? [c.valuationWarning] : [])])];
    return { ...margin, ...(warnings.length ? { dataWarning: warnings.join(' ') } : {}) };
  }

  /**
   * Tüm müşterilerin Margin durumlarını liste halinde döndürür (Branch Dashboard için).
   * usdTryRate verilmezse Ayarlar sayfasından kaydedilen kalıcı kur bir kez okunup tüm müşteriler
   * için kullanılır (her müşteride ayrı ayrı DB'ye gidilmez).
   */
  async evaluateAllCustomers(usdTryRate?: number) {
    const rate = usdTryRate ?? await getUsdTryRate();
    const [customers, trades, rawCollateral] = await Promise.all([
      db.customers.findMany(), db.trades.findMany(), collateralRepository.findAll(),
    ]);
    const [tradeValues, collaterals] = await Promise.all([buildTradeCollaterals(trades), revalueCollaterals(rawCollateral)]);
    const lossByTrade = new Map(tradeValues.map(t => [t.tradeId, t.intrinsicLoss]));
    const positionsByCustomer = new Map<string, TradePosition[]>(), collateralByCustomer = new Map<string, CollateralAsset[]>();
    for (const t of trades) {
      if (t.status !== 'Open' && t.status !== 'Near Expiry') continue;
      const positions = positionsByCustomer.get(t.customerId) ?? [];
      positions.push({ position: t.position, intrinsicLoss: lossByTrade.get(t.id) ?? 0, premium: t.premium });
      positionsByCustomer.set(t.customerId, positions);
    }
    for (const c of collaterals) {
      const items = collateralByCustomer.get(c.customerId) ?? [];
      items.push({ id: c.id, assetCode: c.assetCode, currency: c.currency, marketValueUsd: c.marketValueUsd, haircut: c.haircut });
      collateralByCustomer.set(c.customerId, items);
    }
    return customers.map(customer => {
      const warnings = [...new Set([...tradeValues.filter(t => t.customerId === customer.id).flatMap(t => t.dataWarning ? [t.dataWarning] : []), ...collaterals.filter(c => c.customerId === customer.id).flatMap(c => c.valuationWarning ? [c.valuationWarning] : [])])];
      const margin = MarginEngine.calculatePortfolioMargin(positionsByCustomer.get(customer.id) ?? [], collateralByCustomer.get(customer.id) ?? [], rate);
      return { customer, margin: { ...margin, ...(warnings.length ? { dataWarning: warnings.join(' ') } : {}) } };
    });
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
