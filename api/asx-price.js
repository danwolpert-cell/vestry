export default async function handler(req, res) {
  const { ticker } = req.query;
  try {
    const r = await fetch(
      `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${ticker}`,
      { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://finance.yahoo.com' } }
    );
    const d = await r.json();
    const q = d?.quoteResponse?.result?.[0];
    if (q?.regularMarketPrice) {
      res.json({ c: q.regularMarketPrice, pc: q.regularMarketPreviousClose });
    } else {
      res.status(404).json({ error: 'No data', raw: d });
    }
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
}
