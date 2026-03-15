// Quick diagnostic — run with: npx tsx --env-file .env.local scripts/debug-stooq.ts
// Prints the raw Stooq response for a few tickers so we can see what's coming back.

const tickers = ["gbpusd", "eurusd", "brent", "xauusd", "gc.f", "cl.f"];

async function main() {
  for (const ticker of tickers) {
    const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(ticker)}&i=d`;
    console.log(`\n--- ${ticker} ---`);
    console.log(`URL: ${url}`);
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; macro-dashboard/1.0)" },
      });
      console.log(`Status: ${res.status}`);
      const text = await res.text();
      console.log(`First 300 chars:\n${text.slice(0, 300)}`);
    } catch (e) {
      console.log(`Error: ${e}`);
    }
  }
}

main();
