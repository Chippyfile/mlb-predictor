// src/sports/ncaa/ncaaUtils.js
// NCAAB v21 — Cross-Sport Alignment (v20.1 → v21)
//
// v21 alignment fixes:
//   ALIGN-6: Removed oppThreePct from defBoost (same double-count as oppFGpct F8 fix)
//            NBA-M8 already removed all opponent shooting — NCAA now aligns
//   ALIGN-7: True Shooting % signal ported from NBA-04 (0.05 weight, NCAA lgTS=0.540)
//   ALIGN-8: O/U shrink factor 0.975 added (NCAA 30-game sample needs more regression
//            than NBA's 82-game 0.984)
//
// Changelog v18→v20.1:
//   V20-1: getStat() upgraded to variadic (...names) — matches NBA/NFL pattern
//   V20-2: oppPpg 3-tier resolution: ESPN stat → schedule computation → 72.0 fallback
//          Fixed: robust score parser handles ESPN dict/string/number score formats
//   V20-3: All 4 ESPN fetches (team, record, schedule, statistics) in single Promise.all
//   V20-4: ESPN's estimatedPossessions + pointsPerEstimatedPossessions wired for real tempo/efficiency
//   V20-5: applyKenPomRatings now backfills oppPpg from Railway adj_opp_ppg when ESPN lacks it
//   V20-6: Diagnostic logging enhanced with oppPpg source + possession source tracking
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
// Changelog v16→v18 (Phase 1):
//   P1-INJ:  detectMissingStarters() — injury/roster detection from ESPN summary
//   P1-CTX:  getGameContext() — tournament context flags (conf tourney, NCAA, bubble)
//   P1-SIG:  calculateDynamicSigma() — dynamic sigma by season/conference/quality
//   P1-PAR:  batchProcess() — parallel batch processing with concurrency limit
//   P1-CACHE: createTTLCache() — TTL-based stats cache (replaces indefinite cache)

const _ncaaStatsCache = {};

function espnFetch(path) {
  return fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/${path}`)
    .then(r => r.ok ? r.json() : null).catch(() => null);
}

export async function fetchNCAATeamStats(teamId) {
  if (!teamId) return null;
  if (_ncaaStatsCache[teamId]) return _ncaaStatsCache[teamId];
  try {
    // V20-3: All 4 ESPN API calls in parallel (was 2 parallel + 2 sequential)
    const [teamData, recordData, schedData, statsData] = await Promise.all([
      espnFetch(`teams/${teamId}`),
      espnFetch(`teams/${teamId}/record`),
      espnFetch(`teams/${teamId}/schedule`),
      espnFetch(`teams/${teamId}/statistics`),
    ]);
    if (!teamData) return null;
    const team = teamData.team;
    const stats = statsData?.results?.stats?.categories || [];
    // V20-1: Variadic getStat — try multiple stat name variants (matches NBA/NFL pattern)
    const getStat = (...names) => {
      for (const cat of stats) {
        for (const name of names) {
          const s = cat.stats?.find(st => st.name === name || st.abbreviation === name || st.displayName?.toLowerCase() === name.toLowerCase());
          if (s) { const v = parseFloat(s.value); return isNaN(v) ? null : v; }
        }
      }
      return null;
    };

    // V20-2: Robust score parser — ESPN returns score as string, number, or dict
    // Railway Python has same fix: score can be {"displayValue":"75","value":75.0}
    const parseScore = (s) => {
      if (s == null) return NaN;
      if (typeof s === 'object') return parseInt(s.displayValue || s.value || 0);
      return parseInt(s);
    };

    const ppg = getStat("avgPoints", "pointsPerGame") || 75.0;

    // V20-2: oppPpg — 3-tier resolution
    // Tier 1: ESPN stat (unlikely for NCAAB but try anyway)
    // Tier 2: Compute from completed schedule games
    // Tier 3: Fallback 72.0 (will be overridden by KenPom in applyKenPomRatings)
    let oppPpg = getStat("avgPointsAllowed", "opponentPointsPerGame", "avgPointsAgainst", "pointsAgainstPerGame", "scoringDefenseAverage");
    let _oppPpgSource = oppPpg != null ? "ESPN_STAT" : "NONE";
    if (oppPpg == null && schedData?.events) {
      try {
        const completed = schedData.events.filter(e => e.competitions?.[0]?.status?.type?.completed);
        let totalOppPts = 0, validGames = 0;
        // One-shot debug: log first competitor structure
        let _debugLogged = false;
        for (const ev of completed) {
          const comp = ev.competitions?.[0];
          const competitors = comp?.competitors || [];
          if (!_debugLogged && competitors.length >= 2) {
            console.log(`🔍 NCAA sched structure [${teamId}]:`, {
              n_competitors: competitors.length,
              c0_teamId: competitors[0]?.team?.id,
              c0_teamIdType: typeof competitors[0]?.team?.id,
              c0_score: competitors[0]?.score,
              c0_scoreType: typeof competitors[0]?.score,
              c1_teamId: competitors[1]?.team?.id,
              c1_score: competitors[1]?.score,
              ourTeamId: teamId,
              ourTeamIdType: typeof teamId,
            });
            _debugLogged = true;
          }
          // Find opponent: use same pattern as form score (line ~123 in v18)
          // Match our team first, then take the other competitor
          const ourComp = competitors.find(c => String(c.team?.id) === String(teamId));
          const oppComp = competitors.find(c => String(c.team?.id) !== String(teamId));
          if (oppComp) {
            const score = parseScore(oppComp.score);
            if (!isNaN(score) && score > 0) {
              totalOppPts += score;
              validGames++;
            }
          }
        }
        if (validGames >= 3) {
          oppPpg = totalOppPts / validGames;
          _oppPpgSource = "SCHEDULE_CALC";
          console.log(`✅ NCAA oppPpg [${team.abbreviation || teamId}]: ${oppPpg.toFixed(1)} from ${validGames} games`);
        } else {
          console.warn(`⚠️ NCAA oppPpg [${team.abbreviation || teamId}]: only ${validGames} valid games from ${completed.length} completed, using fallback`);
        }
      } catch (schedErr) {
        console.warn(`⚠️ NCAA oppPpg schedule fallback failed [${teamId}]:`, schedErr.message);
      }
    }
    if (oppPpg == null) {
      oppPpg = 72.0;
      _oppPpgSource = "FALLBACK";
    }

    const normPct = (v, fallback) => { const p = (v != null && v !== 0) ? v : fallback; return p > 1 ? p / 100 : p; };
    const fgPct = normPct(getStat("fieldGoalPct"), 0.455);
    const threePct = normPct(getStat("threePointFieldGoalPct"), 0.340);
    const ftPct = normPct(getStat("freeThrowPct"), 0.720);
    const assists = getStat("avgAssists") || 14.0;
    const turnovers = getStat("avgTurnovers") || 12.0;

    // Pre-compute games played for converting season totals to per-game if needed
    const totalGamesForAvg = (recordData?.items?.[0]?.stats?.find(s => s.name === "wins")?.value || 0)
      + (recordData?.items?.[0]?.stats?.find(s => s.name === "losses")?.value || 0);
    const wins = recordData?.items?.[0]?.stats?.find(s => s.name === "wins")?.value || 0;
    const losses = recordData?.items?.[0]?.stats?.find(s => s.name === "losses")?.value || 0;
    const totalGames = wins + losses;

    // ── Additional stats for Four Factors, defensive metrics, tempo ──
    const fga = getStat("avgFieldGoalsAttempted") || (() => {
      const total = getStat("fieldGoalsAttempted");
      return (total && totalGamesForAvg > 0) ? total / totalGamesForAvg : 58.0;
    })();
    const fta = getStat("avgFreeThrowsAttempted") || (() => {
      const total = getStat("freeThrowsAttempted");
      return (total && totalGamesForAvg > 0) ? total / totalGamesForAvg : 20.0;
    })();
    const offReb = getStat("avgOffensiveRebounds", "offensiveReboundsPerGame") || 10.0;
    const defReb = getStat("avgDefensiveRebounds", "defensiveReboundsPerGame") || 24.0;
    const totalReb = getStat("avgRebounds", "reboundsPerGame") || (offReb + defReb);
    const steals = getStat("avgSteals", "stealsPerGame") || 7.0;
    const blocks = getStat("avgBlocks", "blocksPerGame") || 3.5;
    const threeAtt = getStat("avgThreePointFieldGoalsAttempted") || (() => {
      const total = getStat("threePointFieldGoalsAttempted");
      return (total && totalGamesForAvg > 0) ? total / totalGamesForAvg : (fga * 0.38);
    })();

    // Opponent defensive stats (if available from ESPN)
    const oppFGpct = normPct(getStat("opponentFieldGoalPct"), 0.430);
    const oppThreePct = normPct(getStat("opponentThreePointFieldGoalPct"), 0.330);

    // ── V20-4: ESPN real possessions — use estimatedPossessions when available ──
    // hoopR docs confirm ESPN provides: estimatedPossessions, avgEstimatedPossessions,
    // pointsPerEstimatedPossessions in the offensive stats category.
    const espnPoss = getStat("avgEstimatedPossessions", "estimatedPossessions");
    const espnPtsPer100 = getStat("pointsPerEstimatedPossessions");

    // F1: Possession estimate — prefer ESPN's real value, fall back to Dean Oliver
    const deanOliverPoss = fga - offReb + turnovers + 0.482 * fta; // AUDIT FIX 6
    let offPoss, _possSource;
    if (espnPoss != null && espnPoss > 40 && espnPoss < 90) {
      offPoss = espnPoss;
      _possSource = "ESPN_REAL";
    } else {
      offPoss = deanOliverPoss;
      _possSource = "DEAN_OLIVER";
    }
    const tempo = Math.max(58, Math.min(80, offPoss || 68));

    // ── V20-4: Efficiency — prefer ESPN's pointsPerEstimatedPossessions ──
    let adjOE, adjDE, _effSource;
    if (espnPtsPer100 != null && espnPtsPer100 > 0.5 && espnPtsPer100 < 1.5) {
      adjOE = espnPtsPer100 * 100;
      adjDE = tempo > 0 ? (oppPpg / tempo) * 100 : 107.0;
      _effSource = "ESPN_PPP";
    } else {
      adjOE = tempo > 0 ? (ppg / tempo) * 100 : 107.0;
      adjDE = tempo > 0 ? (oppPpg / tempo) * 100 : 107.0;
      _effSource = "CALC";
    }
    const adjEM = adjOE - adjDE;

    // ── F2: ORB% with league-avg DRB fallback (matchup-specific in predict) ──
    const lgAvgDRB = 24.5;
    const orbPct = offReb / (offReb + lgAvgDRB);
    const ftaRate = fga > 0 ? fta / fga : 0.34;
    const atoRatio = turnovers > 0 ? assists / turnovers : 1.2;
    const threeAttRate = fga > 0 ? threeAtt / fga : 0.38;
    const stealToRatio = turnovers > 0 ? steals / turnovers : 0.58;

    // wins, losses, totalGames already declared above (lines ~148-150)

    // ── F13: Symmetric form score with exponential decay ──
    // V20-3: Uses schedData from Promise.all (was a separate sequential fetch)
    let formScore = 0;
    try {
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

    // ── V20-6: Enhanced diagnostic logging ──
    console.log(`🏀 NCAA STATS [${team.abbreviation || teamId}]:`, {
      ppg, oppPpg: parseFloat(oppPpg.toFixed(1)), oppPpgSource: _oppPpgSource,
      fga, fta, offReb, turnovers,
      offPoss: parseFloat(offPoss.toFixed(1)), possSource: _possSource,
      tempo, effSource: _effSource,
      adjOE: parseFloat(adjOE.toFixed(1)), adjDE: parseFloat(adjDE.toFixed(1)),
      adjEM: parseFloat(adjEM.toFixed(1)),
      _espn_poss: espnPoss, _espn_ppp: espnPtsPer100,
      _raw_oppPpg_stat: getStat("avgPointsAllowed", "opponentPointsPerGame", "avgPointsAgainst"),
    });
    if (ppg > 90 || oppPpg > 90 || adjOE > 135 || adjDE > 135 || fga > 80 || fga < 30) {
      console.warn(`⚠️ NCAA STATS ANOMALY [${team.abbreviation || teamId}]: Check values above`);
    }

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
    const data = await espnFetch(`scoreboard?dates=${compact}&groups=50&limit=500`);
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

  // ── Opponent-adjusted efficiency: 3-tier fallback ──
  // Tier 1: Railway KenPom ratings with home/away splits (best)
  // Tier 2: Railway KenPom ratings, overall values (good)
  // Tier 3: SOS regression on raw ESPN data (fallback)
  const homeOppAdj = homeStats._oppAdj || null;
  const awayOppAdj = awayStats._oppAdj || null;

  let homeAdjOE, awayAdjOE, homeAdjDE, awayAdjDE;

  if (homeOppAdj?.adjOE && awayOppAdj?.adjOE) {
    // ── KenPom available: use venue-aware splits when possible ──
    if (!neutralSite && homeOppAdj.homeOE != null && awayOppAdj.awayOE != null) {
      // Tier 1: Home team uses their home OE/DE, away team uses their away OE/DE
      // Blend: 65% venue-specific + 35% overall (venue splits are noisier due to
      // smaller sample sizes — typically 12-15 home games vs 29 total)
      const VENUE_BLEND = 0.65;
      homeAdjOE = homeOppAdj.homeOE * VENUE_BLEND + homeOppAdj.adjOE * (1 - VENUE_BLEND);
      awayAdjOE = awayOppAdj.awayOE * VENUE_BLEND + awayOppAdj.adjOE * (1 - VENUE_BLEND);
      homeAdjDE = (homeOppAdj.homeDE ?? homeOppAdj.adjDE) * VENUE_BLEND + homeOppAdj.adjDE * (1 - VENUE_BLEND);
      awayAdjDE = (awayOppAdj.awayDE ?? awayOppAdj.adjDE) * VENUE_BLEND + awayOppAdj.adjDE * (1 - VENUE_BLEND);
    } else {
      // Tier 2: Overall KenPom values (neutral site or no splits available)
      homeAdjOE = homeOppAdj.adjOE;
      awayAdjOE = awayOppAdj.adjOE;
      homeAdjDE = homeOppAdj.adjDE;
      awayAdjDE = awayOppAdj.adjDE;
    }
    // When using additive KenPom formula, keep values in KenPom scale (109.7 avg).
    // No rescaling needed — the additive formula handles the scale internally.
    // FIX #5: One-shot KenPom logging — prevent triple-logging per game.
    // ncaaPredictGame is called multiple times (display, ML payload, MC setup).
    const src = homeOppAdj.homeOE != null && !neutralSite ? 'KENPOM-VENUE' : 'KENPOM';
    const _logKey = `${homeStats.teamId}-${awayStats.teamId}`;
    if (!ncaaPredictGame._loggedGames) ncaaPredictGame._loggedGames = new Set();
    if (!ncaaPredictGame._loggedGames.has(_logKey)) {
      ncaaPredictGame._loggedGames.add(_logKey);
      console.log(`📊 ${src}: Home ${homeStats.abbr} OE=${homeAdjOE.toFixed(1)} DE=${homeAdjDE.toFixed(1)} | Away ${awayStats.abbr} OE=${awayAdjOE.toFixed(1)} DE=${awayAdjDE.toFixed(1)}`);
      // Clear after 60s to allow re-logging on page refresh
      setTimeout(() => ncaaPredictGame._loggedGames?.delete(_logKey), 60000);
    }
  } else {
    // Tier 3: SOS regression fallback (no KenPom data)
    const sosMultiplier = 3.5;
    const sosSplit = 0.70;
    const homeSOSAdj = homeSOSFactor != null ? (homeSOSFactor - 0.500) * sosMultiplier * homeConfPower : 0;
    const awaySOSAdj = awaySOSFactor != null ? (awaySOSFactor - 0.500) * sosMultiplier * awayConfPower : 0;
    homeAdjOE = homeStats.adjOE + homeSOSAdj * sosSplit;
    awayAdjOE = awayStats.adjOE + awaySOSAdj * sosSplit;
    homeAdjDE = homeStats.adjDE - homeSOSAdj * sosSplit;
    awayAdjDE = awayStats.adjDE - awaySOSAdj * sosSplit;
  }

  // ── F7: Four Factors scaled by tempo ──
  const tempoScale = possessions / lgAvgTempo;
  const fourFactorsBoost = (stats, opponentDefReb) => {
    const threeRate = stats.threeAttRate || 0.38;
    const eFG = stats.fgPct + 0.5 * threeRate * stats.threePct;
    const lgEFG = 0.502;
    const eFGboost = (eFG - lgEFG) * 10.0; // AUDIT F9: recalibrated to Dean Oliver 40% target weight

    const toPct = stats.tempo > 0 ? (stats.turnovers / stats.tempo) * 100 : 18.0;
    const lgTO = 18.0;
    const toBoost = (lgTO - toPct) * 0.08; // AUDIT F9: from 0.09 to 0.08 (Dean Oliver 25% target)

    // F2: Matchup-specific ORB% using opponent's actual DRB
    const oppDRB = opponentDefReb || 24.5;
    const matchupOrbPct = stats.offReb / (stats.offReb + oppDRB);
    const lgORB = 0.28;
    const orbBoost = (matchupOrbPct - lgORB) * 4.0; // AUDIT F9: from 5.5 to 4.0 (Dean Oliver 20% target)

    const ftaRateVal = stats.ftaRate || 0.34;
    const lgFTR = 0.34;
    const ftrBoost = (ftaRateVal - lgFTR) * 2.5; // AUDIT F9: from 3.0 to 2.5 (Dean Oliver 15% target)

    const rawBoost = eFGboost + Math.max(-2.5, Math.min(2.5, toBoost)) + orbBoost + ftrBoost;
    return rawBoost * tempoScale;
  };
  const homeFFactors = fourFactorsBoost(homeStats, awayStats.defReb);
  const awayFFactors = fourFactorsBoost(awayStats, homeStats.defReb);

  // ── F8 EXTENDED: Defensive quality — oppThreePct ALSO removed ──
  // ALIGN-6: oppThreePct is the same type of double-count as oppFGpct
  // (both captured in adjDE which feeds the core projection). NBA-M8
  // correctly removed ALL opponent shooting from defBoost. NCAA now aligns.
  // Keeping only disruption stats (steals/blocks) which measure active
  // defensive playmaking not reflected in efficiency ratings.
  const defBoost = (stats) => {
    const disruption = ((stats.steals || 7.0) - 7.0) * 0.08
                     + ((stats.blocks || 3.5) - 3.5) * 0.06;
    return disruption;
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

  // ── ALIGN-7: True Shooting % (ported from NBA-04) ──
  // TS% captures free throw conversion beyond what FTR measures (attempts only).
  // Weight at 0.05 to avoid overlap with eFG% in Four Factors.
  // Gracefully returns 0 if fga/fta not available from ESPN.
  const tsBoostCalc = (stats) => {
    if (!stats.fga || !stats.fta) return 0;
    const tsa = stats.fga + 0.44 * stats.fta;
    if (tsa <= 0) return 0;
    const ts = stats.ppg / (2 * tsa);
    const lgTS = 0.540;  // NCAA D1 average TS% (~54.0% vs NBA's ~57.8%)
    return Math.max(-2.5, Math.min(2.5, (ts - lgTS) * 15));
  };
  const homeTSBoost = tsBoostCalc(homeStats) * 0.05;
  const awayTSBoost = tsBoostCalc(awayStats) * 0.05;

  // ── Core score projection ──
  // Additive formula: predicted efficiency = teamOE + oppDE - lgAvg
  // This is how KenPom projects games. The multiplicative formula
  // (OE/lg * lg/DE * lg) inflates when both teams are above average.
  // KenPom path uses 109.7 league avg; SOS path uses lgAvgOE (107.0).
  const usingKenPom = !!(homeOppAdj?.adjOE && awayOppAdj?.adjOE);
  const additiveLgAvg = usingKenPom ? 109.7 : lgAvgOE;
  const homeOffVsAwayDef = homeAdjOE + awayAdjDE - additiveLgAvg;
  const awayOffVsHomeDef = awayAdjOE + homeAdjDE - additiveLgAvg;

  // FIX 3: Amplify supplementary boosts for blowout matchups (EM gap >= 15).
  // In competitive games, conservative multipliers (0.35, 0.20) prevent noise
  // from dominating. But in blowouts, these same caps mean the model can't
  // accumulate enough signal to match Vegas spreads of 20-30+ pts.
  // Gate on EM gap (available pre-projection) rather than win probability
  // to avoid chicken-and-egg dependency.
  const homeEM = homeStats._kenPomEM ?? homeStats.adjEM ?? 0;
  const awayEM = awayStats._kenPomEM ?? awayStats.adjEM ?? 0;
  const emGap = Math.abs(homeEM - awayEM);
  // Scale factor: 1.0 for EM gap < 15, ramps to 1.5 at EM gap 30+
  // Smooth ramp avoids a hard discontinuity at the threshold
  const blowoutScale = emGap >= 15 ? Math.min(1.5, 1.0 + (emGap - 15) / 30) : 1.0;

  let homeScore = (homeOffVsAwayDef / 100) * possessions
    + homeFFactors * 0.35 * blowoutScale + homeDefBoost * 0.20 * blowoutScale + atoBoost * 0.5 + toMarginBoost * 0.5
    + homeTSBoost;  // ALIGN-7
  let awayScore = (awayOffVsHomeDef / 100) * possessions
    + awayFFactors * 0.35 * blowoutScale + awayDefBoost * 0.20 * blowoutScale - atoBoost * 0.5 - toMarginBoost * 0.5
    + awayTSBoost;  // ALIGN-7

  // ── Home court advantage ──
  // When using venue-aware KenPom splits, the home OE/DE already captures
  // most of the home court effect. Apply only a reduced HCA to avoid double-counting.
  const hcaBase = neutralSite ? 0 : (CONF_HCA[homeStats.conferenceName] || DEFAULT_HCA);
  const splitAdj = (!neutralSite && homeSplits?.homeAvgMargin != null)
    ? Math.min(2.5, Math.max(-2.5, (homeSplits.homeAvgMargin - (homeStats.ppgDiff || 0)) * 0.25))
    : 0;
  const venueAlreadyApplied = usingKenPom && homeOppAdj.homeOE != null && !neutralSite;
  const hcaScale = venueAlreadyApplied ? 0.35 : 1.0;  // 35% HCA when venue splits active
  const hca = (hcaBase + splitAdj) * hcaScale;
  homeScore += hca / 2;
  awayScore -= hca / 2;

  // ── F15: Continuous exponential rank boost ──
  const homeRank = homeStats.rank || 200;
  const awayRank = awayStats.rank || 200;
  const rankBoost = (rank) => rank > 50 ? 0 : Math.max(0, 1.2 * Math.exp(-rank / 15));
  homeScore += rankBoost(homeRank) * 0.3;
  awayScore += rankBoost(awayRank) * 0.3;

  // ── Recent form (F12 FIX: per-team weights, matches NBA AUDIT L1 pattern) ──
  const homeFw = Math.min(0.10, 0.10 * Math.sqrt(Math.min(homeStats.totalGames || 0, 30) / 30));
  const awayFw = Math.min(0.10, 0.10 * Math.sqrt(Math.min(awayStats.totalGames || 0, 30) / 30));
  homeScore += homeStats.formScore * homeFw * 4.0;
  awayScore += awayStats.formScore * awayFw * 4.0;

  // ── Safety cap: prevent unrealistic game totals ──
  // NCAA D1 game totals rarely exceed 190 in actual results.
  // Totals above 190 indicate upstream data inflation (adjOE matchup formula
  // is spread-optimized and systematically inflates totals by ~35 pts).
  // FIX: Preserve the spread while capping the total. The old proportional
  // scaling (homeScore *= factor, awayScore *= factor) compressed spreads
  // in blowout matchups — e.g., a 30-pt spread could lose 1-2 pts.
  // New approach: keep spread intact, recenter around capped midpoint.
  const rawTotal = homeScore + awayScore;
  const maxRealisticTotal = 190;
  if (rawTotal > maxRealisticTotal) {
    const currentSpread = homeScore - awayScore;
    const cappedMidpoint = maxRealisticTotal / 2;
    homeScore = cappedMidpoint + currentSpread / 2;
    awayScore = cappedMidpoint - currentSpread / 2;
    console.warn(`⚠️ NCAA total ${rawTotal.toFixed(0)} capped to ${maxRealisticTotal} (spread preserved: ${currentSpread.toFixed(1)})`);
  }

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
  // FIX: Cap moneyline values at ±800 to prevent absurd display values
  // (matches NCAA CalendarTab ML_CAP and aligns with NBA pattern)
  const ML_CAP = 800;
  const modelML_home = homeWinPct >= 0.5
    ? -Math.min(ML_CAP, Math.round((homeWinPct / (1 - homeWinPct)) * 100))
    : +Math.min(ML_CAP, Math.round(((1 - homeWinPct) / homeWinPct) * 100));
  const modelML_away = homeWinPct >= 0.5
    ? +Math.min(ML_CAP, Math.round(((1 - homeWinPct) / homeWinPct) * 100))
    : -Math.min(ML_CAP, Math.round((homeWinPct / (1 - homeWinPct)) * 100));

  const decisiveness = Math.abs(homeWinPct - 0.5) * 100;
  // F14: Raised STRONG threshold from 15→20 for NCAAB (higher variance than pro leagues)
  const decisivenessLabel = decisiveness >= 20 ? "STRONG" : decisiveness >= 8 ? "MODERATE" : "LEAN";

  // ── CONFIDENCE = DATA QUALITY (how much info the model has) ──
  // AUDIT FIX: Previously mixed prediction strength (emGap, winPctStrength) into
  // confidence, causing HIGH confidence on lopsided games even when data was sparse.
  // Now matches MLB pattern: confidence is ONLY about data completeness, season progress,
  // and extra data sources. Decisiveness (how far from 50%) is computed separately.
  //
  // A 52% pick with HIGH confidence can be more valuable than an 80% pick with LOW
  // confidence — because you TRUST the 52% number enough to bet on the edge.
  const homeGames = homeStats._oppAdj?.totalGames || homeStats.totalGames;
  const awayGames = awayStats._oppAdj?.totalGames || awayStats.totalGames;
  const minGames = Math.min(homeGames, awayGames);

  // Component 1: Season maturity (0-25 pts) — more games = more stable stats
  const sampleWeight = Math.min(1.0, minGames / 25); // full credit at 25+ games
  const seasonPts = Math.round(sampleWeight * 25);

  // Component 2: Data completeness (0-30 pts) — which stat sources are available?
  const dataChecks = [
    homeStats.ppg > 0 && awayStats.ppg > 0,           // basic stats loaded
    homeStats.fgPct > 0 && awayStats.fgPct > 0,       // shooting stats
    homeStats.tempo > 0 && awayStats.tempo > 0,        // tempo available
    homeStats.oppPpg !== 72.0 || awayStats.oppPpg !== 72.0, // real defensive stats (not default)
    homeStats.formScore != null && awayStats.formScore != null, // form/trend data
    minGames >= 5,                                      // enough games for basic stats
  ];
  const dataScore = dataChecks.filter(Boolean).length / dataChecks.length;
  const dataPts = Math.round(dataScore * 30);

  // Component 3: KenPom/advanced ratings available (0-25 pts)
  const hasKenPom = !!(homeStats._kenPomEM != null && awayStats._kenPomEM != null);
  const hasVenueSplits = !!(homeStats._oppAdj?.homeOE && awayStats._oppAdj?.awayOE);
  const hasSOS = !!(homeStats.sos || awayStats.sos);
  const extraPts = (hasKenPom ? 15 : 0) + (hasVenueSplits ? 5 : 0) + (hasSOS ? 5 : 0);

  // Component 4: Base (20 pts) — minimum for any game with data
  const basePts = minGames >= 3 ? 20 : 10;

  const confScore = Math.min(100, basePts + seasonPts + dataPts + extraPts);
  const confidence = confScore >= 70 ? "HIGH" : confScore >= 45 ? "MEDIUM" : "LOW";

  // ── O/U Total: PPG-based estimation (separate from spread) ──
  // homeScore/awayScore are adjOE-matchup based, optimized for spread accuracy.
  // They systematically inflate totals by ~35 pts (model avg 186 vs actual 151.5).
  // F11 FIX: O/U uses KenPom additive formula (was averaging, same bug as Python Finding 1)
  // Averaging: (PPG + oppOppPPG) / 2 compresses spread and inflates weak team scores
  // Additive:  PPG + oppOppPPG - lgAvgPPG produces correct matchup-adjusted scores
  const NCAA_TOTAL_SHRINK = 0.975;
  const ouHCA = neutralSite ? 0 : 1.5;
  // Dynamic league PPG average — use team data if available, fallback 72.5
  const _allPpg = [homeStats.ppg, awayStats.ppg, homeStats.oppPpg, awayStats.oppPpg].filter(v => v > 0);
  const lgAvgPPG = _allPpg.length >= 4 ? (_allPpg.reduce((a, b) => a + b, 0) / _allPpg.length) : 72.5;
  const ouHomeScore = (homeStats.ppg + awayStats.oppPpg - lgAvgPPG + ouHCA / 2) * NCAA_TOTAL_SHRINK;
  const ouAwayScore = (awayStats.ppg + homeStats.oppPpg - lgAvgPPG - ouHCA / 2) * NCAA_TOTAL_SHRINK;
  const ouTotal = parseFloat(Math.max(100, ouHomeScore + ouAwayScore).toFixed(1));

  // Round spread-optimized scores for display (these still drive spread/ML)
  const finalHome = parseFloat(homeScore.toFixed(1));
  const finalAway = parseFloat(awayScore.toFixed(1));
  return {
    homeScore: finalHome,
    awayScore: finalAway,
    homeWinPct, awayWinPct: 1 - homeWinPct,
    projectedSpread: spread,
    ouTotal,  // PPG-based (NOT finalHome + finalAway which inflates totals by 35 pts)
    modelML_home, modelML_away, confidence, confScore,
    decisiveness: parseFloat(decisiveness.toFixed(1)),
    decisivenessLabel,
    possessions: parseFloat(possessions.toFixed(1)),
    homeAdjEM: parseFloat((homeStats._kenPomEM ?? homeStats.adjEM)?.toFixed(2)),
    awayAdjEM: parseFloat((awayStats._kenPomEM ?? awayStats.adjEM)?.toFixed(2)),
    emDiff: parseFloat(((homeStats._kenPomEM ?? homeStats.adjEM) - (awayStats._kenPomEM ?? awayStats.adjEM)).toFixed(2)),
    neutralSite,
    toMarginDiff: parseFloat((toMarginHome - toMarginAway).toFixed(2)),
    // KenPom metadata for display
    homeKenPomRank: homeStats._kenPomRank ?? null,
    awayKenPomRank: awayStats._kenPomRank ?? null,
    ratingsSource: homeOppAdj?.source === "kenpom-railway" ? "KenPom" : "SOS",
    venueAware: !!(homeOppAdj?.homeOE != null && !neutralSite),
  };
}

// ── F26: Improved odds matching (with home/away swap detection) ──
export function matchNCAAOddsToGame(oddsGame, espnGame) {
  const normalize = s => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const oddsH = normalize(oddsGame.homeTeam);
  const oddsA = normalize(oddsGame.awayTeam);
  const espnH = normalize(espnGame.homeTeamName || espnGame.homeAbbr);
  const espnA = normalize(espnGame.awayTeamName || espnGame.awayAbbr);
  const minLen = 5;
  const fuzzy = (s1, s2) => {
    if (!s1 || !s2) return false;
    const sub = Math.min(minLen, s1.length, s2.length);
    return s1.includes(s2.slice(0, sub)) || s2.includes(s1.slice(0, sub));
  };
  // Normal match: odds home = ESPN home, odds away = ESPN away
  if (fuzzy(oddsH, espnH) && fuzzy(oddsA, espnA)) return true;
  // Swapped match: odds home = ESPN away, odds away = ESPN home
  if (fuzzy(oddsH, espnA) && fuzzy(oddsA, espnH)) return true;
  return false;
}

// ── Normalize odds to match ESPN home/away designation ──
// Detects when The Odds API and ESPN disagree on home/away
// and flips ML, spread accordingly. Mirrors NBA swap logic.
export function normalizeNCAAOdds(rawOdds, espnGame) {
  if (!rawOdds) return null;
  const normalize = s => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const oddsHome = normalize(rawOdds.homeTeam);
  const espnHome = normalize(espnGame.homeTeamName || espnGame.homeAbbr);
  const espnAway = normalize(espnGame.awayTeamName || espnGame.awayAbbr);
  const minLen = 5;
  const fuzzy = (s1, s2) => {
    if (!s1 || !s2) return false;
    const sub = Math.min(minLen, s1.length, s2.length);
    return s1.includes(s2.slice(0, sub)) || s2.includes(s1.slice(0, sub));
  };
  const homeMatchesHome = fuzzy(oddsHome, espnHome);
  const homeMatchesAway = fuzzy(oddsHome, espnAway);
  const isSwapped = !homeMatchesHome && homeMatchesAway;
  if (isSwapped) {
    console.warn(`⚠️ NCAA ODDS SWAP: Odds="${rawOdds.homeTeam}" vs ESPN="${espnGame.homeTeamName}"`);
  }
  return {
    ...rawOdds,
    homeML: isSwapped ? rawOdds.awayML : rawOdds.homeML,
    awayML: isSwapped ? rawOdds.homeML : rawOdds.awayML,
    homeSpread: isSwapped ? -(rawOdds.marketSpreadHome ?? null) : (rawOdds.marketSpreadHome ?? null),
    marketSpreadHome: isSwapped ? -(rawOdds.marketSpreadHome ?? null) : (rawOdds.marketSpreadHome ?? null),
    ouLine: rawOdds.marketTotal ?? null,
    marketTotal: rawOdds.marketTotal ?? null,
    _swapped: isSwapped,
  };
}


// ═══════════════════════════════════════════════════════════════
// v18 PHASE 1 — New Functions
// ═══════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────
// P1-INJ: Injury/Roster Detection from ESPN Game Summary
// ─────────────────────────────────────────────────────────────
// ESPN's game summary endpoint contains player status/injury info.
// Single biggest missing signal per both internal + external audits.
// Impact: +2-4% accuracy on upset detection.
// ─────────────────────────────────────────────────────────────

export async function detectMissingStarters(gameId, homeTeamId, awayTeamId) {
  if (!gameId) return null;
  try {
    const response = await fetch(
      `https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/summary?event=${gameId}`
    );
    if (!response.ok) return null;
    const data = await response.json();

    const injuries = { home: [], away: [] };

    // Parse roster/players arrays from boxscore for OUT/Suspended status
    const boxPlayers = data?.boxscore?.players || [];
    for (const teamBlock of boxPlayers) {
      const teamId = String(teamBlock?.team?.id || "");
      const isHome = teamId === String(homeTeamId);
      const isAway = teamId === String(awayTeamId);
      if (!isHome && !isAway) continue;

      const side = isHome ? "home" : "away";
      const allStats = teamBlock?.statistics || [];
      for (const statGroup of allStats) {
        const athletes = statGroup?.athletes || [];
        for (const athlete of athletes) {
          const status = athlete?.athlete?.status?.type || "";
          const injuryStatus = athlete?.athlete?.injuries?.[0]?.status || "";
          const displayName = athlete?.athlete?.displayName || "Unknown";
          const starter = athlete?.starter || false;

          if (
            status === "OUT" || status === "out" ||
            injuryStatus === "Out" || injuryStatus === "out" ||
            injuryStatus === "Suspended"
          ) {
            injuries[side].push({
              name: displayName,
              isStarter: starter,
              status: status || injuryStatus,
            });
          }
        }
      }
    }

    // Fallback: parse gameInfo notes/headlines for injury mentions
    const gameNotes = data?.header?.competitions?.[0]?.notes || [];
    const headlines = data?.news?.articles || [];
    const notesText = [
      ...gameNotes.map(n => n.headline || n.text || ""),
      ...headlines.map(h => h.headline || ""),
    ].join(" ").toLowerCase();

    if (injuries.home.length === 0 && injuries.away.length === 0 && notesText.length < 10) {
      return {
        home_injury_penalty: 0, away_injury_penalty: 0,
        injury_diff: 0, home_missing_starters: 0, away_missing_starters: 0,
        home_injured_players: [], away_injured_players: [],
        detection_method: "no_data",
      };
    }

    const homeImpact = calculateInjuryImpact(injuries.home);
    const awayImpact = calculateInjuryImpact(injuries.away);

    return {
      home_injury_penalty: parseFloat(homeImpact.emPenalty.toFixed(2)),
      away_injury_penalty: parseFloat(awayImpact.emPenalty.toFixed(2)),
      injury_diff: parseFloat((homeImpact.emPenalty - awayImpact.emPenalty).toFixed(2)),
      home_missing_starters: homeImpact.starters,
      away_missing_starters: awayImpact.starters,
      home_injured_players: injuries.home.map(p => p.name),
      away_injured_players: injuries.away.map(p => p.name),
      detection_method: "espn_summary",
    };
  } catch (e) {
    console.warn("detectMissingStarters error:", gameId, e.message);
    return null;
  }
}

export function calculateInjuryImpact(injuredPlayers) {
  if (!injuredPlayers?.length) return { starters: 0, benchPlayers: 0, emPenalty: 0 };

  let starters = 0, benchPlayers = 0, totalPenalty = 0;

  for (const player of injuredPlayers) {
    if (player.isStarter) {
      starters++;
      // Diminishing returns: 1st starter=4.0, 2nd=3.5, 3rd=3.0, etc.
      totalPenalty += Math.max(2.0, 4.5 - (starters - 1) * 0.5);
    } else {
      benchPlayers++;
      totalPenalty += Math.max(0.5, 1.2 - (benchPlayers - 1) * 0.2);
    }
  }

  return { starters, benchPlayers, emPenalty: Math.min(16.0, totalPenalty) };
}


// ─────────────────────────────────────────────────────────────
// P1-CTX: Tournament Context Detection
// ─────────────────────────────────────────────────────────────

export function getGameContext(gameDateStr, neutralSite = false) {
  const date = new Date(gameDateStr + "T12:00:00");
  const month = date.getMonth() + 1;
  const day = date.getDate();

  const context = {
    is_conference_tournament: false,
    is_ncaa_tournament: false,
    is_nit: false,
    is_bubble_game: false,
    is_early_season: false,
    importance_multiplier: 1.0,
    override_neutral: false,
  };

  // Early season: November through mid-December
  if (month === 11 || (month === 12 && day <= 20)) {
    context.is_early_season = true;
  }

  // Conference tournaments: March 4–16
  if (month === 3 && day >= 4 && day <= 16) {
    context.is_conference_tournament = true;
    context.importance_multiplier = 1.15;
  }

  // NCAA tournament: March 17 – April 8, neutral site games
  if ((month === 3 && day >= 17) || (month === 4 && day <= 8)) {
    if (neutralSite) {
      context.is_ncaa_tournament = true;
      context.importance_multiplier = 1.25;
      context.override_neutral = true;
    } else {
      context.is_nit = true;
      context.importance_multiplier = 1.10;
    }
  }

  // Bubble games: late February through Selection Sunday
  if ((month === 2 && day >= 20) || (month === 3 && day <= 16)) {
    context.is_bubble_game = true;
    if (context.importance_multiplier < 1.10) {
      context.importance_multiplier = 1.10;
    }
  }

  return context;
}


// ─────────────────────────────────────────────────────────────
// P1-SIG: Dynamic Sigma Calibration
// ─────────────────────────────────────────────────────────────

const CONF_SIGMA = {
  "Big 12": 14.5, "Southeastern Conference": 14.8, "SEC": 14.8,
  "Big Ten": 15.0, "Big Ten Conference": 15.0,
  "Atlantic Coast Conference": 15.2, "ACC": 15.2,
  "Big East": 15.3, "Big East Conference": 15.3,
  "Pac-12": 15.5, "Pac-12 Conference": 15.5,
  "Mountain West Conference": 16.0, "Mountain West": 16.0,
  "American Athletic Conference": 16.2, "AAC": 16.2,
  "West Coast Conference": 16.5, "WCC": 16.5,
  "Atlantic 10 Conference": 16.5, "A-10": 16.5,
  "Missouri Valley Conference": 16.8, "MVC": 16.8,
  "Ivy League": 17.5, "Patriot League": 18.0,
  "MEAC": 18.5, "SWAC": 18.5,
};

export function calculateDynamicSigma(homeStats, awayStats, gameDateStr) {
  let baseSigma = 16.0;
  try {
    const date = new Date(gameDateStr + "T12:00:00");
    const month = date.getMonth() + 1;
    const day = date.getDate();
    let dayOfSeason;
    if (month >= 11) {
      dayOfSeason = (month - 11) * 30 + day;
    } else {
      dayOfSeason = 60 + (month - 1) * 30 + day;
    }
    const seasonProgress = Math.min(1.0, Math.max(0.0, dayOfSeason / 160));
    baseSigma = 19.2 - (4.2 * seasonProgress);
  } catch {
    baseSigma = 16.0;
  }

  const homeConfSigma = CONF_SIGMA[homeStats?.conferenceName] || 16.5;
  const awayConfSigma = CONF_SIGMA[awayStats?.conferenceName] || 16.5;
  const confSigma = (homeConfSigma + awayConfSigma) / 2;

  const homeQuality = Math.min(1, Math.max(0, ((homeStats?.adjEM || 0) + 15) / 45));
  const awayQuality = Math.min(1, Math.max(0, ((awayStats?.adjEM || 0) + 15) / 45));
  const avgQuality = (homeQuality + awayQuality) / 2;
  const qualityAdj = -1.5 * avgQuality;

  const finalSigma = (baseSigma * 0.50) + (confSigma * 0.35) + ((baseSigma + qualityAdj) * 0.15);
  return parseFloat(Math.max(13.0, Math.min(21.0, finalSigma)).toFixed(2));
}


// ─────────────────────────────────────────────────────────────
// P1-PAR: Parallel Batch Processing
// ─────────────────────────────────────────────────────────────

export async function batchProcess(items, processor, concurrency = 5, batchDelayMs = 100) {
  const results = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(item => processor(item).catch(e => {
        console.warn("batchProcess item error:", e.message);
        return null;
      }))
    );
    results.push(...batchResults);
    if (i + concurrency < items.length && batchDelayMs > 0) {
      await new Promise(r => setTimeout(r, batchDelayMs));
    }
  }
  return results.filter(Boolean);
}


// ─────────────────────────────────────────────────────────────
// P1-CACHE: TTL-Based Stats Cache
// ─────────────────────────────────────────────────────────────

export function createTTLCache(ttlMs = 4 * 60 * 60 * 1000) {
  const cache = new Map();
  return {
    get(key) {
      const entry = cache.get(key);
      if (!entry) return undefined;
      if (Date.now() - entry.timestamp > ttlMs) {
        cache.delete(key);
        return undefined;
      }
      return entry.data;
    },
    set(key, data) {
      cache.set(key, { data, timestamp: Date.now() });
    },
    clear() { cache.clear(); },
    get size() { return cache.size; },
  };
}

// ═══════════════════════════════════════════════════════════════
// KenPom Ratings — Railway Backend Integration
// ═══════════════════════════════════════════════════════════════
// Fetches opponent-adjusted efficiency ratings from Railway API
// (computed nightly by /compute/ncaa-efficiency endpoint).
// Includes home/away efficiency splits for venue-aware predictions.

const ML_API = "https://sports-predictor-api-production.up.railway.app";
let _kenPomCache = null;
let _kenPomFetchTime = 0;
const KENPOM_TTL = 4 * 60 * 60 * 1000; // 4 hours

/**
 * Fetch all NCAA team ratings from Railway API.
 * Returns a Map of teamId → rating object, or null if unavailable.
 */
export async function fetchNCAAKenPomRatings() {
  if (_kenPomCache && (Date.now() - _kenPomFetchTime) < KENPOM_TTL) return _kenPomCache;
  try {
    const res = await fetch(`${ML_API}/ratings/ncaa`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const data = await res.json();
    // API returns raw array from Supabase, or {ratings: [...]} — handle both
    const ratings = Array.isArray(data) ? data : data?.ratings;
    if (!ratings?.length) return null;
    const map = new Map();
    for (const r of ratings) {
      // Ensure rank exists: if rank_adj_em not in DB, compute from position in sorted array
      if (r.rank_adj_em == null) r.rank_adj_em = ratings.indexOf(r) + 1;
      map.set(String(r.team_id), r);
    }
    _kenPomCache = map;
    _kenPomFetchTime = Date.now();
    const updatedAt = Array.isArray(data) ? (ratings[0]?.updated_at ?? "unknown") : (data.updated_at ?? "unknown");
    console.log(`🏀 KenPom ratings loaded: ${map.size} teams (updated ${updatedAt})`);
    return map;
  } catch (e) {
    console.warn("KenPom ratings unavailable:", e.message);
    return null;
  }
}

/**
 * Apply KenPom ratings to a team's stats object.
 * Mutates teamStats by adding _oppAdj with pre-computed values,
 * including home/away efficiency splits when available.
 * V20-5: Also backfills oppPpg from Railway when ESPN/schedule couldn't provide it.
 */
export function applyKenPomRatings(teamStats, kenPomMap) {
  if (!teamStats || !kenPomMap) return;
  const rating = kenPomMap.get(String(teamStats.teamId));
  if (!rating) return;

  teamStats._oppAdj = {
    adjOE: rating.adj_oe,
    adjDE: rating.adj_de,
    adjPPG: rating.adj_ppg,
    adjOppPpg: rating.adj_opp_ppg,
    // Home/away splits for venue-aware prediction
    homeOE: rating.home_oe ?? null,
    homeDE: rating.home_de ?? null,
    awayOE: rating.away_oe ?? null,
    awayDE: rating.away_de ?? null,
    gamesUsed: rating.games_used,
    totalGames: (rating.wins || 0) + (rating.losses || 0),
    source: "kenpom-railway",
  };
  teamStats._kenPomRank = rating.rank_adj_em;
  teamStats._kenPomEM = rating.adj_em;

  // V20-5: Backfill oppPpg from Railway if ESPN/schedule couldn't provide it
  if (teamStats.oppPpg === 72.0 && rating.adj_opp_ppg != null && rating.adj_opp_ppg !== 72.0) {
    const oldOppPpg = teamStats.oppPpg;
    teamStats.oppPpg = rating.adj_opp_ppg;
    teamStats.ppgDiff = teamStats.ppg - teamStats.oppPpg;
    if (teamStats.tempo > 0) {
      teamStats.adjDE = (teamStats.oppPpg / teamStats.tempo) * 100;
      teamStats.adjEM = teamStats.adjOE - teamStats.adjDE;
    }
    console.log(`🔧 NCAA oppPpg backfilled [${teamStats.abbr}]: ${oldOppPpg} → ${rating.adj_opp_ppg.toFixed(1)} (Railway)`);
  }
}


// ─────────────────────────────────────────────────────────────
// AUDIT P3: Rest Days — exported for CalendarTab live predictions
// Mirrors _computeRestDays from ncaaSync.js (which is module-private).
// Uses ESPN team schedule to find days since last completed game.
// Impact: +0.5-1% accuracy, especially in tournament back-to-backs.
// ─────────────────────────────────────────────────────────────
export async function computeRestDays(teamId, gameDateStr) {
  try {
    const data = await espnFetch(`teams/${teamId}/schedule`);
    if (!data?.events) return 3;
    const gameDate = new Date(gameDateStr + "T00:00:00");
    let lastGameDate = null;
    for (const ev of data.events) {
      const evDate = new Date(ev.date);
      const completed = ev.competitions?.[0]?.status?.type?.completed;
      if (completed && evDate < gameDate) {
        if (!lastGameDate || evDate > lastGameDate) lastGameDate = evDate;
      }
    }
    if (!lastGameDate) return 7; // season opener
    return Math.max(0, Math.round((gameDate - lastGameDate) / (1000 * 60 * 60 * 24)));
  } catch { return 3; }
}

