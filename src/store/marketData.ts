import { create } from 'zustand';
import { persist } from 'zustand/middleware';

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
  expiryDate: string;
  usdtry: number;

  setField: <K extends keyof Omit<MarketDataState, 'setField' | 'setProduct'>>(field: K, value: MarketDataState[K]) => void;
  setProduct: (prod: string, spot: number, lease: number, vol: number) => void;
}

export const useMarketData = create<MarketDataState>((set) => {
  const today = new Date();
  const exp = new Date(today.getTime() + 90 * 24 * 3600 * 1000);

  return {
    product: 'XAU',
    spot: 3700,
    strike: 3700,
    rate: 5.0,
    lease: 1.50,
    vol: 15.0,
    manualVol: false, // varsayılan: smile'dan otomatik
    manualSpot: false, // varsayılan: canlı yayına bağlı
    contractSize: 100,
    basis: 365,
    tradeDate: today.toISOString().slice(0, 10),
    expiryDate: exp.toISOString().slice(0, 10),
    usdtry: 35.0, // Varsayılan kur

    setField: (field, value) => set((state) => ({ ...state, [field]: value })),
    setProduct: (prod, spot, lease, vol) => set((state) => ({
      ...state,
      product: prod,
      spot,
      strike: spot,
      lease,
      vol
    }))
  };
});

/* Ayarlar — tarayıcıda kalıcı (localStorage) */
export interface SettingsState {
  rate: number;      // risksiz faiz %
  leaseXAU: number;  // altın kira oranı %
  leaseXAG: number;  // gümüş kira oranı %
  usdtry: number;    // USD/TRY kuru
  basis: 360 | 365;  // gün bazı
  setSetting: <K extends keyof Omit<SettingsState, 'setSetting'>>(field: K, value: SettingsState[K]) => void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      rate: 5.0,
      leaseXAU: 1.5,
      leaseXAG: 1.0,
      usdtry: 35.0,
      basis: 365,
      setSetting: (field, value) => set((state) => ({ ...state, [field]: value })),
    }),
    { name: 'ucan-finans-settings' }
  )
);
