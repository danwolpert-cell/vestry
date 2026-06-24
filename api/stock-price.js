export default async function handler(req, res) {
  const { ticker } = req.query;
  try {
    const KEY = "d0oOHQHr01qhcnk56bs0d0oOHQHr01qhcnk56bsg";
    const r = await fetch(`https://finnhub.io/api/v1/quote?symbol=${ticker}&token=${KEY}`);
    const d = await r.json();
    if (d.c) {
      res.json({ c: d.c, pc: d.pc });
    } else {
      res.status(404).json({ error: 'No data' });
    }
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
}
