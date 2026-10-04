'use client';

import { useState } from 'react';
import { CollateralItem } from '@/types/collateral';
import { parseNumberInput } from '@/lib/number-input-parser';
import { addCustomerCollateral, removeCustomerCollateral } from '@/app/customers/[id]/margin/collateral-actions';
import { formatMoney, formatNumber, formatPercent as formatPct } from '@/lib/format';

// Teminat yalnızca USD nakit veya fiziki metal (XAU/XAG). Metaller ONS cinsinden girilir ve
// canlı ons fiyatıyla değerlenir; USD 1:1. Hepsi nakit-eşdeğeri → haircut 0.
const COLLATERAL_TYPES = [
  { code: 'Nakit-USD', currency: 'USD', label: 'Nakit USD', unit: 'USD' as const },
  { code: 'Nakit-XAU', currency: 'XAU', label: 'Altın (XAU)', unit: 'ons' as const },
  { code: 'Nakit-XAG', currency: 'XAG', label: 'Gümüş (XAG)', unit: 'ons' as const },
];

interface CollateralManagerProps {
  customerId: string;
  collaterals: CollateralItem[];
}

export function CollateralManager({ customerId, collaterals }: CollateralManagerProps) {
  const [assetCode, setAssetCode] = useState('Nakit-USD');
  const [amount, setAmount] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const selectedType = COLLATERAL_TYPES.find(t => t.code === assetCode) ?? COLLATERAL_TYPES[0];

  const formatCurrency = (val: number) => formatMoney(val);
  const formatPercent = (val: number) => formatPct(val * 100, 1);
  const formatQty = (c: CollateralItem) =>
    c.currency === 'USD' ? formatCurrency(c.nominalQuantity) : `${formatNumber(c.nominalQuantity)} ons`;

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    setAddError(null);
    const nominal = parseNumberInput(amount) ?? NaN;
    if (!Number.isFinite(nominal) || nominal <= 0) {
      setAddError('Pozitif ve geçerli bir teminat miktarı girin.');
      return;
    }

    setIsSubmitting(true);
    try {
      // marketValueUsd + haircut sunucuda hesaplanır (metal için canlı ons fiyatı). Buradan
      // yalnızca tip + miktar gönderilir.
      await addCustomerCollateral(customerId, {
        assetCode: selectedType.code,
        currency: selectedType.currency,
        nominalQuantity: nominal,
      });

      setAmount('');
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Teminat eklenemedi.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (confirm('Bu teminatı silmek istediğinize emin misiniz?')) {
      await removeCustomerCollateral(customerId, id);
    }
  };

  return (
    <section className="workspace-panel">
      <div className="workspace-heading" style={{ marginBottom: 8 }}>
        <h2>Mevcut teminat varlıkları</h2>
        <span className="desk-muted">USD nakit · XAU/XAG ons</span>
      </div>
      <div className="workspace-table-scroll">
        <table className="workspace-table">
          <thead>
            <tr>
              <th>Varlık</th>
              <th>Döviz</th>
              <th className="number">Miktar / tutar</th>
              <th className="number">Kesinti</th>
              <th className="number">Teminat değeri · USD</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {collaterals.length === 0 ? (
              <tr>
                <td colSpan={6} className="workspace-empty">
                  Henüz teminat eklenmemiş. Aşağıdaki formla ekleyebilirsiniz.
                </td>
              </tr>
            ) : (
              collaterals.map(c => {
                const hc = c.haircut ?? 0;
                return (
                  <tr key={c.id}>
                    <td>{COLLATERAL_TYPES.find(t => t.code === c.assetCode)?.label ?? c.assetCode}</td>
                    <td>{c.currency}</td>
                    <td className="number">{formatQty(c)}</td>
                    <td className="number">{formatPercent(hc)}</td>
                    <td className="number">{formatCurrency(c.marketValueUsd * (1 - hc))}</td>
                    <td>
                      <button className="desk-button" onClick={() => handleDelete(c.id)}>
                        Sil
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <form
        onSubmit={handleAdd}
        className="workspace-toolbar"
        style={{ alignItems: 'flex-end', borderTop: '1px solid var(--border)', paddingTop: 16 }}
      >
        <label className="desk-field">
          Varlık türü
          <select value={assetCode} onChange={e => setAssetCode(e.target.value || 'Nakit-USD')}>
            {COLLATERAL_TYPES.map(t => (
              <option key={t.code} value={t.code}>
                {t.label} · {t.unit === 'ons' ? 'ons, canlı fiyat' : 'USD 1:1'}
              </option>
            ))}
          </select>
        </label>
        <label className="desk-field">
          {selectedType.unit === 'ons' ? 'Miktar · ons' : 'Tutar · USD'}
          <input
            inputMode="decimal"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            placeholder={selectedType.unit === 'ons' ? 'Örn: 100' : 'Örn: 10000'}
            required
          />
        </label>
        <button type="submit" className="desk-button desk-button-primary" disabled={isSubmitting}>
          {isSubmitting ? 'Ekleniyor…' : 'Teminat ekle'}
        </button>
      </form>
      {addError && (
        <p role="alert" className="desk-policy">
          {addError}
        </p>
      )}
    </section>
  );
}
