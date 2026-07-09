"use server";

import { db } from "@/services/mockDb";
import { collateralRepository } from "@/repositories/collateral.repository";
import { revalidatePath } from "next/cache";

interface ManualTradeInput {
  tradeDate: string;
  expiryDate: string;
  underlying: string;
  type: string;
  position: string;
  spot: number | string;
  strike: number | string;
  volatility?: number | string;
  contractSize: number | string;
  premium: number | string;
  manualMarginRate?: number | string;
  initialCollateral?: number | string;
  collateralAssetCode?: string;
  collateralHaircut?: number | string;
  isBarrier?: boolean;
  barrierType?: string;
  barrierLevel?: number | string;
  barrierStyle?: string;
  barrierStartDate?: string;
  barrierEndDate?: string;
}

export async function addManualTradeAction(customerId: string, data: ManualTradeInput) {
  const type: "Call" | "Put" = data.type === "Put" ? "Put" : "Call";
  const position: "Long" | "Short" = data.position === "Short" ? "Short" : "Long";
  const spot = Number(data.spot);
  const strike = Number(data.strike);
  const contractSize = Number(data.contractSize);
  const premium = Number(data.premium);
  const volatility = Number(data.volatility);

  if (!customerId || spot <= 0 || strike <= 0 || contractSize <= 0 || premium < 0) {
    throw new Error("Geçersiz işlem verisi.");
  }

  const trade = {
    customerId,
    tradeDate: data.tradeDate,
    expiryDate: data.expiryDate,
    underlying: data.underlying,
    type,
    position,
    spot,
    strike,
    volatility: Number.isFinite(volatility) && volatility > 0 ? volatility : 0.15,
    contractSize,
    premium,
    // currentPremium BİRİM (kontrat/ons başına) fiyattır, premium ise TOPLAM tutar — ilk kayıtta
    // henüz yeniden fiyatlama yapılmadığı için giriş primini birime çeviriyoruz. portfolio.service.ts
    // ilk "Portföyü Yeniden Değerle" çalıştığında bunu gerçek güncel birim fiyatla günceller.
    currentPremium: contractSize > 0 ? premium / contractSize : 0,
    mtm: 0,
    pnl: 0,
    delta: 0,
    gamma: 0,
    vega: 0,
    theta: 0,
    marginRate: data.manualMarginRate ? Number(data.manualMarginRate) : undefined,
    status: "Open" as const,
    barrierType: data.isBarrier ? data.barrierType : undefined,
    barrierLevel: data.isBarrier && data.barrierLevel ? Number(data.barrierLevel) : undefined,
    barrierStyle: data.isBarrier ? data.barrierStyle : undefined,
    barrierStartDate: data.isBarrier ? (data.barrierStartDate || data.tradeDate) : undefined,
    barrierEndDate: data.isBarrier ? (data.barrierEndDate || data.expiryDate) : undefined,
  };

  await db.trades.create(trade);

  if (data.initialCollateral && Number(data.initialCollateral) > 0) {
    const colValue = Number(data.initialCollateral);
    const assetCode = data.collateralAssetCode || 'Nakit-USD';
    const haircut = data.collateralHaircut !== undefined && data.collateralHaircut !== "" ? Number(data.collateralHaircut) : undefined;
    await collateralRepository.addCollateral({
      customerId,
      assetCode,
      currency: assetCode.includes('-TRY') ? 'TRY' : 'USD', // simplistic mapping
      nominalQuantity: colValue,
      marketValueUsd: colValue,
      haircut,
    });
  }

  revalidatePath(`/customers/${customerId}`);
  revalidatePath("/customers");
  revalidatePath("/risk");
  revalidatePath("/portfolio");
}

export async function deleteTradeAction(customerId: string, tradeId: string) {
  await db.trades.delete(tradeId);
  revalidatePath(`/customers/${customerId}`);
  revalidatePath("/customers");
  revalidatePath("/risk");
  revalidatePath("/portfolio");
}

export async function settleTradeAction(customerId: string, tradeId: string, expirySpot: number) {
  const trades = await db.trades.findByCustomerId(customerId);
  const trade = trades.find((t) => t.id === tradeId);
  
  if (!trade) return;

  let intrinsicValue = 0;
  if (trade.type === "Call") {
    intrinsicValue = Math.max(0, expirySpot - trade.strike) * trade.contractSize;
  } else {
    intrinsicValue = Math.max(0, trade.strike - expirySpot) * trade.contractSize;
  }

  // Adjust for Long/Short position
  const payout = trade.position === "Long" ? intrinsicValue : -intrinsicValue;
  
  // Calculate final PnL: Payout minus premium paid (for Long) or plus premium received (for Short)
  // Wait, the user said "opsiyon kar zarar neyse musteriye o eklensin".
  // Premium is typically paid at start, so final PnL = Payout - Premium (Long), or Payout + Premium (Short).
  // But often users just want to record the final payout as PnL. We will record Payout - Premium (Long).
  
  const premiumAdjustment = trade.position === "Long" ? -trade.premium : trade.premium;
  const finalPnl = payout + premiumAdjustment;

  await db.trades.update(tradeId, {
    status: "Closed",
    pnl: finalPnl,
    mtm: 0, // MTM is zero once settled
    currentPremium: 0,
  });

  revalidatePath(`/customers/${customerId}`);
  revalidatePath("/customers");
  revalidatePath("/risk");
  revalidatePath("/portfolio");
}
