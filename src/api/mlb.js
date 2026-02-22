// All MLB API calls go through /mlb which Vercel rewrites to statsapi.mlb.com/api/v1
// This bypasses CORS and CSP entirely — the request is server-side on Vercel's edge
// All calls go to /api/mlb?path=<endpoint>&<params>
// Vercel serverless function proxies to statsapi.mlb.com server-side
function mlbUrl(path, params = {}) {
  const p = new URLSearchParams({ path, ...params });
  return `/api/mlb?${p.toString()}`;
}
const SEASON = new Date().getFullYear();

function gameTypeLabel(dateStr) {
  const d = new Date(dateStr);
  const m = d.getMonth() + 1, day = d.getDate();
  if (m === 2 || (m === 3 && day < 25)) return 'S';
  if (m === 10 || (m === 11 && day < 10)) return 'P';
  return 'R';
}

export async function fetchSchedule(dateStr) {
  // No gameType filter — let API return all types, label client-side
  const season = new Date(dateStr).getFullYear();
  const url = mlbUrl("schedule", { sportId:1, date:dateStr, season, hydrate:"probablePitcher,teams,venue,linescore" });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Schedule API ${res.status}`);
  const data = await res.json();
  const label = gameTypeLabel(dateStr);
  const games = [];
  for (const d of (data?.dates || [])) {
    for (const g of (d.games || [])) {
      const homeData = g.teams?.home;
      const awayData = g.teams?.away;
      games.push({
        gameId:      g.gamePk,
        gameTime:    g.gameDate,
        status:      (g.status?.abstractGameState === 'Final' || g.status?.detailedState === 'Game Over') ? 'Final'
                       : g.status?.abstractGameState === 'Live' ? 'Live'
                       : 'Preview',
        detailedState: g.status?.detailedState || '',
        gameType:    g.gameType || label,
        homeTeam:    { id: homeData?.team?.id, name: homeData?.team?.name, abbr: homeData?.team?.abbreviation || homeData?.team?.name?.slice(0,3).toUpperCase() },
        awayTeam:    { id: awayData?.team?.id, name: awayData?.team?.name, abbr: awayData?.team?.abbreviation || awayData?.team?.name?.slice(0,3).toUpperCase() },
        venueName:   g.venue?.name || '—',
        homeStarter: homeData?.probablePitcher || null,
        awayStarter: awayData?.probablePitcher || null,
        homeScore:   homeData?.score ?? null,
        awayScore:   awayData?.score ?? null,
        inning:      g.linescore?.currentInning || null,
        inningHalf:  g.linescore?.inningHalf || null,
      });
    }
  }
  return games;
}

export async function fetchTeamHitting(teamId) {
  const url = mlbUrl(`teams/${teamId}/stats`, { stats:"season", group:"hitting", season:SEASON, sportId:1 });
  try {
    const res = await fetch(url);
    const data = await res.json();
    const s = data?.stats?.[0]?.splits?.[0]?.stat || {};
    return {
      avg:  parseFloat(s.avg)  || 0.250,
      obp:  parseFloat(s.obp)  || 0.320,
      slg:  parseFloat(s.slg)  || 0.420,
      ops:  parseFloat(s.ops)  || 0.740,
      runs: parseInt(s.runs)   || 650,
      hr:   parseInt(s.homeRuns) || 160,
    };
  } catch { return null; }
}

export async function fetchTeamPitching(teamId) {
  const url = mlbUrl(`teams/${teamId}/stats`, { stats:"season", group:"pitching", season:SEASON, sportId:1 });
  try {
    const res = await fetch(url);
    const data = await res.json();
    const s = data?.stats?.[0]?.splits?.[0]?.stat || {};
    return {
      era:  parseFloat(s.era)  || 4.00,
      whip: parseFloat(s.whip) || 1.30,
      k9:   parseFloat(s.strikeoutsPer9Inn) || 8.5,
      bb9:  parseFloat(s.walksPer9Inn)      || 3.0,
    };
  } catch { return null; }
}

export async function fetchStarterStats(pitcherId) {
  if (!pitcherId) return null;
  const url = mlbUrl(`people/${pitcherId}/stats`, { stats:"season", group:"pitching", season:SEASON, sportId:1 });
  try {
    const res = await fetch(url);
    const data = await res.json();
    const s = data?.stats?.[0]?.splits?.[0]?.stat || {};
    const era  = parseFloat(s.era)  || 4.20;
    const whip = parseFloat(s.whip) || 1.30;
    const k9   = parseFloat(s.strikeoutsPer9Inn) || 8.5;
    const bb9  = parseFloat(s.walksPer9Inn)      || 3.2;
    const fip  = Math.max(2.0, era * 0.82 + whip * 0.4 + (bb9 - k9) * 0.15);
    const xfip = fip * 0.85 + 4.25 * 0.15;
    return { era, whip, k9, bb9, fip, xfip, ip: parseFloat(s.inningsPitched) || 0 };
  } catch { return null; }
}

export async function fetchVsTeamSplits(teamId, oppId) {
  const url = mlbUrl(`teams/${teamId}/stats`, { stats:"vsTeam", group:"hitting", season:SEASON, opposingTeamId:oppId, sportId:1 });
  try {
    const res = await fetch(url);
    const data = await res.json();
    const splits = data?.stats?.[0]?.splits || [];
    if (!splits.length) return null;
    const s = splits[0]?.stat || {};
    return {
      avg: parseFloat(s.avg) || null,
      obp: parseFloat(s.obp) || null,
      slg: parseFloat(s.slg) || null,
      ops: parseFloat(s.ops) || null,
      hits: parseInt(s.hits) || null,
      ab:  parseInt(s.atBats) || null,
    };
  } catch { return null; }
}

export async function fetchRecentGames(teamId, n = 15) {
  const today = new Date().toISOString().split('T')[0];
  const url = mlbUrl("schedule", { teamId, season:SEASON, startDate:`${SEASON}-01-01`, endDate:today, hydrate:"linescore", sportId:1 });
  try {
    const res = await fetch(url);
    const data = await res.json();
    const games = [];
    for (const d of (data?.dates || [])) {
      for (const g of (d.games || [])) {
        if (g.status?.abstractGameState === 'Final' || g.status?.detailedState === 'Game Over') {
          const isHome = g.teams?.home?.team?.id === teamId;
          const my = isHome ? g.teams?.home : g.teams?.away;
          const op = isHome ? g.teams?.away : g.teams?.home;
          games.push({ win: my?.isWinner || false, rs: my?.score || 0, ra: op?.score || 0 });
        }
      }
    }
    const recent = games.slice(-n);
    if (!recent.length) return null;
    const rf = recent.reduce((s, g) => s + g.rs, 0);
    const ra = recent.reduce((s, g) => s + g.ra, 0);
    const wins = recent.filter(g => g.win).length;
    const pyth = Math.pow(rf, 1.83) / (Math.pow(rf, 1.83) + Math.pow(ra, 1.83));
    const actualWP = wins / recent.length;
    const formScore = recent.slice(-5).reduce((s, g, i) => s + (g.win ? 1 : -0.6) * (i + 1), 0) / 15;
    return {
      games: recent, wins, losses: recent.length - wins,
      winPct: actualWP, pythWinPct: pyth,
      luckFactor: actualWP - pyth,
      avgRF: rf / recent.length, avgRA: ra / recent.length,
      formScore,
    };
  } catch { return null; }
}

export async function fetchBullpenFatigue(teamId) {
  const today = new Date();
  const y = new Date(today); y.setDate(today.getDate() - 1);
  const t = new Date(today); t.setDate(today.getDate() - 2);
  const fmt = d => d.toISOString().split('T')[0];
  const url = mlbUrl("schedule", { teamId, season:SEASON, startDate:fmt(t), endDate:fmt(y), sportId:1 });
  try {
    const res = await fetch(url);
    const data = await res.json();
    let py = 0, pt = 0;
    for (const date of (data?.dates || [])) {
      for (const g of (date.games || [])) {
        const isHome = g.teams?.home?.team?.id === teamId;
        const bp = isHome ? g.teams?.home?.pitchers?.length || 0 : g.teams?.away?.pitchers?.length || 0;
        const days = Math.round((today - new Date(date.date)) / 86400000);
        if (days === 1) py = bp;
        if (days === 2) pt = bp;
      }
    }
    return { fatigue: Math.min(1, py * 0.15 + pt * 0.07), pitchersUsedYesterday: py, closerAvailable: py < 3 };
  } catch { return { fatigue: 0.1, pitchersUsedYesterday: 0, closerAvailable: true }; }
}

export async function fetchLikelyRelievers(teamId) {
  const url = mlbUrl(`teams/${teamId}/roster`, { rosterType:"active", season:SEASON, hydrate:"person(stats(type=season,group=pitching))" });
  try {
    const res = await fetch(url);
    const data = await res.json();
    return (data?.roster || [])
      .filter(p => ['RP','CP'].includes(p.position?.abbreviation))
      .map(p => {
        const s = p.person?.stats?.[0]?.splits?.[0]?.stat || {};
        return { name: p.person?.fullName || '—', era: parseFloat(s.era) || 4.50, saves: parseInt(s.saves) || 0, ip: parseFloat(s.inningsPitched) || 0, isCloser: p.position?.abbreviation === 'CP' || parseInt(s.saves) > 5 };
      })
      .filter(p => p.ip > 0)
      .sort((a, b) => a.era - b.era)
      .slice(0, 5);
  } catch { return []; }
}

// ─── Fetch live odds via Vercel serverless function ──────────
// Matches games by fuzzy team name comparison
export async function fetchLiveOdds() {
  try {
    const res = await fetch('/api/odds');
    if (!res.ok) return { games: [], error: `HTTP ${res.status}` };
    const data = await res.json();
    return data;
  } catch (e) {
    return { games: [], error: e.message };
  }
}

// Match an MLB Stats API team name to an odds API team name
// e.g. "Detroit Tigers" → matches "Detroit Tigers" or "Tigers"
export function matchOddsToGame(oddsGames, homeTeamName, awayTeamName) {
  if (!oddsGames?.length) return null;
  const normalize = s => s?.toLowerCase().replace(/[^a-z]/g, '') || '';
  const hN = normalize(homeTeamName);
  const aN = normalize(awayTeamName);
  return oddsGames.find(og => {
    const ogH = normalize(og.homeTeam);
    const ogA = normalize(og.awayTeam);
    return (ogH.includes(hN.slice(-6)) || hN.includes(ogH.slice(-6))) &&
           (ogA.includes(aN.slice(-6)) || aN.includes(ogA.slice(-6)));
  }) || null;
}
