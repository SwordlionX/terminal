import { randomUUID } from "node:crypto";
import type { Transaction } from "@libsql/client";
import { dbc } from "@/lib/db";
import { rowToTrade } from "@/services/mockDb";
import type { Trade } from "@/types";
import type { CollateralItem } from "@/types/collateral";
import { finiteNumber, validateId } from "@/lib/trade-validation";

type NewCollateral = Omit<CollateralItem, "id" | "addedAt">;

async function writeTransaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
  const client = await dbc();
  const tx = await client.transaction("write");
  try {
    const result = await work(tx);
    await tx.commit();
    return result;
  } finally {
    // Commit edilmemiş işlem, hata dahil her çıkışta tamamen geri alınır.
    tx.close();
  }
}

async function requireCustomer(tx: Transaction, customerId: string) {
  validateId(customerId);
  const result = await tx.execute({ sql: "SELECT id FROM customers WHERE id = ?", args: [customerId] });
  if (!result.rows.length) throw new Error("Müşteri bulunamadı.");
}

async function log(tx: Transaction, customerId: string, type: string, description: string) {
  await tx.execute({ sql: "INSERT INTO activity_log (id,customerId,date,type,description) VALUES (?,?,?,?,?)",
    args: [`act-${randomUUID()}`, customerId, new Date().toISOString(), type, description] });
}

async function insertCollateral(tx: Transaction, data: NewCollateral) {
  await tx.execute({ sql: "INSERT INTO collaterals (id,customerId,assetCode,currency,nominalQuantity,marketValueUsd,haircut,addedAt) VALUES (?,?,?,?,?,?,?,?)",
    args: [`col-${randomUUID()}`, data.customerId, data.assetCode, data.currency, data.nominalQuantity,
      data.marketValueUsd, data.haircut ?? null, new Date().toISOString()] });
  await log(tx, data.customerId, "Margin Updated", `Teminat eklendi: ${data.nominalQuantity} ${data.currency === "USD" ? "USD" : "ons"} (${data.assetCode})`);
}

/** İşlem, başlangıç teminatı ve geçmiş: ya tamamı yazılır ya hiçbiri. Ağ çağrısı yok. */
export async function bookTrade(data: Omit<Trade, "id">, collateral?: NewCollateral): Promise<string> {
  return writeTransaction(async tx => {
    await requireCustomer(tx, data.customerId);
    if (collateral && collateral.customerId !== data.customerId) throw new Error("Teminat müşterisi uyuşmuyor.");
    const id = `t-${randomUUID()}`;
    const columns = ["id", "customerId", "tradeDate", "expiryDate", "underlying", "type", "position",
      "spot", "strike", "volatility", "contractSize", "premium", "currentPremium", "mtm", "pnl",
      "delta", "gamma", "vega", "theta", "marginRate", "status", "barrierType", "barrierLevel", "barrierStyle", "barrierStartDate", "barrierEndDate"];
    await tx.execute({ sql: `INSERT INTO trades (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`,
      args: [id, data.customerId, data.tradeDate, data.expiryDate, data.underlying, data.type, data.position,
        data.spot, data.strike, data.volatility, data.contractSize, data.premium, data.currentPremium,
        data.mtm, data.pnl, data.delta, data.gamma, data.vega, data.theta, data.marginRate ?? null, data.status,
        data.barrierType ?? null, data.barrierLevel ?? null, data.barrierStyle ?? null, data.barrierStartDate ?? null, data.barrierEndDate ?? null] });
    await log(tx, data.customerId, "Trade Added", `İşlem eklendi: ${data.underlying} ${data.position} ${data.type} · strike ${data.strike} · ${data.contractSize} kontrat`);
    if (collateral) await insertCollateral(tx, collateral);
    return id;
  });
}

export async function addCollateralAtomically(data: NewCollateral): Promise<void> {
  await writeTransaction(async tx => {
    await requireCustomer(tx, data.customerId);
    await insertCollateral(tx, data);
  });
}

export async function removeCollateralOwned(customerId: string, id: string): Promise<void> {
  validateId(id, "Teminat");
  await writeTransaction(async tx => {
    await requireCustomer(tx, customerId);
    const result = await tx.execute({ sql: "DELETE FROM collaterals WHERE id = ? AND customerId = ?", args: [id, customerId] });
    if (result.rowsAffected !== 1) throw new Error("Bu müşteriye ait teminat bulunamadı.");
    await log(tx, customerId, "Margin Updated", "Teminat kaldırıldı.");
  });
}

export async function deleteOpenTradeOwned(customerId: string, id: string): Promise<void> {
  validateId(id, "İşlem");
  await writeTransaction(async tx => {
    await requireCustomer(tx, customerId);
    const result = await tx.execute({ sql: "DELETE FROM trades WHERE id = ? AND customerId = ? AND status IN ('Open','Near Expiry','Expired')", args: [id, customerId] });
    if (result.rowsAffected !== 1) throw new Error("İşlem bulunamadı veya arşivlenmiş; arşiv kayıtları buradan silinemez.");
    await log(tx, customerId, "Other", "İşlem silindi.");
  });
}

export async function settleTradeOwned(customerId: string, id: string, expirySpot: number): Promise<void> {
  validateId(id, "İşlem");
  expirySpot = finiteNumber(expirySpot, "Vade sonu spotu", true);
  await writeTransaction(async tx => {
    await requireCustomer(tx, customerId);
    const result = await tx.execute({ sql: "SELECT * FROM trades WHERE id = ? AND customerId = ?", args: [id, customerId] });
    if (!result.rows.length) throw new Error("Bu müşteriye ait işlem bulunamadı.");
    const trade = rowToTrade(result.rows[0]);
    if (trade.status === "Closed") throw new Error("İşlem zaten kapatılmış ve arşivlenmiş.");
    const intrinsic = Math.max(0, trade.type === "Call" ? expirySpot - trade.strike : trade.strike - expirySpot) * trade.contractSize;
    const pnl = (trade.position === "Long" ? 1 : -1) * (intrinsic - trade.premium);
    if (!Number.isFinite(pnl)) throw new Error("Kapanış tutarı hesaplanamıyor.");
    const closedAt = new Date().toISOString();
    const updated = await tx.execute({
      sql: "UPDATE trades SET status = 'Closed', pnl = ?, mtm = 0, currentPremium = 0 WHERE id = ? AND customerId = ? AND status IN ('Open','Near Expiry','Expired')",
      args: [pnl, id, customerId],
    });
    if (updated.rowsAffected !== 1) throw new Error("İşlem artık kapatılabilir durumda değil.");
    // Mevcut kv kullanılır; şema göçü veya yeni tablo gerektirmez. Aynı anahtar ikinci kapanışı da engeller.
    await tx.execute({ sql: "INSERT INTO kv (k,v) VALUES (?,?)", args: [`trade_settlement:${id}`, JSON.stringify({ closedAt, expirySpot })] });
    await log(tx, customerId, "Trade Closed", `İşlem kapatıldı ve arşivlendi: ${trade.underlying} ${trade.position} ${trade.type} · K/Z ${pnl.toFixed(2)} USD`);
  });
}

export interface ArchivedTrade { trade: Trade; customerName: string; closedAt: string | null; expirySpot: number | null }

export async function findArchivedTrades(customerId?: string): Promise<ArchivedTrade[]> {
  const client = await dbc();
  const result = await client.execute({ sql: `SELECT t.*, c.companyName AS archiveCustomerName, k.v AS settlementMetadata
    FROM trades t LEFT JOIN customers c ON c.id = t.customerId
    LEFT JOIN kv k ON k.k = 'trade_settlement:' || t.id
    WHERE t.status = 'Closed' ${customerId ? "AND t.customerId = ?" : ""} ORDER BY t.expiryDate DESC, t.id`, args: customerId ? [customerId] : [] });
  return result.rows.map(row => {
    let closedAt: string | null = null;
    let expirySpot: number | null = null;
    try {
      const metadata = JSON.parse(String(row.settlementMetadata));
      if (typeof metadata?.closedAt === "string" && Number.isFinite(Date.parse(metadata.closedAt))) closedAt = metadata.closedAt;
      if (typeof metadata?.expirySpot === "number" && Number.isFinite(metadata.expirySpot) && metadata.expirySpot >= 0) expirySpot = metadata.expirySpot;
    } catch { /* Eski kapalı kayıtlarda metadata yoktur; tarih/fiyat uydurulmaz. */ }
    return { trade: rowToTrade(row), customerName: String(row.archiveCustomerName ?? "Silinmiş müşteri"), closedAt, expirySpot };
  });
}
