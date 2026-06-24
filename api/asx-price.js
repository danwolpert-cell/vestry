export default async function handler(req, res) {
  const { ticker } = req.query;
  try {
    const r = await fetch(
      `https://query2.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=1d`,
      { 
        headers: { 
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json',
          'Accept-Language': 'en-AU,en;q=0.9',
          'Referer': 'https://finance.yahoo.com',
          'Origin': 'https://finance.yahoo.com'
        } 
      }
    );
    const d = await r.json();
    const q = d?.chart?.result?.[0]?.meta;
    if (q?.regularMarketPrice) {
      res.json({ c: q.regularMarketPrice, pc: q.previousClose || q.chartPreviousClose });
    } else {
      res.status(404).json({ error: 'No data', raw: d });
    }
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
}
