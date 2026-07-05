import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Info } from "lucide-react";

export default function TradesPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">İşlemler (Trades)</h1>
      <Alert>
        <Info className="h-4 w-4" />
        <AlertTitle>Faz 4 Kapsamında Yapılandırılacak</AlertTitle>
        <AlertDescription>
          Bu ekran aktif tüm türev işlemlerinin (Trade Blotter) toplu olarak listeleneceği, filtreleme ve arama yapılabileceği ana modüldür. Şu anda yapım aşamasındadır.
        </AlertDescription>
      </Alert>
    </div>
  );
}
