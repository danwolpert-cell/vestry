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
    const m = d?.chart?.result?.[0]?.meta;
    if (m?.regularMarketPrice) {
      res.json({
        c: m.regularMarketPrice,
        pc: m.chartPreviousClose,
        open: m.regularMarketOpen,
        high: m.regularMarketDayHigh,
        low: m.regularMarketDayLow,
        volume: m.regularMarketVolume,
        marketCap: m.marketCap,
        change: m.regularMarketPrice - m.chartPreviousClose,
        changePct: (m.regularMarketPrice - m.chartPreviousClose) / m.chartPreviousClose,
        week52High: m.fiftyTwoWeekHigh,
        week52Low: m.fiftyTwoWeekLow,
        dayRange: m.regularMarketDayLow + " - " + m.regularMarketDayHigh,
        name: m.shortName || m.longName || ticker
      });
    } else {
      res.status(404).json({ error: 'No data' });
    }
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
}
