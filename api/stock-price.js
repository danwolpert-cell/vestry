export default async function handler(req, res) {
  const { ticker } = req.query;
  const headers = {
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)',
    'Accept': '*/*',
    'Referer': 'https://finance.yahoo.com'
  };
  try {
    const [r1, r2] = await Promise.all([
      fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=5d&includePrePost=false`, { headers }),
      fetch(`https://query1.finance.yahoo.com/v7/finance/quote?symbols=${ticker}`, { headers })
    ]);
    const d1 = await r1.json();
    const d2 = await r2.json();
    const m = d1?.chart?.result?.[0]?.meta;
    const q = d2?.quoteResponse?.result?.[0];
    const quotes = d1?.chart?.result?.[0]?.indicators?.quote?.[0];
    const opens = quotes?.open || [];
    const todayOpen = opens[opens.length - 1];
    if (m?.regularMarketPrice) {
      res.json({
        c: m.regularMarketPrice,
        pc: m.chartPreviousClose,
        open: q?.regularMarketOpen || todayOpen,
        high: m.regularMarketDayHigh,
        low: m.regularMarketDayLow,
        volume: m.regularMarketVolume,
        marketCap: q?.marketCap,
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
