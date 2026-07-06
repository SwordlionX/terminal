"use server";

import { db } from "@/services/mockDb";
import { revalidatePath } from "next/cache";

export async function addManualTradeAction(customerId: string, data: any) {
  const trade = {
    customerId,
    tradeDate: data.tradeDate,
    expiryDate: data.expiryDate,
    underlying: data.underlying,
    type: data.type,
    position: data.position,
    spot: Number(data.spot),
    strike: Number(data.strike),
    volatility: Number(data.volatility) || 0.15,
    contractSize: Number(data.contractSize),
    premium: Number(data.premium),
    currentPremium: Number(data.premium),
    mtm: 0,
    pnl: 0,
    delta: 0,
    gamma: 0,
    vega: 0,
    theta: 0,
    status: "Open" as const,
  };

  await db.trades.create(trade);
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
  // Wait, the user said "opsiyon kar zarar neyse müşteriye o eklensin". 
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
