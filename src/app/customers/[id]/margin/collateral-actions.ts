'use server';

import { addCollateralAtomically, removeCollateralOwned } from '@/repositories/trade-lifecycle.repository';
import { getSpot } from '@/services/market.service';
import { db } from '@/services/mockDb';
import { revalidatePath } from 'next/cache';
import { finiteNumber, validateCollateral, validateId } from '@/lib/trade-validation';

/**
 * Teminat ekler. Tipler yalnızca USD / XAU / XAG nakit-eşdeğeri (haircut 0).
 * nominalQuantity USD için tutar, XAU/XAG için ONS'tur. marketValueUsd yalnızca giriş-anı
 * snapshot'ıdır (fallback); gerçek değer ekranlarda revalueCollaterals ile canlı hesaplanır.
 */
export async function addCustomerCollateral(
  customerId: string,
  data: {
    assetCode: string;
    currency: string;
    nominalQuantity: number;
  },
  activity?: string,
) {
  validateId(customerId);
  const collateral = validateCollateral(data);
  if (!(await db.customers.findById(customerId))) throw new Error('Müşteri bulunamadı.');
  const cur = collateral.currency;
  let marketValueUsd = collateral.nominalQuantity; // USD 1:1
  if (cur === 'XAU' || cur === 'XAG') {
    const live = await getSpot(cur);
    const price = finiteNumber(live?.price, 'Metal teminat fiyatı');
    marketValueUsd = finiteNumber(collateral.nominalQuantity * price, 'Teminat değeri');
  }

  await addCollateralAtomically(
    {
      customerId,
      ...collateral,
      marketValueUsd,
      haircut: 0,
    },
    activity,
  );
  return { ...collateral, marketValueUsd };

  revalidatePath(`/customers/${customerId}/margin`);
  revalidatePath(`/customers/${customerId}`);
  revalidatePath('/margin');
  revalidatePath('/dashboard');
}

export async function removeCustomerCollateral(customerId: string, collateralId: string) {
  validateId(customerId);
  validateId(collateralId, 'Teminat');
  await removeCollateralOwned(customerId, collateralId);

  revalidatePath(`/customers/${customerId}/margin`);
  revalidatePath(`/customers/${customerId}`);
  revalidatePath('/margin');
  revalidatePath('/dashboard');
}
