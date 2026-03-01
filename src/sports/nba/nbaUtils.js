// src/sports/nba/nbaUtils.js
// NBA v15 — Forensic Audit Implementation
//
// Fixes implemented:
//   NBA-01: Real Dean Oliver pace (was crude PPG proxy)
//   NBA-02: Kill fetchNBARealPace stub → real ESPN fetch with proper possession calc
//   NBA-04: Fix True Shooting proxy (was mathematically incorrect)
//   NBA-05: Full Four Factors framework (ported from NCAAB v15)
//   NBA-06: Expand fetchNBATeamStats to collect 20+ granular stats
//   NBA-12: Rim protection now uses real collected blocks/fouls
//   NBA-13: Dynamic league averages from team data
//   NBA-14: Consolidated fetchNBARealPace (single canonical implementation)
//   NBA-15: Enhanced confidence score with data quality factors
//   NBA-16: Raised score clamp ceiling to 155

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
  // Compute league eFG% from components
  const lgThreeRate = avg(allTeamStats, "threeAttRate");
  const lgThreePct = _leagueAverages.threePct;
  const lgFgPct = _leagueAverages.fgPct;
  if (lgThreeRate != null) {
    update("eFGpct", lgFgPct + 0.5 * lgThreeRate * lgThreePct);
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
    const fga    = getStat("fieldGoalsAttempted", "avgFieldGoalsAttempted") || 88.0;
    const fta    = getStat("freeThrowsAttempted", "avgFreeThrowsAttempted") || 24.0;
    const offReb = getStat("avgOffensiveRebounds", "offensiveReboundsPerGame") || 10.5;
    const defReb = getStat("avgDefensiveRebounds", "defensiveReboundsPerGame") || 33.5;
    const totalReb = getStat("avgRebounds", "reboundsPerGame") || (offReb + defReb);
    const steals = getStat("avgSteals", "stealsPerGame") || 7.5;
    const blocks = getStat("avgBlocks", "blocksPerGame") || 5.0;
    const threeAtt = getStat("threePointFieldGoalsAttempted", "avgThreePointFieldGoalsAttempted") || (fga * 0.40);
    const foulsPerGame = getStat("avgFouls", "foulsPerGame") || 20.0;

    // ── Opponent defensive stats ──
    const oppFgPct    = normPct(getStat("opponentFieldGoalPct"), 0.471);
    const oppThreePct = normPct(getStat("opponentThreePointFieldGoalPct"), 0.365);

    // ── NBA-01 FIX: Real Dean Oliver possession estimate ──
    // Poss ≈ FGA − ORB + TO + 0.475 × FTA (per game)
    // This replaces the old `96 + (ppg - 110) * 0.3` linear proxy
    const estPoss = fga - offReb + turnovers + 0.475 * fta;
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
        return s + ((tc?.winner || false) ? 1 : -0.6) * (i + 1);
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
            const mapAbbr = a => ({"GS":"GSW","NY":"NYK","NO":"NOP","SA":"SAS"}[a] || a);
            lastGameCity = mapAbbr(homeAbbr);
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
      orbPct, ftaRate, atoRatio, threeAttRate,
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
// NBA-02 FIX: fetchNBARealPace — real ESPN fetch (was a dead stub)
// NBA-14 FIX: Single canonical implementation (was duplicated across 3 files)
//
// This function fetches a SECOND time specifically for pace/ratings.
// In most cases, fetchNBATeamStats already has what we need.
// This is kept for backward compat — CalendarTab and Sync import it.
// It now returns real data from ESPN (not null).
// ─────────────────────────────────────────────────────────────
const _nbaRealStatsCache = {};

export async function fetchNBARealPace(abbr) {
  if (_nbaRealStatsCache[abbr]) return _nbaRealStatsCache[abbr];
  const espnId = NBA_ESPN_IDS[abbr];
  if (!espnId) return null;
  try {
    const statsData = await fetch(
      `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${espnId}/statistics`
    ).then(r => r.ok ? r.json() : null).catch(() => null);
    if (!statsData) return null;
    const cats = statsData?.results?.stats?.categories || [];
    const getStat = (...names) => {
      for (const cat of cats) for (const name of names) {
        const s = cat.stats?.find(s => s.name === name || s.displayName === name);
        if (s) { const v = parseFloat(s.value); return isNaN(v) ? null : v; }
      }
      return null;
    };
    const normPct = (v, fallback) => {
      const p = (v != null && v !== 0) ? v : fallback;
      return p > 1 ? p / 100 : p;
    };

    const ppg    = getStat("avgPoints", "pointsPerGame") || 112.0;
    const oppPpg = getStat("avgPointsAllowed", "opponentPointsPerGame") || 112.0;
    const fga    = getStat("fieldGoalsAttempted", "avgFieldGoalsAttempted") || 88.0;
    const fta    = getStat("freeThrowsAttempted", "avgFreeThrowsAttempted") || 24.0;
    const offReb = getStat("avgOffensiveRebounds", "offensiveReboundsPerGame") || 10.5;
    const turnovers = getStat("avgTurnovers") || 14.0;

    // NBA-01: Real Dean Oliver possessions
    const estPoss = fga - offReb + turnovers + 0.475 * fta;
    const pace = Math.max(90, Math.min(108, estPoss || 99.5));

    const offRtg = (ppg / pace) * 100;
    const defRtg = (oppPpg / pace) * 100;
    const netRtg = offRtg - defRtg;

    const result = { pace, offRtg, defRtg, netRtg };
    _nbaRealStatsCache[abbr] = result;
    return result;
  } catch { return null; }
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
    const mapAbbr = a => ({"GS":"GSW","NY":"NYK","NO":"NOP","SA":"SAS"}[a] || a);
    return data.events.map(ev => {
      const comp = ev.competitions?.[0];
      const home = comp?.competitors?.find(c => c.homeAway === "home");
      const away = comp?.competitors?.find(c => c.homeAway === "away");
      const status = comp?.status?.type;
      return {
        gameId: ev.id, gameDate: ev.date,
        status: status?.completed ? "Final" : status?.state === "in" ? "Live" : "Preview",
        homeAbbr: mapAbbr(home?.team?.abbreviation || ""),
        awayAbbr: mapAbbr(away?.team?.abbreviation || ""),
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
  const lgAvg = lg.ppg;

  // ── Core score projection (offense vs defense matchup) ──
  let homeScore = ((homeOffRtg / lgAvg) * (lgAvg / awayDefRtg) * lgAvg / 100) * poss;
  let awayScore = ((awayOffRtg / lgAvg) * (lgAvg / homeDefRtg) * lgAvg / 100) * poss;

  // ── NBA-05 FIX: Full Four Factors framework ──
  // Dean Oliver weights: eFG% 40%, TO% 25%, ORB% 20%, FTR 15%
  const fourFactorsBoost = (stats) => {
    // eFG% = FG% + 0.5 × 3PA_rate × 3P%
    const threeRate = stats.threeAttRate || 0.40;
    const eFG = (stats.fgPct || lg.fgPct) + 0.5 * threeRate * (stats.threePct || lg.threePct);
    const eFGboost = (eFG - lg.eFGpct) * 8.0; // ~40% weight

    // TO% — turnovers per 100 possessions
    const toPct = stats.pace > 0 ? (stats.turnovers / stats.pace) * 100 : lg.toPct;
    const toBoost = (lg.toPct - toPct) * 0.12; // lower TO% = positive

    // ORB% — offensive rebounding rate
    const orbPctVal = stats.orbPct || lg.orbPct;
    const orbBoost = (orbPctVal - lg.orbPct) * 6.0; // ~20% weight

    // FTA Rate — free throw attempts per FGA
    const ftaRateVal = stats.ftaRate || lg.ftaRate;
    const ftrBoost = (ftaRateVal - lg.ftaRate) * 3.5; // ~15% weight

    return eFGboost + Math.max(-2.5, Math.min(2.5, toBoost)) + orbBoost + ftrBoost;
  };
  const homeFFactors = fourFactorsBoost(homeStats);
  const awayFFactors = fourFactorsBoost(awayStats);

  homeScore += homeFFactors * 0.30;
  awayScore += awayFFactors * 0.30;

  // ── Defensive quality adjustment ──
  const defBoost = (stats) => {
    const oppFGdiff = lg.oppFgPct - (stats.oppFgPct || lg.oppFgPct); // positive = better D
    const oppThreeDiff = lg.oppThreePct - (stats.oppThreePct || lg.oppThreePct);
    const disruption = ((stats.steals || lg.steals) - lg.steals) * 0.08
                     + ((stats.blocks || lg.blocks) - lg.blocks) * 0.06;
    return oppFGdiff * 5.0 + oppThreeDiff * 3.0 + disruption;
  };
  homeScore += defBoost(homeStats) * 0.18;
  awayScore += defBoost(awayStats) * 0.18;

  // ── Ball control differential ──
  const homeATO = (homeStats.atoRatio || 1.8) - 1.8;
  const awayATO = (awayStats.atoRatio || 1.8) - 1.8;
  const atoBoost = (homeATO - awayATO) * 0.4;
  homeScore += atoBoost * 0.5;
  awayScore -= atoBoost * 0.5;

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
  homeScore += tsBoost(homeStats) * 0.15;
  awayScore += tsBoost(awayStats) * 0.15;

  // ── Home court advantage: 2.4 pts (post-2020 research) ──
  homeScore += (neutralSite ? 0 : 2.4) / 2;
  awayScore -= (neutralSite ? 0 : 2.4) / 2;

  // ── B2B rest penalties ──
  if (homeDaysRest === 0) { homeScore -= 1.8; awayScore += 0.8; }
  else if (awayDaysRest === 0) { awayScore -= 2.2; homeScore += 1.0; }
  else if (homeDaysRest - awayDaysRest >= 3) homeScore += 1.4;
  else if (awayDaysRest - homeDaysRest >= 3) awayScore += 1.4;

  // ── Travel distance penalty (Haversine) ──
  if (awayPrevCityAbbr && homeAbbr) {
    try {
      const dist = haversineDistance(awayPrevCityAbbr, homeAbbr);
      if (dist > 2000) awayScore -= 1.4;
      else if (dist > 1000) awayScore -= 0.7;
    } catch {}
  }

  // ── NBA-12 FIX: Rim protection now uses real collected blocks/fouls ──
  const rimProtection = (blk, oppFouls) => {
    const blkBonus = blk != null ? (blk - (lg.blocks || 5.0)) * 0.18 : 0;
    const foulPenalty = oppFouls != null ? (oppFouls - 20) * -0.06 : 0;
    return blkBonus + foulPenalty;
  };
  homeScore += rimProtection(homeStats.blocks, awayStats.foulsPerGame) * 0.15;
  awayScore += rimProtection(awayStats.blocks, homeStats.foulsPerGame) * 0.15;

  // ── Lineup injury impact ──
  const roleWeight = { starter: 3.2, rotation: 1.5, reserve: 0.5 };
  const homeInjPenalty = (homeInjuries || []).reduce((s, p) => s + (roleWeight[p.role] || 1.5), 0);
  const awayInjPenalty = (awayInjuries || []).reduce((s, p) => s + (roleWeight[p.role] || 1.5), 0);
  homeScore -= homeInjPenalty;
  awayScore -= awayInjPenalty;

  // ── Recent form ──
  const fw = Math.min(0.10, 0.10 * Math.sqrt(Math.min(homeStats.totalGames, 30) / 30));
  homeScore += homeStats.formScore * fw * 3;
  awayScore += awayStats.formScore * fw * 3;

  // ── NBA-16 FIX: Raised ceiling from 148 to 155 for modern NBA ──
  homeScore = Math.max(85, Math.min(155, homeScore));
  awayScore = Math.max(85, Math.min(155, awayScore));

  // ── Win probability (logistic) ──
  const spread = parseFloat((homeScore - awayScore).toFixed(1));
  // NBA logistic sigma = 12.0 (calibrated vs 5-season ATS records)
  let hwp = 1 / (1 + Math.pow(10, -spread / 12.0));
  hwp = Math.min(0.93, Math.max(0.07, hwp));
  if (calibrationFactor !== 1.0) {
    hwp = Math.min(0.93, Math.max(0.07, 0.5 + (hwp - 0.5) * calibrationFactor));
  }
  const mml = hwp >= 0.5 ? -Math.round((hwp / (1 - hwp)) * 100) : +Math.round(((1 - hwp) / hwp) * 100);
  const aml = hwp >= 0.5 ? +Math.round(((1 - hwp) / hwp) * 100) : -Math.round((hwp / (1 - hwp)) * 100);

  // ── NBA-15 FIX: Enhanced confidence score with data quality ──
  const netGap = Math.abs((homeRealStats?.netRtg || homeStats.netRtg) - (awayRealStats?.netRtg || awayStats.netRtg));
  const hasRealPace = !!(homeRealStats?.pace && awayRealStats?.pace);
  const hasGranularStats = !!(homeStats.fgPct && awayStats.fgPct && homeStats.turnovers && awayStats.turnovers);
  const dataQuality = (hasGranularStats ? 10 : 0) + (hasRealPace ? 5 : 0);
  const cs = Math.round(
    (Math.min(netGap, 8) / 8) * 35
    + Math.abs(hwp - 0.5) * 2 * 30
    + Math.min(1, homeStats.totalGames / 20) * 15
    + (homeStats.totalGames >= 10 ? 5 : 0)
    + dataQuality
  );

  return {
    homeScore: parseFloat(homeScore.toFixed(1)),
    awayScore: parseFloat(awayScore.toFixed(1)),
    homeWinPct: hwp, awayWinPct: 1 - hwp,
    projectedSpread: spread,
    ouTotal: parseFloat((homeScore + awayScore).toFixed(1)),
    modelML_home: mml, modelML_away: aml,
    confidence: cs >= 62 ? "HIGH" : cs >= 35 ? "MEDIUM" : "LOW", confScore: cs,
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
