import { CollateralItem } from "@/types/collateral";

// In a real application, this would use Prisma or Supabase client
// e.g., import { prisma } from "@/lib/db"

const MOCK_COLLATERALS: CollateralItem[] = [
  {
    id: "col-1",
    customerId: "c1", // Customer A
    assetCode: "Nakit-USD",
    currency: "USD",
    nominalQuantity: 500000,
    marketValueUsd: 500000,
    addedAt: new Date().toISOString()
  },
  {
    id: "col-2",
    customerId: "c1",
    assetCode: "IDL-LKT-MPF",
    currency: "TRY",
    nominalQuantity: 1000000,
    marketValueUsd: 28500, // Varsayılan 35 kur üzerinden
    addedAt: new Date().toISOString()
  }
];

export class CollateralRepository {
  async findByCustomerId(customerId: string): Promise<CollateralItem[]> {
    // return prisma.collateral.findMany({ where: { customerId } })
    return MOCK_COLLATERALS.filter(c => c.customerId === customerId);
  }

  async addCollateral(item: Omit<CollateralItem, 'id' | 'addedAt'>): Promise<CollateralItem> {
    const newItem: CollateralItem = {
      ...item,
      id: `col-${Date.now()}`,
      addedAt: new Date().toISOString()
    };
    MOCK_COLLATERALS.push(newItem);
    return newItem;
  }

  async findAll(): Promise<CollateralItem[]> {
    return [...MOCK_COLLATERALS];
  }
}

export const collateralRepository = new CollateralRepository();
