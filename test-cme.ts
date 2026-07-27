import { refreshCmeSurface } from './src/services/cme.service';

async function main() {
  try {
    console.log('Fetching CME XAU...');
    const surface = await refreshCmeSurface('XAU');
    console.log(`Success! Expiries: ${surface.expiries.length}`);
    process.exit(0);
  } catch (err) {
    console.error('Error fetching CME XAU:', err);
    process.exit(1);
  }
}

main();
