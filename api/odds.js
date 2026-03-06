// Vercel serverless function — proxies The Odds API
// Fetches h2h (moneyline), spreads, and totals in one call
//
// Dual-key support: tries ODDS_API_KEY (free) first.
// If quota is exhausted, retries with ODDS_API_KEY_BACKUP (paid).
// Add both keys in Vercel → Settings → Environment Variables.
const ODDS_API_KEY        = process.env.ODDS_API_KEY || '';
const ODDS_API_KEY_BACKUP = process.env.ODDS_API_KEY_BACKUP || '';

async function fetchFromOddsAPI(apiKey, sport) {
  const url = `https://api.the-odds-api.com/v4/sports/${sport}/odds?apiKey=${apiKey}&regions=us&markets=h2h,spreads,totals&oddsFormat=american`;
  const upstream = await fetch(url);
  const remaining = upstream.headers.get('x-requests-remaining');
  const raw = await upstream.json();

  // Detect quota exhaustion — API returns object with message instead of array
  const isQuotaError = !Array.isArray(raw) && 
    /quota|limit|exceeded/i.test(raw?.message || raw?.error || '');

  return { raw, remaining, isQuotaError };
}

function parseGames(raw) {
  return raw.map(g => {
    const books = g.bookmakers || [];
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

    return {
      id: g.id,
      homeTeam: g.home_team,
      awayTeam: g.away_team,
      commenceTime: g.commence_time,
      homeML:           h2h?.outcomes?.find(o => o.name === g.home_team)?.price ?? null,
      awayML:           h2h?.outcomes?.find(o => o.name === g.away_team)?.price ?? null,
      marketSpreadHome: spreads?.outcomes?.find(o => o.name === g.home_team)?.point ?? null,
      marketTotal:      totals?.outcomes?.find(o => o.name === 'Over')?.point ?? null,
    };
  });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (!ODDS_API_KEY && !ODDS_API_KEY_BACKUP) {
    return res.json({ error: 'NO_API_KEY', games: [] });
  }

  const sport = req.query.sport || 'baseball_mlb';

  try {
    // ── Try primary (free) key first ──
    if (ODDS_API_KEY) {
      const primary = await fetchFromOddsAPI(ODDS_API_KEY, sport);

      if (!primary.isQuotaError && Array.isArray(primary.raw)) {
        const games = parseGames(primary.raw);
        if (primary.remaining) {
          console.log(`[odds] ${sport}: ${primary.remaining} remaining (primary)`);
        }
        res.setHeader('Cache-Control', 's-maxage=21600');
        return res.json({ games });
      }

      console.warn(`[odds] Primary key quota exhausted for ${sport}, trying backup...`);
    }

    // ── Fallback to backup (paid) key ──
    if (ODDS_API_KEY_BACKUP) {
      const backup = await fetchFromOddsAPI(ODDS_API_KEY_BACKUP, sport);

      if (!backup.isQuotaError && Array.isArray(backup.raw)) {
        const games = parseGames(backup.raw);
        if (backup.remaining) {
          console.log(`[odds] ${sport}: ${backup.remaining} remaining (backup)`);
        }
        res.setHeader('Cache-Control', 's-maxage=21600');
        return res.json({ games, _source: 'backup' });
      }

      const msg = backup.raw?.message || backup.raw?.error || 'Both API keys exhausted';
      console.error(`[odds] Both keys exhausted for ${sport}: ${msg}`);
      return res.json({ error: msg, games: [], noKey: false });
    }

    return res.json({ error: 'Primary key quota reached, no backup configured', games: [], noKey: false });

  } catch (e) {
    res.status(500).json({ error: e.message, games: [] });
  }
}
