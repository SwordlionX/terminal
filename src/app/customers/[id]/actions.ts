"use server";

import { db } from "@/services/mockDb";
import { collateralRepository } from "@/repositories/collateral.repository";
import { getSpot } from "@/services/market.service";
import { MarginEngine } from "@/lib/margin/engine";
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

  // Teminat oranı: manuel girildiyse onu, yoksa vade × varlık grubu tablosundan otomatik hesapla
  // ve işleme kilitle (böylece blotter "Teminat Oranı" sütununda seed işlemler gibi görünür).
  const initialDays = Math.max(1, (new Date(data.expiryDate).getTime() - new Date(data.tradeDate).getTime()) / 86400000);
  const resolvedMarginRate = data.manualMarginRate
    ? Number(data.manualMarginRate)
    : MarginEngine.getBaseMarginRate(data.underlying, initialDays);

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
    marginRate: resolvedMarginRate,
    status: "Open" as const,
    barrierType: data.isBarrier ? data.barrierType : undefined,
    barrierLevel: data.isBarrier && data.barrierLevel ? Number(data.barrierLevel) : undefined,
    barrierStyle: data.isBarrier ? data.barrierStyle : undefined,
    barrierStartDate: data.isBarrier ? (data.barrierStartDate || data.tradeDate) : undefined,
    barrierEndDate: data.isBarrier ? (data.barrierEndDate || data.expiryDate) : undefined,
  };

  await db.trades.create(trade);
  await db.activity.log(customerId, "Trade Added",
    `İşlem eklendi: ${trade.underlying} ${position} ${type} · strike ${strike} · ${contractSize} kontrat`);

  if (data.initialCollateral && Number(data.initialCollateral) > 0) {
    // Teminat yalnızca USD / XAU / XAG (nakit-eşdeğeri, haircut 0). nominalQuantity USD için tutar,
    // metaller için ONS'tur; marketValueUsd metal için canlı ons snapshot'ı (ekranlarda revalueCollaterals
    // ile canlı yeniden değerlenir). Bkz. collateral-actions.addCustomerCollateral — aynı mantık.
    const nominalQuantity = Number(data.initialCollateral);
    const assetCode = data.collateralAssetCode || 'Nakit-USD';
    const currency = assetCode.includes('-XAU') ? 'XAU' : assetCode.includes('-XAG') ? 'XAG' : 'USD';
    let marketValueUsd = nominalQuantity; // USD 1:1
    if (currency === 'XAU' || currency === 'XAG') {
      const live = await getSpot(currency);
      marketValueUsd = live?.price ? nominalQuantity * live.price : 0;
    }
    await collateralRepository.addCollateral({
      customerId,
      assetCode,
      currency,
      nominalQuantity,
      marketValueUsd,
      haircut: 0,
    });
    const unit = currency === 'USD' ? 'USD' : 'ons';
    await db.activity.log(customerId, "Margin Updated",
      `Başlangıç teminatı yatırıldı: ${nominalQuantity} ${unit} (${assetCode})`);
  }

  revalidatePath(`/customers/${customerId}`);
  revalidatePath("/customers");
  revalidatePath("/risk");
}

export async function deleteTradeAction(customerId: string, tradeId: string) {
  await db.trades.delete(tradeId);
  await db.activity.log(customerId, "Other", "İşlem silindi.");
  revalidatePath(`/customers/${customerId}`);
  revalidatePath("/customers");
  revalidatePath("/risk");
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

  // Pozisyon yönüne göre ödeme ve gerçekleşen K/Z: vade intrinsic'i − ödenen prim (Long) / + alınan prim (Short).
  const payout = trade.position === "Long" ? intrinsicValue : -intrinsicValue;
  const premiumAdjustment = trade.position === "Long" ? -trade.premium : trade.premium;
  const finalPnl = payout + premiumAdjustment;

  await db.trades.update(tradeId, {
    status: "Closed",
    pnl: finalPnl,
    mtm: 0, // MTM is zero once settled
    currentPremium: 0,
  });
  await db.activity.log(customerId, "Trade Closed",
    `İşlem vade sonu kapatıldı: ${trade.underlying} ${trade.position} ${trade.type} · K/Z ${finalPnl.toFixed(2)} USD`);

  revalidatePath(`/customers/${customerId}`);
  revalidatePath("/customers");
  revalidatePath("/risk");
}
