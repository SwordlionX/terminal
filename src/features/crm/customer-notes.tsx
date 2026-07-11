import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function CustomerNotes({ initialNotes }: { customerId: string, initialNotes: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Notlar ve Belgeler</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-sm space-y-4">
          <div className="bg-secondary/30 p-3 rounded-md">
            <p className="text-muted-foreground text-xs mb-1">Müşteri Notu</p>
            <p>{initialNotes || "Not bulunmuyor."}</p>
          </div>
          <div className="bg-secondary/30 p-3 rounded-md border border-dashed">
            <p className="text-muted-foreground text-xs mb-1">Belgeler</p>
            <p className="text-muted-foreground italic">Sözleşme / ISDA / uygunluk formu yükleme özelliği yol haritasında (henüz aktif değil).</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
