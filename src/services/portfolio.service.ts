import { db } from '@/services/mockDb';
import { getSpot } from '@/services/market.service';
import { Trade, Customer } from '@/types';

export interface EnrichedTrade {
  trade: Trade;
  customerName: string;
  initialDaysToExpiry: number;
  daysToExpiry: number;
  currentSpot: number | null;   // canlı spot
  spotIsLive: boolean;
  notional: number;             // currentSpot * contractSize
  pnl: number | null;           // Unrealized K/Z — basit intrinsic (Black-Scholes/smile YOK):
                                 // aynı formül settleTradeAction'daki gerçekleşen K/Z ile birebir aynı,
                                 // sadece vade spotu yerine canlı spot kullanılır.
}

export interface CustomerPortfolioSummary {
  customer: Customer;
  openTrades: number;
  totalNotional: number;
  totalPnl: number;
}

/**
 * Tüm açık işlemleri canlı spotla yeniden değerler. NOT: Black-Scholes/smile YOK — MTM kavramı
 * kaldırıldı (banka şubesi kendi opsiyon kitabını hedge etmiyor, bunu hazine + karşı taraf banka
 * back-to-back yapıyor; şube için tek anlamlı rakam "bugün kapatılsa ne kadar kâr/zarar" sorusu).
 * PnL = intrinsic value (canlı spot vs strike) - prim; settleTradeAction'daki gerçekleşen K/Z
 * formülüyle birebir aynı, sadece expiry spotu yerine canlı spot kullanır.
 *
 * Teminat burada YOK — o margin.service.ts'te, bu fonksiyondan tamamen bağımsız hesaplanıyor.
 */
export async function evaluatePortfolio(): Promise<{
  trades: EnrichedTrade[];
  customers: CustomerPortfolioSummary[];
}> {
  const allTrades = await db.trades.findMany();
  const allCustomers = await db.customers.findMany();
  const now = Date.now();

  // Kullanılan ürünler için spotları tek seferde çek (5 dk önbellekli)
  const products = [...new Set(allTrades.map(t => t.underlying.toUpperCase()))];
  const spotMap: Record<string, { price: number } | null> = {};
  await Promise.all(products.map(async p => {
    spotMap[p] = await getSpot(p);
  }));

  // Canlı spot alınamayan ürün varsa PnL'i eski/işlem-anı veriyle sessizce hesaplamak yerine
  // burada durup açık hata fırlat — çağıran ekran hatayı gösterir, yanlış PnL'e güvenilmez.
  const missingSpot = products.filter(p => !spotMap[p]);
  if (missingSpot.length) {
    throw new Error(`Canlı spot alınamadı: ${missingSpot.join(', ')}. PnL hesaplanamıyor.`);
  }

  const enriched: EnrichedTrade[] = [];

  for (const t of allTrades) {
    if (t.status === 'Closed' || t.status === 'Expired') continue;

    const prod = t.underlying.toUpperCase();
    const live = spotMap[prod]!; // yukarıda kontrol edildi — eksikse zaten hata fırlatıldı
    const spot = live.price;
    const daysToExpiry = Math.max(0.5, (new Date(t.expiryDate).getTime() - now) / 86400000);

    // Basit intrinsic değer — settleTradeAction'la aynı formül, sadece expiry spotu yerine canlı spot.
    let intrinsicValue = t.type === 'Call'
      ? Math.max(0, spot - t.strike)
      : Math.max(0, t.strike - spot);
    intrinsicValue *= t.contractSize;

    const payout = t.position === 'Long' ? intrinsicValue : -intrinsicValue;
    const premiumAdjustment = t.position === 'Long' ? -t.premium : t.premium;
    const pnl = payout + premiumAdjustment;

    const notional = spot * t.contractSize;

    const initialDaysToExpiry = Math.max(1, (new Date(t.expiryDate).getTime() - new Date(t.tradeDate).getTime()) / (1000 * 3600 * 24));

    enriched.push({
      trade: { ...t, pnl },
      customerName: allCustomers.find(c => c.id === t.customerId)?.companyName || 'Bilinmiyor',
      initialDaysToExpiry,
      daysToExpiry,
      currentSpot: spot,
      spotIsLive: true, // canlı değilse yukarıda zaten hata fırlatıldı
      notional,
      pnl,
    });
  }

  // Müşteri bazlı özet (nominal + PnL — teminat burada YOK, bkz. margin.service.ts)
  const customers: CustomerPortfolioSummary[] = allCustomers
    .map((customer) => {
      const ct = enriched.filter(e => e.trade.customerId === customer.id);
      return {
        customer,
        openTrades: ct.length,
        totalNotional: ct.reduce((s, e) => s + e.notional, 0),
        totalPnl: ct.reduce((s, e) => s + (e.pnl || 0), 0),
      };
    });

  return { trades: enriched, customers };
}
