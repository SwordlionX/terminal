"use client";

import { useState, useTransition } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

/**
 * Genel hata sınırı — evaluatePortfolio() artık canlı spot alınamadığında sessizce eski/giriş
 * spotuna düşmek yerine hata fırlatıyor (bkz. portfolio.service.ts). MTM/smile kavramı kaldırıldı;
 * PnL sadece canlı spot + strike'a bakıyor, bu yüzden tek hata sebebi canlı spot çekilememesi
 * (örn. Yahoo geçici erişilemez/rate-limit). Burada basitçe tekrar deneme sunuyoruz.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const [isPending, startTransition] = useTransition();
  const [retryCount, setRetryCount] = useState(0);

  const handleRetry = () => {
    setRetryCount((c) => c + 1);
    startTransition(() => reset());
  };

  return (
    <div className="flex items-center justify-center min-h-[60vh] p-6">
      <Card className="max-w-lg w-full border-red-900/50">
        <CardHeader>
          <CardTitle className="text-red-500">PnL/Teminat için canlı spot alınamadı</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">{error.message}</p>
          <p className="text-sm text-muted-foreground">
            Bu genelde canlı spot fiyatı geçici olarak çekilemediğinde olur (Yahoo erişilemez/rate-limit).
            Birkaç saniye sonra tekrar deneyin — teminat kartları bundan etkilenmez, sadece PnL/nominal
            gösterimi geçici olarak boş kalır.
          </p>
          <div className="flex items-center gap-2">
            <Button onClick={handleRetry} disabled={isPending}>
              {isPending ? "Deneniyor..." : `Tekrar Dene${retryCount > 0 ? ` (${retryCount})` : ""}`}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
