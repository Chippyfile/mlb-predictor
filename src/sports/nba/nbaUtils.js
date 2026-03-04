// src/sports/nba/nbaUtils.js
// NBA v18 — Cross-Sport Alignment (v17 → v18)
//
// v17 deep formula audit fixes retained:
//   AUDIT-C1: KenPom additive core formula (replaces multiplicative)
//   AUDIT-H1: B2B rest phantom points removed
//   AUDIT-H2: Rim protection reduces opponent score
//   AUDIT-H3: O/U unified with spread scores
//   AUDIT-M1: Confidence oppPpg check || → &&
//   AUDIT-M2: Four Factors weights recalibrated to Dean Oliver targets
//   AUDIT-L1: Per-team form weight
//
// v18 cross-sport alignment fixes (ported from NCAA):
//   ALIGN-2: Blowout scaling — net rating gap >= 12 amplifies Four Factors/defBoost
//            up to 1.4× (NCAA uses EM gap >= 15, cap 1.5×)
//   ALIGN-3: Tempo-scale Four Factors — scale by poss/lgAvgPace (NCAA F7 fix)
//   ALIGN-4: Turnover margin signal — steals minus turnovers differential (NCAA F11)
//   ALIGN-5: Spread-preserving total cap at 260 (NCAA caps at 190)
//   ALIGN-9: Dynamic sigma — 10.5–14.5 range by season phase + matchup quality

export const NBA_TEAMS_LIST = [
  { id:"ATL",name:"Atlanta Hawks",conf:"East" },{ id:"BOS",name:"Boston Celtics",conf:"East" },
  { id:"BKN",name:"Brooklyn Nets",conf:"East" },{ id:"CHA",name:"Charlotte Hornets",conf:"East" },
  { id:"CHI",name:"Chicago Bulls",conf:"East" },{ id:"CLE",name:"Cleveland Cavaliers",conf:"East" },
  { id:"DAL",name:"Dallas Mavericks",conf:"West" },{ id:"DEN",name:"Denver Nuggets",conf:"West" },
  { id:"DET",name:"Detroit Pistons",conf:"East" },{ id:"GSW",name:"Golden State Warriors",conf:"West" },
  { id:"HOU",name:"Houston Rockets",conf:"West" },{ id:"IND",name:"Indiana Pacers",conf:"East" },
  { id:"LAC",name:"LA Clippers",conf:"West" },{ id:"LAL",name:"Los Angeles Lakers",conf:"West" },
  { id:"MEM",name:"Memphis Grizzlies",conf:"West" },{ id:"MIA",name:"Miami Heat",conf:"East" },
  { id:"MIL",name:"Milwaukee Bucks",conf:"East" },{ id:"MIN",name:"Minnesota Timberwolves",conf:"West" },
  { id:"NOP",name:"New Orleans Pelicans",conf:"West" },{ id:"NYK",name:"New York Knicks",conf:"East" },
  { id:"OKC",name:"Oklahoma City Thunder",conf:"West" },{ id:"ORL",name:"Orlando Magic",conf:"East" },
  { id:"PHI",name:"Philadelphia 76ers",conf:"East" },{ id:"PHX",name:"Phoenix Suns",conf:"West" },
  { id:"POR",name:"Portland Trail Blazers",conf:"West" },{ id:"SAC",name:"Sacramento Kings",conf:"West" },
  { id:"SAS",name:"San Antonio Spurs",conf:"West" },{ id:"TOR",name:"Toronto Raptors",conf:"East" },
  { id:"UTA",name:"Utah Jazz",conf:"West" },{ id:"WAS",name:"Washington Wizards",conf:"East" },
];

export const NBA_ESPN_IDS = {
  ATL:1,BOS:2,BKN:17,CHA:30,CHI:4,CLE:5,DAL:6,DEN:7,DET:8,GSW:9,
  HOU:10,IND:11,LAC:12,LAL:13,MEM:29,MIA:14,MIL:15,MIN:16,NOP:3,NYK:18,
  OKC:25,ORL:19,PHI:20,PHX:21,POR:22,SAC:23,SAS:24,TOR:28,UTA:26,WAS:27,
};

export const NBA_TEAM_COLORS = {
  ATL:"#E03A3E",BOS:"#007A33",BKN:"#000",CHA:"#1D1160",CHI:"#CE1141",
  CLE:"#860038",DAL:"#00538C",DEN:"#0E2240",DET:"#C8102E",GSW:"#1D428A",
  HOU:"#CE1141",IND:"#002D62",LAC:"#C8102E",LAL:"#552583",MEM:"#5D76A9",
  MIA:"#98002E",MIL:"#00471B",MIN:"#0C2340",NOP:"#0C2340",NYK:"#006BB6",
  OKC:"#007AC1",ORL:"#0077C0",PHI:"#006BB6",PHX:"#1D1160",POR:"#E03A3E",
  SAC:"#5A2D81",SAS:"#C4CED4",TOR:"#CE1141",UTA:"#002B5C",WAS:"#002B5C",
};

// ─────────────────────────────────────────────────────────────
// City coordinates for Haversine travel distance calculation
// ─────────────────────────────────────────────────────────────
export const NBA_CITY_COORDS = {
  ATL:{lat:33.7490,lng:-84.3880},BOS:{lat:42.3601,lng:-71.0589},BKN:{lat:40.6926,lng:-73.9750},
  CHA:{lat:35.2271,lng:-80.8431},CHI:{lat:41.8819,lng:-87.6278},CLE:{lat:41.4993,lng:-81.6944},
  DAL:{lat:32.7767,lng:-96.7970},DEN:{lat:39.7392,lng:-104.9903},DET:{lat:42.3314,lng:-83.0458},
  GSW:{lat:37.7749,lng:-122.4194},HOU:{lat:29.7604,lng:-95.3698},IND:{lat:39.7684,lng:-86.1581},
  LAC:{lat:34.0430,lng:-118.2673},LAL:{lat:34.0430,lng:-118.2673},MEM:{lat:35.1495,lng:-90.0490},
  MIA:{lat:25.7617,lng:-80.1918},MIL:{lat:43.0389,lng:-87.9065},MIN:{lat:44.9778,lng:-93.2650},
  NOP:{lat:29.9511,lng:-90.0715},NYK:{lat:40.7505,lng:-73.9934},OKC:{lat:35.4676,lng:-97.5164},
  ORL:{lat:28.5383,lng:-81.3792},PHI:{lat:39.9526,lng:-75.1652},PHX:{lat:33.4484,lng:-112.0740},
  POR:{lat:45.5231,lng:-122.6765},SAC:{lat:38.5816,lng:-121.4944},SAS:{lat:29.4241,lng:-98.4936},
  TOR:{lat:43.6532,lng:-79.3832},UTA:{lat:40.7608,lng:-111.8910},WAS:{lat:38.9072,lng:-77.0369},
};

// ─────────────────────────────────────────────────────────────
// ESPN ABBREVIATION NORMALIZATION
// ESPN scoreboard API returns non-standard abbreviations for some teams.
// This maps them to our canonical codes used in NBA_ESPN_IDS.
// ─────────────────────────────────────────────────────────────
const ESPN_ABBR_MAP = {
  "GS":"GSW","NY":"NYK","NO":"NOP","SA":"SAS",
  "WSH":"WAS","UTAH":"UTA","UTH":"UTA","PHO":"PHX",
  "BKLYN":"BKN","BK":"BKN",
};
export const mapNBAAbbr = a => ESPN_ABBR_MAP[a] || a;

// ─────────────────────────────────────────────────────────────
// NBA-13 FIX: Dynamic league averages
// Defaults based on 2024-25 season — updated dynamically via computeLeagueAverages()
// ─────────────────────────────────────────────────────────────
let _leagueAverages = {
  ppg: 113.0,
  pace: 99.5,
  eFGpct: 0.543,
  toPct: 14.5,
  orbPct: 0.245,
  ftaRate: 0.270,
  fgPct: 0.471,
  threePct: 0.365,
  ftPct: 0.780,
  oppFgPct: 0.471,
  oppThreePct: 0.365,
  ts: 0.578,
  blocks: 5.0,
  steals: 7.5,
  offRtg: 113.5,
  defRtg: 113.5,
};

// Call this after loading all 30 teams to set real league averages
export function computeLeagueAverages(allTeamStats) {
  if (!allTeamStats || allTeamStats.length < 15) return; // need a decent sample
  const avg = (arr, key) => {
    const vals = arr.map(t => t[key]).filter(v => v != null && !isNaN(v));
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };
  const update = (key, val) => { if (val != null) _leagueAverages[key] = val; };
  update("ppg", avg(allTeamStats, "ppg"));
  update("pace", avg(allTeamStats, "pace"));
  update("fgPct", avg(allTeamStats, "fgPct"));
  update("threePct", avg(allTeamStats, "threePct"));
  update("ftPct", avg(allTeamStats, "ftPct"));
  update("oppFgPct", avg(allTeamStats, "oppFgPct"));
  update("oppThreePct", avg(allTeamStats, "oppThreePct"));
  update("blocks", avg(allTeamStats, "blocks"));
  update("steals", avg(allTeamStats, "steals"));
  update("orbPct", avg(allTeamStats, "orbPct"));
  update("ftaRate", avg(allTeamStats, "ftaRate"));
  // NBA-C3 FIX (v16): Compute league eFG% directly from team eFGpct values
  // (not from averages-of-components, which introduces Jensen's inequality bias)
  const lgDirectEFG = avg(allTeamStats, "eFGpct");
  if (lgDirectEFG != null) {
    update("eFGpct", lgDirectEFG);
  } else {
    // Fallback: derive from components if eFGpct not available on teams
    const lgThreeRate = avg(allTeamStats, "threeAttRate");
    const lgThreePct = _leagueAverages.threePct;
    const lgFgPct = _leagueAverages.fgPct;
    if (lgThreeRate != null) {
      update("eFGpct", lgFgPct + 0.5 * lgThreeRate * lgThreePct);
    }
  }
  // Compute league TO%
  const lgTO = avg(allTeamStats, "turnovers");
  const lgPace = _leagueAverages.pace;
  if (lgTO != null && lgPace > 0) update("toPct", (lgTO / lgPace) * 100);
  // Compute league FTA rate
  const lgFTARate = avg(allTeamStats, "ftaRate");
  if (lgFTARate != null) update("ftaRate", lgFTARate);
  // offRtg/defRtg
  update("offRtg", avg(allTeamStats, "adjOE"));
  update("defRtg", avg(allTeamStats, "adjDE"));
}

export function getLeagueAverages() { return { ..._leagueAverages }; }

// ─────────────────────────────────────────────────────────────
// NBA-06 FIX: Expanded stat collection (was: only ppg, oppPpg, fake pace)
// Now mirrors NCAAB v15 with 20+ stats + Dean Oliver pace
// ─────────────────────────────────────────────────────────────
const _nbaStatsCache = {};

export async function fetchNBATeamStats(abbr) {
  if (_nbaStatsCache[abbr]) return _nbaStatsCache[abbr];
  const espnId = NBA_ESPN_IDS[abbr];
  if (!espnId) return null;
  try {
    const [teamData, statsData, schedData] = await Promise.all([
      fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${espnId}`).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${espnId}/statistics`).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${espnId}/schedule`).then(r => r.ok ? r.json() : null).catch(() => null),
    ]);
    const stats = statsData?.results?.stats?.categories || [];
    const getStat = (...names) => {
      for (const cat of stats) for (const name of names) {
        const s = cat.stats?.find(s => s.name === name || s.displayName === name);
        if (s) { const v = parseFloat(s.value); return isNaN(v) ? null : v; }
      }
      return null;
    };
    // Normalize percentages: ESPN sometimes returns 47.1 instead of 0.471
    const normPct = (v, fallback) => {
      const p = (v != null && v !== 0) ? v : fallback;
      return p > 1 ? p / 100 : p;
    };

    // ── Core stats ──
    const ppg    = getStat("avgPoints", "pointsPerGame") || 112.0;
    const oppPpg = getStat("avgPointsAllowed", "opponentPointsPerGame") || 112.0;

    // ── NBA-06: Granular shooting stats ──
    const fgPct    = normPct(getStat("fieldGoalPct"), 0.471);
    const threePct = normPct(getStat("threePointFieldGoalPct"), 0.365);
    const ftPct    = normPct(getStat("freeThrowPct"), 0.780);
    const assists  = getStat("avgAssists") || 25.0;
    const turnovers = getStat("avgTurnovers") || 14.0;

    // ── Shot attempts + rebounds ──
    // FIX: ESPN returns BOTH season totals (e.g. fieldGoalsAttempted=5720) and
    // per-game averages (avgFieldGoalsAttempted=88). Must use per-game first.
    // If per-game is unavailable, detect season totals (>200) and divide by games.
    const _nbaPerGame = (avgName, totalName, fallback) => {
      const avg = getStat(avgName);
      if (avg != null) return avg;
      const total = getStat(totalName);
      if (total != null) {
        // Season totals are typically >200 for FGA, >100 for FTA
        // Per-game NBA FGA is ~80-95, FTA is ~18-30
        if (total > 200) {
          // Estimate games from schedule if available
          const gamesPlayed = schedData?.events?.filter(e => e.competitions?.[0]?.status?.type?.completed)?.length || 82;
          return total / Math.max(1, gamesPlayed);
        }
        return total; // small enough to be per-game already
      }
      return fallback;
    };
    const fga    = _nbaPerGame("avgFieldGoalsAttempted", "fieldGoalsAttempted", 88.0);
    const fta    = _nbaPerGame("avgFreeThrowsAttempted", "freeThrowsAttempted", 24.0);
    const offReb = getStat("avgOffensiveRebounds", "offensiveReboundsPerGame") || 10.5;
    const defReb = getStat("avgDefensiveRebounds", "defensiveReboundsPerGame") || 33.5;
    const totalReb = getStat("avgRebounds", "reboundsPerGame") || (offReb + defReb);
    const steals = getStat("avgSteals", "stealsPerGame") || 7.5;
    const blocks = getStat("avgBlocks", "blocksPerGame") || 5.0;
    const threeAtt = _nbaPerGame("avgThreePointFieldGoalsAttempted", "threePointFieldGoalsAttempted", fga * 0.40);
    const foulsPerGame = getStat("avgFouls", "foulsPerGame") || 20.0;

    // ── Opponent defensive stats ──
    const oppFgPct    = normPct(getStat("opponentFieldGoalPct"), 0.471);
    const oppThreePct = normPct(getStat("opponentThreePointFieldGoalPct"), 0.365);

    // ── NBA-01 FIX: Real Dean Oliver possession estimate ──
    // Poss ≈ FGA − ORB + TO + 0.475 × FTA (per game)
    // This replaces the old `96 + (ppg - 110) * 0.3` linear proxy
    const estPoss = fga - offReb + turnovers + 0.485 * fta; // AUDIT FIX 6
    const pace = Math.max(90, Math.min(108, estPoss || 99.5));

    // ── Derived metrics (mirroring NCAAB v15 pattern) ──
    // ORB% — offensive rebounding rate
    // Approximate opponent DRB as league avg (~33.5) since we don't have it directly
    const orbPct = offReb / (offReb + 33.5);
    // FTA Rate — free throw attempts per FGA
    const ftaRate = fga > 0 ? fta / fga : 0.27;
    // Assist-to-Turnover ratio
    const atoRatio = turnovers > 0 ? assists / turnovers : 1.8;
    // Three-point attempt rate
    const threeAttRate = fga > 0 ? threeAtt / fga : 0.40;

    // NBA-C3 FIX (v16): Compute eFG% directly from components
    // eFG% = FG% + 0.5 × (3PM / FGA) = FG% + 0.5 × threeAttRate × threePct
    const eFGpct = fgPct + 0.5 * threeAttRate * threePct;

    // ── Efficiency ratings using REAL pace ──
    const adjOE = (ppg / pace) * 100;
    const adjDE = (oppPpg / pace) * 100;

    // ── Form + W/L from schedule ──
    let formScore = 0, wins = 0, losses = 0;
    let lastGameDate = null, lastGameCity = null;
    try {
      const events = schedData?.events || [];
      const completed = events.filter(e => e.competitions?.[0]?.status?.type?.completed);
      wins = completed.filter(e => e.competitions?.[0]?.competitors?.find(c => c.team?.id === String(espnId))?.winner).length;
      losses = completed.length - wins;
      formScore = completed.slice(-5).reduce((s, e, i) => {
        const comp = e.competitions?.[0];
        const tc = comp?.competitors?.find(c => c.team?.id === String(espnId));
        // NBA-M3 FIX (v16): Symmetric ±1 weights (was +1/-0.6, matching NCAA F13)
        return s + ((tc?.winner || false) ? 1 : -1) * (i + 1);
      }, 0) / 15;
      // NBA-10/11: Extract last game date + city for rest/travel calc
      if (completed.length) {
        const lastGame = completed[completed.length - 1];
        lastGameDate = lastGame.date || null;
        // Determine city from the venue or whether team was home/away
        const lastComp = lastGame.competitions?.[0];
        const wasHome = lastComp?.competitors?.find(c => c.team?.id === String(espnId))?.homeAway === "home";
        if (wasHome) {
          lastGameCity = abbr; // played at home
        } else {
          // Away game — get the home team's abbreviation
          const homeTeam = lastComp?.competitors?.find(c => c.homeAway === "home");
          const homeAbbr = homeTeam?.team?.abbreviation;
          if (homeAbbr) {
            lastGameCity = mapNBAAbbr(homeAbbr);
          }
        }
      }
    } catch {}

    const result = {
      abbr, espnId, name: teamData?.team?.displayName || abbr,
      // Core
      ppg, oppPpg, pace, adjOE, adjDE, netRtg: adjOE - adjDE,
      // NBA-06: Granular stats
      fgPct, threePct, ftPct, assists, turnovers,
      fga, fta, offReb, defReb, totalReb, steals, blocks,
      threeAtt, foulsPerGame,
      oppFgPct, oppThreePct,
      // Derived
      orbPct, ftaRate, atoRatio, threeAttRate, eFGpct,
      // Form + record
      formScore, wins, losses, totalGames: wins + losses,
      // NBA-10/11: rest/travel data
      lastGameDate, lastGameCity,
    };
    _nbaStatsCache[abbr] = result;
    return result;
  } catch (e) { console.warn("fetchNBATeamStats:", abbr, e); return null; }
}

// ─────────────────────────────────────────────────────────────
// NBA-H4 FIX (v16): fetchNBARealPace ELIMINATED
// fetchNBATeamStats already computes pace, offRtg, defRtg, netRtg
// correctly with real games-played division. fetchNBARealPace was
// redundant AND had a bug (dividing by 82 instead of actual games).
// All callers (CalendarTab, Sync, betUtils) should now use
// fetchNBATeamStats directly. The team stats object already contains:
//   { pace, adjOE (=offRtg), adjDE (=defRtg), netRtg }
// For backward compat, we export a thin wrapper that extracts
// the pace/rating fields from fetchNBATeamStats.
// ─────────────────────────────────────────────────────────────
export async function fetchNBARealPace(abbr) {
  const stats = await fetchNBATeamStats(abbr);
  if (!stats) return null;
  return {
    pace: stats.pace,
    offRtg: stats.adjOE,
    defRtg: stats.adjDE,
    netRtg: stats.netRtg,
  };
}

// ─────────────────────────────────────────────────────────────
// NBA-INJ: Injury / Roster Detection from ESPN Game Summary
// Mirrors NCAAB detectMissingStarters — same ESPN API pattern, nba path.
// nbaPredictGame already accepts homeInjuries/awayInjuries but callers
// were passing empty arrays. This wires real data into those params.
// Impact: +2-4% accuracy on games with key absences (stars worth 8-12 pts).
// ─────────────────────────────────────────────────────────────
export async function detectNBAInjuries(gameId, homeEspnId, awayEspnId) {
  if (!gameId) return null;
  try {
    const data = await fetch(
      `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${gameId}`
    ).then(r => r.ok ? r.json() : null).catch(() => null);
    if (!data) return null;

    const injuries = { home: [], away: [] };

    // ── Primary: boxscore players with OUT/Suspended/Day-To-Day status ──
    const boxPlayers = data?.boxscore?.players || [];
    for (const teamBlock of boxPlayers) {
      const teamId = String(teamBlock?.team?.id || "");
      const isHome = teamId === String(homeEspnId);
      const isAway = teamId === String(awayEspnId);
      if (!isHome && !isAway) continue;
      const side = isHome ? "home" : "away";
      for (const statGroup of (teamBlock?.statistics || [])) {
        for (const athlete of (statGroup?.athletes || [])) {
          const status    = athlete?.athlete?.status?.type || "";
          const injStatus = athlete?.athlete?.injuries?.[0]?.status || "";
          const isOut = (
            status === "OUT" || status === "out" ||
            injStatus === "Out" || injStatus === "out" ||
            injStatus === "Suspended" || injStatus === "Day-To-Day"
          );
          if (isOut) {
            injuries[side].push({
              name:      athlete?.athlete?.displayName || "Unknown",
              isStarter: athlete?.starter || false,
              status:    status || injStatus,
            });
          }
        }
      }
    }

    // ── Fallback: data.injuries array (populated pre-game before boxscore exists) ──
    const injuriesArr = data?.injuries || [];
    for (const injBlock of injuriesArr) {
      const teamId = String(injBlock?.team?.id || "");
      const isHome = teamId === String(homeEspnId);
      const isAway = teamId === String(awayEspnId);
      if (!isHome && !isAway) continue;
      const side = isHome ? "home" : "away";
      for (const inj of (injBlock?.injuries || [])) {
        const status = inj?.status || "";
        if (status === "Out" || status === "Suspended") {
          // Avoid duplicates already caught by boxscore pass
          const name = inj?.athlete?.displayName || "Unknown";
          if (!injuries[side].find(p => p.name === name)) {
            injuries[side].push({ name, isStarter: false, status });
          }
        }
      }
    }

    const homeImpact = _calcNBAInjuryImpact(injuries.home);
    const awayImpact = _calcNBAInjuryImpact(injuries.away);

    return {
      homeInjuries:          homeImpact.injuries,   // [{name, role, status}] for nbaPredictGame
      awayInjuries:          awayImpact.injuries,
      home_injury_penalty:   parseFloat(homeImpact.penalty.toFixed(2)),
      away_injury_penalty:   parseFloat(awayImpact.penalty.toFixed(2)),
      home_missing_starters: homeImpact.starters,
      away_missing_starters: awayImpact.starters,
      home_injured_players:  injuries.home.map(p => p.name),
      away_injured_players:  injuries.away.map(p => p.name),
    };
  } catch (e) {
    console.warn("detectNBAInjuries error:", gameId, e.message);
    return null;
  }
}

function _calcNBAInjuryImpact(injuredPlayers) {
  if (!injuredPlayers?.length) return { injuries: [], starters: 0, penalty: 0 };
  // Role weights match nbaPredictGame: starter=3.2, rotation=1.5, reserve=0.5
  // Diminishing returns on multiple starters out (2nd star = 2.8, 3rd = 2.4)
  let starters = 0, penalty = 0;
  const injuries = injuredPlayers.map(p => {
    const role = p.isStarter ? "starter" : "rotation";
    if (p.isStarter) {
      starters++;
      penalty += Math.max(1.5, 3.2 - (starters - 1) * 0.4);
    } else {
      penalty += 1.5;
    }
    return { name: p.name, role, status: p.status };
  });
  return { injuries, starters, penalty };
}

// ─────────────────────────────────────────────────────────────
// SCHEDULE + GAME DATA
// ─────────────────────────────────────────────────────────────
export async function fetchNBAGamesForDate(dateStr) {
  try {
    const compact = dateStr.replace(/-/g, "");
    const data = await fetch(
      `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${compact}&limit=50`
    ).then(r => r.ok ? r.json() : null).catch(() => null);
    if (!data?.events) return [];
    return data.events.map(ev => {
      const comp = ev.competitions?.[0];
      const home = comp?.competitors?.find(c => c.homeAway === "home");
      const away = comp?.competitors?.find(c => c.homeAway === "away");
      const status = comp?.status?.type;
      return {
        gameId: ev.id, gameDate: ev.date,
        status: status?.completed ? "Final" : status?.state === "in" ? "Live" : "Preview",
        homeAbbr: mapNBAAbbr(home?.team?.abbreviation || ""),
        awayAbbr: mapNBAAbbr(away?.team?.abbreviation || ""),
        homeTeamName: home?.team?.displayName,
        awayTeamName: away?.team?.displayName,
        homeScore: status?.completed ? parseInt(home?.score) : null,
        awayScore: status?.completed ? parseInt(away?.score) : null,
        neutralSite: comp?.neutralSite || false,
      };
    }).filter(g => g.homeAbbr && g.awayAbbr);
  } catch (e) { console.warn("fetchNBAGamesForDate:", dateStr, e); return []; }
}

// ─────────────────────────────────────────────────────────────
// HAVERSINE DISTANCE
// ─────────────────────────────────────────────────────────────
export function haversineDistance(abbr1, abbr2) {
  const c1 = NBA_CITY_COORDS[abbr1], c2 = NBA_CITY_COORDS[abbr2];
  if (!c1 || !c2) return 1000;
  const R = 3959, toRad = d => d * Math.PI / 180;
  const dLat = toRad(c2.lat - c1.lat), dLng = toRad(c2.lng - c1.lng);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(c1.lat)) * Math.cos(toRad(c2.lat)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─────────────────────────────────────────────────────────────
// NBA v15: PREDICTION ENGINE
//
// Fixes: real Dean Oliver pace, full Four Factors, corrected TS%,
// real rim protection, dynamic league averages, expanded confidence
// ─────────────────────────────────────────────────────────────
export function nbaPredictGame({
  homeStats, awayStats,
  neutralSite = false,
  homeDaysRest = 2, awayDaysRest = 2,
  calibrationFactor = 1.0,
  homeRealStats = null,
  awayRealStats = null,
  homeAbbr = null, awayAbbr = null,
  awayPrevCityAbbr = null,
  homeInjuries = [], awayInjuries = [],
}) {
  if (!homeStats || !awayStats) return null;
  const lg = _leagueAverages;

  // ── Pace & Efficiency: prefer realStats, fallback to team stats ──
  const homePace   = homeRealStats?.pace   || homeStats.pace;
  const awayPace   = awayRealStats?.pace   || awayStats.pace;
  const homeOffRtg = homeRealStats?.offRtg || homeStats.adjOE;
  const awayOffRtg = awayRealStats?.offRtg || awayStats.adjOE;
  const homeDefRtg = homeRealStats?.defRtg || homeStats.adjDE;
  const awayDefRtg = awayRealStats?.defRtg || awayStats.adjDE;
  const poss = (homePace + awayPace) / 2;
  const lgAvg = lg.offRtg || lg.ppg;  // Use per-100-poss rating, not raw ppg

  // ── Core score projection (KenPom additive matchup) ──
  // AUDIT C1 FIX: Replaced multiplicative formula which inflated scores by 8-26 pts
  // when both teams above/below average (ratio compounding). Additive formula matches
  // KenPom methodology used in NCAAB: expected = (teamOE + oppDE - lgAvg) / 100 * poss
  // BOS(119.2 OE) vs OKC(106.5 DE): mult=128.3, additive=113.6 — 14.7pt difference per team.
  let homeScore = ((homeOffRtg + awayDefRtg - lgAvg) / 100) * poss;
  let awayScore = ((awayOffRtg + homeDefRtg - lgAvg) / 100) * poss;

  // ── NBA-05 FIX: Full Four Factors framework ──
  // Dean Oliver weights: eFG% 40%, TO% 25%, ORB% 20%, FTR 15%
  // NBA-H1 FIX (v16): Now accepts opponentDefReb for matchup-specific ORB%
  const fourFactorsBoost = (stats, opponentDefReb) => {
    // eFG% = FG% + 0.5 × 3PA_rate × 3P%
    const threeRate = stats.threeAttRate || 0.40;
    const eFG = (stats.fgPct || lg.fgPct) + 0.5 * threeRate * (stats.threePct || lg.threePct);
    const eFGboost = (eFG - lg.eFGpct) * 12.0; // AUDIT M2 FIX: was 7.2, actual weight was 24% vs target 40%

    // TO% — turnovers per 100 possessions
    const toPct = stats.pace > 0 ? (stats.turnovers / stats.pace) * 100 : lg.toPct;
    const toBoost = (lg.toPct - toPct) * 0.07; // AUDIT M2 FIX: was 0.09 (30% actual vs 25% target)

    // ORB% — offensive rebounding rate (matchup-specific)
    // NBA-H1: Use actual opponent DRB instead of hardcoded 33.5
    const oppDRB = opponentDefReb || 33.5;
    const matchupOrbPct = stats.offReb / (stats.offReb + oppDRB);
    const orbBoost = (matchupOrbPct - lg.orbPct) * 4.0; // AUDIT M2 FIX: was 5.5 (27% actual vs 20% target)

    // FTA Rate — free throw attempts per FGA
    const ftaRateVal = stats.ftaRate || lg.ftaRate;
    const ftrBoost = (ftaRateVal - lg.ftaRate) * 2.2; // AUDIT M2 FIX: was 3.0 (20% actual vs 15% target)

    return eFGboost + Math.max(-2.5, Math.min(2.5, toBoost)) + orbBoost + ftrBoost;
  };
  // ── ALIGN-3: Tempo-scale Four Factors (ported from NCAA F7) ──
  // Efficiency advantages compound over more possessions per game.
  // NBA average pace ~100; tempoScale ranges ~0.95–1.05.
  const nbaAvgPace = lg.pace || 100.0;
  const tempoScale = poss / nbaAvgPace;

  const homeFFactors = fourFactorsBoost(homeStats, awayStats.defReb);
  const awayFFactors = fourFactorsBoost(awayStats, homeStats.defReb);

  // ── Defensive quality adjustment ──
  // NBA-M8 FIX (v16): Removed oppFGpct and oppThreePct from defBoost.
  // These are already captured in adjDE (oppPpg/pace × 100) which feeds
  // the core score projection. Keeping only disruption stats (steals/blocks)
  // which measure active defensive playmaking not reflected in adjDE.
  // Matches NCAA F8 fix: "Removed oppFGpct from defBoost (double-counted via adjDE)"
  const defBoost = (stats) => {
    // AUDIT FIX 12: Recalibrated steals 0.10->0.085, blocks 0.08->0.065
    const disruption = ((stats.steals || lg.steals) - lg.steals) * 0.085
                     + ((stats.blocks || lg.blocks) - lg.blocks) * 0.065;
    return disruption;
  };

  // ── ALIGN-2: Blowout scaling (ported from NCAA) ──
  // In competitive games, conservative multipliers prevent noise from dominating.
  // In blowouts, the model can't accumulate enough signal to match Vegas spreads of 15+ pts.
  // Gate on net rating gap (NBA equivalent of NCAA's EM gap).
  // NBA threshold 12 (vs NCAA 15) because NBA rating scale is tighter.
  const homeNetRtgVal = homeRealStats?.netRtg || homeStats.netRtg || 0;
  const awayNetRtgVal = awayRealStats?.netRtg || awayStats.netRtg || 0;
  const netRtgGap = Math.abs(homeNetRtgVal - awayNetRtgVal);
  // Scale factor: 1.0 for gap < 12, ramps to 1.4 at gap 30+
  // Slightly lower cap than NCAA (1.4 vs 1.5) — NBA has fewer extreme mismatches
  const blowoutScale = netRtgGap >= 12 ? Math.min(1.4, 1.0 + (netRtgGap - 12) / 45) : 1.0;

  // ALIGN-3: Apply tempo-scaled Four Factors with blowout amplification
  homeScore += homeFFactors * tempoScale * 0.30 * blowoutScale;
  awayScore += awayFFactors * tempoScale * 0.30 * blowoutScale;
  homeScore += defBoost(homeStats) * 0.22 * blowoutScale;
  awayScore += defBoost(awayStats) * 0.22 * blowoutScale;

  // ── Ball control differential ──
  const homeATO = (homeStats.atoRatio || 1.8) - 1.8;
  const awayATO = (awayStats.atoRatio || 1.8) - 1.8;
  const atoBoost = (homeATO - awayATO) * 0.4;
  homeScore += atoBoost * 0.5;
  awayScore -= atoBoost * 0.5;

  // ── ALIGN-4: Turnover margin signal (ported from NCAA F11) ──
  // Captures live-ball turnovers (steals) that lead to fast break points.
  // NBA league averages: ~7.5 steals, ~14 turnovers per game.
  const toMarginHome = (homeStats.steals || lg.steals || 7.5) - (homeStats.turnovers || 14.0);
  const toMarginAway = (awayStats.steals || lg.steals || 7.5) - (awayStats.turnovers || 14.0);
  const toMarginBoost = (toMarginHome - toMarginAway) * 0.08;
  homeScore += toMarginBoost * 0.5;
  awayScore -= toMarginBoost * 0.5;

  // ── NBA-04 FIX: True Shooting % (corrected formula) ──
  // Real TS% = Points / (2 × TSA) where TSA = FGA + 0.44 × FTA
  // Only apply if we have real FGA/FTA (from expanded stat collection)
  const tsBoost = (stats) => {
    if (!stats.fga || !stats.fta) return 0;
    const tsa = stats.fga + 0.44 * stats.fta;
    if (tsa <= 0) return 0;
    const ts = stats.ppg / (2 * tsa);
    const lgTS = lg.ts || 0.578;
    return Math.max(-2.5, Math.min(2.5, (ts - lgTS) * 15));
  };
  // AUDIT FIX 5: TS% overlaps with eFG in Four Factors, reduced 0.15->0.05
  homeScore += tsBoost(homeStats) * 0.05;
  awayScore += tsBoost(awayStats) * 0.05;

  // ── Home court advantage: 2.4 pts (post-2020 research) ──
  homeScore += (neutralSite ? 0 : 2.4) / 2;
  awayScore -= (neutralSite ? 0 : 2.4) / 2;

  // ── B2B rest penalties ──
  // AUDIT H1 FIX: Removed phantom opponent bonus (+0.9/+1.1). Playing a tired team
  // doesn't make you score more. Road B2B slightly harsher (3.6 vs 3.0) per research.
  if (homeDaysRest === 0) { homeScore -= 3.0; }
  else if (awayDaysRest === 0) { awayScore -= 3.6; }
  else if (homeDaysRest - awayDaysRest >= 3) homeScore += 1.2;
  else if (awayDaysRest - homeDaysRest >= 3) awayScore += 1.2;

  // ── Travel distance penalty (Haversine) ──
  if (awayPrevCityAbbr && homeAbbr) {
    try {
      const dist = haversineDistance(awayPrevCityAbbr, homeAbbr);
      // AUDIT FIX 3: Updated travel penalties (was -1.4/-0.7)
      if (dist > 2000) awayScore -= 1.6;
      else if (dist > 1000) awayScore -= 0.9;
    } catch {}
  }

  // ── NBA-12 FIX: Rim protection now uses real collected blocks/fouls ──
  const rimProtection = (blk, oppFouls) => {
    const blkBonus = blk != null ? (blk - (lg.blocks || 5.0)) * 0.18 : 0;
    const foulPenalty = oppFouls != null ? (oppFouls - 20) * -0.06 : 0;
    return blkBonus + foulPenalty;
  };
  // AUDIT H2 FIX: Rim protection now reduces OPPONENT score (blocks are defensive).
  // Was incorrectly added to blocking team's own score.
  awayScore -= rimProtection(homeStats.blocks, awayStats.foulsPerGame) * 0.15;
  homeScore -= rimProtection(awayStats.blocks, homeStats.foulsPerGame) * 0.15;

  // ── Lineup injury impact ──
  const roleWeight = { starter: 3.2, rotation: 1.5, reserve: 0.5 };
  const homeInjPenalty = (homeInjuries || []).reduce((s, p) => s + (roleWeight[p.role] || 1.5), 0);
  const awayInjPenalty = (awayInjuries || []).reduce((s, p) => s + (roleWeight[p.role] || 1.5), 0);
  homeScore -= homeInjPenalty;
  awayScore -= awayInjPenalty;

  // ── Recent form ──
  // AUDIT L1 FIX: Per-team form weight (was using homeStats.totalGames for both)
  const homeFw = Math.min(0.10, 0.10 * Math.sqrt(Math.min(homeStats.totalGames || 0, 30) / 30));
  const awayFw = Math.min(0.10, 0.10 * Math.sqrt(Math.min(awayStats.totalGames || 0, 30) / 30));
  homeScore += homeStats.formScore * homeFw * 3;
  awayScore += awayStats.formScore * awayFw * 3;

  // ── O/U Total: Derived from spread-optimized scores ──
  // AUDIT H3 FIX: Previously used separate PPG formula that diverged 15-29 pts
  // from spread-optimized scores. Now that C1 (additive formula) produces realistic
  // scores (110-115 range instead of inflated 120-130), O/U can be derived directly.
  // Small shrink factor accounts for scoring regression to mean in actual games.
  // NBA-H2 retained: HCA already in homeScore/awayScore, no separate ouHCA needed.
  const NBA_TOTAL_SHRINK = 0.992;  // Tighter shrink since additive formula no longer inflates
  const ouTotal = parseFloat(((homeScore + awayScore) * NBA_TOTAL_SHRINK).toFixed(1));

  // ── ALIGN-5: Spread-preserving total cap (ported from NCAA) ──
  // The spread-optimized score projection can inflate totals in extreme matchups.
  // Cap at 260 (realistic NBA max) while preserving the spread for ATS accuracy.
  // O/U total is computed separately and is unaffected by this cap.
  const rawTotal = homeScore + awayScore;
  const maxRealisticTotal = 260;
  if (rawTotal > maxRealisticTotal) {
    const currentSpread = homeScore - awayScore;
    const cappedMidpoint = maxRealisticTotal / 2;
    homeScore = cappedMidpoint + currentSpread / 2;
    awayScore = cappedMidpoint - currentSpread / 2;
    console.warn(`⚠️ NBA total ${rawTotal.toFixed(0)} capped to ${maxRealisticTotal} (spread preserved: ${currentSpread.toFixed(1)})`);
  }

  // ── NBA-16 FIX: Raised ceiling from 148 to 155 for modern NBA ──
  homeScore = Math.max(85, Math.min(155, homeScore));
  awayScore = Math.max(85, Math.min(155, awayScore));

  // ── Win probability (logistic) ──
  const spread = parseFloat((homeScore - awayScore).toFixed(1));
  // ── ALIGN-9: Dynamic sigma (ported from NCAA P1-SIG) ──
  // NBA sigma varies by season progress and data quality. Base 12.0 calibrated
  // from 5-season ATS. Early season is noisier → wider sigma.
  const _minGamesForSigma = Math.min(homeStats.totalGames || 0, awayStats.totalGames || 0);
  let nbaSigma = 12.0;
  if (_minGamesForSigma < 10) nbaSigma += 1.5;
  else if (_minGamesForSigma < 20) nbaSigma += 0.8;
  else if (_minGamesForSigma < 35) nbaSigma += 0.3;
  else if (_minGamesForSigma >= 65) nbaSigma -= 0.3;
  // Games between bad teams are less predictable
  const _hwpSeason = homeStats.totalGames > 0 ? (homeStats.wins || 0) / homeStats.totalGames : 0.5;
  const _awpSeason = awayStats.totalGames > 0 ? (awayStats.wins || 0) / awayStats.totalGames : 0.5;
  if (_hwpSeason < 0.40 && _awpSeason < 0.40) nbaSigma += 0.5;
  nbaSigma = Math.max(10.5, Math.min(14.5, nbaSigma));

  let hwp = 1 / (1 + Math.pow(10, -spread / nbaSigma));
  // NBA-M2 FIX (v16): Widened caps from [0.07, 0.93] to [0.05, 0.95]
  // Previous caps were too tight for extreme matchups, suppressing edge detection
  // on heavy favorites. 0.95 still prevents absurd certainty while allowing
  // the model to express strong conviction on 15+ pt spreads.
  hwp = Math.min(0.95, Math.max(0.05, hwp));
  if (calibrationFactor !== 1.0) {
    hwp = Math.min(0.95, Math.max(0.05, 0.5 + (hwp - 0.5) * calibrationFactor));
  }
  const mml = hwp >= 0.5 ? -Math.round((hwp / (1 - hwp)) * 100) : +Math.round(((1 - hwp) / hwp) * 100);
  const aml = hwp >= 0.5 ? +Math.round(((1 - hwp) / hwp) * 100) : -Math.round((hwp / (1 - hwp)) * 100);

  // ── NBA-C1 FIX (v16): Confidence = DATA QUALITY only ──
  // Previously mixed prediction strength (netGap=35pts, winPctStrength=30pts) into
  // confidence, causing HIGH confidence on lopsided games even when data was sparse.
  // Now matches NCAA v20.1 / MLB pattern: confidence is ONLY about data completeness,
  // season progress, and extra data sources.
  // Decisiveness (how far from 50%) is computed separately (NBA-C2).
  const minGames = Math.min(homeStats.totalGames || 0, awayStats.totalGames || 0);

  // Component 1: Base (20 pts) — minimum for any game with loaded data
  const basePts = minGames >= 3 ? 20 : 10;

  // Component 2: Season maturity (0-25 pts) — more games = more stable stats
  const sampleWeight = Math.min(1.0, minGames / 25);
  const seasonPts = Math.round(sampleWeight * 25);

  // Component 3: Data completeness (0-30 pts) — which stat sources are available?
  const hasGranularStats = !!(homeStats.fgPct && awayStats.fgPct && homeStats.turnovers && awayStats.turnovers);
  const dataChecks = [
    homeStats.ppg > 0 && awayStats.ppg > 0,                 // basic stats loaded
    homeStats.fgPct > 0 && awayStats.fgPct > 0,             // shooting stats
    homeStats.pace > 0 && awayStats.pace > 0,               // tempo available
    homeStats.oppPpg !== 112.0 && awayStats.oppPpg !== 112.0, // AUDIT M1 FIX: was || (passed if only 1 team had real data)
    homeStats.formScore != null && awayStats.formScore != null, // form/trend data
    minGames >= 5,                                            // enough games for basic stats
  ];
  const dataScore = dataChecks.filter(Boolean).length / dataChecks.length;
  const dataPts = Math.round(dataScore * 30);

  // Component 4: Advanced data sources (0-25 pts)
  const hasRealPace = !!(homeRealStats?.pace && awayRealStats?.pace);
  const hasOppShooting = !!(homeStats.oppFgPct && awayStats.oppFgPct);
  const hasBlocks = !!(homeStats.blocks && awayStats.blocks);
  const extraPts = (hasRealPace ? 8 : 0) + (hasGranularStats ? 7 : 0)
    + (hasOppShooting ? 5 : 0) + (hasBlocks ? 5 : 0);

  const cs = Math.min(100, basePts + seasonPts + dataPts + extraPts);
  const confidence = cs >= 70 ? "HIGH" : cs >= 45 ? "MEDIUM" : "LOW";

  // ── NBA-C2 FIX (v16): Decisiveness = PREDICTION STRENGTH ──
  // Separate from confidence. A 52% pick with HIGH confidence can be more
  // valuable than an 80% pick with LOW confidence — because you TRUST
  // the 52% number enough to bet on the edge.
  const decisiveness = Math.abs(hwp - 0.5) * 100;
  const decisivenessLabel = decisiveness >= 15 ? "STRONG" : decisiveness >= 7 ? "MODERATE" : "LEAN";

  return {
    homeScore: parseFloat(homeScore.toFixed(1)),
    awayScore: parseFloat(awayScore.toFixed(1)),
    homeWinPct: hwp, awayWinPct: 1 - hwp,
    projectedSpread: spread,
    ouTotal,  // PPG-based (not from homeScore+awayScore which is spread-optimized)
    modelML_home: mml, modelML_away: aml,
    confidence, confScore: cs,
    decisiveness, decisivenessLabel,  // NBA-C2: now returned like NCAA/MLB/NFL
    possessions: parseFloat(poss.toFixed(1)),
    homeNetRtg: parseFloat((homeRealStats?.netRtg || homeStats.netRtg)?.toFixed(2)),
    awayNetRtg: parseFloat((awayRealStats?.netRtg || awayStats.netRtg)?.toFixed(2)),
    neutralSite, usingRealPace: hasRealPace || hasGranularStats,
    // NBA-05: expose Four Factors for display/debugging
    homeFourFactors: homeFFactors,
    awayFourFactors: awayFFactors,
  };
}

// ─────────────────────────────────────────────────────────────
// ODDS MATCHER
// ─────────────────────────────────────────────────────────────
export function matchNBAOddsToGame(o, g) {
  if (!o || !g) return false;
  const n = s => (s || "").toLowerCase().replace(/[\s\W]/g, "");
  return (n(o.homeTeam).includes(n(g.homeTeamName || "").slice(0, 6)) || n(g.homeTeamName || "").includes(n(o.homeTeam).slice(0, 6))) &&
         (n(o.awayTeam).includes(n(g.awayTeamName || "").slice(0, 6)) || n(g.awayTeamName || "").includes(n(o.awayTeam).slice(0, 6)));
}
