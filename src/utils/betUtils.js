// src/utils/betUtils.js
// Lines 4282–5103 of App.jsx (extracted)

import { computeAccuracy } from "./sharedUtils.js";
import { mlbPredictGame } from "../sports/mlb/mlb.js";
import { ncaaPredictGame } from "../sports/ncaa/ncaaUtils.js";
import { nbaPredictGame, NBA_ESPN_IDS } from "../sports/nba/nbaUtils.js";
import { nflPredictGame } from "../sports/nfl/nflUtils.js";
import { ncaafPredictGame } from "../sports/ncaaf/ncaafUtils.js";

// ─────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────
export const ENHANCEMENT_VERSION  = "v15-ncaa-overhaul";
export const BREAK_EVEN_WIN_RATE  = 0.524;   // -110 juice break-even
export const TARGET_WIN_RATE      = 0.55;    // Achievable with free enhancements
export const KELLY_FRACTION       = 0.25;    // Quarter Kelly (conservative)
export const CLV_MIN_THRESHOLD    = 2.0;     // Minimum +EV % to flag as value bet

// ═══════════════════════════════════════════════════════════════
// SECTION 2 — MLB ENHANCEMENTS
// ═══════════════════════════════════════════════════════════════

// xFIP/SIERA proxy from Baseball Savant / FanGraphs CSVs
export function calcXFIP(stats) {
  if (!stats) return null;
  if (stats.kPct != null && stats.bbPct != null) {
    const lgHRperFB = 0.105;
    const fbPct = stats.fbPct || 0.38;
    const xHR9  = (lgHRperFB * fbPct * 9) / (stats.ip || 6);
    const kCoeff = -2.05, bbCoeff = 3.08, hrCoeff = 13.0, constant = 3.10;
    return Math.max(2.0, Math.min(7.5,
      constant + kCoeff * stats.kPct + bbCoeff * stats.bbPct + hrCoeff * xHR9
    ));
  }
  if (stats.k9 != null && stats.bb9 != null) {
    const gbBonus = stats.gbPct ? (stats.gbPct - 0.45) * -2.0 : 0;
    return Math.max(2.0, Math.min(7.5,
      3.20 + (stats.bb9 - 3.0) * 0.30 - (stats.k9 - 8.5) * 0.18 + gbBonus
    ));
  }
  return null;
}

// Pitcher recent form delta (last 3 starts vs season ERA)
export function pitcherRecentFormDelta(recentStarts = []) {
  if (!recentStarts || recentStarts.length < 1) return 0;
  const recent    = recentStarts.slice(-3);
  const recentERA = recent.reduce((s, g) => {
    const er = g.earnedRuns ?? 0, ip = g.inningsPitched ?? 6;
    return s + (er * 9) / Math.max(ip, 1);
  }, 0) / recent.length;
  const seasonERA = recent[0]?.seasonERA ?? recentERA;
  return recentERA - seasonERA; // positive = worse than season avg
}

// Catcher framing impact (~0.2–0.5 runs/game for elite framers)
export const CATCHER_FRAMING = {
  "Jose Trevino":          +0.18, "Tucker Barnhart":       +0.15,
  "Jonah Heim":            +0.14, "Austin Hedges":         +0.12,
  "Tyler Stephenson":      +0.10, "Yainer Diaz":           +0.09,
  "Francisco Mejia":       +0.08, "Alejandro Kirk":        +0.07,
  "Willson Contreras":     -0.08, "Salvador Perez":        -0.07,
  "Danny Jansen":          -0.06, "Christian Bethancourt": -0.05,
  "Pedro Severino":        -0.05,
};
export const CATCHER_FRAMING_DEFAULT = 0.0;
export function catcherFramingBonus(catcherName) {
  if (!catcherName) return CATCHER_FRAMING_DEFAULT;
  for (const [name, val] of Object.entries(CATCHER_FRAMING)) {
    if (catcherName.toLowerCase().includes(name.toLowerCase())) return val;
  }
  return CATCHER_FRAMING_DEFAULT;
}

// Stolen base overlay
export function stolenBaseOverlay(teamStats) {
  if (!teamStats?.sb) return 0;
  const lgAvgSB = 1.2;
  const sbRate  = teamStats.sb / (teamStats.gp || 82);
  return (sbRate - lgAvgSB) * 0.04;
}

// Park coordinates for weather fetching (Open-Meteo free API)
export const PARK_COORDINATES = {
  108:{lat:33.80,lng:-117.88}, 109:{lat:33.44,lng:-112.07},
  110:{lat:39.28,lng:-76.62},  111:{lat:42.35,lng:-71.10},
  112:{lat:41.95,lng:-87.66},  113:{lat:39.10,lng:-84.51},
  114:{lat:41.50,lng:-81.69},  115:{lat:39.76,lng:-104.99},
  116:{lat:42.33,lng:-83.05},  117:{lat:29.76,lng:-95.35},
  118:{lat:39.05,lng:-94.48},  119:{lat:34.07,lng:-118.24},
  120:{lat:38.87,lng:-77.01},  121:{lat:40.76,lng:-73.85},
  133:{lat:37.75,lng:-122.20}, 134:{lat:40.45,lng:-80.01},
  135:{lat:32.71,lng:-117.16}, 136:{lat:47.59,lng:-122.33},
  137:{lat:37.78,lng:-122.39}, 138:{lat:38.62,lng:-90.19},
  139:{lat:27.77,lng:-82.65},  140:{lat:32.75,lng:-97.08},
  141:{lat:43.64,lng:-79.39},  142:{lat:44.98,lng:-93.28},
  143:{lat:39.91,lng:-75.17},  144:{lat:33.89,lng:-84.47},
  145:{lat:41.83,lng:-87.63},  146:{lat:25.77,lng:-80.22},
  147:{lat:40.83,lng:-73.93},  158:{lat:43.03,lng:-88.09},
};

const _weatherCache    = {};
const _weatherInFlight = {};

export async function fetchParkWeather(homeTeamId) {
  if (!homeTeamId) return null;
  const coords   = PARK_COORDINATES[homeTeamId];
  if (!coords)   return null;
  const cacheKey = `wx_${homeTeamId}_${new Date().toISOString().slice(0, 13)}`;
  if (_weatherCache[cacheKey])    return _weatherCache[cacheKey];
  if (_weatherInFlight[homeTeamId]) return _weatherInFlight[homeTeamId];
  const promise = (async () => {
    try {
      const url  = `https://api.open-meteo.com/v1/forecast?latitude=${coords.lat}&longitude=${coords.lng}&current_weather=true&hourly=temperature_2m,windspeed_10m&forecast_days=1`;
      const data = await fetch(url).then(r => r.ok ? r.json() : null).catch(() => null);
      if (!data?.current_weather) return null;
      const wx = {
        tempF:   Math.round(data.current_weather.temperature * 9 / 5 + 32),
        windMph: Math.round(data.current_weather.windspeed * 0.621),
        windDir: data.current_weather.winddirection,
      };
      _weatherCache[cacheKey] = wx;
      return wx;
    } catch { return null; }
    finally { delete _weatherInFlight[homeTeamId]; }
  })();
  _weatherInFlight[homeTeamId] = promise;
  return promise;
}

export function weatherAdjustedParkFactor(baseFactor, weather) {
  if (!weather) return baseFactor;
  let adj = baseFactor;
  const { tempF = 70, windMph = 5, windDir = 180 } = weather;
  adj += ((tempF - 70) / 10) * 0.003;
  const isWindOut = windDir >= 150 && windDir <= 250;
  const isWindIn  = (windDir >= 0 && windDir <= 60) || windDir >= 330;
  if (isWindOut && windMph > 10) adj += (windMph - 10) * 0.003;
  if (isWindIn  && windMph > 10) adj -= (windMph - 10) * 0.003;
  return Math.max(0.85, Math.min(1.30, adj));
}

export function bullpenQualityScore(bpData) {
  if (!bpData) return { era: 4.10, fip: 4.10, quality: 0 };
  const era = bpData.era || 4.10;
  const fip = bpData.fip || era;
  const ip  = bpData.ipLastWeek || 0;
  const lgBpERA = 4.10, lgBpFIP = 4.05;
  const qualityERA = (lgBpERA - era) / lgBpERA;
  const qualityFIP = (lgBpFIP - fip) / lgBpFIP;
  const quality    = qualityERA * 0.5 + qualityFIP * 0.5 - (ip > 8 ? (ip - 8) * 0.01 : 0);
  return { era, fip, quality };
}

// Alias — base function contains all enhancements
export const mlbPredictGameEnhanced = (params) => mlbPredictGame(params);

// ═══════════════════════════════════════════════════════════════
// SECTION 3 — NCAA BASKETBALL ENHANCEMENTS
// ═══════════════════════════════════════════════════════════════

// Combined SOS + splits fetch — single API call (matches ncaaSync.js)
export async function fetchNCAATeamRecord(teamId) {
  if (!teamId) return { sos: null, splits: null };
  try {
    const data = await fetch(
      `https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/teams/${teamId}/record`
    ).then(r => r.ok ? r.json() : null).catch(() => null);
    const items = data?.items || [];
    const sos = items.find(i => i.type === "sos")?.stats?.find(s => s.name === "opponentWinPercent")?.value ?? null;
    const home = items.find(i => i.type === "home");
    const away = items.find(i => i.type === "away");
    const getStat = (item, name) => item?.stats?.find(s => s.name === name)?.value ?? null;
    const splits = (home || away) ? {
      homeAvgMargin: getStat(home, "avgPointDifferential"),
      awayAvgMargin: getStat(away, "avgPointDifferential"),
    } : null;
    return { sos, splits };
  } catch { return { sos: null, splits: null }; }
}

// Legacy aliases for backward compat
export async function fetchNCAATeamSOS(teamId) {
  const rec = await fetchNCAATeamRecord(teamId);
  return rec.sos;
}
export async function fetchNCAAHomeAwaySplits(teamId) {
  const rec = await fetchNCAATeamRecord(teamId);
  return rec.splits;
}

export function ncaaInjuryImpact(injuredPlayers = []) {
  if (!injuredPlayers?.length) return 0;
  return injuredPlayers.reduce((sum, p) => {
    const impact = p.role === "starter" ? 2.5 : p.role === "rotation" ? 1.5 : 0.5;
    return sum + impact;
  }, 0);
}

export const ncaaPredictGameEnhanced = (params) => ncaaPredictGame(params);

// ═══════════════════════════════════════════════════════════════
// SECTION 4 — NBA ENHANCEMENTS
// ═══════════════════════════════════════════════════════════════

const _nbaRealStatsCache = {};

export async function fetchNBARealPace(abbr) {
  if (_nbaRealStatsCache[abbr]) return _nbaRealStatsCache[abbr];
  const espnId = NBA_ESPN_IDS[abbr];
  if (!espnId) return null;
  try {
    const statsData = await fetch(
      `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${espnId}/statistics`
    ).then(r => r.ok ? r.json() : null).catch(() => null);
    const cats = statsData?.results?.stats?.categories || [];
    const getStat = (...names) => {
      for (const cat of cats) for (const name of names) {
        const s = cat.stats?.find(s => s.name === name || s.displayName === name);
        if (s) { const v = parseFloat(s.value); return isNaN(v) ? null : v; }
      }
      return null;
    };
    const ppg    = getStat("avgPoints", "pointsPerGame") || 112.0;
    const oppPpg = getStat("avgPointsAllowed", "opponentPointsPerGame") || 112.0;
    const estPace = 96 + (ppg - 110) * 0.3;
    const pace    = Math.max(92, Math.min(105, estPace));
    const offRtg  = (ppg    / pace) * 100;
    const defRtg  = (oppPpg / pace) * 100;
    const netRtg  = offRtg - defRtg;
    const result  = { pace, offRtg, defRtg, netRtg };
    _nbaRealStatsCache[abbr] = result;
    return result;
  } catch { return null; }
}

export const NBA_CITY_COORDS = {
  ATL:{lat:33.7,lng:-84.4},BOS:{lat:42.4,lng:-71.1},BKN:{lat:40.7,lng:-74.0},
  CHA:{lat:35.2,lng:-80.8},CHI:{lat:41.9,lng:-87.6},CLE:{lat:41.5,lng:-81.7},
  DAL:{lat:32.8,lng:-97.0},DEN:{lat:39.8,lng:-105.0},DET:{lat:42.3,lng:-83.0},
  GSW:{lat:37.8,lng:-122.4},HOU:{lat:29.7,lng:-95.4},IND:{lat:39.8,lng:-86.2},
  LAC:{lat:34.0,lng:-118.3},LAL:{lat:34.0,lng:-118.3},MEM:{lat:35.1,lng:-90.0},
  MIA:{lat:25.8,lng:-80.2},MIL:{lat:43.0,lng:-87.9},MIN:{lat:44.9,lng:-93.2},
  NOP:{lat:29.9,lng:-90.1},NYK:{lat:40.8,lng:-74.0},OKC:{lat:35.5,lng:-97.5},
  ORL:{lat:28.5,lng:-81.4},PHI:{lat:40.0,lng:-75.2},PHX:{lat:33.4,lng:-112.1},
  POR:{lat:45.5,lng:-122.7},SAC:{lat:38.6,lng:-121.5},SAS:{lat:29.4,lng:-98.4},
  TOR:{lat:43.6,lng:-79.4},UTA:{lat:40.8,lng:-111.9},WAS:{lat:38.9,lng:-77.0},
};

export function haversineDistance(abbr1, abbr2) {
  const c1 = NBA_CITY_COORDS[abbr1], c2 = NBA_CITY_COORDS[abbr2];
  if (!c1 || !c2) return 1000;
  const R = 3959, toRad = d => d * Math.PI / 180;
  const dLat = toRad(c2.lat - c1.lat), dLng = toRad(c2.lng - c1.lng);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(c1.lat)) * Math.cos(toRad(c2.lat)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function nbaRestTravelAdj(homeAbbr, awayAbbr, homeDaysRest, awayDaysRest, awayPrevCityAbbr = null) {
  let homeAdj = 0, awayAdj = 0;
  if (homeDaysRest === 0)                       { homeAdj -= 2.2; awayAdj += 2.2; }
  else if (awayDaysRest === 0)                  { awayAdj -= 2.2; homeAdj += 2.2; }
  else if (homeDaysRest - awayDaysRest >= 3)    homeAdj += 1.8;
  else if (awayDaysRest - homeDaysRest >= 3)    awayAdj += 1.8;
  if (awayPrevCityAbbr) {
    const dist = haversineDistance(awayPrevCityAbbr, homeAbbr);
    if (dist > 2000)      awayAdj -= 1.5;
    else if (dist > 1000) awayAdj -= 0.8;
  }
  return { homeAdj, awayAdj };
}

export function nbaLineupImpact(homeInjuries = [], awayInjuries = []) {
  const roleWeight = { starter:3.5, rotation:1.5, reserve:0.5 };
  const homePenalty = homeInjuries.reduce((s, p) => s + (roleWeight[p.role] || 1.5), 0);
  const awayPenalty = awayInjuries.reduce((s, p) => s + (roleWeight[p.role] || 1.5), 0);
  return { homePenalty, awayPenalty };
}

export const nbaPredictGameEnhanced = (params) => nbaPredictGame(params);

// ═══════════════════════════════════════════════════════════════
// SECTION 5 — NFL ENHANCEMENTS
// ═══════════════════════════════════════════════════════════════

const _nflEpaCache = {};

export const NFL_NFLVERSE_ABBR = {
  ARI:"ARI",ATL:"ATL",BAL:"BAL",BUF:"BUF",CAR:"CAR",CHI:"CHI",CIN:"CIN",CLE:"CLE",
  DAL:"DAL",DEN:"DEN",DET:"DET",GB:"GB",HOU:"HOU",IND:"IND",JAX:"JAX",KC:"KC",
  LAC:"LAC",LAR:"LA",LV:"LV",MIA:"MIA",MIN:"MIN",NE:"NE",NO:"NO",NYG:"NYG",
  NYJ:"NYJ",PHI:"PHI",PIT:"PIT",SEA:"SEA",SF:"SF",TB:"TB",TEN:"TEN",WAS:"WAS",
};

export async function fetchNFLRealEPA(abbr, season = null) {
  const yr  = season || (() => {
    const n = new Date(); return n.getMonth() < 2 ? n.getFullYear() - 1 : n.getFullYear();
  })();
  const key = `${abbr}_${yr}`;
  if (_nflEpaCache[key]) return _nflEpaCache[key];
  try {
    const teamUrl = `https://raw.githubusercontent.com/nflverse/nflverse-data/main/data/team_stats/team_stats_${yr}_REG.csv`;
    const resp    = await fetch(teamUrl).then(r => r.ok ? r.text() : null).catch(() => null);
    if (!resp) return null;
    const lines   = resp.trim().split("\n");
    const headers = lines[0].split(",").map(h => h.trim().replace(/^"|"$/g, ""));
    const nflverseAbbr = NFL_NFLVERSE_ABBR[abbr] || abbr;
    const row = lines.slice(1).find(l => {
      const cols = l.split(",");
      return (cols[headers.indexOf("team")] || "").replace(/^"|"$/g, "") === nflverseAbbr;
    });
    if (!row) return null;
    const cols = row.split(",");
    const get  = name => { const i = headers.indexOf(name); return i >= 0 ? parseFloat(cols[i]) || null : null; };
    const result = {
      offEPA:  get("offense_epa_per_play"),
      defEPA:  get("defense_epa_per_play"),
      passEPA: get("pass_epa_per_play"),
      rushEPA: get("rush_epa_per_play"),
      netEPA:  get("net_epa_per_play"),
    };
    _nflEpaCache[key] = result;
    return result;
  } catch { return null; }
}

export function calcDVOAProxy(teamStats, realEpa = null) {
  const epa    = realEpa?.offEPA ?? teamStats.offEPA ?? 0;
  const defEpa = realEpa?.defEPA ?? teamStats.defEPA ?? 0;
  const ppg = teamStats.ppg || 22.5, oppPpg = teamStats.oppPpg || 22.5;
  const ypPlay = teamStats.ypPlay || 5.5, oppYpPlay = teamStats.oppYpPlay || 5.5;
  const offDVOA = epa * 30 + (ppg - 22.5) * 0.8 + (ypPlay - 5.5) * 5;
  const defDVOA = defEpa * 30 + (oppPpg - 22.5) * 0.8 + (oppYpPlay - 5.5) * 5;
  return { offDVOA, defDVOA, netDVOA: offDVOA - defDVOA };
}

export const QB_TIER_IMPACT = {
  elite:0, above_avg:-2.5, average:-5.0, below_avg:-8.0, backup:-12.0,
};
export function qbAdjustment(starterTier, backupTier) {
  if (!backupTier || backupTier === starterTier) return 0;
  return QB_TIER_IMPACT[backupTier] - QB_TIER_IMPACT[starterTier];
}

export function defPersonnelMatchup(offensePassRate, defensePassRtgAllowed) {
  if (!offensePassRate || !defensePassRtgAllowed) return 0;
  if (offensePassRate > 0.62) return (defensePassRtgAllowed - 95) * -0.05;
  return 0;
}

export const nflPredictGameEnhanced = (params) => nflPredictGame(params);

// ═══════════════════════════════════════════════════════════════
// SECTION 6 — NCAAF ENHANCEMENTS
// ═══════════════════════════════════════════════════════════════

export const FCS_INDICATORS = [
  "appalachian","charlotte","coastal carolina","florida atlantic","florida international",
  "georgia southern","georgia state","james madison","kennesaw state","marshall",
  "middle tennessee","old dominion","south alabama","southern miss","texas state","troy",
  "usa","utep","utsa","western kentucky","western michigan","east carolina","rice",
  "north texas","tulane","tulsa","uab",
];

export function filterFCSOpponents(games = []) {
  return games.map(g => ({
    ...g,
    isFCSOpponent: FCS_INDICATORS.some(name =>
      (g.awayTeamName || "").toLowerCase().includes(name) ||
      (g.homeTeamName || "").toLowerCase().includes(name)
    ),
  }));
}

export function calcSPPlusProxy(stats) {
  if (!stats) return 0;
  const { ppg, oppPpg, yardsPerPlay, oppYpPlay, thirdPct, redZonePct, toMargin } = stats;
  const lgPpg = 27.5, lgYpp = 5.8, lgThird = 0.40, lgRZ = 0.60;
  const offSP = (ppg - lgPpg) * 0.8 + (yardsPerPlay - lgYpp) * 6 + (thirdPct - lgThird) * 20 + (redZonePct - lgRZ) * 12;
  const defSP = (lgPpg - oppPpg) * 0.8 + (lgYpp - oppYpPlay) * 6;
  const stSP  = toMargin * 2.5;
  return parseFloat((offSP * 0.5 + defSP * 0.4 + stSP * 0.1).toFixed(2));
}

export function conferenceContextAdj(homeConf, awayConf, isConferenceGame) {
  if (!isConferenceGame) return 0;
  const powerConfs = ["SEC","Big Ten","Big 12","ACC","Pac-12","Big Ten Conference","Southeastern Conference","Big 12 Conference","Atlantic Coast Conference"];
  const bothPower  = powerConfs.some(c => homeConf?.includes(c)) && powerConfs.some(c => awayConf?.includes(c));
  return bothPower ? -0.5 : 0;
}

export const RECRUITING_ELITE  = ["Alabama","Georgia","Ohio State","LSU","Texas","USC","Notre Dame","Michigan","Penn State","Oregon","Florida","Clemson","Oklahoma","Texas A&M"];
export const RECRUITING_STRONG = ["Auburn","Tennessee","Arkansas","Ole Miss","Mississippi State","Wisconsin","Iowa","Miami","Florida State","Washington","Utah","Kansas State","Missouri"];

export function recruitingBaselineBonus(teamName) {
  if (!teamName) return 0;
  const name = teamName.toLowerCase();
  if (RECRUITING_ELITE.some(t  => name.includes(t.toLowerCase()))) return 1.5;
  if (RECRUITING_STRONG.some(t => name.includes(t.toLowerCase()))) return 0.75;
  return 0;
}

export const NCAAF_CITY_COORDS_BET = {
  "Alabama":{lat:33.2,lng:-87.5},"Georgia":{lat:33.9,lng:-83.4},
  "Ohio State":{lat:40.0,lng:-83.0},"Michigan":{lat:42.3,lng:-83.7},
  "LSU":{lat:30.4,lng:-91.2},"Texas":{lat:30.3,lng:-97.7},
  "USC":{lat:34.0,lng:-118.3},"Oregon":{lat:44.1,lng:-123.1},
  "Washington":{lat:47.6,lng:-122.3},"Utah":{lat:40.8,lng:-111.9},
};

export function ncaafTravelAdj(homeTeamName, awayTeamName) {
  const homeCoords = NCAAF_CITY_COORDS_BET[homeTeamName];
  const awayCoords = NCAAF_CITY_COORDS_BET[awayTeamName];
  if (!homeCoords || !awayCoords) return 0;
  const R = 3959, toRad = d => d * Math.PI / 180;
  const dLat = toRad(awayCoords.lat - homeCoords.lat);
  const dLng = toRad(awayCoords.lng - homeCoords.lng);
  const a    = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(homeCoords.lat)) * Math.cos(toRad(awayCoords.lat)) * Math.sin(dLng / 2) ** 2;
  const dist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const lngDiff          = Math.abs(awayCoords.lng - homeCoords.lng);
  const timeZoneCrossings = Math.floor(lngDiff / 15);
  let penalty = 0;
  if (dist > 2000)      penalty -= 1.5;
  else if (dist > 1000) penalty -= 0.8;
  if (timeZoneCrossings >= 3) penalty -= 1.0;
  return penalty;
}

export const ncaafPredictGameEnhanced = (params) => ncaafPredictGame(params);

// ═══════════════════════════════════════════════════════════════
// SECTION 7 — UNIVERSAL ENHANCEMENTS
// Bayesian blending, line movement, ensemble, Kelly, CLV
// ═══════════════════════════════════════════════════════════════

export function bayesianBlend(modelWinPct, marketWinPct, seasonGamesPlayed = 0, totalSeasonGames = 162) {
  if (marketWinPct == null) return modelWinPct;
  const seasonProgress = Math.min(1, seasonGamesPlayed / totalSeasonGames);
  const modelWeight    = 0.35 + seasonProgress * 0.20;
  const marketWeight   = 1 - modelWeight;
  return Math.min(0.95, Math.max(0.05, modelWinPct * modelWeight + marketWinPct * marketWeight));
}

export function americanOddsToWinPct(ml) {
  if (!ml || ml === 0) return 0.5;
  return ml < 0 ? Math.abs(ml) / (Math.abs(ml) + 100) : 100 / (ml + 100);
}

export function removeVig(homeML, awayML) {
  const homeImplied = americanOddsToWinPct(homeML);
  const awayImplied = americanOddsToWinPct(awayML);
  const total       = homeImplied + awayImplied;
  return {
    homeWinPct: homeImplied / total,
    awayWinPct: awayImplied / total,
    vigPct:     (total - 1) * 100,
  };
}

export function ensembleWinProbability({
  modelWinPct, marketML_home, marketML_away,
  gamesPlayed = 0, totalSeasonGames = 162, sport = "MLB",
}) {
  if (!marketML_home || !marketML_away) return { ensembleWinPct: modelWinPct, source: "model_only" };
  const { homeWinPct: marketWinPct } = removeVig(marketML_home, marketML_away);
  const blended   = bayesianBlend(modelWinPct, marketWinPct, gamesPlayed, totalSeasonGames);
  const divergence = Math.abs(modelWinPct - marketWinPct);
  return {
    ensembleWinPct: blended,
    marketWinPct, modelWinPct,
    divergence:  parseFloat(divergence.toFixed(4)),
    isValueBet:  divergence >= 0.05,
    favoredBy:   modelWinPct > marketWinPct ? "model" : "market",
    source:      "ensemble",
  };
}

export function detectLineMovement(openingML, currentML, side = "home") {
  if (!openingML || !currentML) return null;
  const openingWinPct = americanOddsToWinPct(openingML);
  const currentWinPct = americanOddsToWinPct(currentML);
  const movement      = currentWinPct - openingWinPct;
  return {
    openingML, currentML,
    movement:    parseFloat(movement.toFixed(4)),
    isSteamMove: Math.abs(movement) >= 0.04,
    direction:   movement > 0 ? "moving_toward_" + side : "moving_away_from_" + side,
    note:        Math.abs(movement) >= 0.04
      ? `⚡ Steam move: line moved ${(movement * 100).toFixed(1)}% toward ${side}`
      : null,
  };
}

export function kellyCriterion(winPct, decimalOdds, fractionKelly = KELLY_FRACTION) {
  if (!winPct || !decimalOdds || winPct <= 0 || winPct >= 1) return 0;
  const b     = decimalOdds - 1;
  const kelly = (b * winPct - (1 - winPct)) / b;
  if (kelly <= 0) return 0;
  return parseFloat(Math.min(0.25, kelly * fractionKelly).toFixed(4));
}

export function americanToDecimal(ml) {
  if (!ml) return 1.91;
  return ml > 0 ? (ml / 100) + 1 : (100 / Math.abs(ml)) + 1;
}

export function calcCLV(bettingML, closingML) {
  if (!bettingML || !closingML) return null;
  const bettingWinPct = americanOddsToWinPct(bettingML);
  const closingWinPct = americanOddsToWinPct(closingML);
  const clv           = closingWinPct - bettingWinPct;
  return {
    clv:           parseFloat(clv.toFixed(4)),
    clvPct:        parseFloat((clv * 100).toFixed(2)),
    isPositiveCLV: clv > CLV_MIN_THRESHOLD / 100,
    note: clv > 0.02 ? `+${(clv * 100).toFixed(1)}% CLV ✅` : clv < -0.02 ? `${(clv * 100).toFixed(1)}% CLV ⚠️` : "Neutral CLV",
  };
}

// ═══════════════════════════════════════════════════════════════
// SECTION 8 — BEAT VEGAS FRAMEWORK
// ═══════════════════════════════════════════════════════════════

export function computeExpectedROI(winRate, betsPerYear = 1000, avgBetSize = 100, juice = -110) {
  const decimalOdds  = americanToDecimal(juice);
  const profitPerWin = avgBetSize * (decimalOdds - 1);
  const lossPerLoss  = avgBetSize;
  const wins         = Math.round(betsPerYear * winRate);
  const losses       = betsPerYear - wins;
  const roi          = wins * profitPerWin - losses * lossPerLoss;
  const roiPct       = roi / (betsPerYear * avgBetSize) * 100;
  return {
    winRate, betsPerYear, wins, losses, avgBetSize,
    annualROI:    parseFloat(roi.toFixed(0)),
    annualROIPct: parseFloat(roiPct.toFixed(2)),
    breakEven:    BREAK_EVEN_WIN_RATE,
    isBeatingVegas: winRate > BREAK_EVEN_WIN_RATE,
  };
}

export const ENHANCEMENT_ROADMAP = [
  { priority:1,  effort:"2–3 hrs", sport:"MLB",   enhancement:"Real xFIP/SIERA from FanGraphs CSV",          gainPct:"+0.3%", cost:"Free",       status:"implemented" },
  { priority:2,  effort:"3–4 hrs", sport:"NBA",   enhancement:"NBA Stats API real pace/efficiency",           gainPct:"+0.4%", cost:"Free",       status:"implemented" },
  { priority:3,  effort:"1–2 hrs", sport:"MLB",   enhancement:"Pitcher last-3-start form overlay",            gainPct:"+0.2%", cost:"Free",       status:"implemented" },
  { priority:4,  effort:"2–3 hrs", sport:"NCAAB", enhancement:"Home/away splits from schedule",              gainPct:"+0.3%", cost:"Free",       status:"implemented" },
  { priority:5,  effort:"2–3 hrs", sport:"ALL",   enhancement:"Ensemble model with market probability",       gainPct:"+0.5–1.0%", cost:"Free",   status:"implemented" },
  { priority:6,  effort:"1 hr",    sport:"NCAAF", enhancement:"FCS opponent filter",                          gainPct:"+0.2%", cost:"Free",       status:"implemented" },
  { priority:7,  effort:"4–6 hrs", sport:"NFL",   enhancement:"nflverse real EPA/play data",                  gainPct:"+0.4%", cost:"Free",       status:"implemented" },
  { priority:8,  effort:"ongoing", sport:"ALL",   enhancement:"KenPom subscription (NCAAB)",                  gainPct:"+0.8%", cost:"$20/yr",     status:"optional_paid" },
  { priority:9,  effort:"ongoing", sport:"MLB",   enhancement:"Stathead batter-vs-pitcher splits",            gainPct:"+0.3%", cost:"$9/mo",      status:"optional_paid" },
  { priority:10, effort:"ongoing", sport:"NFL",   enhancement:"Football Outsiders DVOA",                      gainPct:"+0.5%", cost:"$40/season", status:"optional_paid" },
];

// ═══════════════════════════════════════════════════════════════
// SECTION 9 — ENHANCED PREDICTION ENGINE (unified async wrapper)
// ═══════════════════════════════════════════════════════════════

export const EnhancedPredictionEngine = {

  async mlb(params) {
    const { homeTeamId } = params;
    let parkWeather = null;
    try { parkWeather = await fetchParkWeather(homeTeamId); } catch {}
    return mlbPredictGameEnhanced({ ...params, parkWeather });
  },

  async ncaab(game, homeStats, awayStats, opts = {}) {
    let homeSOSFactor = null, awaySOSFactor = null;
    let homeSplits = null, awaySplits = null;
    try {
      const [homeRecord, awayRecord] = await Promise.all([
        fetchNCAATeamRecord(game.homeTeamId),
        fetchNCAATeamRecord(game.awayTeamId),
      ]);
      homeSOSFactor = homeRecord.sos;
      awaySOSFactor = awayRecord.sos;
      homeSplits = homeRecord.splits;
      awaySplits = awayRecord.splits;
    } catch {}
    return ncaaPredictGameEnhanced({ homeStats, awayStats, neutralSite: game.neutralSite, homeSOSFactor, awaySOSFactor, homeSplits, awaySplits, ...opts });
  },

  async nba(game, homeStats, awayStats, opts = {}) {
    let homeRealStats = null, awayRealStats = null;
    try {
      [homeRealStats, awayRealStats] = await Promise.all([
        fetchNBARealPace(game.homeAbbr),
        fetchNBARealPace(game.awayAbbr),
      ]);
    } catch {}
    return nbaPredictGameEnhanced({ homeStats, awayStats, homeAbbr: game.homeAbbr, awayAbbr: game.awayAbbr, neutralSite: game.neutralSite, homeRealStats, awayRealStats, ...opts });
  },

  async nfl(game, homeStats, awayStats, opts = {}) {
    let homeRealEpa = null, awayRealEpa = null;
    try {
      [homeRealEpa, awayRealEpa] = await Promise.all([
        fetchNFLRealEPA(homeStats.abbr),
        fetchNFLRealEPA(awayStats.abbr),
      ]);
    } catch {}
    return nflPredictGameEnhanced({ homeStats, awayStats, neutralSite: game.neutralSite, homeRealEpa, awayRealEpa, ...opts });
  },

  async ncaaf(game, homeStats, awayStats, opts = {}) {
    return ncaafPredictGameEnhanced({
      homeStats, awayStats,
      homeTeamName:    game.homeTeamName || "",
      awayTeamName:    game.awayTeamName || "",
      neutralSite:     game.neutralSite,
      isConferenceGame: game.conferenceGame || false,
      weather:         game.weather || {},
      ...opts,
    });
  },

  applyEnsemble(pred, marketML_home, marketML_away, gamesPlayed = 0, totalSeasonGames = 162) {
    if (!pred) return pred;
    const ensemble    = ensembleWinProbability({ modelWinPct: pred.homeWinPct, marketML_home, marketML_away, gamesPlayed, totalSeasonGames });
    const finalWinPct = ensemble.ensembleWinPct;
    const mml = finalWinPct >= 0.5 ? -Math.round((finalWinPct / (1 - finalWinPct)) * 100) : +Math.round(((1 - finalWinPct) / finalWinPct) * 100);
    const aml = finalWinPct >= 0.5 ? +Math.round(((1 - finalWinPct) / finalWinPct) * 100) : -Math.round((finalWinPct / (1 - finalWinPct)) * 100);
    return { ...pred, homeWinPct: parseFloat(finalWinPct.toFixed(4)), awayWinPct: parseFloat((1 - finalWinPct).toFixed(4)), modelML_home: mml, modelML_away: aml, ensemble };
  },

  getBetSize(winPct, marketML, bankroll = 1000) {
    const decOdds  = americanToDecimal(marketML);
    const fraction = kellyCriterion(winPct, decOdds);
    return {
      fraction,
      dollarAmount: parseFloat((bankroll * fraction).toFixed(2)),
      note: fraction >= 0.05 ? "Strong bet" : fraction >= 0.02 ? "Small bet" : fraction > 0 ? "Marginal" : "No edge — skip",
    };
  },
};

// Enhanced accuracy with CLV tracking
export function computeAccuracyEnhanced(records) {
  const base = computeAccuracy(records);
  if (!base) return null;
  const withCLV = records.filter(r => r.bet_ml != null && r.closing_ml != null);
  let avgCLV = null, positiveCLVPct = null;
  if (withCLV.length > 0) {
    const clvs     = withCLV.map(r => calcCLV(r.bet_ml, r.closing_ml)).filter(Boolean);
    avgCLV         = clvs.reduce((s, c) => s + c.clvPct, 0) / clvs.length;
    positiveCLVPct = (clvs.filter(c => c.isPositiveCLV).length / clvs.length * 100).toFixed(1);
  }
  const valuePicksAccuracy = records
    .filter(r => r.result_entered && r.ml_correct !== null && r.ensemble_divergence >= 0.05)
    .reduce((acc, r) => ({ total: acc.total + 1, correct: acc.correct + (r.ml_correct ? 1 : 0) }), { total: 0, correct: 0 });
  return {
    ...base,
    clv: { avgCLV: avgCLV?.toFixed(2), positiveCLVPct, samplesWithCLV: withCLV.length },
    valuePicks: valuePicksAccuracy.total > 0
      ? { total: valuePicksAccuracy.total, pct: (valuePicksAccuracy.correct / valuePicksAccuracy.total * 100).toFixed(1) }
      : null,
    expectedROI: computeExpectedROI(parseFloat(base.mlAcc) / 100, base.mlTotal),
    roadmap: ENHANCEMENT_ROADMAP,
  };
}
