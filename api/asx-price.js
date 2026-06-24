export default async function handler(req, res) {
  const { ticker } = req.query;
  try {
    const asxTicker = ticker.replace('.AX', '');
    const r = await fetch(
      `https://www.google.com/finance/quote/${asxTicker}:ASX`,
      { headers: { 'User-Agent': 'Mozilla/5.0' } }
    );
    const html = await r.text();
    const match = html.match(/data-last-price="([0-9.]+)"/);
    const prevMatch = html.match(/data-prev-close="([0-9.]+)"/);
    if (match) {
      res.json({ c: parseFloat(match[1]), pc: prevMatch ? parseFloat(prevMatch[1]) : null });
    } else {
      res.status(404).json({ error: 'Price not found' });
    }
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
}
