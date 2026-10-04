import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { addDays, istanbulToday } from '@/lib/dates';

export interface MarketDataState {
  product: string;
  spot: number;
  strike: number;
  rate: number;
  lease: number;
  vol: number;
  manualVol: boolean; // true: kullanıcı vol girer, false: smile'dan otomatik
  manualSpot: boolean; // true: kullanıcı spot girer (canlı veri ezmez), false: canlı yayına bağlı
  contractSize: number;
  basis: number;
  tradeDate: string;
  /** true: değerleme tarihi İstanbul takvimindeki bugünü izler; kullanıcı tarihi değiştirince false. */
  tradeDateAuto: boolean;
  expiryDate: string;
  strikeInitialized: boolean; // oturum boyunca korunur; sayfa geçişinde sıfırlanmaz

  setField: <K extends keyof Omit<MarketDataState, 'setField' | 'setProduct' | 'applyLiveSpot' | 'syncToday'>>(
    field: K,
    value: MarketDataState[K],
  ) => void;
  setProduct: (prod: string, spot: number, lease: number, vol: number) => void;
  applyLiveSpot: (product: string, price: number) => void;
  /** Gün değiştiyse (gece açık kalan sekme) otomatik değerleme tarihini bugüne taşır. */
  syncToday: () => void;
}

export const useMarketData = create<MarketDataState>()(
  persist(
    set => {
      // Değerleme günü İstanbul takvimidir; asistan ve pozisyon değerlemesiyle aynı gün kullanılır.
      const today = istanbulToday();

      return {
        product: 'XAU',
        spot: 3700,
        strike: 3700,
        rate: 5.0,
        lease: 1.5,
        vol: 15.0,
        manualVol: false, // varsayılan: smile'dan otomatik
        manualSpot: false, // varsayılan: canlı yayına bağlı
        contractSize: 100,
        basis: 365,
        tradeDate: today,
        tradeDateAuto: true,
        expiryDate: addDays(today, 90),
        strikeInitialized: false,

        setField: (field, value) =>
          set(state => ({
            ...state,
            [field]: value,
            ...(field === 'strike' ? { strikeInitialized: true } : {}),
            ...(field === 'tradeDate' ? { tradeDateAuto: value === istanbulToday() } : {}),
          })),
        applyLiveSpot: (product, price) =>
          set(state => {
            if (state.product !== product || state.manualSpot || !Number.isFinite(price) || price <= 0) return state;
            return { spot: price, strike: state.strikeInitialized ? state.strike : price, strikeInitialized: true };
          }),
        syncToday: () =>
          set(state => {
            const current = istanbulToday();
            return state.tradeDateAuto && state.tradeDate !== current ? { tradeDate: current } : state;
          }),
        setProduct: (prod, spot, lease, vol) =>
          set(state => ({
            ...state,
            product: prod,
            spot,
            strike: spot,
            strikeInitialized: false,
            lease,
            vol,
          })),
      };
    },
    {
      name: 'ucan-finans-market',
      // YALNIZ ürün kalıcı. Sayfa yenilendiğinde gümüşten altına düşmek yanlış ölçekte
      // strike/spot gösteriyordu. Fiyat/tarih alanları BİLİNÇLİ olarak kalıcı DEĞİL:
      // bayat bir spot ya da geçmiş bir işlem tarihi geri yüklenirse ekran güncel
      // görünürken eski veriyle fiyat üretir — canlı besleme her açılışta taze doldurur.
      partialize: s => ({ product: s.product }),
    },
  ),
);
