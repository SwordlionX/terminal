import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';

/** Visual introduction only; never manufacture a quote to populate a demo. */
export default function AssistantPreview() {
  if (process.env.NODE_ENV === 'production') notFound();
  return (
    <div className="mx-auto max-w-4xl space-y-6 pb-20">
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-cyan-300">Terminal Asistanı · Önizleme</p>
        <h1 className="mt-3 text-2xl font-semibold">Terminal eğrisiyle konuşarak fiyatlama</h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-slate-400">Sağ üstteki Asistan düğmesinden başla.</p>
      </div>
      <section className="rounded-2xl border border-cyan-400/20 bg-[#0e202b] p-5">
        <h2 className="text-sm font-semibold text-cyan-200">Fiyatlama kuralı</h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-300">
          Yalnız terminal eğrisiyle fiyatlama. Manuel piyasa girdileri eğri–fiyat tutarlılığını bozar.
        </p>
      </section>
    </div>
  );
}
