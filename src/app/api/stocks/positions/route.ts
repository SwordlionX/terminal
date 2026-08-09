import { NextResponse } from 'next/server';
import { dbc } from '@/lib/db';
import { SYMBOL_RE, toYahooSymbol, normalizeStockTradeType, StockTradeType } from '@/lib/bist';

export const dynamic = 'force-dynamic';

/** stock_positions satırının istemciye dönen biçimi (updatedAt hariç). */
interface StoredPosition {
  tradeType: StockTradeType;
  basePrice: number;
  quantity: number;
  premium: number;
}

export async function GET() {
  try {
    const db = await dbc();
    const result = await db.execute('SELECT * FROM stock_positions ORDER BY symbol');

    // Convert array of rows to a dictionary keyed by symbol
    const positions: Record<string, StoredPosition> = {};
    for (const row of result.rows) {
      positions[String(row.symbol)] = {
        // Tanınmayan/eski bir değer gelirse 'long'a düşülür — satır kaybolmaz.
        tradeType: normalizeStockTradeType(row.tradeType) ?? 'long',
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

/**
 * Gövde doğrulaması. `stock_positions`ın birincil anahtarı sembol olduğu ve sayısal
 * alanlar doğrudan SQLite'a yazıldığı için doğrulama şart: eksik bir alan `Number(undefined)`
 * ile NaN üretip libsql'i patlatıyordu (500), serbest metin bir sembol de tabloda çöp satır
 * açıyordu. Hatalı gövde artık 400 ile ve NEDENİYLE geri döner.
 */
function parseBody(body: unknown): { symbol: string; pos: StoredPosition } | { error: string } {
  const b = (body ?? {}) as Record<string, unknown>;

  if (typeof b.symbol !== 'string' || !b.symbol.trim()) return { error: 'Sembol gerekli' };
  const symbol = toYahooSymbol(b.symbol);
  if (!SYMBOL_RE.test(symbol)) return { error: `Geçersiz sembol: ${b.symbol}` };

  const tradeType = normalizeStockTradeType(b.tradeType);
  if (!tradeType) {
    return { error: 'Geçersiz işlem tipi (call_buy / call_sell / put_buy / put_sell / long)' };
  }

  const num = (v: unknown): number | null => {
    const n = typeof v === 'string' ? parseFloat(v) : v;
    return typeof n === 'number' && Number.isFinite(n) ? n : null;
  };
  const basePrice = num(b.basePrice), quantity = num(b.quantity), premium = num(b.premium);

  if (basePrice == null || basePrice < 0) return { error: 'Maliyet/kullanım fiyatı geçersiz' };
  if (quantity == null || quantity <= 0) return { error: 'Miktar 0’dan büyük olmalı' };
  if (premium == null) return { error: 'Prim geçersiz' };

  return { symbol, pos: { tradeType, basePrice, quantity, premium } };
}

export async function POST(request: Request) {
  try {
    const parsed = parseBody(await request.json().catch(() => null));
    if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const { symbol, pos } = parsed;

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
      args: [symbol, pos.tradeType, pos.basePrice, pos.quantity, pos.premium, now],
    });

    return NextResponse.json({ success: true, symbol });
  } catch (error) {
    console.error('Failed to save stock position:', error);
    return NextResponse.json({ error: 'Failed to save stock position' }, { status: 500 });
  }
}

/** DELETE /api/stocks/positions?symbol=THYAO.IS — takip listesinden çıkarır. */
export async function DELETE(request: Request) {
  try {
    const raw = new URL(request.url).searchParams.get('symbol');
    if (!raw) return NextResponse.json({ error: 'Sembol gerekli' }, { status: 400 });
    const symbol = toYahooSymbol(raw);
    if (!SYMBOL_RE.test(symbol)) return NextResponse.json({ error: `Geçersiz sembol: ${raw}` }, { status: 400 });

    const db = await dbc();
    await db.execute({ sql: 'DELETE FROM stock_positions WHERE symbol = ?', args: [symbol] });
    return NextResponse.json({ success: true, symbol });
  } catch (error) {
    console.error('Failed to delete stock position:', error);
    return NextResponse.json({ error: 'Failed to delete stock position' }, { status: 500 });
  }
}
