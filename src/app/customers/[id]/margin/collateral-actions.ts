"use server";

import { collateralRepository } from "@/repositories/collateral.repository";
import { getSpot } from "@/services/market.service";
import { revalidatePath } from "next/cache";

/**
 * Teminat ekler. Tipler yalnızca USD / XAU / XAG nakit-eşdeğeri (haircut 0).
 * nominalQuantity USD için tutar, XAU/XAG için ONS'tur. marketValueUsd yalnızca giriş-anı
 * snapshot'ıdır (fallback); gerçek değer ekranlarda revalueCollaterals ile canlı hesaplanır.
 */
export async function addCustomerCollateral(customerId: string, data: {
  assetCode: string;
  currency: string;
  nominalQuantity: number;
}) {
  const cur = data.currency.toUpperCase();
  let marketValueUsd = data.nominalQuantity; // USD 1:1
  if (cur === 'XAU' || cur === 'XAG') {
    const live = await getSpot(cur);
    marketValueUsd = live?.price ? data.nominalQuantity * live.price : 0;
  }

  await collateralRepository.addCollateral({
    customerId,
    assetCode: data.assetCode,
    currency: data.currency,
    nominalQuantity: data.nominalQuantity,
    marketValueUsd,
    haircut: 0,
  });

  revalidatePath(`/customers/${customerId}/margin`);
  revalidatePath(`/customers/${customerId}`);
  revalidatePath("/risk");
  revalidatePath("/dashboard");
}

export async function removeCustomerCollateral(customerId: string, collateralId: string) {
  await collateralRepository.deleteCollateral(collateralId);

  revalidatePath(`/customers/${customerId}/margin`);
  revalidatePath(`/customers/${customerId}`);
  revalidatePath("/risk");
  revalidatePath("/dashboard");
}
