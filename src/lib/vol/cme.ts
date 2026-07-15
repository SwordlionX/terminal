import { impliedVolAmerican } from '../math/american';
import { VolSurface, ExpirySmile, SmilePoint } from './surface';

/**
 * CME COMEX settlement → de-Amerikanize IV yüzeyi (Yahoo/ETF yolunun futures muadili).
 *
 * Kaynak: Databento GLBX.MDP3 `definition` + `statistics` (stat_type=3, settlement).
 * ETF yolundan tek farkı forward'ın GÖZLEMLENEN olması: F = dayanak SI futures'ının
 * settlement fiyatı (carry/lease tahmini yok). Yüzey yine forward-moneyness (m = K/F)
 * ekseninde tutulur; böylece downstream (surfaceVol, fiyatlama) hiç değişmeden çalışır.
 *
 * Futures opsiyonu Amerikan tipidir ve dayanağı futures olduğu için taşıma yoktur (b=0).
 * Bu, `impliedVolAmerican`'ı q=r ile çağırmaya denktir: binom risk-nötr olasılığı
 * p=(1−d)/(u−d)'ye iner ve control variate gk(F,K,T,r,r,σ) tam olarak Black-76 olur —
 * ayrı bir fiyatlama fonksiyonu gerekmez.
 */

export interface CmeOptionDef {
  cls: 'C' | 'P';
  expSec: number;   // vade (epoch saniye)
  strike: number;   // kullanım fiyatı (fiyat birimi)
  und: string;      // underlying_id — dayanak SI futures instrument_id'si
}

export interface CmeInputs {
  /** instrument_id -> opsiyon tanımı (yalnız C/P) */
  options: Map<string, CmeOptionDef>;
  /** instrument_id -> opsiyon settlement fiyatı */
  optSettle: Map<string, number>;
  /** futures instrument_id -> futures settlement fiyatı (F) */
  futSettle: Map<string, number>;
  /** settlement seansının tarihi (epoch saniye, gün başı UTC) */
  evalSec: number;
  /** ekranda gösterilecek settlement tarih/saat etiketi */
  fetchedISO: string;
}

// Yüzeye yalnızca ATM'i saran makul bir moneyness penceresi alınır; hem gürültülü uzak
// kanatları eler hem de vade başına binom inversiyon sayısını sınırlar.
const MONEY_LO = 0.75, MONEY_HI = 1.30;
const BINOM_STEPS = 72;
// Vade başına en fazla bu kadar strike ters çevrilir. Ham settlement 150+ strike içerebilir;
// smile'ı temsil için bu gereksiz (ve her biri ağır Amerikan binom inversiyonu). ATM'i saran
// dar bant tam çözünürlükte tutulur, kanatlar seyreltilir — ATM doğruluğu korunur, refresh hızlanır.
const MAX_STRIKES = 40;

/** Sıralı (m'e göre) adaylardan ATM bandını koruyup kanatları seyrelterek en fazla MAX_STRIKES seçer. */
function subsampleStrikes<T extends { m: number }>(sorted: T[]): T[] {
  if (sorted.length <= MAX_STRIKES) return sorted;
  const kept: T[] = [];
  const stride = sorted.length / MAX_STRIKES;
  let next = 0;
  for (let i = 0; i < sorted.length; i++) {
    // ATM'e yakın (|m−1| ≤ 0.06) her strike korunur; uzaktakiler stride ile seyreltilir.
    if (Math.abs(sorted[i].m - 1) <= 0.06 || i >= next) {
      kept.push(sorted[i]);
      if (i >= next) next += stride;
    }
  }
  return kept;
}

/**
 * CME settlement girdilerinden tek üründe (ör. XAG) de-Amerikanize IV yüzeyi kurar.
 * Her vade için OTM taraf kullanılır (K>=F -> call, K<F -> put); IV, dayanağın futures
 * settlement'ına (F) göre çözülür.
 */
export function buildCmeSurface(inp: CmeInputs, symbol: string, r: number): VolSurface {
  // 1) Opsiyonları vadeye göre grupla (yalnız settlement'ı olanlar)
  const byExp = new Map<number, { def: CmeOptionDef; px: number }[]>();
  for (const [id, def] of inp.options) {
    const px = inp.optSettle.get(id);
    if (px == null) continue;
    const arr = byExp.get(def.expSec) || [];
    arr.push({ def, px });
    byExp.set(def.expSec, arr);
  }

  const expiries: ExpirySmile[] = [];
  let frontF = 0;

  for (const expSec of [...byExp.keys()].sort((a, b) => a - b)) {
    const list = byExp.get(expSec)!;

    // 2) Dayanak F: çoğunluk underlying_id -> futures settlement (ay kodundan tahmin yok)
    const undCount = new Map<string, number>();
    for (const o of list) undCount.set(o.def.und, (undCount.get(o.def.und) || 0) + 1);
    const und = [...undCount.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const F = inp.futSettle.get(und);

    const days = Math.round(((expSec - inp.evalSec) / 86400) * 10) / 10;
    if (F == null || days < 1) continue;
    const T = days / 365;

    // 3) OTM adayları topla (K>=F -> call, K<F -> put), moneyness penceresinde
    const cands: { m: number; K: number; px: number; type: 'call' | 'put' }[] = [];
    for (const { def, px } of list) {
      const K = def.strike;
      if (K < MONEY_LO * F || K > MONEY_HI * F) continue;
      const useCall = K >= F;
      if (useCall && def.cls !== 'C') continue;
      if (!useCall && def.cls !== 'P') continue;
      cands.push({ m: K / F, K, px, type: useCall ? 'call' : 'put' });
    }
    cands.sort((a, b) => a.m - b.m);

    // 4) Seyreltilmiş adayları -> Amerikan futures-opsiyon IV inversiyonu (ağır adım burada)
    const points: SmilePoint[] = [];
    for (const c of subsampleStrikes(cands)) {
      const res = impliedVolAmerican(F, c.K, T, r, r, c.px, c.type, BINOM_STEPS);
      if (res.ok && res.vol > 0.005 && res.vol < 4) points.push({ m: c.m, iv: res.vol });
    }

    points.sort((a, b) => a.m - b.m);
    // Yüzey ATM'i sarmalı (m=1 kote aralık içinde) — değilse o vade güvenilmez.
    if (points.length >= 3 && points[0].m <= 1 && points[points.length - 1].m >= 1) {
      const date = new Date(expSec * 1000).toISOString().slice(0, 10);
      expiries.push({ days, date, points, f: F });
      if (frontF === 0) frontF = F;
    }
  }

  expiries.sort((a, b) => a.days - b.days);
  return { symbol, spot: frontF, fetchedISO: inp.fetchedISO, expiries };
}
