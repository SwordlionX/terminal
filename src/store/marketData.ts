import { create } from 'zustand';

export interface MarketDataState {
  product: string;
  spot: number;
  strike: number;
  rate: number;
  lease: number;
  vol: number;
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
