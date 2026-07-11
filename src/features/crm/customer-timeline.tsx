import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CustomerTimelineEvent } from "@/types";

const TYPE_LABEL: Record<CustomerTimelineEvent["type"], string> = {
  "Customer Created": "Müşteri Oluşturuldu",
  "Trade Added": "İşlem Eklendi",
  "Trade Closed": "İşlem Kapatıldı",
  "Margin Updated": "Teminat Güncellendi",
  "Report Generated": "Rapor Alındı",
  "Other": "İşlem",
};

const TYPE_COLOR: Record<CustomerTimelineEvent["type"], string> = {
  "Customer Created": "bg-emerald-500",
  "Trade Added": "bg-sky-500",
  "Trade Closed": "bg-zinc-400",
  "Margin Updated": "bg-amber-500",
  "Report Generated": "bg-violet-500",
  "Other": "bg-rose-500",
};

export function CustomerTimeline({ events }: { events: CustomerTimelineEvent[] }) {
  const fmt = (iso: string) => {
    const d = new Date(iso);
    return isNaN(d.getTime()) ? iso : d.toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short" });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Aktivite Geçmişi</CardTitle>
      </CardHeader>
      <CardContent>
        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">Henüz kayıtlı aktivite yok.</p>
        ) : (
          <div className="space-y-4">
            {events.map((e, i) => (
              <div key={e.id} className="flex gap-4">
                <div className="flex flex-col items-center">
                  <div className={`w-2 h-2 rounded-full mt-2 ${TYPE_COLOR[e.type] ?? "bg-primary"}`} />
                  {i !== events.length - 1 && <div className="w-px h-full bg-border mt-2" />}
                </div>
                <div className="pb-4">
                  <p className="text-sm font-medium">{TYPE_LABEL[e.type] ?? e.type}</p>
                  <p className="text-xs text-muted-foreground">{fmt(e.date)} — {e.description}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
