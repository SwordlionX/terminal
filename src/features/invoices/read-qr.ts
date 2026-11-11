'use client';

type QrReader = (image: ImageData, options: unknown) => Promise<{ text: string; isValid: boolean }[]>;
interface PdfPage {
  getTextContent(): Promise<{ items: { str?: string }[] }>;
  getViewport(options: { scale: number }): { width: number; height: number };
  render(options: unknown): { promise: Promise<unknown> };
  cleanup(): void;
}
interface PdfDocument {
  numPages: number;
  getPage(page: number): Promise<PdfPage>;
  destroy(): Promise<void>;
}
type PdfEngine = { getDocument(options: unknown): { promise: Promise<PdfDocument> } };
const scripts = new Map<string, Promise<void>>();
const zxingOverrides = { locateFile: (path: string) => '/vendor/invoice-qr/' + path };
function bounded<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new Error('QR kontrolü süre sınırına ulaştı.'));
    if (signal.aborted) {
      void promise.catch(() => {});
      abort();
      return;
    }
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
function loadScript(src: string, module = false) {
  if (!scripts.has(src))
    scripts.set(
      src,
      new Promise<void>((resolve, reject) => {
        const script = document.createElement('script');
        const timeout = setTimeout(() => fail(), 15000);
        const fail = () => {
          clearTimeout(timeout);
          scripts.delete(src);
          script.remove();
          reject(new Error('QR kitaplığı yüklenemedi.'));
        };
        script.src = src;
        if (module) script.type = 'module';
        script.onload = () => {
          clearTimeout(timeout);
          resolve();
        };
        script.onerror = fail;
        document.head.append(script);
      }),
    );
  return scripts.get(src)!;
}
// Quick pass: the receipt QR sits in the upper-right corner; the whole-page read
// still finds several large codes on one page.
const QUICK_REGIONS = [
  [0.5, 0, 0.5, 0.2],
  [0, 0, 1, 1],
];
// Detailed pass: overlapping crops isolate multiple small/dense codes and preserve quiet zones.
const DETAILED_REGIONS = [
  [0.55, 0, 0.4, 0.13],
  [0.5, 0, 0.5, 0.2],
  [0, 0, 1, 1],
  ...[0, 0.28, 0.55].flatMap(x => [0, 0.2, 0.4, 0.6].map(y => [x, y, 0.45, 0.4])),
];
const QUICK_EDGE = 2400,
  DETAILED_PDF_EDGE = 6400,
  DETAILED_IMAGE_EDGE = 3200;
/** True for a decoded QR carrying structured document data (not a bare link). */
function carriesData(code: string) {
  if (/^https?:\/\//i.test(code)) return false;
  try {
    const value: unknown = JSON.parse(code);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const b = value as Record<string, unknown>;
    return typeof b.no === 'string' || typeof b.faturano === 'string';
  } catch {
    return false;
  }
}
/** Returns the number of data-bearing codes newly added by this scan. */
async function scan(
  canvas: HTMLCanvasElement,
  read: QrReader,
  codes: Set<string>,
  deadline: number,
  regions: number[][] = DETAILED_REGIONS,
) {
  let found = 0;
  for (const [x, y, w, h] of regions) {
    if (codes.size >= 20 || performance.now() > deadline) break;
    const left = Math.floor(x * canvas.width),
      top = Math.floor(y * canvas.height),
      width = Math.min(Math.ceil(w * canvas.width), canvas.width - left),
      height = Math.min(Math.ceil(h * canvas.height), canvas.height - top);
    const crop = document.createElement('canvas'),
      scale = w < 1 ? 2 : 1;
    crop.width = width * scale;
    crop.height = height * scale;
    crop.getContext('2d')!.drawImage(canvas, left, top, width, height, 0, 0, crop.width, crop.height);
    const image = crop.getContext('2d')!.getImageData(0, 0, crop.width, crop.height),
      results = await read(image, { formats: ['QRCode'], tryHarder: true, tryDenoise: true, maxNumberOfSymbols: 20 });
    for (const result of results)
      if (result.isValid !== false && result.text.length <= 4096 && !codes.has(result.text)) {
        codes.add(result.text);
        if (carriesData(result.text)) found++;
      }
    crop.width = crop.height = 0;
    // Animation frames can pause indefinitely when the user changes tabs.
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
  return found;
}
/** Draws at a moderate size first and escalates to the detailed scan only when
 * no data-bearing QR was found, keeping the same detection fallback. */
async function scanInPasses(
  draw: (longestEdge: number) => Promise<void>,
  canvas: HTMLCanvasElement,
  read: QrReader,
  codes: Set<string>,
  deadline: number,
  detailedEdge: number,
) {
  await draw(QUICK_EDGE);
  if ((await scan(canvas, read, codes, deadline, QUICK_REGIONS)) > 0) return;
  if (codes.size >= 20 || performance.now() > deadline) return;
  await draw(detailedEdge);
  await scan(canvas, read, codes, deadline, DETAILED_REGIONS);
}
export async function readDocumentQr(
  file: File,
): Promise<{ codes: string[]; state: 'read' | 'not_found' | 'unavailable'; pdfPages?: string[] }> {
  const codes = new Set<string>(),
    canvas = document.createElement('canvas');
  const controller = new AbortController(),
    timeout = setTimeout(() => controller.abort(), 30000);
  const wait = <T>(promise: Promise<T>) => bounded(promise, controller.signal);
  let pdfPages: string[] | undefined;
  try {
    await wait(loadScript('/vendor/invoice-qr/zxing-reader.js'));
    const zxing = (
      window as unknown as {
        ZXingWASM: { readBarcodes: QrReader; prepareZXingModule: (options: unknown) => Promise<unknown> };
      }
    ).ZXingWASM;
    await wait(zxing.prepareZXingModule({ overrides: zxingOverrides, fireImmediately: true }));
    const read: QrReader = (image, options) => wait(zxing.readBarcodes(image, options));
    if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
      await wait(loadScript('/vendor/invoice-qr/pdf-loader.mjs', true));
      const engine = (window as unknown as { invoicePdf: PdfEngine }).invoicePdf;
      const pdf = await wait(
        engine.getDocument({
          data: new Uint8Array(await file.arrayBuffer()),
          isEvalSupported: false,
          useSystemFonts: true,
        }).promise,
      );
      try {
        const pages: string[] = [];
        // Loading the local libraries and PDF must not consume the scan budget.
        const deadline = performance.now() + 16000;
        for (
          let n = 1;
          n <= Math.min(pdf.numPages, 10) && performance.now() < deadline && !controller.signal.aborted;
          n++
        ) {
          const page = await wait(pdf.getPage(n)),
            base = page.getViewport({ scale: 1 });
          const content = await wait(page.getTextContent());
          const text = content.items.map(item => item.str || '').join(' ');
          pages.push(text.length <= 20000 ? text : '');
          const draw = async (edge: number) => {
            const viewport = page.getViewport({ scale: edge / Math.max(base.width, base.height) });
            canvas.width = Math.ceil(viewport.width);
            canvas.height = Math.ceil(viewport.height);
            await wait(page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport }).promise);
          };
          await scanInPasses(draw, canvas, read, codes, deadline, DETAILED_PDF_EDGE);
          page.cleanup();
        }
        // Do not advertise a partially scanned PDF as a complete fast-path input.
        if (pages.length === pdf.numPages && pages.every(Boolean) && pages.join('').length <= 60000) pdfPages = pages;
      } finally {
        void pdf.destroy().catch(() => {});
      }
    } else {
      const bitmap = await wait(createImageBitmap(file));
      try {
        const draw = async (edge: number) => {
          const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
          canvas.width = Math.ceil(bitmap.width * scale);
          canvas.height = Math.ceil(bitmap.height * scale);
          canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        };
        await scanInPasses(draw, canvas, read, codes, performance.now() + 16000, DETAILED_IMAGE_EDGE);
      } finally {
        bitmap.close();
      }
    }
    return { codes: [...codes], state: codes.size ? 'read' : 'not_found', ...(pdfPages ? { pdfPages } : {}) };
  } catch {
    return { codes: [...codes], state: codes.size ? 'read' : 'unavailable' };
  } finally {
    clearTimeout(timeout);
    canvas.width = canvas.height = 0;
  }
}
