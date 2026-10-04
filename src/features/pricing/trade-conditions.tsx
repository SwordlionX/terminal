'use client';
import { useMarketData } from '@/store/marketData';
import { NumberInput } from '@/components/ui/number-input';
/** Shared tool ticket. Strike is hidden where it is the result (target premium search). */
export function TradeConditions({ showStrike = true }: { showStrike?: boolean }) {
  const md = useMarketData();
  return (
    <section className="workspace-panel">
      <div className="workspace-toolbar">
        <div className="desk-segments">
          {['XAU', 'XAG'].map(p => (
            <button key={p} aria-pressed={md.product === p} onClick={() => md.setProduct(p, md.spot, md.lease, md.vol)}>
              {p}
            </button>
          ))}
        </div>
        {showStrike && (
          <label className="desk-field">
            Strike · USD/ons
            <NumberInput
              aria-label="Araç kullanım fiyatı"
              value={md.strike}
              onValueChange={v => md.setField('strike', v)}
            />
          </label>
        )}
        <label className="desk-field">
          Miktar · ons
          <NumberInput
            aria-label="Araç işlem miktarı"
            value={md.contractSize}
            onValueChange={v => md.setField('contractSize', v)}
          />
        </label>
        <label className="desk-field">
          Vade
          <input
            aria-label="Araç vadesi"
            type="date"
            value={md.expiryDate}
            onChange={e => md.setField('expiryDate', e.target.value)}
          />
        </label>
      </div>
    </section>
  );
}
