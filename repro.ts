import { buildSurface, surfaceVol, PRODUCT_SURFACE_MAP } from './src/lib/vol/surface';
import fs from 'fs';

const snap = JSON.parse(fs.readFileSync('data/yahoo_snapshot.json', 'utf-8'));
const slv = snap.products['SLV'];
console.log('SLV spot', slv.spot);

const surface = buildSurface(slv, 0.05, snap.fetchedISO, 0);
console.log('expiries:', surface.expiries.map(e => ({days: e.days, date: e.date, n: e.points.length})));

// end of august from today 2026-07-09
const today = new Date('2026-07-09');
const target = new Date('2026-08-31');
const days = (target.getTime() - today.getTime()) / (1000*3600*24);
console.log('target days', days);

// forward-moneyness m=K/F (F = S·e^{(r−q)T}); SLV kendi üstünde q=0
const T = days / 365;
const F = slv.spot * Math.exp((0.05 - 0) * T);
for (const m of [0.9, 0.95, 1.0, 1.05, 1.1]) {
  const iv = surfaceVol(surface, m, days);
  console.log('m=', m, 'K=', (m * F).toFixed(2), 'iv=', iv);
}

// print smile points near each bracketing expiry
for (const e of surface.expiries) {
  if (e.days > 20 && e.days < 90) {
    console.log('---', e.date, e.days, e.points);
  }
}
