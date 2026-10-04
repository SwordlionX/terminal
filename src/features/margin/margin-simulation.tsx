"use client";

import { useState } from "react";
import { NumberInput } from "@/components/ui/number-input";
import { RISK_THRESHOLDS } from "@/lib/margin/config";
import { formatMoney, formatPercent } from '@/lib/format';

interface MarginSimulationProps {
  initialLoss: number;
  initialCollateral: number;
}

export function MarginSimulation({ initialLoss, initialCollateral }: MarginSimulationProps) {
  const [addedCollateral, setAddedCollateral] = useState<number>(0);
  const [addedLoss, setAddedLoss] = useState<number>(0);

  // Teminat yalnızca USD/XAU/XAG nakit-eşdeğeri (haircut 0) → eklenen teminat 1:1 sayılır.
  const totalCollateral = initialCollateral + addedCollateral;
  const totalLoss = Math.max(0, initialLoss + addedLoss);

  const newRatio = totalCollateral > 0 ? totalLoss / totalCollateral : (totalLoss > 0 ? 1 : 0);
  const newCure = totalLoss > 0 ? Math.max(0, totalLoss / RISK_THRESHOLDS.CURE_TARGET - totalCollateral) : 0;
  const zone = newRatio > RISK_THRESHOLDS.STOP_LOSS_IMMEDIATE ? 'Anında stop' : newRatio > RISK_THRESHOLDS.STOP_LOSS_WARNING ? 'Stop uyarısı'
    : newRatio > RISK_THRESHOLDS.MARGIN_CALL ? 'Teminat çağrısı' : 'Eşik altında';

  return (
    <section className="workspace-panel">
      <h2>Teminat simülatörü</h2>
      <div className="workspace-toolbar" style={{ marginTop: 0 }}>
        <label className="desk-field">Yeni teminat · USD<NumberInput aria-label="Yeni teminat" value={addedCollateral} onValueChange={setAddedCollateral} placeholder="100000" /></label>
        <label className="desk-field">Varsayımsal ek zarar · USD<NumberInput aria-label="Varsayımsal ek zarar" value={addedLoss} onValueChange={setAddedLoss} placeholder="+50000 / -20000" /></label>
      </div>
      {[['Simüle zarar', formatMoney(totalLoss)], ['Simüle teminat', formatMoney(totalCollateral)],
        [`Gerekli ek teminat · %${RISK_THRESHOLDS.CURE_TARGET * 100} hedef`, newCure > 0 ? formatMoney(newCure) : '—'],
        ['Zarar / teminat', `${formatPercent(newRatio * 100, 1)} · ${zone}`]].map(([label, value]) =>
        <div className="desk-risk-item" key={label}><span>{label}</span><strong>{value}</strong></div>)}
      <button className="desk-button" style={{ marginTop: 16 }} onClick={() => { setAddedCollateral(0); setAddedLoss(0); }}>Sıfırla</button>
    </section>
  );
}
