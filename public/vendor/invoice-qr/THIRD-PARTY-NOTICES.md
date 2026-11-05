# Invoice QR reader assets

These pinned upstream distributions are served locally and loaded only when a document is selected. No customer document is part of this directory.

- PDF.js 5.6.205 (`pdf.min.mjs`, `pdf.worker.min.mjs`), Mozilla contributors: Apache-2.0. See `PDFJS-LICENSE`. Source: https://github.com/mozilla/pdf.js
- zxing-wasm 3.1.6 reader (`zxing-reader.js`, `zxing_reader.wasm`), Sec-ant: MIT for the JavaScript wrapper. See `ZXING-LICENSE`. Source: https://github.com/Sec-ant/zxing-wasm/tree/v3.1.6
- The WASM reader includes zxing-cpp and the zxing-wasm C++ bindings under Apache-2.0. See `ZXING-CPP-LICENSE` and `ZXING-WASM-CPP-LICENSE`. Sources: https://github.com/zxing-cpp/zxing-cpp and https://github.com/Sec-ant/zxing-wasm/tree/v3.1.6/src/cpp

`pdf-loader.mjs` is the application's same-origin PDF.js configuration, rather than an upstream distribution file. The upstream minified distributions are otherwise unmodified.
