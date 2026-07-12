import { cache } from "react";
import { CollateralItem } from "@/types/collateral";
import { dbc } from "@/lib/db";
import type { Row } from "@libsql/client";

function rowToItem(r: Row): CollateralItem {
  return {
    id: String(r.id),
    customerId: String(r.customerId),
    assetCode: String(r.assetCode ?? ''),
    currency: String(r.currency ?? ''),
    nominalQuantity: Number(r.nominalQuantity ?? 0),
    marketValueUsd: Number(r.marketValueUsd ?? 0),
    haircut: r.haircut == null ? undefined : Number(r.haircut),
    addedAt: String(r.addedAt ?? ''),
  };
}

// React cache(): tek istek içinde tekrar eden findAll/findByCustomerId çağrılarını tek sorguya indirger.
const findByCustomerIdCached = cache(async (customerId: string): Promise<CollateralItem[]> => {
  const c = await dbc();
  const r = await c.execute({ sql: 'SELECT * FROM collaterals WHERE customerId = ?', args: [customerId] });
  return r.rows.map(rowToItem);
});

const findAllCached = cache(async (): Promise<CollateralItem[]> => {
  const c = await dbc();
  const r = await c.execute('SELECT * FROM collaterals');
  return r.rows.map(rowToItem);
});

export class CollateralRepository {
  async findByCustomerId(customerId: string): Promise<CollateralItem[]> {
    return findByCustomerIdCached(customerId);
  }

  async addCollateral(item: Omit<CollateralItem, 'id' | 'addedAt'>): Promise<CollateralItem> {
    const c = await dbc();
    const newItem: CollateralItem = { ...item, id: `col-${Date.now()}`, addedAt: new Date().toISOString() };
    await c.execute({
      sql: 'INSERT INTO collaterals VALUES (?,?,?,?,?,?,?,?)',
      args: [newItem.id, newItem.customerId, newItem.assetCode, newItem.currency,
             newItem.nominalQuantity, newItem.marketValueUsd, newItem.haircut ?? null, newItem.addedAt],
    });
    return newItem;
  }

  async findAll(): Promise<CollateralItem[]> {
    return findAllCached();
  }

  async deleteCollateral(id: string): Promise<void> {
    const c = await dbc();
    await c.execute({ sql: 'DELETE FROM collaterals WHERE id = ?', args: [id] });
  }
}

export const collateralRepository = new CollateralRepository();
