// Vercel serverless function — fetches MLB odds from The Odds API
// Runs server-side so no CORS/CSP issues
// Free tier: 500 requests/month at the-odds-api.com
// Set ODDS_API_KEY in Vercel environment variables

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const apiKey = process.env.ODDS_API_KEY;

  // If no API key, return a clear message rather than failing silently
  if (!apiKey) {
    return res.status(200).json({
      error: 'NO_API_KEY',
      message: 'Add ODDS_API_KEY to Vercel environment variables. Get a free key at the-odds-api.com (500 req/month free).',
      games: []
    });
  }

  try {
    // Fetch all MLB games with h2h (moneyline), spreads (run line), totals (O/U)
    const url = `https://api.the-odds-api.com/v4/sports/baseball_mlb/odds/?apiKey=${apiKey}&regions=us&markets=h2h,spreads,totals&oddsFormat=american&bookmakers=draftkings,fanduel,betmgm`;
    const response = await fetch(url);

    if (!response.ok) {
      const text = await response.text();
      return res.status(200).json({ error: 'API_ERROR', message: text, games: [] });
    }

    const data = await response.json();

    // Normalize into our format: { homeTeam, awayTeam, homeML, awayML, overUnder, homeRL }
    const games = (data || []).map(game => {
      // Average across bookmakers for best line
      const allH2H = [], allSpreads = [], allTotals = [];

      for (const book of (game.bookmakers || [])) {
        const h2h    = book.markets?.find(m => m.key === 'h2h');
        const spread = book.markets?.find(m => m.key === 'spreads');
        const total  = book.markets?.find(m => m.key === 'totals');

        if (h2h) {
          const home = h2h.outcomes?.find(o => o.name === game.home_team);
          const away = h2h.outcomes?.find(o => o.name === game.away_team);
          if (home && away) allH2H.push({ home: home.price, away: away.price });
        }
        if (spread) {
          const home = spread.outcomes?.find(o => o.name === game.home_team);
          if (home) allSpreads.push({ homePoint: home.point, homePrice: home.price });
        }
        if (total) {
          const over = total.outcomes?.find(o => o.name === 'Over');
          if (over) allTotals.push(over.point);
        }
      }

      // Use consensus (most common) or first available
      const h2h    = allH2H[0]    || null;
      const spread = allSpreads[0] || null;
      const ouLine = allTotals.length
        ? (allTotals.reduce((s,v)=>s+v,0)/allTotals.length).toFixed(1)
        : null;

      return {
        gameId:    game.id,
        homeTeam:  game.home_team,
        awayTeam:  game.away_team,
        commenceTime: game.commence_time,
        homeML:    h2h?.home ?? null,
        awayML:    h2h?.away ?? null,
        overUnder: ouLine ? parseFloat(ouLine) : null,
        homeRL:    spread?.homePoint < 0 ? spread.homePrice : null, // home -1.5 juice
        awayRL:    spread?.homePoint > 0 ? spread.homePrice : null,
        books:     (game.bookmakers || []).map(b => b.key),
      };
    });

    // Return remaining quota in header for monitoring
    const remaining = response.headers.get('x-requests-remaining');
    const used      = response.headers.get('x-requests-used');

    return res.status(200).json({
      games,
      quota: { remaining, used },
      source: 'the-odds-api.com',
    });

  } catch (err) {
    return res.status(200).json({ error: 'FETCH_ERROR', message: err.message, games: [] });
  }
}
