export function CustomerNotes({ initialNotes }: { customerId: string; initialNotes: string }) {
  return (
    <section className="workspace-panel">
      <h2>Notlar ve belgeler</h2>
      <div className="workspace-priority">
        <div>
          <strong>Müşteri notu</strong>
          <small>{initialNotes || 'Not bulunmuyor.'}</small>
        </div>
      </div>
      <div className="workspace-priority">
        <div>
          <strong>Belgeler</strong>
          <small>Belge yükleme henüz kullanılamıyor.</small>
        </div>
      </div>
    </section>
  );
}
