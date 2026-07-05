import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Info } from "lucide-react";

export default function ReportsPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">Raporlar (Reports)</h1>
      <Alert>
        <Info className="h-4 w-4" />
        <AlertTitle>Faz 4 Kapsamında Yapılandırılacak</AlertTitle>
        <AlertDescription>
          Bu ekran günlük MTM, teminat limit aşımları ve genel hazine raporlarının çekilebileceği, verilerin Excel'e aktarılabileceği analiz altyapısıdır. Şu anda yapım aşamasındadır.
        </AlertDescription>
      </Alert>
    </div>
  );
}
