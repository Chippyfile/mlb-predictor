// Vercel serverless function — proxies The Odds API
const ODDS_API_KEY = process.env.ODDS_API_KEY || '';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (!ODDS_API_KEY) return res.json({ error: 'NO_API_KEY', games: [] });
  const sport = req.query.sport || 'baseball_mlb';
  const url = `https://api.the-odds-api.com/v4/sports/${sport}/odds?apiKey=${ODDS_API_KEY}&regions=us&markets=h2h&oddsFormat=american`;
  try {
    const upstream = await fetch(url);
    const raw = await upstream.json();
    const games = (raw || []).map(g => ({
      id: g.id,
      homeTeam: g.home_team,
      awayTeam: g.away_team,
      commenceTime: g.commence_time,
      homeML: g.bookmakers?.[0]?.markets?.[0]?.outcomes?.find(o => o.name === g.home_team)?.price || null,
      awayML: g.bookmakers?.[0]?.markets?.[0]?.outcomes?.find(o => o.name === g.away_team)?.price || null,
    }));
    res.setHeader('Cache-Control', 's-maxage=600');
    res.json({ games });
  } catch (e) {
    res.status(500).json({ error: e.message, games: [] });
  }
}
