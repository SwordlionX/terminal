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
    addedAt: String(r.addedAt ?? ''),
  };
}

export class CollateralRepository {
  async findByCustomerId(customerId: string): Promise<CollateralItem[]> {
    const c = await dbc();
    const r = await c.execute({ sql: 'SELECT * FROM collaterals WHERE customerId = ?', args: [customerId] });
    return r.rows.map(rowToItem);
  }

  async addCollateral(item: Omit<CollateralItem, 'id' | 'addedAt'>): Promise<CollateralItem> {
    const c = await dbc();
    const newItem: CollateralItem = { ...item, id: `col-${Date.now()}`, addedAt: new Date().toISOString() };
    await c.execute({
      sql: 'INSERT INTO collaterals VALUES (?,?,?,?,?,?,?)',
      args: [newItem.id, newItem.customerId, newItem.assetCode, newItem.currency,
             newItem.nominalQuantity, newItem.marketValueUsd, newItem.addedAt],
    });
    return newItem;
  }

  async findAll(): Promise<CollateralItem[]> {
    const c = await dbc();
    const r = await c.execute('SELECT * FROM collaterals');
    return r.rows.map(rowToItem);
  }
}

export const collateralRepository = new CollateralRepository();
