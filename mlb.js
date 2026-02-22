// Vercel serverless function — proxies ALL MLB API calls server-side
// This completely bypasses CORS/CSP. No more proxy rewrite needed.

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  // req.url will be like /api/mlb?path=teams/116/stats&stats=season&group=hitting&season=2026&sportId=1
  const { path, ...params } = req.query;

  if (!path) {
    return res.status(400).json({ error: 'Missing path parameter' });
  }

  // Build the MLB API URL
  const qs = new URLSearchParams(params).toString();
  const mlbUrl = `https://statsapi.mlb.com/api/v1/${path}${qs ? '?' + qs : ''}`;

  try {
    const response = await fetch(mlbUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }
    });
    const data = await response.json();
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    return res.status(response.status).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message, url: mlbUrl });
  }
}
