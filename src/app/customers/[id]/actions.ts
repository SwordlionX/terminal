'use server';

import { db } from '@/services/mockDb';
import { bookTrade, deleteOpenTradeOwned, settleTradeOwned } from '@/repositories/trade-lifecycle.repository';
import { getSpot } from '@/services/market.service';
import { MarginEngine } from '@/lib/margin/engine';
import { revalidatePath } from 'next/cache';
import { finiteNumber, validateId, validateManualTrade, type ManualTradeInput } from '@/lib/trade-validation';

export async function addManualTradeAction(customerId: string, data: ManualTradeInput) {
  validateId(customerId);
  const { manualMarginRate, collateral, ...validatedTrade } = validateManualTrade(data);
  const { contractSize, premium } = validatedTrade;

  // Teminat oranı: manuel girildiyse onu, yoksa vade × varlık grubu tablosundan otomatik hesapla
  // ve işleme kilitle (böylece blotter "Teminat Oranı" sütununda seed işlemler gibi görünür).
  const initialDays = Math.max(
    1,
    (new Date(validatedTrade.expiryDate).getTime() - new Date(validatedTrade.tradeDate).getTime()) / 86400000,
  );
  const resolvedMarginRate = manualMarginRate ?? MarginEngine.getBaseMarginRate(validatedTrade.underlying, initialDays);

  if (!(await db.customers.findById(customerId))) throw new Error('Müşteri bulunamadı.');

  // Tüm girişler ve gerekiyorsa metal fiyatı İLK yazmadan önce doğrulanır.
  // Ağ çağrısı transaction dışında; tüm kayıtlar aşağıda tek transaction ile yazılır.
  let marketValueUsd = collateral?.nominalQuantity ?? 0;
  if (collateral && collateral.currency !== 'USD') {
    const live = await getSpot(collateral.currency);
    const price = finiteNumber(live?.price, 'Metal teminat fiyatı');
    marketValueUsd = finiteNumber(collateral.nominalQuantity * price, 'Teminat değeri');
  }

  const trade = {
    ...validatedTrade,
    customerId,
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
    status: 'Open' as const,
  };

  await bookTrade(trade, collateral ? { customerId, ...collateral, marketValueUsd, haircut: 0 } : undefined);

  invalidateCustomer(customerId);
}

export async function deleteTradeAction(customerId: string, tradeId: string) {
  validateId(customerId);
  validateId(tradeId, 'İşlem');
  await deleteOpenTradeOwned(customerId, tradeId);
  invalidateCustomer(customerId);
}

export async function settleTradeAction(customerId: string, tradeId: string, expirySpot: number) {
  validateId(customerId);
  validateId(tradeId, 'İşlem');
  expirySpot = finiteNumber(expirySpot, 'Vade sonu spotu', true);
  await settleTradeOwned(customerId, tradeId, expirySpot);
  invalidateCustomer(customerId);
}

function invalidateCustomer(customerId: string) {
  for (const path of [
    `/customers/${customerId}`,
    `/customers/${customerId}/margin`,
    '/customers',
    '/margin',
    '/trades',
    '/archive',
    '/dashboard',
  ])
    revalidatePath(path);
}
