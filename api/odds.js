// Vercel serverless function — proxies The Odds API
// Fetches h2h (moneyline), spreads, and totals in one call
const ODDS_API_KEY = process.env.ODDS_API_KEY || '';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (!ODDS_API_KEY) return res.json({ error: 'NO_API_KEY', games: [] });
  const sport = req.query.sport || 'baseball_mlb';
  const url = `https://api.the-odds-api.com/v4/sports/${sport}/odds?apiKey=${ODDS_API_KEY}&regions=us&markets=h2h,spreads,totals&oddsFormat=american`;
  try {
    const upstream = await fetch(url);
    const raw = await upstream.json();
    const games = (raw || []).map(g => {
      const books = g.bookmakers || [];
      // Search ALL bookmakers for each market (some books only offer h2h, not totals)
      const findMarket = (key) => {
        for (const bk of books) {
          const m = bk.markets?.find(m => m.key === key);
          if (m) return m;
        }
        return null;
      };
      const h2h     = findMarket('h2h');
      const spreads = findMarket('spreads');
      const totals  = findMarket('totals');

      const homeML = h2h?.outcomes?.find(o => o.name === g.home_team)?.price ?? null;
      const awayML = h2h?.outcomes?.find(o => o.name === g.away_team)?.price ?? null;

      // Spread: point value for home team (negative = home favored, e.g. -6.5)
      const homeSpreadOutcome = spreads?.outcomes?.find(o => o.name === g.home_team);
      const marketSpreadHome = homeSpreadOutcome?.point ?? null;

      // Total: the over/under line
      const overOutcome = totals?.outcomes?.find(o => o.name === 'Over');
      const marketTotal = overOutcome?.point ?? null;

      return {
        id: g.id,
        homeTeam: g.home_team,
        awayTeam: g.away_team,
        commenceTime: g.commence_time,
        homeML,
        awayML,
        marketSpreadHome,  // e.g. -6.5 (home favored by 6.5)
        marketTotal,       // e.g. 145.5
      };
    });
    res.setHeader('Cache-Control', 's-maxage=600');
    res.json({ games });
  } catch (e) {
    res.status(500).json({ error: e.message, games: [] });
  }
}
