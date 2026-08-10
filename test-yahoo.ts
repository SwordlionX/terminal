import { refreshSnapshot } from './src/services/market.service';

async function run() {
  console.log('Yahoo fetch işlemi başlıyor...');
  const start = performance.now();
  
  try {
    const snap = await refreshSnapshot();
    const end = performance.now();
    const diff = (end - start) / 1000;
    
    const counts = Object.fromEntries(
      Object.entries(snap.products).map(([k, v]) => [k, v.expiries.length])
    );
    
    console.log(`\nBAŞARILI! Toplam süre: ${diff.toFixed(2)} saniye`);
    console.log('Tarih:', snap.fetchedISO);
    console.log('Vade sayıları:', counts);
  } catch (error) {
    const end = performance.now();
    const diff = (end - start) / 1000;
    console.error(`\nHATA OLUŞTU! Geçen süre: ${diff.toFixed(2)} saniye`);
    console.error(error);
  }
}

run();
