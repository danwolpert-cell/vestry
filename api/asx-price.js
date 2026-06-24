export default async function handler(req, res) {
  const { ticker } = req.query;
  try {
    const r = await fetch(`https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${ticker}&apikey=demo`);
    const d = await r.json();
    const q = d?.['Global Quote'];
    if (q?.['05. price']) {
      res.json({ c: parseFloat(q['05. price']), pc: parseFloat(q['08. previous close']) });
    } else {
      res.status(404).json({ error: 'No data', raw: d });
    }
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
}
