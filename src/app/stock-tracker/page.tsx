"use client";

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ArrowDownIcon, ArrowUpIcon, RefreshCcw, TrendingUp, Activity, DollarSign, Briefcase, Save } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

// Define our stock symbols
const STOCKS = [
  { symbol: 'THYAO.IS', name: 'Türk Hava Yolları', color: 'from-red-500 to-rose-600' },
  { symbol: 'PGSUS.IS', name: 'Pegasus Hava Taşımacılığı', color: 'from-yellow-400 to-orange-500' }
];

type StockData = {
  price: number;
  previousClose: number;
};

type UserInputs = {
  tradeType: 'long' | 'put_sell';
  basePrice: number;
  quantity: number;
  premium: number;
};

export default function StockTrackerPage() {
  const [stockData, setStockData] = useState<Record<string, StockData>>({});
  const [loading, setLoading] = useState<boolean>(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  
  // Database sync state
  const [savingSymbol, setSavingSymbol] = useState<string | null>(null);
  
  // State for user inputs per stock
  const [inputs, setInputs] = useState<Record<string, UserInputs>>({
    'THYAO.IS': { tradeType: 'long', basePrice: 0, quantity: 100, premium: 0 },
    'PGSUS.IS': { tradeType: 'long', basePrice: 0, quantity: 100, premium: 0 }
  });

  const saveTimeoutRef = useRef<Record<string, NodeJS.Timeout>>({});

  const fetchPositions = useCallback(async () => {
    try {
      const res = await fetch('/api/stocks/positions');
      if (res.ok) {
        const data = await res.json();
        if (data.positions) {
          setInputs(prev => ({ ...prev, ...data.positions }));
        }
      }
    } catch (error) {
      console.error("Failed to fetch positions from DB", error);
    }
  }, []);

  const fetchStockData = useCallback(async () => {
    setLoading(true);
    try {
      const newData: Record<string, StockData> = {};
      
      for (const stock of STOCKS) {
        const res = await fetch(`/api/stocks?symbol=${stock.symbol}`);
        if (res.ok) {
          const data = await res.json();
          newData[stock.symbol] = data;
        }
      }
      
      setStockData(newData);
      setLastUpdated(new Date());
    } catch (error) {
      console.error("Failed to fetch stock data", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPositions();
    fetchStockData();
    // Auto-refresh every 30 seconds
    const interval = setInterval(fetchStockData, 30000);
    return () => clearInterval(interval);
  }, [fetchStockData, fetchPositions]);

  const saveToDatabase = async (symbol: string, inputData: UserInputs) => {
    setSavingSymbol(symbol);
    try {
      await fetch('/api/stocks/positions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol, ...inputData })
      });
    } catch (error) {
      console.error(`Failed to save ${symbol} to DB`, error);
    } finally {
      setTimeout(() => setSavingSymbol(null), 500); // give a little time to show the saved state
    }
  };

  const handleInputChange = (symbol: string, field: keyof UserInputs, value: any) => {
    setInputs(prev => {
      const newInputs = {
        ...prev,
        [symbol]: {
          ...prev[symbol],
          [field]: value
        }
      };
      
      // Clear existing timeout for this symbol
      if (saveTimeoutRef.current[symbol]) {
        clearTimeout(saveTimeoutRef.current[symbol]);
      }
      
      // Set a new timeout to auto-save after 1 second of no typing
      saveTimeoutRef.current[symbol] = setTimeout(() => {
        saveToDatabase(symbol, newInputs[symbol]);
      }, 1000);
      
      return newInputs;
    });
  };

  const calculatePnL = (symbol: string) => {
    const data = stockData[symbol];
    if (!data) return { pnl: 0, isProfit: true };

    const input = inputs[symbol];
    let pnl = 0;

    if (input.tradeType === 'long') {
      pnl = (data.price - input.basePrice) * input.quantity + input.premium;
    } else if (input.tradeType === 'put_sell') {
      if (data.price >= input.basePrice) {
        pnl = input.premium;
      } else {
        pnl = ((data.price - input.basePrice) * input.quantity) + input.premium;
      }
    }

    return {
      pnl,
      isProfit: pnl >= 0
    };
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-50 p-6 font-sans selection:bg-indigo-500/30">
      <div className="max-w-6xl mx-auto space-y-8">
        
        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-neutral-900/50 p-6 rounded-3xl border border-neutral-800/50 backdrop-blur-xl">
          <div>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-indigo-400 to-cyan-400 bg-clip-text text-transparent flex items-center gap-3">
              <Activity className="w-8 h-8 text-indigo-400" />
              Anlık Portföy Takibi
            </h1>
            <p className="text-neutral-400 mt-2">Turso veritabanı ile eşzamanlı Müşteri prim ve kar/zarar durumu.</p>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-sm text-neutral-400 text-right hidden sm:block">
              <div>Son Güncelleme</div>
              <div className="font-mono text-neutral-200">
                {lastUpdated ? lastUpdated.toLocaleTimeString('tr-TR') : '--:--:--'}
              </div>
            </div>
            <Button 
              onClick={fetchStockData} 
              disabled={loading}
              className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl transition-all duration-300 hover:shadow-[0_0_20px_rgba(79,70,229,0.4)]"
            >
              <RefreshCcw className={`w-4 h-4 sm:mr-2 ${loading ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Yenile</span>
            </Button>
          </div>
        </div>

        {/* Stock Cards */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {STOCKS.map((stock) => {
            const data = stockData[stock.symbol];
            const input = inputs[stock.symbol];
            const { pnl, isProfit } = calculatePnL(stock.symbol);
            const isSaving = savingSymbol === stock.symbol;
            
            const priceChange = data ? data.price - data.previousClose : 0;
            const priceChangePercent = data ? (priceChange / data.previousClose) * 100 : 0;
            const isPriceUp = priceChange >= 0;

            return (
              <Card key={stock.symbol} className="bg-neutral-900/60 border-neutral-800/60 backdrop-blur-md rounded-3xl overflow-hidden shadow-2xl transition-all duration-500 hover:border-neutral-700/80 hover:bg-neutral-900/80 group">
                <div className={`h-2 w-full bg-gradient-to-r ${stock.color}`} />
                
                <CardHeader className="pb-4">
                  <div className="flex justify-between items-start">
                    <div>
                      <CardTitle className="text-2xl font-bold text-white tracking-tight flex items-center gap-2">
                        {stock.symbol}
                      </CardTitle>
                      <CardDescription className="text-neutral-400 mt-1">
                        {stock.name}
                      </CardDescription>
                    </div>
                    
                    <div className="text-right">
                      {data ? (
                        <>
                          <div className="text-3xl font-mono font-bold text-white tracking-tighter">
                            ₺{data.price.toFixed(2)}
                          </div>
                          <Badge variant="outline" className={`mt-2 font-mono ${isPriceUp ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-red-500/10 text-red-400 border-red-500/20'}`}>
                            {isPriceUp ? <ArrowUpIcon className="w-3 h-3 mr-1" /> : <ArrowDownIcon className="w-3 h-3 mr-1" />}
                            {Math.abs(priceChangePercent).toFixed(2)}%
                          </Badge>
                        </>
                      ) : (
                        <div className="animate-pulse bg-neutral-800 h-10 w-24 rounded-lg"></div>
                      )}
                    </div>
                  </div>
                </CardHeader>
                
                <CardContent className="space-y-6">
                  <div className="grid grid-cols-2 gap-4 p-5 bg-neutral-950/50 rounded-2xl border border-neutral-800/50 relative">
                    {/* Save Indicator */}
                    <div className={`absolute top-2 right-2 text-xs flex items-center gap-1 transition-opacity duration-300 ${isSaving ? 'opacity-100 text-indigo-400' : 'opacity-0'}`}>
                      <Save className="w-3 h-3 animate-pulse" />
                      Kaydediliyor...
                    </div>

                    <div className="space-y-2 col-span-2">
                      <Label className="text-neutral-400 text-xs uppercase tracking-wider font-semibold">İşlem Tipi</Label>
                      <Select 
                        value={input.tradeType} 
                        onValueChange={(val: any) => handleInputChange(stock.symbol, 'tradeType', val)}
                      >
                        <SelectTrigger className="bg-neutral-900 border-neutral-800 rounded-xl">
                          <SelectValue placeholder="İşlem Tipi" />
                        </SelectTrigger>
                        <SelectContent className="bg-neutral-900 border-neutral-800 rounded-xl">
                          <SelectItem value="long">Normal Hisse (Long)</SelectItem>
                          <SelectItem value="put_sell">Put Opsiyon Satışı</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label className="text-neutral-400 text-xs uppercase tracking-wider font-semibold">
                        {input.tradeType === 'put_sell' ? 'Kullanım Fiyatı (Strike)' : 'Maliyet Fiyatı'}
                      </Label>
                      <div className="relative">
                        <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500" />
                        <Input 
                          type="number" 
                          value={input.basePrice || ''} 
                          onChange={(e) => handleInputChange(stock.symbol, 'basePrice', parseFloat(e.target.value) || 0)}
                          className="bg-neutral-900 border-neutral-800 pl-9 rounded-xl focus:ring-indigo-500"
                          placeholder="0.00"
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label className="text-neutral-400 text-xs uppercase tracking-wider font-semibold">Miktar (Lot)</Label>
                      <div className="relative">
                        <Briefcase className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500" />
                        <Input 
                          type="number" 
                          value={input.quantity || ''} 
                          onChange={(e) => handleInputChange(stock.symbol, 'quantity', parseInt(e.target.value) || 0)}
                          className="bg-neutral-900 border-neutral-800 pl-9 rounded-xl focus:ring-indigo-500"
                          placeholder="0"
                        />
                      </div>
                    </div>

                    <div className="space-y-2 col-span-2">
                      <Label className="text-neutral-400 text-xs uppercase tracking-wider font-semibold">Müşteriye Verilen Prim / Gelir (TL)</Label>
                      <div className="relative">
                        <TrendingUp className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500" />
                        <Input 
                          type="number" 
                          value={input.premium || ''} 
                          onChange={(e) => handleInputChange(stock.symbol, 'premium', parseFloat(e.target.value) || 0)}
                          className="bg-neutral-900 border-neutral-800 pl-9 rounded-xl focus:ring-indigo-500"
                          placeholder="0.00"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Result Area */}
                  <div className={`p-6 rounded-2xl border transition-all duration-300 relative overflow-hidden ${
                    isProfit 
                      ? 'bg-emerald-500/10 border-emerald-500/20 shadow-[0_0_30px_rgba(16,185,129,0.1)]' 
                      : 'bg-red-500/10 border-red-500/20 shadow-[0_0_30px_rgba(239,68,68,0.1)]'
                  }`}>
                    <div className={`absolute -right-20 -top-20 w-40 h-40 blur-3xl opacity-20 rounded-full ${isProfit ? 'bg-emerald-500' : 'bg-red-500'}`} />
                    
                    <div className="flex justify-between items-center relative z-10">
                      <div>
                        <div className={`text-sm font-semibold uppercase tracking-wider ${isProfit ? 'text-emerald-400' : 'text-red-400'}`}>
                          Net {isProfit ? 'Kar' : 'Zarar'} Durumu
                        </div>
                        <div className="text-neutral-400 text-xs mt-1">Anlık fiyata göre hesaplanmıştır</div>
                      </div>
                      <div className={`text-4xl font-black font-mono tracking-tighter ${isProfit ? 'text-emerald-400' : 'text-red-400'}`}>
                        {isProfit ? '+' : ''}{pnl.toFixed(2)} <span className="text-xl">₺</span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
        
      </div>
    </div>
  );
}
