'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Download, Smartphone, X } from 'lucide-react';

interface InstallEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function platformSnapshot(): 'ios' | 'other' | 'standalone' {
  const nav = navigator as Navigator & { standalone?: boolean };
  if (window.matchMedia('(display-mode: standalone)').matches || nav.standalone === true) return 'standalone';
  return /iPhone|iPad|iPod/.test(nav.userAgent) || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1)
    ? 'ios'
    : 'other';
}
function subscribeDisplay(notify: () => void) {
  const display = window.matchMedia('(display-mode: standalone)');
  display.addEventListener('change', notify);
  return () => display.removeEventListener('change', notify);
}
const serverPlatform = () => null;

export function InstallInvoiceApp() {
  const prompt = useRef<InstallEvent | null>(null);
  const platform = useSyncExternalStore(subscribeDisplay, platformSnapshot, serverPlatform);
  const [installed, setInstalled] = useState(false);
  const [available, setAvailable] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const ready = (event: Event) => {
      event.preventDefault();
      prompt.current = event as InstallEvent;
      setAvailable(true);
    };
    const done = () => {
      prompt.current = null;
      setAvailable(false);
      setInstalled(true);
    };
    window.addEventListener('beforeinstallprompt', ready);
    window.addEventListener('appinstalled', done);
    return () => {
      window.removeEventListener('beforeinstallprompt', ready);
      window.removeEventListener('appinstalled', done);
    };
  }, []);

  async function install() {
    const event = prompt.current;
    if (!event) {
      setExpanded(value => !value);
      return;
    }
    setBusy(true);
    try {
      await event.prompt();
      await event.userChoice;
    } catch {
      setExpanded(true);
    } finally {
      prompt.current = null;
      setAvailable(false);
      setBusy(false);
    }
  }

  if (!platform || platform === 'standalone' || installed || hidden) return null;
  return (
    <aside className="inv-install" aria-label="Ana ekrana ekle">
      <div className="inv-install-row">
        <Smartphone size={22} aria-hidden="true" />
        <p>
          <strong>Fatura Takip cebinde</strong>
          <span>Ana ekranından uygulama gibi aç.</span>
        </p>
        <button
          className="inv-secondary"
          type="button"
          disabled={busy}
          onClick={() => void install()}
          aria-expanded={available ? undefined : expanded}
          aria-controls={available ? undefined : 'invoice-install-help'}
        >
          <Download size={16} aria-hidden="true" />
          {busy ? 'Açılıyor…' : available ? 'Uygulamayı yükle' : 'Ana ekrana ekle'}
        </button>
        <button className="inv-icon" type="button" aria-label="Ekleme önerisini kapat" onClick={() => setHidden(true)}>
          <X size={18} />
        </button>
      </div>
      <div id="invoice-install-help" hidden={!expanded} className="inv-install-help">
        {platform === 'ios' ? (
          <p>
            Safari’de <strong>Paylaş → Ana Ekrana Ekle → Ekle</strong> yolunu izle. “Web Uygulaması Olarak Aç” seçeneği
            görünürse açık bırak. Paylaş görünmüyorsa önce tarayıcı menüsünü aç.
          </p>
        ) : (
          <p>
            Chrome veya Edge menüsünden <strong>Uygulamayı yükle</strong> ya da <strong>Ana ekrana ekle</strong>{' '}
            seçeneğini kullan. Bu seçenek görünmüyorsa sayfayı telefonunun tarayıcısında aç.
          </p>
        )}
        <p>Simge Fatura Takip’i açar. Kayıtları görmek ve mesnet yüklemek için internet bağlantısı gerekir.</p>
      </div>
    </aside>
  );
}
