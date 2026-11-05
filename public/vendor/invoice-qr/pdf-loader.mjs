// PDF.js 5.6.205 (Apache-2.0). Served from this origin; no CDN requests.
import {getDocument,GlobalWorkerOptions} from './pdf.min.mjs';
GlobalWorkerOptions.workerSrc='/vendor/invoice-qr/pdf.worker.min.mjs';
window.invoicePdf={getDocument};
