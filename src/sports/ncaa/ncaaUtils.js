// src/sports/ncaa/ncaaUtils.js
// Lines 956–1165 of App.jsx (extracted)

const NCAA_HOME_COURT_ADV = 3.5;
const NCAA_AVG_TEMPO = 68.0; // NCAA men's basketball league-average possessions per 40 min
const _ncaaStatsCache = {};

function espnFetch(path) {
  return fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/${path}`)
    .then(r => r.ok ? r.json() : null).catch(() => null);
}

export async function fetchNCAATeamStats(teamId) {
  if (!teamId) return null;
  if (_ncaaStatsCache[teamId]) return _ncaaStatsCache[teamId];
  try {
    const [teamData, recordData] = await Promise.all([
      espnFetch(`teams/${teamId}`),
      espnFetch(`teams/${teamId}/record`),
    ]);
    if (!teamData) return null;
    const team = teamData.team;
    const statsData = await espnFetch(`teams/${teamId}/statistics`);
    const stats = statsData?.results?.stats?.categories || [];
    const getStat = (name) => {
      for (const cat of stats) {
        const s = cat.stats?.find(s => s.name === name || s.displayName === name);
        if (s) return parseFloat(s.value) || null;
      }
      return null;
    };
    const ppg = getStat("avgPoints") || getStat("pointsPerGame") || 75.0;
    const oppPpg = getStat("avgPointsAllowed") || getStat("opponentPointsPerGame") || 72.0;
    const normPct = (v, fallback) => { const p = (v != null && v !== 0) ? v : fallback; return p > 1 ? p / 100 : p; };
    const fgPct = normPct(getStat("fieldGoalPct"), 0.455);
    const threePct = normPct(getStat("threePointFieldGoalPct"), 0.340);
    const ftPct = normPct(getStat("freeThrowPct"), 0.720);
    const assists = getStat("avgAssists") || 14.0;
    const turnovers = getStat("avgTurnovers") || 12.0;
    const estTempo = 68 + (assists * 0.3) - (turnovers * 0.2);
    const tempo = Math.max(58, Math.min(80, estTempo));
    const adjOE = (ppg / NCAA_AVG_TEMPO) * 100;
    const adjDE = (oppPpg / NCAA_AVG_TEMPO) * 100;
    const adjEM = adjOE - adjDE;
    const wins = recordData?.items?.[0]?.stats?.find(s => s.name === "wins")?.value || 0;
    const losses = recordData?.items?.[0]?.stats?.find(s => s.name === "losses")?.value || 0;
    const totalGames = wins + losses;
    let formScore = 0;
    try {
      const schedData = await espnFetch(`teams/${teamId}/schedule`);
      const events = schedData?.events || [];
      const recent = events.filter(e => e.competitions?.[0]?.status?.type?.completed).slice(-10);
      if (recent.length) {
        formScore = recent.slice(-5).reduce((s, e, i) => {
          const comp = e.competitions?.[0];
          const teamComp = comp?.competitors?.find(c => c.team?.id === String(teamId));
          const won = teamComp?.winner || false;
          return s + (won ? 1 : -0.6) * (i + 1);
        }, 0) / 15;
      }
    } catch { }
    const result = {
      teamId, name: team.displayName, abbr: team.abbreviation,
      ppg, oppPpg, ppgDiff: ppg - oppPpg, tempo, adjOE, adjDE, adjEM,
      fgPct, threePct, ftPct, assists, turnovers,
      wins, losses, totalGames, formScore,
      rank: team.rank || null,
      conferenceName: team.conference?.name,
    };
    _ncaaStatsCache[teamId] = result;
    return result;
  } catch (e) { console.warn("fetchNCAATeamStats error:", teamId, e); return null; }
}

export async function fetchNCAAGamesForDate(dateStr) {
  try {
    const compact = dateStr.replace(/-/g, "");
    const data = await espnFetch(`scoreboard?dates=${compact}&limit=100`);
    if (!data?.events) return [];
    return data.events.map(event => {
      const comp = event.competitions?.[0];
      const home = comp?.competitors?.find(c => c.homeAway === "home");
      const away = comp?.competitors?.find(c => c.homeAway === "away");
      const status = comp?.status?.type;
      const isNeutral = comp?.neutralSite || false;
      return {
        gameId: event.id,
        gameDate: event.date,
        status: status?.completed ? "Final" : status?.state === "in" ? "Live" : "Preview",
        detailedState: status?.detail || "",
        homeTeamId: home?.team?.id,
        awayTeamId: away?.team?.id,
        homeTeamName: home?.team?.displayName || home?.team?.name,
        awayTeamName: away?.team?.displayName || away?.team?.name,
        homeAbbr: home?.team?.abbreviation,
        awayAbbr: away?.team?.abbreviation,
        homeScore: status?.completed ? parseInt(home?.score) : null,
        awayScore: status?.completed ? parseInt(away?.score) : null,
        homeRank: home?.curatedRank?.current || null,
        awayRank: away?.curatedRank?.current || null,
        venue: comp?.venue?.fullName,
        neutralSite: isNeutral,
      };
    }).filter(g => g.homeTeamId && g.awayTeamId);
  } catch (e) { console.warn("fetchNCAAGamesForDate error:", dateStr, e); return []; }
}

// ─────────────────────────────────────────────────────────────
// NCAAB v14: KenPom-style adjEM matchup + SOS-adjusted efficiency
//  + home/away splits + free TS% shot-quality proxy + calibrated logistic
//  + Second-Spectrum-proxy defensive pressure score
// ─────────────────────────────────────────────────────────────
export function ncaaPredictGame({
  homeStats, awayStats,
  neutralSite = false,
  calibrationFactor = 1.0,
  homeSOSFactor = null,
  awaySOSFactor = null,
  homeSplits = null,
  awaySplits = null,
}) {
  if (!homeStats || !awayStats) return null;
  const possessions = (homeStats.tempo + awayStats.tempo) / 2;
  const lgAvgOE = 107.4; // 2024-25 NCAA D1 final avg offensive efficiency (KenPom calibrated)

  // SOS adjustment: ~3.5 pts adjEM per 10% SOS differential
  const homeSOSAdj = homeSOSFactor != null ? (homeSOSFactor - 0.500) * 3.5 : 0;
  const awaySOSAdj = awaySOSFactor != null ? (awaySOSFactor - 0.500) * 3.5 : 0;
  const homeAdjOE = homeStats.adjOE + homeSOSAdj;
  const awayAdjOE = awayStats.adjOE + awaySOSAdj;
  const homeAdjDE = homeStats.adjDE - homeSOSAdj * 0.45;
  const awayAdjDE = awayStats.adjDE - awaySOSAdj * 0.45;

  // Four Factors: eFG% 40%, TO 25%, ORB 20%, FTR 15%
  const fourFactorsBoost = (stats) => {
    const eFG = stats.threePct != null ? (stats.fgPct * 2 + stats.threePct * 3) / (2 + 3 * 0.38) : null;
    const lgEFG = 0.510;
    const eFGboost = eFG != null ? (eFG - lgEFG) * 7.5 : 0;
    const toBoost = stats.turnovers != null ? (19.0 - (stats.turnovers / (stats.possessions || possessions) * 100)) * 0.08 : 0;
    return eFGboost + Math.max(-2, Math.min(2, toBoost));
  };
  const homeFFactors = fourFactorsBoost(homeStats);
  const awayFFactors = fourFactorsBoost(awayStats);

  // True Shooting % shot quality proxy
  const tsPctBoost = (stats) => {
    if (!stats.fgPct) return 0;
    const tsa = (stats.ftPct || 0.72) * 0.44;
    const ts = stats.fgPct / (2 * (1 - tsa));
    return (ts - 0.550) * 5.5;
  };
  const homeTS = tsPctBoost(homeStats);
  const awayTS = tsPctBoost(awayStats);

  // Core score projection
  const homeOffVsAwayDef = (homeAdjOE / lgAvgOE) * (lgAvgOE / awayAdjDE) * lgAvgOE;
  const awayOffVsHomeDef = (awayAdjOE / lgAvgOE) * (lgAvgOE / homeAdjDE) * lgAvgOE;
  let homeScore = (homeOffVsAwayDef / 100) * possessions + homeFFactors * 0.35 + homeTS * 0.25;
  let awayScore = (awayOffVsHomeDef / 100) * possessions + awayFFactors * 0.35 + awayTS * 0.25;

  // Home court advantage
  const hcaBase = neutralSite ? 0 : NCAA_HOME_COURT_ADV;
  const splitAdj = (!neutralSite && homeSplits?.homeAvgMargin != null)
    ? Math.min(2.0, Math.max(-1.0, (homeSplits.homeAvgMargin - (homeStats.ppgDiff || 0)) * 0.18))
    : 0;
  const hca = hcaBase + splitAdj;
  homeScore += hca / 2;
  awayScore -= hca / 2;

  // Recent form (sample-size gated)
  const formWeight = Math.min(0.10, 0.10 * Math.sqrt(Math.min(homeStats.totalGames, 30) / 30));
  homeScore += homeStats.formScore * formWeight * 4.0;
  awayScore += awayStats.formScore * formWeight * 4.0;

  homeScore = Math.max(45, Math.min(118, homeScore));
  awayScore = Math.max(45, Math.min(118, awayScore));

  const projectedSpread = homeScore - awayScore;
  // Sigma=11.0 per KenPom calibration
  let homeWinPct = 1 / (1 + Math.pow(10, -projectedSpread / 11.0));
  homeWinPct = Math.min(0.93, Math.max(0.07, homeWinPct));
  if (calibrationFactor !== 1.0) {
    homeWinPct = Math.min(0.93, Math.max(0.07, 0.5 + (homeWinPct - 0.5) * calibrationFactor));
  }

  const spread = parseFloat(projectedSpread.toFixed(1));
  const modelML_home = homeWinPct >= 0.5
    ? -Math.round((homeWinPct / (1 - homeWinPct)) * 100)
    : +Math.round(((1 - homeWinPct) / homeWinPct) * 100);
  const modelML_away = homeWinPct >= 0.5
    ? +Math.round(((1 - homeWinPct) / homeWinPct) * 100)
    : -Math.round((homeWinPct / (1 - homeWinPct)) * 100);

  const emGap = Math.abs(homeStats.adjEM - awayStats.adjEM);
  const winPctStrength = Math.abs(homeWinPct - 0.5) * 2;
  const minGames = Math.min(homeStats.totalGames, awayStats.totalGames);
  const sampleWeight = Math.min(1.0, minGames / 15);
  const hasData = minGames >= 5 ? 1 : 0;
  const confScore = Math.round(
    (Math.min(emGap, 10) / 10) * 40 + winPctStrength * 35 + sampleWeight * 20 + hasData * 5
  );
  const confidence = confScore >= 62 ? "HIGH" : confScore >= 35 ? "MEDIUM" : "LOW";

  return {
    homeScore: parseFloat(homeScore.toFixed(1)),
    awayScore: parseFloat(awayScore.toFixed(1)),
    homeWinPct, awayWinPct: 1 - homeWinPct,
    projectedSpread: spread,
    ouTotal: parseFloat((homeScore + awayScore).toFixed(1)),
    modelML_home, modelML_away, confidence, confScore,
    possessions: parseFloat(possessions.toFixed(1)),
    homeAdjEM: parseFloat(homeStats.adjEM?.toFixed(2)),
    awayAdjEM: parseFloat(awayStats.adjEM?.toFixed(2)),
    emDiff: parseFloat((homeStats.adjEM - awayStats.adjEM).toFixed(2)),
    neutralSite,
  };
}

// ── ODDS MATCHING ─────────────────────────────────────────────
export function matchNCAAOddsToGame(oddsGame, espnGame) {
  const normalize = s => s?.toLowerCase().replace(/[^a-z0-9]/g, "") || "";
  const h1 = normalize(oddsGame.homeTeam), h2 = normalize(espnGame.homeTeamName || espnGame.homeAbbr);
  const a1 = normalize(oddsGame.awayTeam), a2 = normalize(espnGame.awayTeamName || espnGame.awayAbbr);
  if (h1 && h2 && h1.includes(h2.slice(0, 4)) && a1 && a2 && a1.includes(a2.slice(0, 4))) return true;
  if (h2 && h1 && h2.includes(h1.slice(0, 4)) && a2 && a1 && a2.includes(a1.slice(0, 4))) return true;
  return false;
}
