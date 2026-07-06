import { NextResponse } from 'next/server';
import { db } from '@/services/mockDb';

export const dynamic = 'force-dynamic';

/** GET /api/customers — fiyatlama ekranındaki müşteri seçimi için. */
export async function GET() {
  const customers = await db.customers.findMany();
  return NextResponse.json(customers.map(c => ({ id: c.id, companyName: c.companyName })));
}
