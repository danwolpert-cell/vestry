export default async function handler(req, res) {
  const { ticker } = req.query;
  try {
    const r = await fetch(
      `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${ticker}?modules=price,summaryDetail`,
      { headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)',
        'Accept': '*/*',
        'Referer': 'https://finance.yahoo.com'
      }}
    );
    const d = await r.json();
    const p = d?.quoteSummary?.result?.[0]?.price;
    const s = d?.quoteSummary?.result?.[0]?.summaryDetail;
    if (p?.regularMarketPrice?.raw) {
      res.json({
        c: p.regularMarketPrice.raw,
        pc: p.regularMarketPreviousClose.raw,
        open: p.regularMarketOpen?.raw,
        high: p.regularMarketDayHigh?.raw,
        low: p.regularMarketDayLow?.raw,
        volume: p.regularMarketVolume?.raw,
        marketCap: p.marketCap?.raw,
        change: p.regularMarketChange?.raw,
        changePct: p.regularMarketChangePercent?.raw,
        week52High: s?.fiftyTwoWeekHigh?.raw,
        week52Low: s?.fiftyTwoWeekLow?.raw,
        dayRange: p.regularMarketDayRange?.fmt,
        name: p.shortName
      });
    } else {
      res.status(404).json({ error: 'No data', raw: d });
    }
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
}
