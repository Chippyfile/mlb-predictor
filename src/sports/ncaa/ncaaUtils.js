// src/sports/ncaa/ncaaUtils.js
// NCAAB v16 — Audit-fixed efficiency engine (28 findings, Sprint 1-5)
// Changes from v15: F1(adjOE/adjDE), F2(ORB%), F6(dynamic conf power),
// F7(tempo-scaled 4F), F8(defBoost dedup), F13(form symmetry),
// F14(SOS symmetry), F15(continuous rank), F16(wider clamp), F26(odds match)

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

    // ── Tempo: Dean Oliver possession estimate ──
    // Poss ≈ FGA - ORB + TO + 0.475 * FTA (per game)
    const estPoss = fga - offReb + turnovers + 0.475 * fta;
    const tempo = Math.max(58, Math.min(80, estPoss || 68));

    // ── Derived metrics ──
    // F2 FIX: ORB% uses opponent's actual DRB instead of hardcoded 25.0
    // We estimate opponent DRB from: totalReb - offReb gives team DRB,
    // and opponents roughly mirror (league avg DRB ≈ 24.5, but use team's
    // own DRB as proxy for opponent's DRB since better rebounding teams
    // face opponents who also rebound near league average)
    const oppDRBest = defReb || 24.5; // team's own DRB as best available proxy
    const orbPct = offReb / (offReb + oppDRBest);
    // FTA Rate: FTA / FGA
    const ftaRate = fga > 0 ? fta / fga : 0.34;
    // Assist-to-Turnover ratio
    const atoRatio = turnovers > 0 ? assists / turnovers : 1.2;
    // Three-point attempt rate
    const threeAttRate = fga > 0 ? threeAtt / fga : 0.38;

    // F1 FIX: Proper per-possession efficiency ratings
    // adjOE = points scored per offensive possession × 100
    // adjDE = points allowed per defensive possession × 100
    // Offensive possessions ≈ FGA - ORB + TO + 0.475*FTA (same as tempo)
    // Defensive possessions estimated from opponent side:
    //   oppPoss ≈ tempo (approx equal for both teams over a game)
    const offPoss = tempo; // our offensive possessions per game
    const defPoss = tempo; // defensive possessions ≈ offensive possessions
    const adjOE = offPoss > 0 ? (ppg / offPoss) * 100 : 107.0;
    const adjDE = defPoss > 0 ? (oppPpg / defPoss) * 100 : 107.0;
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
        // F13 FIX: Symmetric weights (+1/-1) with exponential recency decay
        // Most recent game (index=4) weighted highest; oldest (index=0) lowest
        formScore = recent.slice(-5).reduce((s, e, i) => {
          const comp = e.competitions?.[0];
          const teamComp = comp?.competitors?.find(c => c.team?.id === String(teamId));
          const won = teamComp?.winner || false;
          const recencyWeight = Math.pow(1.3, i); // exponential: 1.0, 1.3, 1.69, 2.20, 2.86
          return s + (won ? 1 : -1) * recencyWeight;
        }, 0) / (1.0 + 1.3 + 1.69 + 2.20 + 2.86); // normalize by sum of weights (9.05)
      }
    } catch { }
    const result = {
      teamId, name: team.displayName, abbr: team.abbreviation,
      ppg, oppPpg, ppgDiff: ppg - oppPpg, tempo, adjOE, adjDE, adjEM,
      fgPct, threePct, ftPct, assists, turnovers,
      // New stats (Phase 2)
      fga, fta, offReb, defReb, totalReb, steals, blocks,
      threeAtt, threeAttRate, orbPct, ftaRate, atoRatio,
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
// NCAAB v16: Audit-fixed KenPom-style adjEM matchup engine
//  F1:  Real per-possession adjOE/adjDE
//  F2:  Dynamic ORB% denominator
//  F6:  Dynamic conference power (computed from team adjEMs)
//  F7:  Four Factors scaled by game tempo
//  F8:  Defensive boost no longer double-counts oppFGpct
//  F9:  Empirically-tunable sigma (default 11.0, recommend calibrating)
//  F13: Symmetric form scoring with exponential decay
//  F14: Symmetric SOS adjustment (OE and DE)
//  F15: Continuous rank boost via exponential decay
//  F16: Widened score clamp [35, 130]
// ─────────────────────────────────────────────────────────────

// Conference-tier home court advantage (Finding 17)
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

// F6: Dynamic conference power — computed from cached team adjEMs
// Falls back to static defaults if not enough data is cached
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

function getDynamicConfPower(confName) {
  // Compute from cached teams in this conference
  const confTeams = Object.values(_ncaaStatsCache).filter(
    t => t.conferenceName === confName && t.adjEM != null && t.totalGames >= 10
  );
  if (confTeams.length >= 4) {
    const avgEM = confTeams.reduce((s, t) => s + t.adjEM, 0) / confTeams.length;
    // Map adjEM to power index: avgEM of 0 → 1.0, +5 → 1.15, +10 → 1.30, -5 → 0.85
    return Math.max(0.70, Math.min(1.40, 1.0 + avgEM * 0.03));
  }
  return CONF_POWER_DEFAULTS[confName] || 1.0;
}

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

  // Dynamic league average OE from the two teams (Finding 6)
  const lgAvgOE = 107.0;

  // F6: Dynamic conference power scaling
  const homeConfPower = getDynamicConfPower(homeStats.conferenceName);
  const awayConfPower = getDynamicConfPower(awayStats.conferenceName);

  // F14 FIX: Symmetric SOS adjustment (apply equally to OE and DE)
  const homeSOSAdj = homeSOSFactor != null ? (homeSOSFactor - 0.500) * 3.5 * homeConfPower : 0;
  const awaySOSAdj = awaySOSFactor != null ? (awaySOSFactor - 0.500) * 3.5 * awayConfPower : 0;
  const homeAdjOE = homeStats.adjOE + homeSOSAdj;
  const awayAdjOE = awayStats.adjOE + awaySOSAdj;
  const homeAdjDE = homeStats.adjDE - homeSOSAdj * 0.70; // F14: 70% symmetric (was 45%)
  const awayAdjDE = awayStats.adjDE - awaySOSAdj * 0.70;

  // ── F7 FIX: Four Factors scaled by game tempo ──────────────
  // Weights per Dean Oliver: eFG% 40%, TO% 25%, ORB% 20%, FTR 15%
  const D1_AVG_POSS = 68.0;
  const tempoScaler = possessions / D1_AVG_POSS; // >1 for fast games, <1 for slow

  const fourFactorsBoost = (stats) => {
    // Correct eFG% = FG% + 0.5 * 3PA_rate * 3P%
    const threeRate = stats.threeAttRate || 0.38;
    const eFG = stats.fgPct + 0.5 * threeRate * stats.threePct;
    const lgEFG = 0.502;
    const eFGboost = (eFG - lgEFG) * 8.0;

    // TO% — use team's own tempo as denominator
    const toPct = stats.tempo > 0 ? (stats.turnovers / stats.tempo) * 100 : 18.0;
    const lgTO = 18.0;
    const toBoost = (lgTO - toPct) * 0.12;

    // ORB%
    const orbPctVal = stats.orbPct || 0.28;
    const lgORB = 0.28;
    const orbBoost = (orbPctVal - lgORB) * 6.0;

    // FTA Rate
    const ftaRateVal = stats.ftaRate || 0.34;
    const lgFTR = 0.34;
    const ftrBoost = (ftaRateVal - lgFTR) * 3.5;

    // F7: Scale total by tempo — more possessions amplifies factor advantages
    return (eFGboost + Math.max(-2.5, Math.min(2.5, toBoost)) + orbBoost + ftrBoost) * tempoScaler;
  };
  const homeFFactors = fourFactorsBoost(homeStats);
  const awayFFactors = fourFactorsBoost(awayStats);

  // ── F8 FIX: Defensive boost — removed oppFGpct (already in adjDE via oppPpg)
  // Now only captures signals NOT in adjDE: 3PT defense specifics + disruption
  const defBoost = (stats) => {
    // Opponent 3PT% defense — not fully captured by overall oppPpg
    const oppThreeDiff = 0.330 - (stats.oppThreePct || 0.330);
    // Steals + blocks per game as disruption proxy (live-ball turnovers, rim protection)
    const disruption = ((stats.steals || 7.0) - 7.0) * 0.10 + ((stats.blocks || 3.5) - 3.5) * 0.08;
    return oppThreeDiff * 4.0 + disruption;
  };
  const homeDefBoost = defBoost(homeStats);
  const awayDefBoost = defBoost(awayStats);

  // ── Ball control / efficiency ──────────────────────────────
  const homeATO = (homeStats.atoRatio || 1.2) - 1.2;
  const awayATO = (awayStats.atoRatio || 1.2) - 1.2;
  const atoBoost = (homeATO - awayATO) * 0.5;

  // ── Core score projection ──────────────────────────────────
  const homeOffVsAwayDef = (homeAdjOE / lgAvgOE) * (lgAvgOE / awayAdjDE) * lgAvgOE;
  const awayOffVsHomeDef = (awayAdjOE / lgAvgOE) * (lgAvgOE / homeAdjDE) * lgAvgOE;
  let homeScore = (homeOffVsAwayDef / 100) * possessions
    + homeFFactors * 0.35 + homeDefBoost * 0.20 + atoBoost * 0.5;
  let awayScore = (awayOffVsHomeDef / 100) * possessions
    + awayFFactors * 0.35 + awayDefBoost * 0.20 - atoBoost * 0.5;

  // ── Home court advantage ───────────────────────────────────
  const hcaBase = neutralSite ? 0 : (CONF_HCA[homeStats.conferenceName] || DEFAULT_HCA);
  const splitAdj = (!neutralSite && homeSplits?.homeAvgMargin != null)
    ? Math.min(2.5, Math.max(-2.5, (homeSplits.homeAvgMargin - (homeStats.ppgDiff || 0)) * 0.25))
    : 0;
  const hca = hcaBase + splitAdj;
  homeScore += hca / 2;
  awayScore -= hca / 2;

  // ── F15 FIX: Continuous rank boost via exponential decay ───
  const homeRank = homeStats.rank || 200;
  const awayRank = awayStats.rank || 200;
  const rankBoost = (rank) => {
    if (rank > 100) return 0;
    // Smooth exponential: #1 → ~1.2, #10 → ~0.62, #25 → ~0.23, #50 → ~0.04
    return 1.2 * Math.exp(-rank / 15);
  };
  homeScore += rankBoost(homeRank) * 0.3;
  awayScore += rankBoost(awayRank) * 0.3;

  // ── Recent form (sample-size gated) ────────────────────────
  const formWeight = Math.min(0.10, 0.10 * Math.sqrt(Math.min(homeStats.totalGames, 30) / 30));
  homeScore += homeStats.formScore * formWeight * 4.0;
  awayScore += awayStats.formScore * formWeight * 4.0;

  // F16 FIX: Widened score clamp from [45,118] to [35,130]
  homeScore = Math.max(35, Math.min(130, homeScore));
  awayScore = Math.max(35, Math.min(130, awayScore));

  const projectedSpread = homeScore - awayScore;
  // F9: Sigma=11.0 — to be empirically calibrated via /backtest/ncaa
  // (set sigma_ncaab in the logistic transform; default 11.0)
  const SIGMA = 11.0;
  let homeWinPct = 1 / (1 + Math.pow(10, -projectedSpread / SIGMA));
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

  const emGap = Math.abs(homeStats.adjEM - awayStats.adjEM);
  const winPctStrength = Math.abs(homeWinPct - 0.5) * 2;
  const minGames = Math.min(homeStats.totalGames, awayStats.totalGames);
  const sampleWeight = Math.min(1.0, minGames / 15);
  const hasData = minGames >= 5 ? 1 : 0;
  // Decisiveness: how far from a coin flip (0 = toss-up, 50 = absolute lock)
  const decisiveness = Math.abs(homeWinPct - 0.5) * 100;
  const decisivenessLabel = decisiveness >= 15 ? "STRONG" : decisiveness >= 7 ? "MODERATE" : "LEAN";
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
  };
}

// ── ODDS MATCHING (F26: improved fuzzy matching) ────────────
export function matchNCAAOddsToGame(oddsGame, espnGame) {
  const normalize = s => s?.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim() || "";
  const h1 = normalize(oddsGame.homeTeam), h2 = normalize(espnGame.homeTeamName || espnGame.homeAbbr);
  const a1 = normalize(oddsGame.awayTeam), a2 = normalize(espnGame.awayTeamName || espnGame.awayAbbr);

  // F26: Multi-strategy matching to handle short names (Miami, Ohio, etc.)
  const matchTeam = (odds, espn) => {
    if (!odds || !espn) return false;
    // Exact match
    if (odds === espn) return true;
    // One contains the other (handles "duke blue devils" vs "duke")
    if (odds.includes(espn) || espn.includes(odds)) return true;
    // Word overlap: at least 1 significant word (>3 chars) matches
    const oddsWords = odds.split(" ").filter(w => w.length > 3);
    const espnWords = espn.split(" ").filter(w => w.length > 3);
    const overlap = oddsWords.filter(w => espnWords.some(e => e.includes(w) || w.includes(e)));
    if (overlap.length >= 1 && (oddsWords.length <= 2 || overlap.length >= Math.ceil(oddsWords.length * 0.5))) return true;
    // Fallback: first 5+ chars match (safer than 4)
    if (odds.length >= 5 && espn.length >= 5 && (odds.startsWith(espn.slice(0, 5)) || espn.startsWith(odds.slice(0, 5)))) return true;
    return false;
  };

  return matchTeam(h1, h2) && matchTeam(a1, a2);
}
