import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function CustomerTimeline(_props: { customerId: string }) {
  void _props.customerId;
  // Mock veri - UI gösterimi için
  const events = [
    { date: "2026-07-01", type: "Customer Created", desc: "Müşteri sisteme eklendi." },
    { date: "2026-07-02", type: "Margin Updated", desc: "Risk limiti güncellendi." }
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Aktivite Geçmişi</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {events.map((e, i) => (
            <div key={i} className="flex gap-4">
              <div className="flex flex-col items-center">
                <div className="w-2 h-2 bg-primary rounded-full mt-2" />
                {i !== events.length - 1 && <div className="w-px h-full bg-border mt-2" />}
              </div>
              <div className="pb-4">
                <p className="text-sm font-medium">{e.type}</p>
                <p className="text-xs text-muted-foreground">{e.date} - {e.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
