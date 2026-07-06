import { db } from '@/services/mockDb';
import { getSpot, getSurface } from '@/services/market.service';
import { marginService } from '@/services/margin.service';
import { surfaceVol } from '@/lib/vol/surface';
import { gk } from '@/lib/math';
import { MarginEngine, MarginResult } from '@/lib/margin/engine';
import { Trade, Customer } from '@/types';

const DEFAULT_RATE = 0.05;
const DEFAULT_LEASE = 0; // GLD/SLV smile q=0 bazlı; XAU kirasını ayarlardan bağlamak istersek buraya taşınır

export interface EnrichedTrade {
  trade: Trade;
  customerName: string;
  daysToExpiry: number;
  currentSpot: number | null;   // canlı spot (yoksa giriş spotu)
  spotIsLive: boolean;
  usedVol: number | null;       // smile'dan gelen IV (yoksa işlem vol'ü)
  volSource: 'smile' | 'trade';
  currentValue: number | null;  // opsiyonun güncel toplam değeri (USD)
  mtm: number | null;           // aktif kar/zarar
  maintenanceMargin: number;    // gereken sürdürme teminatı (USD)
  notional: number;
}

export interface CustomerPortfolioSummary {
  customer: Customer;
  openTrades: number;
  totalNotional: number;
  totalMtm: number;
  totalMaintenanceMargin: number;
  margin: MarginResult;
}

/**
 * Tüm açık işlemleri güncel spot + smile IV ile yeniden fiyatlar (MTM),
 * sürdürme teminatını hesaplar ve mockDb'deki mtm alanlarını günceller —
 * böylece Risk Merkezi ve Margin ekranları da güncel MTM görür.
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
  const surfMap: Record<string, Awaited<ReturnType<typeof getSurface>>> = {};
  await Promise.all(products.map(async p => {
    spotMap[p] = await getSpot(p);
    surfMap[p] = await getSurface(p, DEFAULT_RATE);
  }));

  const enriched: EnrichedTrade[] = [];

  for (const t of allTrades) {
    if (t.status === 'Closed' || t.status === 'Expired') continue;

    const prod = t.underlying.toUpperCase();
    const live = spotMap[prod];
    const spot = live?.price ?? t.spot;
    const daysToExpiry = Math.max(0.5, (new Date(t.expiryDate).getTime() - now) / 86400000);
    const T = daysToExpiry / 365;

    // Vol: smile'dan; yoksa işleme yazılmış vol
    const surface = surfMap[prod];
    const smileIv = surface ? surfaceVol(surface, t.strike / spot, daysToExpiry) : null;
    const vol = smileIv ?? (t.volatility > 0 ? t.volatility : 0.15);

    const g = gk(spot, t.strike, T, DEFAULT_RATE, DEFAULT_LEASE, vol);
    const valPerOz = t.type === 'Call' ? g.call : g.put;
    const currentValue = valPerOz * t.contractSize;
    const mtm = t.position === 'Long' ? currentValue - t.premium : t.premium - currentValue;

    const notional = spot * t.contractSize;
    const maintenanceMargin = MarginEngine.getBaseMarginRate(prod, daysToExpiry) * notional;

    // mockDb'yi güncelle — margin/risk ekranları güncel MTM kullansın
    await db.trades.update(t.id, { mtm, currentPremium: valPerOz });

    enriched.push({
      trade: { ...t, mtm, currentPremium: valPerOz },
      customerName: allCustomers.find(c => c.id === t.customerId)?.companyName || 'Bilinmiyor',
      daysToExpiry,
      currentSpot: spot,
      spotIsLive: live != null,
      usedVol: vol,
      volSource: smileIv != null ? 'smile' : 'trade',
      currentValue,
      mtm,
      maintenanceMargin,
      notional,
    });
  }

  // Müşteri bazlı özet (margin motoru teminat/haircut kurallarını uygular)
  const marginResults = await marginService.evaluateAllCustomers();
  const customers: CustomerPortfolioSummary[] = marginResults
    .map(({ customer, margin }) => {
      const ct = enriched.filter(e => e.trade.customerId === customer.id);
      return {
        customer,
        openTrades: ct.length,
        totalNotional: ct.reduce((s, e) => s + e.notional, 0),
        totalMtm: ct.reduce((s, e) => s + (e.mtm || 0), 0),
        totalMaintenanceMargin: ct.reduce((s, e) => s + e.maintenanceMargin, 0),
        margin,
      };
    });

  return { trades: enriched, customers };
}
