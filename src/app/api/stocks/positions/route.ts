import { NextResponse } from 'next/server';
import { dbc } from '@/lib/db';

export async function GET() {
  try {
    const db = await dbc();
    const result = await db.execute('SELECT * FROM stock_positions');
    
    // Convert array of rows to a dictionary keyed by symbol
    const positions: Record<string, any> = {};
    for (const row of result.rows) {
      positions[String(row.symbol)] = {
        tradeType: String(row.tradeType),
        basePrice: Number(row.basePrice),
        quantity: Number(row.quantity),
        premium: Number(row.premium),
      };
    }
    
    return NextResponse.json({ positions });
  } catch (error) {
    console.error('Failed to get stock positions:', error);
    return NextResponse.json({ error: 'Failed to get stock positions' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { symbol, tradeType, basePrice, quantity, premium } = body;
    
    if (!symbol || !tradeType) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const db = await dbc();
    const now = new Date().toISOString();
    
    await db.execute({
      sql: `INSERT INTO stock_positions (symbol, tradeType, basePrice, quantity, premium, updatedAt)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(symbol) DO UPDATE SET
              tradeType = excluded.tradeType,
              basePrice = excluded.basePrice,
              quantity = excluded.quantity,
              premium = excluded.premium,
              updatedAt = excluded.updatedAt`,
      args: [symbol, tradeType, Number(basePrice), Number(quantity), Number(premium), now]
    });
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to save stock position:', error);
    return NextResponse.json({ error: 'Failed to save stock position' }, { status: 500 });
  }
}
