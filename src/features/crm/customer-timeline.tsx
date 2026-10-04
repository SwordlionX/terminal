import { CustomerTimelineEvent } from '@/types';
import { formatDateTime } from '@/lib/format';

const TYPE_LABEL: Record<CustomerTimelineEvent['type'], string> = {
  'Customer Created': 'Müşteri oluşturuldu',
  'Trade Added': 'İşlem eklendi',
  'Trade Closed': 'İşlem kapatıldı',
  'Margin Updated': 'Teminat güncellendi',
  'Report Generated': 'Rapor alındı',
  Other: 'İşlem',
};

export function CustomerTimeline({ events }: { events: CustomerTimelineEvent[] }) {
  return (
    <section className="workspace-panel">
      <h2>Aktivite geçmişi</h2>
      {events.length === 0 ? (
        <p className="workspace-empty">Henüz kayıtlı aktivite yok.</p>
      ) : (
        events.map(e => (
          <div className="workspace-priority" key={e.id}>
            <span>{formatDateTime(e.date)}</span>
            <div>
              <strong>{TYPE_LABEL[e.type] ?? e.type}</strong>
              <small>{e.description}</small>
            </div>
          </div>
        ))
      )}
    </section>
  );
}
