// api/weather.js — Vercel serverless proxy for Open-Meteo weather API
// Bypasses CORS (browser → Vercel edge → Open-Meteo → back)
// Drop this file into your Vercel project's /api/ directory

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { latitude, longitude } = req.query;
  if (!latitude || !longitude) {
    return res.status(400).json({ error: 'Missing latitude/longitude' });
  }
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current_weather=true&hourly=temperature_2m,windspeed_10m,winddirection_10m&forecast_days=1`;
  try {
    const upstream = await fetch(url);
    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: `Open-Meteo returned ${upstream.status}` });
    }
    const data = await upstream.json();
    res.setHeader('Cache-Control', 's-maxage=3600'); // cache 1hr on Vercel CDN
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
