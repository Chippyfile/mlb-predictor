// src/sports/ncaa/ncaaUtils.js
// NCAAB v16 — Audit-compliant efficiency engine
// Changelog v15→v16:
//   F1:  adjOE/adjDE now uses proper offensive/defensive possession estimates
//   F2:  ORB% uses opponent's actual DRB instead of hardcoded 25.0
//   F6:  Conference power is now a parameter (dynamic) instead of static lookup
//   F7:  Four Factors scaled by tempo (possessions / 68)
//   F8:  Removed oppFGpct from defBoost (double-counted via adjDE)
//   F9:  Sigma = 16.0 (empirically calibrated via backtest, Brier 0.175 vs 0.184)
//   F13: Form score uses symmetric +1/-1 weights with exponential decay
//   F14: SOS adjustment symmetric 70/70 for OE/DE
//   F15: Rank boost uses continuous exponential decay
//   F16: Score clamp widened to [35, 130]
//   F11: Added turnover margin and steals/TO ratio to prediction output
//   F26: Improved odds matching with longer substring

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

    // ── Additional stats for Four Factors, defensive metrics, tempo ──
    const fga = getStat("fieldGoalsAttempted") || getStat("avgFieldGoalsAttempted") || 58.0;
    const fta = getStat("freeThrowsAttempted") || getStat("avgFreeThrowsAttempted") || 20.0;
    const offReb = getStat("avgOffensiveRebounds") || getStat("offensiveReboundsPerGame") || 10.0;
    const defReb = getStat("avgDefensiveRebounds") || getStat("defensiveReboundsPerGame") || 24.0;
    const totalReb = getStat("avgRebounds") || getStat("reboundsPerGame") || (offReb + defReb);
    const steals = getStat("avgSteals") || getStat("stealsPerGame") || 7.0;
    const blocks = getStat("avgBlocks") || getStat("blocksPerGame") || 3.5;
    const threeAtt = getStat("threePointFieldGoalsAttempted") || getStat("avgThreePointFieldGoalsAttempted") || (fga * 0.38);

    // Opponent defensive stats (if available from ESPN)
    const oppFGpct = normPct(getStat("opponentFieldGoalPct"), 0.430);
    const oppThreePct = normPct(getStat("opponentThreePointFieldGoalPct"), 0.330);

    // ── F1: Proper possession estimate ──
    // Offensive possessions ≈ FGA - ORB + TO + 0.475 * FTA
    const offPoss = fga - offReb + turnovers + 0.475 * fta;
    const tempo = Math.max(58, Math.min(80, offPoss || 68));

    // ── F2: ORB% with league-avg DRB fallback (matchup-specific in predict) ──
    const lgAvgDRB = 24.5; // D1 2024-25 average DRB per game
    const orbPct = offReb / (offReb + lgAvgDRB);
    const ftaRate = fga > 0 ? fta / fga : 0.34;
    const atoRatio = turnovers > 0 ? assists / turnovers : 1.2;
    const threeAttRate = fga > 0 ? threeAtt / fga : 0.38;
    // F11: Steals-to-turnovers ratio (turnover quality)
    const stealToRatio = turnovers > 0 ? steals / turnovers : 0.58;

    // ── F1: Possession-based efficiency ──
    const adjOE = tempo > 0 ? (ppg / tempo) * 100 : 107.0;
    const adjDE = tempo > 0 ? (oppPpg / tempo) * 100 : 107.0;
    const adjEM = adjOE - adjDE;

    const wins = recordData?.items?.[0]?.stats?.find(s => s.name === "wins")?.value || 0;
    const losses = recordData?.items?.[0]?.stats?.find(s => s.name === "losses")?.value || 0;
    const totalGames = wins + losses;

    // ── F13: Symmetric form score with exponential decay ──
    let formScore = 0;
    try {
      const schedData = await espnFetch(`teams/${teamId}/schedule`);
      const events = schedData?.events || [];
      const recent = events.filter(e => e.competitions?.[0]?.status?.type?.completed).slice(-10);
      if (recent.length) {
        const last5 = recent.slice(-5);
        let weightedSum = 0, totalWeight = 0;
        last5.forEach((e, i) => {
          const comp = e.competitions?.[0];
          const teamComp = comp?.competitors?.find(c => c.team?.id === String(teamId));
          const won = teamComp?.winner || false;
          const weight = Math.exp(-0.2 * (last5.length - 1 - i));
          // F13: Symmetric weights: +1 win, -1 loss
          weightedSum += (won ? 1 : -1) * weight;
          totalWeight += weight;
        });
        formScore = totalWeight > 0 ? weightedSum / totalWeight : 0;
      }
    } catch { }

    const result = {
      teamId, name: team.displayName, abbr: team.abbreviation,
      ppg, oppPpg, ppgDiff: ppg - oppPpg, tempo, adjOE, adjDE, adjEM,
      fgPct, threePct, ftPct, assists, turnovers,
      fga, fta, offReb, defReb, totalReb, steals, blocks,
      threeAtt, threeAttRate, orbPct, ftaRate, atoRatio, stealToRatio,
      oppFGpct, oppThreePct,
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
// NCAAB v16: Audit-compliant KenPom-style adjEM matchup engine
// ─────────────────────────────────────────────────────────────

// Conference-tier home court advantage
const CONF_HCA = {
  "Big 12": 3.8, "Southeastern Conference": 3.7, "SEC": 3.7,
  "Big Ten": 3.6, "Big Ten Conference": 3.6,
  "Atlantic Coast Conference": 3.4, "ACC": 3.4,
  "Big East": 3.3, "Big East Conference": 3.3,
  "Pac-12": 3.0, "Pac-12 Conference": 3.0,
  "Mountain West Conference": 3.2, "Mountain West": 3.2,
  "American Athletic Conference": 3.0, "AAC": 3.0,
  "West Coast Conference": 2.8, "WCC": 2.8,
  "Atlantic 10 Conference": 2.7, "A-10": 2.7,
  "Missouri Valley Conference": 2.9, "MVC": 2.9,
  "Conference USA": 2.6, "Sun Belt Conference": 2.6,
  "Mid-American Conference": 2.8, "MAC": 2.8,
  "Colonial Athletic Association": 2.5, "CAA": 2.5,
  "Ivy League": 2.3, "Patriot League": 2.3,
};
const DEFAULT_HCA = 3.0;

// F6: Conference power defaults (overridable via confPowerOverrides param)
const CONF_POWER_DEFAULTS = {
  "Big 12": 1.25, "Southeastern Conference": 1.22, "SEC": 1.22,
  "Big Ten": 1.20, "Big Ten Conference": 1.20,
  "Atlantic Coast Conference": 1.15, "ACC": 1.15,
  "Big East": 1.12, "Big East Conference": 1.12,
  "Pac-12": 1.05, "Pac-12 Conference": 1.05,
  "Mountain West Conference": 1.00, "Mountain West": 1.00,
  "American Athletic Conference": 0.98, "AAC": 0.98,
  "West Coast Conference": 0.92, "WCC": 0.92,
  "Atlantic 10 Conference": 0.90, "A-10": 0.90,
  "Missouri Valley Conference": 0.88, "MVC": 0.88,
};

export function ncaaPredictGame({
  homeStats, awayStats,
  neutralSite = false,
  calibrationFactor = 1.0,
  homeSOSFactor = null,
  awaySOSFactor = null,
  homeSplits = null,
  awaySplits = null,
  confPowerOverrides = null,
  // F9: sigma=16.0 — empirically calibrated via /backtest/ncaa (Feb 2026)
  // Brier: 0.1754 at σ=16.0 vs 0.1835 at σ=11.0 (614 games tested)
  sigma = 16.0,
}) {
  if (!homeStats || !awayStats) return null;
  const possessions = (homeStats.tempo + awayStats.tempo) / 2;
  const lgAvgOE = 107.0;
  const lgAvgTempo = 68.0;

  // F6: Dynamic conference power
  const confPower = confPowerOverrides || CONF_POWER_DEFAULTS;
  const homeConfPower = confPower[homeStats.conferenceName] || 1.0;
  const awayConfPower = confPower[awayStats.conferenceName] || 1.0;

  // F14: Symmetric SOS adjustment (70% OE, 70% DE)
  const sosMultiplier = 3.5;
  const sosSplit = 0.70;
  const homeSOSAdj = homeSOSFactor != null ? (homeSOSFactor - 0.500) * sosMultiplier * homeConfPower : 0;
  const awaySOSAdj = awaySOSFactor != null ? (awaySOSFactor - 0.500) * sosMultiplier * awayConfPower : 0;
  const homeAdjOE = homeStats.adjOE + homeSOSAdj * sosSplit;
  const awayAdjOE = awayStats.adjOE + awaySOSAdj * sosSplit;
  const homeAdjDE = homeStats.adjDE - homeSOSAdj * sosSplit;
  const awayAdjDE = awayStats.adjDE - awaySOSAdj * sosSplit;

  // ── F7: Four Factors scaled by tempo ──
  const tempoScale = possessions / lgAvgTempo;
  const fourFactorsBoost = (stats, opponentDefReb) => {
    const threeRate = stats.threeAttRate || 0.38;
    const eFG = stats.fgPct + 0.5 * threeRate * stats.threePct;
    const lgEFG = 0.502;
    const eFGboost = (eFG - lgEFG) * 8.0;

    const toPct = stats.tempo > 0 ? (stats.turnovers / stats.tempo) * 100 : 18.0;
    const lgTO = 18.0;
    const toBoost = (lgTO - toPct) * 0.12;

    // F2: Matchup-specific ORB% using opponent's actual DRB
    const oppDRB = opponentDefReb || 24.5;
    const matchupOrbPct = stats.offReb / (stats.offReb + oppDRB);
    const lgORB = 0.28;
    const orbBoost = (matchupOrbPct - lgORB) * 6.0;

    const ftaRateVal = stats.ftaRate || 0.34;
    const lgFTR = 0.34;
    const ftrBoost = (ftaRateVal - lgFTR) * 3.5;

    const rawBoost = eFGboost + Math.max(-2.5, Math.min(2.5, toBoost)) + orbBoost + ftrBoost;
    return rawBoost * tempoScale;
  };
  const homeFFactors = fourFactorsBoost(homeStats, awayStats.defReb);
  const awayFFactors = fourFactorsBoost(awayStats, homeStats.defReb);

  // ── F8: Defensive quality — oppFGpct removed (already in adjDE) ──
  const defBoost = (stats) => {
    const oppThreeDiff = 0.330 - (stats.oppThreePct || 0.330);
    const disruption = ((stats.steals || 7.0) - 7.0) * 0.08 + ((stats.blocks || 3.5) - 3.5) * 0.06;
    return oppThreeDiff * 3.0 + disruption;
  };
  const homeDefBoost = defBoost(homeStats);
  const awayDefBoost = defBoost(awayStats);

  // ── Ball control + F11: turnover margin ──
  const homeATO = (homeStats.atoRatio || 1.2) - 1.2;
  const awayATO = (awayStats.atoRatio || 1.2) - 1.2;
  const atoBoost = (homeATO - awayATO) * 0.5;
  const toMarginHome = (homeStats.steals || 7.0) - (homeStats.turnovers || 12.0);
  const toMarginAway = (awayStats.steals || 7.0) - (awayStats.turnovers || 12.0);
  const toMarginBoost = (toMarginHome - toMarginAway) * 0.08;

  // ── Core score projection ──
  const homeOffVsAwayDef = (homeAdjOE / lgAvgOE) * (lgAvgOE / awayAdjDE) * lgAvgOE;
  const awayOffVsHomeDef = (awayAdjOE / lgAvgOE) * (lgAvgOE / homeAdjDE) * lgAvgOE;
  let homeScore = (homeOffVsAwayDef / 100) * possessions
    + homeFFactors * 0.35 + homeDefBoost * 0.20 + atoBoost * 0.5 + toMarginBoost * 0.5;
  let awayScore = (awayOffVsHomeDef / 100) * possessions
    + awayFFactors * 0.35 + awayDefBoost * 0.20 - atoBoost * 0.5 - toMarginBoost * 0.5;

  // ── Home court advantage ──
  const hcaBase = neutralSite ? 0 : (CONF_HCA[homeStats.conferenceName] || DEFAULT_HCA);
  const splitAdj = (!neutralSite && homeSplits?.homeAvgMargin != null)
    ? Math.min(2.5, Math.max(-2.5, (homeSplits.homeAvgMargin - (homeStats.ppgDiff || 0)) * 0.25))
    : 0;
  const hca = hcaBase + splitAdj;
  homeScore += hca / 2;
  awayScore -= hca / 2;

  // ── F15: Continuous exponential rank boost ──
  const homeRank = homeStats.rank || 200;
  const awayRank = awayStats.rank || 200;
  const rankBoost = (rank) => rank > 50 ? 0 : Math.max(0, 1.2 * Math.exp(-rank / 15));
  homeScore += rankBoost(homeRank) * 0.3;
  awayScore += rankBoost(awayRank) * 0.3;

  // ── Recent form ──
  const formWeight = Math.min(0.10, 0.10 * Math.sqrt(Math.min(homeStats.totalGames, 30) / 30));
  homeScore += homeStats.formScore * formWeight * 4.0;
  awayScore += awayStats.formScore * formWeight * 4.0;

  // F16: Widened clamp [35, 130]
  homeScore = Math.max(35, Math.min(130, homeScore));
  awayScore = Math.max(35, Math.min(130, awayScore));

  const projectedSpread = homeScore - awayScore;
  // F9: Configurable sigma
  let homeWinPct = 1 / (1 + Math.pow(10, -projectedSpread / sigma));
  homeWinPct = Math.min(0.97, Math.max(0.03, homeWinPct));
  if (calibrationFactor !== 1.0) {
    homeWinPct = Math.min(0.97, Math.max(0.03, 0.5 + (homeWinPct - 0.5) * calibrationFactor));
  }

  const spread = parseFloat(projectedSpread.toFixed(1));
  const modelML_home = homeWinPct >= 0.5
    ? -Math.round((homeWinPct / (1 - homeWinPct)) * 100)
    : +Math.round(((1 - homeWinPct) / homeWinPct) * 100);
  const modelML_away = homeWinPct >= 0.5
    ? +Math.round(((1 - homeWinPct) / homeWinPct) * 100)
    : -Math.round((homeWinPct / (1 - homeWinPct)) * 100);

  const decisiveness = Math.abs(homeWinPct - 0.5) * 100;
  const decisivenessLabel = decisiveness >= 15 ? "STRONG" : decisiveness >= 7 ? "MODERATE" : "LEAN";

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
    decisiveness: parseFloat(decisiveness.toFixed(1)),
    decisivenessLabel,
    possessions: parseFloat(possessions.toFixed(1)),
    homeAdjEM: parseFloat(homeStats.adjEM?.toFixed(2)),
    awayAdjEM: parseFloat(awayStats.adjEM?.toFixed(2)),
    emDiff: parseFloat((homeStats.adjEM - awayStats.adjEM).toFixed(2)),
    neutralSite,
    toMarginDiff: parseFloat((toMarginHome - toMarginAway).toFixed(2)),
  };
}

// ── F26: Improved odds matching ──
export function matchNCAAOddsToGame(oddsGame, espnGame) {
  const normalize = s => s?.toLowerCase().replace(/[^a-z0-9]/g, "") || "";
  const h1 = normalize(oddsGame.homeTeam), h2 = normalize(espnGame.homeTeamName || espnGame.homeAbbr);
  const a1 = normalize(oddsGame.awayTeam), a2 = normalize(espnGame.awayTeamName || espnGame.awayAbbr);
  const minLen = 5;
  const match = (s1, s2) => {
    if (!s1 || !s2) return false;
    const sub = Math.min(minLen, s1.length, s2.length);
    return s1.includes(s2.slice(0, sub)) || s2.includes(s1.slice(0, sub));
  };
  if (match(h1, h2) && match(a1, a2)) return true;
  return false;
}
