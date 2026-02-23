// Vercel serverless function — proxies MLB Stats API
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { path, ...params } = req.query;
  if (!path) return res.status(400).json({ error: 'Missing path' });
  const qs = new URLSearchParams(params).toString();
  const url = `https://statsapi.mlb.com/api/v1/${path}${qs ? '?' + qs : ''}`;
  try {
    const upstream = await fetch(url);
    const data = await upstream.json();
    res.setHeader('Cache-Control', 's-maxage=120');
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
