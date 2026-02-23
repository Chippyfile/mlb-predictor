import https from 'https';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  // Vercel pre-decodes query params, so path=teams%2F140%2Fstats arrives as "teams/140/stats"
  // No need to decodeURIComponent — just use it directly
  const { path, ...params } = req.query;

  if (!path) return res.status(400).json({ error: 'Missing path', query: req.query });

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
          catch (e) { reject(new Error(`Parse error: ${body.slice(0,200)}`)); }
        });
      }).on('error', reject);
    });
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    return res.status(data.status).json(data.data);
  } catch (err) {
    return res.status(500).json({ error: err.message, url: mlbUrl });
  }
}
