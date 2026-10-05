'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { NumberInput } from '@/components/ui/number-input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { addManualTradeAction } from '@/app/customers/[id]/actions';
import { quoteOption } from '@/lib/assistant/pricing';
import type { MarketSnapshot, OptionRequest, Product, Quote, ScreenContext } from '@/lib/assistant/types';
import { expiryPayoffLimits } from '@/lib/pricing/position-analysis';
import { useAnalysisDraft } from '@/store/analysis-draft';
import { TERMINAL_DESIGN } from '@/lib/terminal-design';
import { usePricingModel } from './use-pricing-model';
import { SmileChart } from './smile-chart';
import { VolatilityTermChart } from './volatility-term-chart';
import { analysisMoney, analysisNumber } from './position-analysis-view';
import { formatDate } from '@/lib/format';

/** A new contract must carry a premium and start on the untouched side of its barrier. */
function bookingBlock(quote: Quote | null): string | null {
  if (!quote) return null;
  if (quote.barrier?.rebate) return 'Rebate içeren sözleşmenin kayıt şeması henüz desteklenmiyor.';
  if (quote.barrier) {
    const up = quote.barrier.variant[0] === 'u';
    if (up ? quote.inputs.spot >= quote.barrier.level : quote.inputs.spot <= quote.barrier.level)
      return 'Spot bariyerin ötesinde; yeni bariyerli işlem bu seviyeyle kaydedilemez.';
  }
  if (!(quote.premiumTotal >= 0.01)) return 'Prim sıfır; değersiz yapı müşteriye kaydedilmez.';
  return null;
}

function BookQuote({ quote }: { quote: Quote | null }) {
  const [open, setOpen] = useState(false),
    [customers, setCustomers] = useState<{ id: string; companyName: string }[]>([]);
  const [customer, setCustomer] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  const show = async () => {
    setOpen(true);
    setMessage('');
    try {
      const r = await fetch('/api/customers');
      if (!r.ok) throw new Error();
      const data = await r.json();
      if (!Array.isArray(data)) throw new Error();
      setCustomers(data);
    } catch {
      setMessage('Müşteri listesi alınamadı.');
    }
  };
  const save = async () => {
    if (!quote || !customer || busy) return;
    setBusy(true);
    setMessage('');
    try {
      await addManualTradeAction(customer, {
        tradeDate: quote.inputs.tradeDate,
        expiryDate: quote.inputs.expiryDate,
        underlying: quote.product,
        type: quote.type,
        position: quote.position,
        spot: quote.inputs.spot,
        strike: quote.inputs.strike,
        volatility: quote.effectiveVol / 100,
        contractSize: quote.inputs.contractSize,
        premium: quote.premiumTotal,
        ...(quote.barrier
          ? {
              isBarrier: true,
              barrierType: { uo: 'Knock Out Up', do: 'Knock Out Down', ui: 'Knock In Up', di: 'Knock In Down' }[
                quote.barrier.variant
              ],
              barrierLevel: quote.barrier.level,
              barrierStyle: 'Amerikan',
            }
          : {}),
      });
      setMessage('İşlem kaydı oluşturuldu.');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Kayıt oluşturulamadı.');
    } finally {
      setBusy(false);
    }
  };
  const blocked = bookingBlock(quote);
  return (
    <>
      <button className="desk-button" disabled={!quote || Boolean(blocked)} title={blocked ?? undefined} onClick={show}>
        Müşteriye kaydet ↗
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>İşlemi müşteriye kaydet</DialogTitle>
            <DialogDescription>Terminalin hesapladığı koşullarla kayıt oluşturur; emir göndermez.</DialogDescription>
          </DialogHeader>
          <label className="desk-field">
            Müşteri
            <select value={customer} onChange={e => setCustomer(e.target.value)}>
              <option value="">Müşteri seçin</option>
              {customers.map(c => (
                <option key={c.id} value={c.id}>
                  {c.companyName}
                </option>
              ))}
            </select>
          </label>
          {quote && (
            <p className="desk-muted">
              {quote.position} {quote.type} · {quote.product} · {quote.inputs.contractSize} birim ·{' '}
              {formatDate(quote.inputs.expiryDate)} · {analysisMoney(quote.premiumTotal)}
            </p>
          )}
          <button
            className="desk-button desk-button-primary"
            disabled={!customer || !quote || busy || message === 'İşlem kaydı oluşturuldu.'}
            onClick={save}
          >
            {busy ? 'Kaydediliyor…' : 'Kaydı oluştur'}
          </button>
          <p role="status">{message}</p>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function TerminalWorkspace() {
  const { md, feed } = usePricingModel();
  const router = useRouter();
  const type = useAnalysisDraft(s => s.quoteType),
    position = useAnalysisDraft(s => s.quotePosition);
  const barrier = useAnalysisDraft(s => s.quoteBarrier),
    setBarrier = useAnalysisDraft(s => s.setQuoteBarrier);
  const selectQuote = useAnalysisDraft(s => s.selectQuote);
  const setType = (next: 'Call' | 'Put') => selectQuote(next, position);
  const setPosition = (next: 'Long' | 'Short') => selectQuote(type, next);
  const [curveTab, setCurveTab] = useState<'smile' | 'term'>('smile');
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get('barrier') !== '1' || !feed.spot) return;
    setBarrier({ variant: 'uo', level: Math.round(feed.spot.price * 1.1 * 100) / 100, rebate: 0 });
    url.searchParams.delete('barrier');
    window.history.replaceState(null, '', url.pathname + url.search);
  }, [feed.spot, setBarrier]);
  const pricing = useMemo(() => {
    try {
      if (feed.loading) return { quotes: null, error: 'Terminal verisi yükleniyor…' };
      const market: MarketSnapshot = {
        product: md.product as Product,
        spot: feed.spot?.price ?? null,
        spotAt: feed.spot ? new Date(feed.spot.quoteAt ?? feed.spot.at).toISOString() : null,
        spotSource: feed.spot?.source ?? '',
        spotStale: feed.spot?.stale,
        surface: feed.surface,
        surfaceSource: feed.surfaceSource,
      };
      const terms = {
        position,
        strike: md.strike,
        expiryDate: md.expiryDate,
        contractSize: md.contractSize,
        ...(barrier ? { barrier } : {}),
      };
      const screen = { ...md, product: md.product as Product } as ScreenContext;
      return {
        quotes: {
          Call: quoteOption({ ...terms, type: 'Call' }, screen, market),
          Put: quoteOption({ ...terms, type: 'Put' }, screen, market),
        },
        error: null,
      };
    } catch (e) {
      return { quotes: null, error: e instanceof Error ? e.message : 'Fiyatlama yapılamadı.' };
    }
  }, [md, feed, position, barrier]);
  const q = pricing.quotes?.[type] ?? null,
    unit = ['XAU', 'XAG'].includes(md.product) ? 'ons' : 'adet';
  const days = q ? (Date.parse(q.inputs.expiryDate) - Date.parse(q.inputs.tradeDate)) / 86400000 : 0;
  const fwd =
    q?.forward ??
    (q ? q.inputs.spot * Math.exp((((q.inputs.rate - q.inputs.lease) / 100) * days) / q.inputs.basis) : 0);
  const limits = q && !q.barrier ? expiryPayoffLimits([q], [q.premiumPerUnit]) : null;
  const analyze = () => {
    if (barrier) return;
    useAnalysisDraft
      .getState()
      .seed(md.product, [
        { option: { type, position, strike: md.strike, expiryDate: md.expiryDate, contractSize: md.contractSize } },
      ]);
    router.push('/pricing/position-analysis');
  };
  const ticket = (
    <section className="desk-ticket analysis-panel">
      <div className="analysis-panel-head">
        <p className="desk-eyebrow">İŞLEM KOŞULLARI</p>
        <span className="desk-muted">Avrupa tipi</span>
      </div>
      <div className="desk-product-tabs">
        {(['XAU', 'XAG'] as const).map(p => (
          <button
            key={p}
            aria-pressed={md.product === p}
            onClick={() => {
              if (p !== md.product) setBarrier(null);
              md.setProduct(p, md.spot, md.lease, md.vol);
            }}
          >
            {p}
            <small>{p === 'XAU' ? 'ALTIN' : 'GÜMÜŞ'}</small>
          </button>
        ))}
      </div>
      <div className="desk-ticket-fields">
        <label className="desk-field">
          Opsiyon
          <select value={type} onChange={e => setType(e.target.value as 'Call' | 'Put')}>
            <option>Put</option>
            <option>Call</option>
          </select>
        </label>
        <label className="desk-field">
          Müşteri yönü
          <select value={position} onChange={e => setPosition(e.target.value as 'Long' | 'Short')}>
            <option value="Short">Satış · prim alır</option>
            <option value="Long">Alış · prim öder</option>
          </select>
        </label>
        <label className="desk-field">
          Miktar · {unit}
          <NumberInput
            aria-label="İşlem miktarı"
            value={md.contractSize}
            onValueChange={n => md.setField('contractSize', n)}
          />
        </label>
        <label className="desk-field">
          Kullanım fiyatı · USD/{unit}
          <NumberInput aria-label="Kullanım fiyatı" value={md.strike} onValueChange={n => md.setField('strike', n)} />
        </label>
        <label className="desk-field">
          Değerleme tarihi
          <input type="date" value={md.tradeDate} onChange={e => md.setField('tradeDate', e.target.value)} />
        </label>
        <label className="desk-field">
          Vade
          <input type="date" value={md.expiryDate} onChange={e => md.setField('expiryDate', e.target.value)} />
        </label>
        <label className="desk-field">
          Gün bazı
          <select value={md.basis} onChange={e => md.setField('basis', Number(e.target.value))}>
            <option value="365">ACT / 365</option>
            <option value="360">ACT / 360</option>
          </select>
        </label>
      </div>
      <div className="desk-barrier-control">
        <label className="desk-checkbox">
          <input
            type="checkbox"
            checked={Boolean(barrier)}
            disabled={!feed.spot}
            onChange={e =>
              setBarrier(
                e.target.checked
                  ? { variant: 'uo', level: Math.round((feed.spot?.price ?? 0) * 1.1 * 100) / 100, rebate: 0 }
                  : null,
              )
            }
          />
          Bariyerli fiyatla
        </label>
        {barrier && (
          <div className="desk-ticket-fields" id="barrier-fields">
            <label className="desk-field">
              Bariyer yapısı
              <select
                value={barrier.variant}
                onChange={e =>
                  setBarrier({
                    ...barrier,
                    variant: e.target.value as NonNullable<OptionRequest['barrier']>['variant'],
                  })
                }
              >
                <option value="uo">Yukarı knock-out</option>
                <option value="do">Aşağı knock-out</option>
                <option value="ui">Yukarı knock-in</option>
                <option value="di">Aşağı knock-in</option>
              </select>
            </label>
            <label className="desk-field">
              Bariyer · USD/ons
              <NumberInput
                aria-label="Bariyer seviyesi"
                value={barrier.level}
                onValueChange={level => setBarrier({ ...barrier, level })}
              />
            </label>
            <small className="desk-muted">Sürekli bariyer gözlemi · kullanım vade sonunda</small>
          </div>
        )}
      </div>
      {(md.manualSpot || md.manualVol) && (
        <button
          className="desk-button"
          onClick={() => {
            md.setField('manualSpot', false);
            md.setField('manualVol', false);
          }}
        >
          Otomatik kaynağa dön
        </button>
      )}
    </section>
  );
  const quote = (
    <section className="desk-quote analysis-panel">
      <div className="analysis-panel-head">
        <p className="desk-eyebrow">
          {md.product} / MÜŞTERİ {position === 'Short' ? 'SATIŞI' : 'ALIŞI'} / {type.toUpperCase()}
          {barrier ? ' / BARİYER' : ''}
        </p>
        <span className="desk-tag">ENDİKATİF</span>
      </div>
      <p className="desk-muted">Müşterinin {position === 'Short' ? 'alacağı' : 'ödeyeceği'} toplam prim</p>
      <div className="desk-option-comparison">
        {(['Call', 'Put'] as const).map(optionType => {
          const result = pricing.quotes?.[optionType];
          return (
            <button
              key={optionType}
              className="desk-option-quote"
              aria-label={`${optionType} fiyatını seç`}
              aria-pressed={type === optionType}
              onClick={() => setType(optionType)}
            >
              <span className="desk-option-label">
                {optionType.toUpperCase()}
                <small>{type === optionType ? 'SEÇİLİ' : 'SEÇ'}</small>
              </span>
              <span className="desk-option-premiums">
                <strong>
                  {result ? analysisNumber(result.premiumTotal) : '—'}
                  <small> USD</small>
                </strong>
                <strong>
                  {result ? analysisNumber(result.premiumPctSpot) : '—'}
                  <small> %</small>
                </strong>
              </span>
              <span className="desk-option-unit">
                {result ? analysisNumber(result.premiumPerUnit, 4) : '—'} USD / {unit} · % spot nominali
              </span>
            </button>
          );
        })}
      </div>
      <p className="desk-muted">Risk ve kayıt: seçili {type} işlemi</p>
      {pricing.error && (
        <p role="status" className="desk-policy">
          {pricing.error}
        </p>
      )}
      <div className="desk-market-facts">
        <div>
          <span>Terminal spotu</span>
          <strong>{feed.spot ? analysisNumber(feed.spot.price) : '—'}</strong>
        </div>
        <div>
          <span>Model forward</span>
          <strong>{q ? analysisNumber(fwd) : '—'}</strong>
        </div>
        <div>
          <span>Smile IV</span>
          <strong>{q ? '%' + analysisNumber(q.effectiveVol) : '—'}</strong>
        </div>
        <div>
          <span>Yüzey tarihi</span>
          <strong>{feed.surface ? formatDate(feed.surface.fetchedISO) : 'Veri yok'}</strong>
        </div>
      </div>
      {q && feed.surface?.curves && (
        <p className="desk-muted">
          Seçili vade · USD faiz %{analysisNumber((q.inputs.rate * q.inputs.basis) / 365, 4)} · Metal taşıması (proxy) %
          {analysisNumber((q.inputs.lease * q.inputs.basis) / 365, 4)} · Sürekli yıllık oran / ACT {q.inputs.basis}
        </p>
      )}
      <div className="desk-actions">
        <button
          className="desk-button desk-button-primary"
          disabled={!q || Boolean(barrier)}
          title={barrier ? 'Fiyat × tarih analizi şu an vanilya işlemleri destekler.' : undefined}
          onClick={analyze}
        >
          Pozisyonu analiz et ↗
        </button>
        <BookQuote quote={q} />
        <button className="desk-button" disabled={feed.loading} onClick={feed.refetch}>
          Kayıtlı veriyi oku
        </button>
      </div>
      <p className="analysis-footnote">
        {feed.spot?.source ?? 'Spot kaynağı bekleniyor'} · {q?.volMode ?? 'IV bekleniyor'} · Endikatif model fiyatı.
      </p>
    </section>
  );
  const risk = (
    <aside className="desk-risk analysis-panel">
      <p className="desk-eyebrow">RİSKİN KARŞILIĞI</p>
      {[
        ['Delta', q ? analysisNumber(q.delta, 3) + ' ' + unit : '—'],
        ['Gamma', q ? analysisNumber(q.gamma, 5) : '—'],
        ['Vega / vol puanı', q ? analysisMoney(q.vega) : '—'],
        ['Theta / gün', q ? analysisMoney(q.theta) : '—'],
      ].map(([name, value]) => (
        <div className="desk-risk-item" key={name}>
          <span>{name}</span>
          <strong>{value}</strong>
        </div>
      ))}
      <div className="desk-risk-note">
        <p>{barrier ? 'Bariyer sözleşmesi' : 'Vade sonu azami kayıp'}</p>
        <strong>
          {barrier
            ? 'Yola bağlı'
            : !limits
              ? '—'
              : limits.maxLoss === null
                ? 'Teorik olarak sınırsız'
                : analysisMoney(limits.maxLoss)}
        </strong>
        <p>
          {barrier
            ? 'Risk, bariyer gözlemine bağlıdır. Vanilya azami kayıp sınırı uygulanmaz.'
            : type === 'Put' && position === 'Short'
              ? 'Short put kaybı, dayanak sıfıra düştüğünde sonludur.'
              : type === 'Call' && position === 'Short'
                ? 'Korumasız short call yukarı yönlü sınırsız kayıp taşıyabilir.'
                : 'Long opsiyonda vade sonu azami kayıp ödenen primdir.'}
        </p>
        {!barrier && limits && limits.breakevens.length > 0 && (
          <>
            <p>Vade sonu başabaş</p>
            <strong>{limits.breakevens.map(level => analysisNumber(level)).join(' / ')}</strong>
            <p>
              {(type === 'Call') === (position === 'Long') ? 'Bu seviyenin üstü' : 'Bu seviyenin altı'} müşteri lehine.
            </p>
          </>
        )}
      </div>
    </aside>
  );
  return (
    <div className={`desk-workspace desk-${TERMINAL_DESIGN}`}>
      <div className="desk-hero">
        <div>
          <p className="desk-eyebrow">
            {TERMINAL_DESIGN === 'meridian' ? 'MERIDIAN / KIYMETLİ METALLER' : 'TERMINAL X / PRECIOUS METALS DESK'}
          </p>
          <h1>Opsiyon masası</h1>
          <p>XAU / XAG · terminal eğrisi · müşteri perspektifi</p>
        </div>
        <div className="desk-hero-mark" aria-hidden="true">
          {TERMINAL_DESIGN === 'meridian' ? '╱╲' : 'X / 01'}
        </div>
      </div>
      <div className="desk-main-grid">
        {ticket}
        {quote}{' '}
        <section className="desk-curve">
          <div className="analysis-panel-head">
            <h2>Volatilite eğrisi</h2>
            <div className="desk-segments">
              <button aria-pressed={curveTab === 'smile'} onClick={() => setCurveTab('smile')}>
                Smile
              </button>
              <button aria-pressed={curveTab === 'term'} onClick={() => setCurveTab('term')}>
                Vade yapısı
              </button>
            </div>
          </div>
          {curveTab === 'smile' ? (
            <SmileChart
              surface={feed.surface}
              fwd={fwd}
              strike={md.strike}
              daysToExpiry={days}
              valuationDate={md.tradeDate}
              sourceLabel={feed.surfaceSource ?? undefined}
            />
          ) : (
            <VolatilityTermChart
              surface={feed.surface}
              valuationDate={md.tradeDate}
              onSelect={date => md.setField('expiryDate', date)}
            />
          )}
        </section>
        {risk}
      </div>
      <div className="desk-tool-grid">
        <Link href="/pricing/position-analysis">
          <span>01 / POZİSYON</span>
          <h2>Tek bir fiyatla kalma.</h2>
          <p>Fiyat × tarih haritası, birleşik K/Z, delta/gamma ve hedge alternatifleri.</p>
        </Link>
        <Link href="/pricing/reverse-engineering">
          <span>02 / HEDEF</span>
          <h2>Hedef primi değerlendir.</h2>
          <p>Mevcut terminal araçlarıyla işlem koşullarını ve prim hedefini incele.</p>
        </Link>
        <Link href="/pricing/barrier">
          <span>03 / GELİŞMİŞ</span>
          <h2>Bariyer ve delta hedge.</h2>
          <p>Bariyer gözlemi, yardımcı smile ve mevcut motorun gelişmiş araçları.</p>
        </Link>
      </div>
      {!feed.surface?.curves && !feed.loading && (
        <p className="desk-policy" role="status">
          Faiz/taşıma eğrisi yüklenmedi. Fiyatlama için doğrulanmış veri paketi gerekli.
        </p>
      )}
      {(feed.error || feed.quoteError) && (
        <p role="status" className="desk-policy">
          {feed.error ?? feed.quoteError}
        </p>
      )}
      {q?.barrier && (
        <p className="desk-policy" role="status">
          Vade-eşdeğer sabit faiz/taşıma yaklaşımı · sürekli gözlemli yeni bariyer · geçmiş bariyer teması bu hesapta
          yok.
        </p>
      )}
      {q &&
        q.warnings
          .filter(
            w =>
              !/^(Endikatif SOFR|Ayın bilinmeyen|Metal taşıması final|Futures son işlem|Gösterilen faiz|Bariyer yolunda|Sürekli gözlemli)/.test(
                w,
              ),
          )
          .map((w, i) => (
            <p className="desk-policy" role="status" key={i}>
              {w}
            </p>
          ))}
      {q && (
        <details className="workspace-notes">
          <summary>Veri ve model ayrıntıları</summary>
          <p className="analysis-footnote">
            Manuel piyasa girdisi, eğri–fiyat tutarlılığını bozar. Model fiyatı banka kotasyonu değildir.
          </p>
          {q.warnings.map((warning, i) => (
            <p className="analysis-footnote" key={i}>
              {warning}
            </p>
          ))}
        </details>
      )}
      <footer className="desk-footer">
        <strong>TERMINAL X / {TERMINAL_DESIGN === 'meridian' ? 'MERIDIAN' : 'DESK 01'}</strong>
        <span>Avrupa tipi · müşteri perspektifi · ortak fiyatlama motoru</span>
        <Link href="/pricing/delta-hedge">Delta hedge ↗</Link>
      </footer>
    </div>
  );
}
