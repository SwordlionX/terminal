import { create } from 'zustand';
import type { AnalysisLeg } from '@/lib/pricing/position-analysis';
export const useAnalysisDraft = create<{ product: string | null; legs: AnalysisLeg[] | null;
  quoteType: 'Call' | 'Put'; quotePosition: 'Long' | 'Short';
  selectQuote: (quoteType: 'Call' | 'Put', quotePosition: 'Long' | 'Short') => void;
  seed: (product: string, legs: AnalysisLeg[]) => void }>(set => ({
  quoteType: 'Put', quotePosition: 'Short', selectQuote: (quoteType, quotePosition) => set({ quoteType, quotePosition }),
  product: null, legs: null, seed: (product, legs) => set({ product, legs }),
}));
