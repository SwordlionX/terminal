"use server";

import { collateralRepository } from "@/repositories/collateral.repository";
import { revalidatePath } from "next/cache";

export async function addCustomerCollateral(customerId: string, data: {
  assetCode: string;
  currency: string;
  nominalQuantity: number;
  marketValueUsd: number;
  haircut: number;
}) {
  await collateralRepository.addCollateral({
    customerId,
    assetCode: data.assetCode,
    currency: data.currency,
    nominalQuantity: data.nominalQuantity,
    marketValueUsd: data.marketValueUsd,
    haircut: data.haircut,
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
