import { create } from 'zustand';
import type { AnalysisLeg } from '@/lib/pricing/position-analysis';
import type { OptionRequest } from '@/lib/assistant/types';
export const useAnalysisDraft = create<{
  product: string | null;
  legs: AnalysisLeg[] | null;
  quoteType: 'Call' | 'Put';
  quotePosition: 'Long' | 'Short';
  quoteBarrier: OptionRequest['barrier'] | null;
  setQuoteBarrier: (barrier: OptionRequest['barrier'] | null) => void;
  selectQuote: (quoteType: 'Call' | 'Put', quotePosition: 'Long' | 'Short') => void;
  seed: (product: string, legs: AnalysisLeg[]) => void;
}>(set => ({
  quoteType: 'Put',
  quotePosition: 'Short',
  selectQuote: (quoteType, quotePosition) => set({ quoteType, quotePosition }),
  quoteBarrier: null,
  setQuoteBarrier: quoteBarrier => set({ quoteBarrier }),
  product: null,
  legs: null,
  seed: (product, legs) => set({ product, legs }),
}));
