import https from 'https';

// Vercel serverless function — proxies MLB Stats API requests server-side
// Bypasses browser CORS restrictions entirely
// Deploy location: /api/mlb.js (at repo root, NOT inside src/)
// Usage: /api/mlb?path=schedule&sportId=1&date=2026-03-01

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const { path, ...params } = req.query;
  if (!path) return res.status(400).json({ error: 'Missing path param', query: req.query });

  const qs = new URLSearchParams(params).toString();
  const mlbUrl = `https://statsapi.mlb.com/api/v1/${path}${qs ? '?' + qs : ''}`;

  try {
    const data = await new Promise((resolve, reject) => {
      https.get(mlbUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }
      }, (r) => {
        let body = '';
        r.on('data', chunk => body += chunk);
        r.on('end', () => {
          try { resolve({ status: r.statusCode, data: JSON.parse(body) }); }
          catch (e) { reject(new Error(`JSON parse error: ${body.slice(0, 200)}`)); }
        });
      }).on('error', reject);
    });
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    return res.status(data.status).json(data.data);
  } catch (err) {
    return res.status(500).json({ error: err.message, url: mlbUrl });
  }
}
