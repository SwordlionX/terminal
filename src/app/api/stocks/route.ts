import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get('symbol');

  if (!symbol) {
    return NextResponse.json({ error: 'Symbol is required' }, { status: 400 });
  }

  try {
    const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0'
      },
      next: { revalidate: 60 } // Cache for 60 seconds
    });
    
    if (!res.ok) {
      throw new Error('Failed to fetch data');
    }
    
    const data = await res.json();
    const price = data.chart.result[0].meta.regularMarketPrice;
    const previousClose = data.chart.result[0].meta.previousClose;
    
    return NextResponse.json({ price, previousClose });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Failed to fetch price' }, { status: 500 });
  }
}
