import type { Trade } from "@/types";
import { TIINGO_KEY } from "@/services/market.service";
import { scanBarrierHistory, validHistoryDate, type BarrierHistoryReport } from "@/lib/barrier-history";

const historyCache = new Map<string, { at: number; rows: unknown }>();

/** Kullanıcı istediğinde çalışır. Otomatik/ücretli yeni abonelik veya veri yazması yapmaz. */
export async function checkTradeBarrierHistory(trade: Trade, now = new Date()): Promise<BarrierHistoryReport> {
  const today = now.toISOString().slice(0, 10);
  const startDate = trade.barrierStartDate || trade.tradeDate;
  const contractualEnd = trade.barrierEndDate || trade.expiryDate;
  const endDate = contractualEnd < today ? contractualEnd : today;
  const product = trade.underlying.toUpperCase();
  const ticker = product === "XAU" ? "xauusd" : product === "XAG" ? "xagusd" : "";
  const unavailable = (note: string): BarrierHistoryReport => ({ status: "unavailable", source: "Tiingo spot OHLC",
    checkedAt: now.toISOString(), startDate, endDate, bars: 0, note });
  if (!ticker) return unavailable("Bu tarama yalnız XAU/USD ve XAG/USD spot için destekleniyor.");
  if (trade.barrierStyle !== "Amerikan") return unavailable("Bu tarama sürekli gözlemli bariyerler içindir; vade anı gözlemi ayrıca doğrulanmalı.");
  if (!validHistoryDate(startDate) || !validHistoryDate(contractualEnd) || endDate < startDate ||
      !Number.isFinite(trade.barrierLevel) || !(trade.barrierLevel! > 0) ||
      !["Knock Out Up", "Knock Out Down", "Knock In Up", "Knock In Down"].includes(trade.barrierType ?? "")) {
    return unavailable("Bariyer bilgisi geçersiz veya gözlem aralığı henüz başlamadı.");
  }
  // İlk sürümde tek isteğin kapsamını sınırla; daha eski başlangıcı sessizce kırpma.
  if ((Date.parse(today) - Date.parse(startDate)) / 86400000 > 366) {
    return unavailable("İlk sürüm en fazla son 366 günün geçmişini tarar. Daha eski işlem için kapsamlı geçmiş aktarımı gerekiyor.");
  }
  if (!TIINGO_KEY) return unavailable("Tiingo erişim anahtarı bulunamadı.");
  const key = `${ticker}:${startDate}:${today}`;
  let cached = historyCache.get(key);
  if (!cached || now.getTime() - cached.at >= 5 * 60 * 1000) {
    try {
      // Belgelenmiş startDate + 1day isteği; bitiş sözleşme tarihiyle yerelde filtrelenir.
      const url = new URL(`https://api.tiingo.com/tiingo/fx/${ticker}/prices`);
      url.searchParams.set("startDate", startDate);
      url.searchParams.set("resampleFreq", "1day");
      url.searchParams.set("token", TIINGO_KEY);
      const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(10000) });
      if (!response.ok) return unavailable(`Geçmiş spot verisine erişilemedi (HTTP ${response.status}). Hesabın tarihsel veri yetkisini kontrol edin.`);
      const rows: unknown = await response.json();
      if (!Array.isArray(rows)) return unavailable("Sağlayıcı tarihsel spot barı döndürmedi; doğrulanamadı.");
      cached = { at: now.getTime(), rows };
      if (historyCache.size >= 100) historyCache.delete(historyCache.keys().next().value!);
      historyCache.set(key, cached);
    } catch {
      return unavailable("Geçmiş spot servisine ulaşılamadı; doğrulanamadı. İşlem kaydı değiştirilmedi.");
    }
  }
  return scanBarrierHistory(cached.rows, ticker, trade.barrierType!, trade.barrierLevel!, startDate, endDate, new Date(cached.at).toISOString());
}
