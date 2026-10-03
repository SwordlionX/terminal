import { barrierPrice, barrierGreeks, spotFiniteDiff } from '../math';
import { vannaVolgaBarrier } from '../math/vanna-volga';
import type { VolEstimateMode } from '../vol/surface';

export interface BarrierOptionsProps {
  spot: number;
  strike: number;
  tYears: number;
  rate: number;
  lease: number;
  vol: number;
  /** Verilen fiyat seviyesinin smile vol'ü (%). Yoksa/aralığın dışıysa null. */
  volAtLevel?: (level: number) => number | null;
  /** Provenance of auxiliary smile queries, including ATM and delta pillars. */
  volModeAtLevel?: (level: number) => VolEstimateMode;
  /** Kontrat büyüklüğü (ons) — toplam primi göstermek için. */
  contractSize?: number;
  /** true ise Vanna-Volga dökümü + Greek'ler de gösterilir (bariyer alt sayfası). */
  detailed?: boolean;
}

export interface BarrierGreekResult {
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
}

/** Tek bacak (call ya da put) için hesap sonucu. */
export interface LegResult {
  price: number;
  greeks: BarrierGreekResult;
  /** Vanna-Volga uygulandıysa detayları; smile yoksa null (düz BS'e düşülür). */
  vv: { bsPrice: number; correction: number; survival: number; atmVol: number } | null;
}

/** Hesap anındaki girdiler — sonrasında girdi değişirse ekrandaki sonuç "bayat" işaretlenir. */
export interface CalcInputs {
  spot: number; strike: number; tYears: number; rate: number; lease: number; vol: number;
  variant: string; barrierH: number; rebateR: number;
}

export interface CalcResult {
  call: LegResult;
  put: LegResult;
  nearBarrier: boolean;
  knockedOut: boolean;
  inputs: CalcInputs;
  smileModes: VolEstimateMode[];
}

/** Fiyat hesabı — saf fonksiyon. FİYATLAMA MANTIĞI DEĞİŞMEDİ, yalnız state'ten ayrıldı. */
export function priceBarrier(
  { spot, strike, tYears, rate, lease, vol, volAtLevel, volModeAtLevel }: BarrierOptionsProps,
  { variant, barrierH, rebateR }: { variant: string; barrierH: number; rebateR: number },
): CalcResult {
  {
    const r = rate / 100, q = lease / 100;
    const smileModes = new Set<VolEstimateMode>();
    // Smile fonksiyonu (ondalık vol). Yoksa Vanna-Volga kurulamaz → düz BS'e düşülür.
    const smile = volAtLevel
      ? (k: number): number | null => {
        const v = volAtLevel(k);
        if (v != null && isFinite(v) && volModeAtLevel) smileModes.add(volModeAtLevel(k));
        return v != null && isFinite(v) ? v / 100 : null;
      }
      : null;

    /** Tek bacağı (code = 'c'/'p' + variant) fiyatlar. FİYATLAMA MANTIĞI DEĞİŞMEDİ. */
    const priceLeg = (code: string): LegResult => {
      /**
       * Fiyat: Vanna-Volga varsa onunla (piyasa standardı smile düzeltmesi), yoksa tek-vol BS.
       * `shift` paralel vol kaydırmasıdır — vega'yı sonlu farkla almak için kullanılır.
       */
      const priceAt = (s: number, shift: number): number => {
        if (smile) {
          const sm = (k: number) => { const v = smile(k); return v == null ? null : v + shift; };
          const res = vannaVolgaBarrier(s, strike, barrierH, rebateR, tYears, r, q, code, sm);
          if (res) return res.price;
        }
        return barrierPrice(s, strike, barrierH, rebateR, tYears, r, q, vol / 100 + shift, code);
      };

      const vvRes = smile ? vannaVolgaBarrier(spot, strike, barrierH, rebateR, tYears, r, q, code, smile) : null;
      const price = vvRes ? vvRes.price : barrierPrice(spot, strike, barrierH, rebateR, tYears, r, q, vol / 100, code);

      // Greek'ler: VV varsa VV fiyatının kendisinden sonlu farkla (fiyatla tutarlı olsun),
      // yoksa mevcut BS tabanlı hesaplayıcı.
      let greeks: BarrierGreekResult;
      if (vvRes) {
        const dv = 0.005, dt = 1 / 365;
        // Delta/Gamma bariyer-korumalı sonlu farkla (bkz. spotFiniteDiff): bariyere yakınken
        // adımlar tek taraflı atılır, süreksizlik örneklenmez.
        const { delta, gamma } = spotFiniteDiff(spot, barrierH, s => priceAt(s, 0));
        const pT = (() => {
          const sm = smile as (k: number) => number | null;
          const res = vannaVolgaBarrier(spot, strike, barrierH, rebateR, Math.max(tYears - dt, 1e-8), r, q, code, sm);
          return res ? res.price : price;
        })();
        greeks = {
          delta,
          gamma,
          vega: (priceAt(spot, dv) - priceAt(spot, -dv)) / (2 * dv) / 100,
          theta: pT - price,
        };
      } else {
        greeks = barrierGreeks(spot, strike, barrierH, rebateR, tYears, r, q, vol / 100, code, 365);
      }

      return {
        price,
        greeks,
        vv: vvRes ? { bsPrice: vvRes.bsPrice, correction: vvRes.correction, survival: vvRes.survival, atmVol: vvRes.atmVol } : null,
      };
    };

    const isUp = variant[0] === "u";
    const isOut = variant[1] === "o";
    // Greek'ler sonlu farkla; bariyer süreksizliğine yakın (~%3) Delta/Gamma güvenilmez
    const nearBarrier = spot > 0 && Math.abs(spot - barrierH) / spot < 0.03;
    // KO opsiyonu bariyeri zaten geçtiyse devre dışı — prim yalnızca rebate
    const knockedOut = isOut && ((isUp && spot >= barrierH) || (!isUp && spot <= barrierH));

    return {
      call: priceLeg("c" + variant),
      put: priceLeg("p" + variant),
      smileModes: Array.from(smileModes),
      nearBarrier,
      knockedOut,
      inputs: { spot, strike, tYears, rate, lease, vol, variant, barrierH, rebateR },
    };
  }
}
