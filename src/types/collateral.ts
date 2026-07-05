export interface CollateralItem {
  id: string;
  customerId: string;
  assetCode: string; // e.g., 'Nakit-USD', 'IDL-LKT-MPF'
  currency: string;
  nominalQuantity: number;
  marketValueUsd: number;
  addedAt: string;
}
