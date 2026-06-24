export default async function handler(req, res) {
  const { ticker } = req.query;
  try {
    const r = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=5d&includePrePost=false`,
      { headers: { 
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)',
        'Accept': '*/*',
        'Referer': 'https://finance.yahoo.com'
      }}
    );
    const d = await r.json();
    const q = d?.chart?.result?.[0]?.meta;
    if (q?.regularMarketPrice) {
      res.json({ c: q.regularMarketPrice, pc: q.chartPreviousClose });
    } else {
      res.status(404).json({ error: 'blocked', raw: JSON.stringify(d).slice(0,200) });
    }
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
}
