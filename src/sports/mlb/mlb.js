// src/sports/mlb/mlb.js
// Lines 387–807 of App.jsx (extracted)

import { STAT_SEASON, FULL_SEASON_THRESHOLD, SEASON } from "../../utils/sharedUtils.js";

// ─────────────────────────────────────────────────────────────
// TEAMS
// ─────────────────────────────────────────────────────────────
export const MLB_TEAMS = [
  { id: 108, name: "Angels",    abbr: "LAA", league: "AL" },
  { id: 109, name: "D-backs",   abbr: "ARI", league: "NL" },
  { id: 110, name: "Orioles",   abbr: "BAL", league: "AL" },
  { id: 111, name: "Red Sox",   abbr: "BOS", league: "AL" },
  { id: 112, name: "Cubs",      abbr: "CHC", league: "NL" },
  { id: 113, name: "Reds",      abbr: "CIN", league: "NL" },
  { id: 114, name: "Guardians", abbr: "CLE", league: "AL" },
  { id: 115, name: "Rockies",   abbr: "COL", league: "NL" },
  { id: 116, name: "Tigers",    abbr: "DET", league: "AL" },
  { id: 117, name: "Astros",    abbr: "HOU", league: "AL" },
  { id: 118, name: "Royals",    abbr: "KC",  league: "AL" },
  { id: 119, name: "Dodgers",   abbr: "LAD", league: "NL" },
  { id: 120, name: "Nationals", abbr: "WSH", league: "NL" },
  { id: 121, name: "Mets",      abbr: "NYM", league: "NL" },
  { id: 133, name: "Athletics", abbr: "OAK", league: "AL" },
  { id: 134, name: "Pirates",   abbr: "PIT", league: "NL" },
  { id: 135, name: "Padres",    abbr: "SD",  league: "NL" },
  { id: 136, name: "Mariners",  abbr: "SEA", league: "AL" },
  { id: 137, name: "Giants",    abbr: "SF",  league: "NL" },
  { id: 138, name: "Cardinals", abbr: "STL", league: "NL" },
  { id: 139, name: "Rays",      abbr: "TB",  league: "AL" },
  { id: 140, name: "Rangers",   abbr: "TEX", league: "AL" },
  { id: 141, name: "Blue Jays", abbr: "TOR", league: "AL" },
  { id: 142, name: "Twins",     abbr: "MIN", league: "AL" },
  { id: 143, name: "Phillies",  abbr: "PHI", league: "NL" },
  { id: 144, name: "Braves",    abbr: "ATL", league: "NL" },
  { id: 145, name: "White Sox", abbr: "CWS", league: "AL" },
  { id: 146, name: "Marlins",   abbr: "MIA", league: "NL" },
  { id: 147, name: "Yankees",   abbr: "NYY", league: "AL" },
  { id: 158, name: "Brewers",   abbr: "MIL", league: "NL" },
];

export const mlbTeamById = (id) =>
  MLB_TEAMS.find(t => t.id === id) || { name: String(id), abbr: String(id), id, league: "?" };

export const normAbbr = s => (s || "").replace(/\d+$/, "").toUpperCase();

const _resolvedIdCache = {};
export function resolveStatTeamId(teamId, abbr) {
  if (!teamId) return null;
  if (MLB_TEAMS.find(t => t.id === teamId)) return teamId;
  if (_resolvedIdCache[teamId]) return _resolvedIdCache[teamId];
  const baseAbbr = (abbr || "").replace(/\d+$/, "").toUpperCase();
  if (baseAbbr.length >= 2) {
    const parent = MLB_TEAMS.find(t => t.abbr === baseAbbr);
    if (parent) { _resolvedIdCache[teamId] = parent.id; return parent.id; }
  }
  _resolvedIdCache[teamId] = null;
  return null;
}

// ─────────────────────────────────────────────────────────────
// PARK FACTORS
// ─────────────────────────────────────────────────────────────
export const PARK_FACTORS = {
  // hfa: park-specific home field advantage (research: dome teams, altitude, travel burden)
  // Base HFA ~0.035; domes get +0.008; Coors altitude +0.012; West Coast late starts +0.005
  108: { runFactor: 1.02, hfa: 0.033, name: "Angel Stadium" },
  109: { runFactor: 1.03, hfa: 0.038, name: "Chase Field" },       // dome (retractable)
  110: { runFactor: 0.95, hfa: 0.034, name: "Camden Yards" },
  111: { runFactor: 1.04, hfa: 0.037, name: "Fenway Park" },       // quirky dimensions help home team
  112: { runFactor: 1.04, hfa: 0.036, name: "Wrigley Field" },     // wind knowledge
  113: { runFactor: 1.00, hfa: 0.034, name: "Great American" },
  114: { runFactor: 0.97, hfa: 0.035, name: "Progressive" },
  115: { runFactor: 1.16, hfa: 0.048, name: "Coors Field" },       // altitude + humidor = huge HFA
  116: { runFactor: 0.98, hfa: 0.034, name: "Comerica" },
  117: { runFactor: 0.99, hfa: 0.042, name: "Minute Maid" },       // dome (retractable) + Crawford boxes
  118: { runFactor: 1.01, hfa: 0.035, name: "Kauffman" },
  119: { runFactor: 1.00, hfa: 0.038, name: "Dodger Stadium" },    // West Coast travel burden on visitors
  120: { runFactor: 1.01, hfa: 0.034, name: "Nationals Park" },
  121: { runFactor: 1.03, hfa: 0.035, name: "Citi Field" },
  133: { runFactor: 0.99, hfa: 0.032, name: "Oakland Coliseum" },  // low attendance dampens HFA
  134: { runFactor: 0.96, hfa: 0.034, name: "PNC Park" },
  135: { runFactor: 0.95, hfa: 0.037, name: "Petco Park" },        // West Coast
  136: { runFactor: 0.94, hfa: 0.039, name: "T-Mobile Park" },     // dome (retractable) + West Coast
  137: { runFactor: 0.91, hfa: 0.038, name: "Oracle Park" },       // West Coast + quirky RF
  138: { runFactor: 0.97, hfa: 0.035, name: "Busch Stadium" },
  139: { runFactor: 0.96, hfa: 0.041, name: "Tropicana" },         // dome (fixed)
  140: { runFactor: 1.05, hfa: 0.041, name: "Globe Life" },        // dome (retractable)
  141: { runFactor: 1.03, hfa: 0.036, name: "Rogers Centre" },     // dome (retractable) + border travel
  142: { runFactor: 1.00, hfa: 0.035, name: "Target Field" },
  143: { runFactor: 1.06, hfa: 0.036, name: "Citizens Bank" },
  144: { runFactor: 1.02, hfa: 0.035, name: "Truist Park" },
  145: { runFactor: 1.00, hfa: 0.033, name: "Guaranteed Rate" },   // low attendance
  146: { runFactor: 0.97, hfa: 0.040, name: "loanDepot" },         // dome (retractable)
  147: { runFactor: 1.05, hfa: 0.036, name: "Yankee Stadium" },
  158: { runFactor: 0.97, hfa: 0.035, name: "American Family Field" }, // dome (retractable)
};

// ─────────────────────────────────────────────────────────────
// UMPIRE PROFILES
// ─────────────────────────────────────────────────────────────
// Step 18: Expanded from 16 to 76 active umpires.
// runImpact = estimated runs above/below league avg per game from strike zone size.
// Negative = large zone (pitcher-friendly, fewer runs). Positive = small zone (hitter-friendly, more runs).
// Sources: UmpScorecards 2022-2024, SIS Strike Zone Runs Saved, Covers O/U tendencies.
// 2025 note: MLB shrunk umpire evaluation buffer zone (2" → 0.75"), compressing variance.
// Retired: Angel Hernandez (May 2024), Phil Cuzzi (2023), Fieldin Culbreth (2023), Ted Barrett (2024).
export const UMPIRE_PROFILES = {
  // ── Large zone (pitcher-friendly, suppress runs) ──────────────
  "CB Bucknor":       { runImpact: -0.25, size: "Large" },
  "Dan Bellino":      { runImpact: -0.20, size: "Large" },
  "Mike Estabrook":   { runImpact: -0.18, size: "Large" },
  "Doug Eddings":     { runImpact: -0.22, size: "Large" },
  "Bill Miller":      { runImpact: -0.20, size: "Large" },
  "Manny Gonzalez":   { runImpact: -0.15, size: "Large" },
  "Quinn Wolcott":    { runImpact: -0.14, size: "Large" },
  "Tripp Gibson":     { runImpact: -0.16, size: "Large" },
  "Lance Barrett":    { runImpact: -0.13, size: "Large" },
  "Brian O'Nora":     { runImpact: -0.14, size: "Large" },
  "Jansen Visconti":  { runImpact: -0.12, size: "Large" },

  // ── Above average zone ────────────────────────────────────────
  "Nic Lentz":        { runImpact: -0.10, size: "Above Avg" },
  "Marvin Hudson":    { runImpact: -0.10, size: "Above Avg" },
  "Jerry Layne":      { runImpact: -0.09, size: "Above Avg" },
  "Alfonso Marquez":  { runImpact: -0.08, size: "Above Avg" },
  "Chris Conroy":     { runImpact: -0.08, size: "Above Avg" },
  "Adrian Johnson":   { runImpact: -0.07, size: "Above Avg" },
  "Ryan Blakney":     { runImpact: -0.07, size: "Above Avg" },
  "Brennan Miller":   { runImpact: -0.06, size: "Above Avg" },
  "Jeremie Rehak":    { runImpact: -0.06, size: "Above Avg" },
  "Chris Segal":      { runImpact: -0.06, size: "Above Avg" },
  "David Rackley":    { runImpact: -0.05, size: "Above Avg" },

  // ── Average zone ──────────────────────────────────────────────
  "Laz Diaz":         { runImpact:  0.00, size: "Average" },
  "Mark Carlson":     { runImpact:  0.01, size: "Average" },
  "Ron Kulpa":        { runImpact:  0.02, size: "Average" },
  "Dan Iassogna":     { runImpact:  0.00, size: "Average" },
  "Mark Wegner":      { runImpact:  0.01, size: "Average" },
  "Tony Randazzo":    { runImpact: -0.01, size: "Average" },
  "Alan Porter":      { runImpact:  0.00, size: "Average" },
  "Todd Tichenor":    { runImpact: -0.02, size: "Average" },
  "Chad Whitson":     { runImpact:  0.02, size: "Average" },
  "Gabe Morales":     { runImpact:  0.01, size: "Average" },
  "Tom Hallion":      { runImpact: -0.01, size: "Average" },
  "Chris Guccione":   { runImpact:  0.00, size: "Average" },
  "Pat Hoberg":       { runImpact: -0.02, size: "Average" },
  "Jordan Baker":     { runImpact:  0.03, size: "Average" },
  "Cory Blaser":      { runImpact:  0.02, size: "Average" },
  "Alex Tosi":        { runImpact:  0.00, size: "Average" },
  "Chad Fairchild":   { runImpact:  0.01, size: "Average" },
  "D.J. Reyburn":     { runImpact:  0.02, size: "Average" },
  "Clint Vondrak":    { runImpact:  0.00, size: "Average" },
  "Ryan Wills":       { runImpact:  0.01, size: "Average" },
  "Edwin Moscoso":    { runImpact:  0.00, size: "Average" },
  "Shane Livensparger": { runImpact: 0.01, size: "Average" },
  "Nate Tomlinson":   { runImpact:  0.00, size: "Average" },
  "Malachi Moore":    { runImpact:  0.00, size: "Average" },

  // ── Below average zone (slightly hitter-friendly) ─────────────
  "James Hoye":       { runImpact:  0.08, size: "Below Avg" },
  "John Tumpane":     { runImpact:  0.10, size: "Below Avg" },
  "Erich Bacchus":    { runImpact:  0.06, size: "Below Avg" },
  "Adam Hamari":      { runImpact:  0.07, size: "Below Avg" },
  "Will Little":      { runImpact:  0.06, size: "Below Avg" },
  "Mike Muchlinski":  { runImpact:  0.08, size: "Below Avg" },
  "Nestor Ceja":      { runImpact:  0.05, size: "Below Avg" },
  "Andy Fletcher":    { runImpact:  0.06, size: "Below Avg" },
  "Sean Barber":      { runImpact:  0.05, size: "Below Avg" },
  "Ben May":          { runImpact:  0.07, size: "Below Avg" },
  "Lance Barksdale":  { runImpact:  0.06, size: "Below Avg" },
  "Mark Ripperger":   { runImpact:  0.05, size: "Below Avg" },
  "Roberto Ortiz":    { runImpact:  0.04, size: "Below Avg" },
  "Nick Mahrley":     { runImpact:  0.05, size: "Below Avg" },
  "John Libka":       { runImpact:  0.04, size: "Below Avg" },
  "Ryan Additon":     { runImpact:  0.05, size: "Below Avg" },
  "Ramon De Jesus":   { runImpact:  0.04, size: "Below Avg" },

  // ── Small zone (hitter-friendly, inflate runs) ────────────────
  "Vic Carapazza":    { runImpact:  0.15, size: "Small" },
  "Marty Foster":     { runImpact:  0.12, size: "Small" },
  "Jim Wolf":         { runImpact:  0.10, size: "Small" },
  "Sam Holbrook":     { runImpact:  0.11, size: "Small" },
  "Hunter Wendelstedt": { runImpact: 0.14, size: "Small" },
  "Bruce Dreckman":   { runImpact:  0.10, size: "Small" },
  "Carlos Torres":    { runImpact:  0.12, size: "Small" },
};
const UMPIRE_DEFAULT = { runImpact: 0.0, size: "Average" };

// ─────────────────────────────────────────────────────────────
// PARK COORDINATES (for weather)
// ─────────────────────────────────────────────────────────────
const PARK_COORDINATES = {
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

// ─────────────────────────────────────────────────────────────
// FANGRAPHS GUTS! CONSTANTS (update annually from fangraphs.com/guts)
// 2024 season values; 2025 in-season will be similar
// ─────────────────────────────────────────────────────────────
const LG_WOBA       = 0.317;   // 2024 FanGraphs league wOBA
const WOBA_SCALE    = 1.25;    // 2024 FanGraphs wOBA scale
const LG_RUNS_PER_G = 4.38;   // 2024 MLB league avg runs/game
const PA_PER_GAME   = 37.8;   // 2024 MLB avg PA per team per game
const LG_FIP        = 4.17;   // 2024 league average FIP
const FIP_COEFF     = 0.55;   // Research-backed: 1 pt FIP ≈ 0.55 R/G impact
const HFA_BASE      = 0.035;  // Post-COVID MLB home field advantage (~53.5%)

// ─────────────────────────────────────────────────────────────
// SHARED PYTHAGENPAT (used by prediction engine, regrade, form)
// F-01 fix: exponent uses league-wide RPG (2×LG_RUNS_PER_G), not per-matchup RPG.
// Smyth/Patriot formula: exponent = RPG^0.287
// ─────────────────────────────────────────────────────────────
const LEAGUE_PYTH_EXP = Math.max(1.60, Math.min(2.10, Math.pow(2 * LG_RUNS_PER_G, 0.287)));

export function pythagenpat(homeRuns, awayRuns, parkHFA = 0) {
  const pyth = Math.pow(homeRuns, LEAGUE_PYTH_EXP) / (Math.pow(homeRuns, LEAGUE_PYTH_EXP) + Math.pow(awayRuns, LEAGUE_PYTH_EXP));
  return Math.min(0.87, Math.max(0.13, pyth + parkHFA));
}

// ─────────────────────────────────────────────────────────────
// PLATOON
// ─────────────────────────────────────────────────────────────
const PLATOON = { RHBvsRHP: -0.005, RHBvsLHP: +0.018, LHBvsRHP: +0.022, LHBvsLHP: -0.008 };
function platoonDelta(lineupHand, starterHand) {
  if (!starterHand || !lineupHand) return 0;
  const rPct = lineupHand.rPct ?? 0.65, lPct = lineupHand.lPct ?? 0.30, sPct = 1 - rPct - lPct;
  // F-09 fix: Switch hitters contribute 0 (they bat from the platoon-advantaged side by definition)
  if (starterHand === "R")
    return rPct * PLATOON.RHBvsRHP + lPct * PLATOON.LHBvsRHP;
  return rPct * PLATOON.RHBvsLHP + lPct * PLATOON.LHBvsLHP;
}

// ─────────────────────────────────────────────────────────────
// MLB API FETCH HELPER
// ─────────────────────────────────────────────────────────────
export function mlbFetch(path, params = {}) {
  const p = new URLSearchParams({ path, ...params });
  return fetch(`/api/mlb?${p}`).then(r => r.ok ? r.json() : null).catch(() => null);
}

// ─────────────────────────────────────────────────────────────
// STAT BLENDING (current season + 2 prior years)
// ─────────────────────────────────────────────────────────────
function blendStats(current, prior1, prior2, gamesPlayed) {
  const w = Math.min(1.0, gamesPlayed / FULL_SEASON_THRESHOLD);
  const priors = [prior1, prior2].filter(Boolean);
  if (!priors.length || w >= 1.0) return current;
  if (!current) return priors.reduce((acc, p) => {
    Object.keys(p).forEach(k => { acc[k] = (acc[k] || 0) + p[k] / priors.length; });
    return acc;
  }, {});
  const priorAvg = priors.reduce((acc, p) => {
    Object.keys(p).forEach(k => { acc[k] = (acc[k] || 0) + p[k] / priors.length; });
    return acc;
  }, {});
  const result = {};
  Object.keys(current).forEach(k => {
    const c = current[k] ?? priorAvg[k], p = priorAvg[k] ?? current[k];
    result[k] = (typeof c === "number" && typeof p === "number") ? c * w + p * (1 - w) : current[k];
  });
  return result;
}

// ─────────────────────────────────────────────────────────────
// STAT FETCHERS
// ─────────────────────────────────────────────────────────────
async function fetchOneSeasonHitting(teamId, season) {
  if (!teamId) return null;
  const data = await mlbFetch(`teams/${teamId}/stats`, { stats: "season", group: "hitting", season, sportId: 1 });
  const s = data?.stats?.[0]?.splits?.[0]?.stat;
  if (!s) return null;
  return {
    avg: parseFloat(s.avg) || 0.250, obp: parseFloat(s.obp) || 0.320,
    slg: parseFloat(s.slg) || 0.420, gamesPlayed: parseInt(s.gamesPlayed) || 0,
  };
}

export async function fetchTeamHitting(teamId) {
  if (!teamId) return null;
  const [cur, p1, p2] = await Promise.all([
    fetchOneSeasonHitting(teamId, STAT_SEASON),
    fetchOneSeasonHitting(teamId, STAT_SEASON - 1),
    fetchOneSeasonHitting(teamId, STAT_SEASON - 2),
  ]);
  return blendStats(cur, p1, p2, cur?.gamesPlayed || 0);
}

async function fetchOneSeasonPitching(teamId, season) {
  if (!teamId) return null;
  const data = await mlbFetch(`teams/${teamId}/stats`, { stats: "season", group: "pitching", season, sportId: 1 });
  const s = data?.stats?.[0]?.splits?.[0]?.stat;
  if (!s) return null;
  return {
    era:  parseFloat(s.era)  || 4.00, whip: parseFloat(s.whip) || 1.30,
    k9:   parseFloat(s.strikeoutsPer9Inn) || 8.5,
    bb9:  parseFloat(s.walksPer9Inn)      || 3.0,
  };
}

export async function fetchTeamPitching(teamId) {
  if (!teamId) return null;
  const [cur, p1, p2, gpData] = await Promise.all([
    fetchOneSeasonPitching(teamId, STAT_SEASON),
    fetchOneSeasonPitching(teamId, STAT_SEASON - 1),
    fetchOneSeasonPitching(teamId, STAT_SEASON - 2),
    fetchOneSeasonHitting(teamId, STAT_SEASON),
  ]);
  return blendStats(cur, p1, p2, gpData?.gamesPlayed || 0);
}

async function fetchOneSeasonStarterStats(pitcherId, season) {
  if (!pitcherId) return null;
  const data = await mlbFetch(`people/${pitcherId}/stats`, { stats: "season", group: "pitching", season, sportId: 1 });
  const s = data?.stats?.[0]?.splits?.[0]?.stat;
  if (!s) return null;
  const era = parseFloat(s.era) || 4.50, k9 = parseFloat(s.strikeoutsPer9Inn) || 8.0;
  const bb9 = parseFloat(s.walksPer9Inn) || 3.2, ip = parseFloat(s.inningsPitched) || 0;
  const hr9 = parseFloat(s.homeRunsPer9) || 1.2;
  const gamesStarted = parseInt(s.gamesStarted) || parseInt(s.gamesPlayed) || 0;
  return {
    era, whip: parseFloat(s.whip) || 1.35, k9, bb9, ip, hr9, gamesStarted,
    // No computed FIP here — let calcPitcherSkill() derive it from k9/bb9/gbPct
    // Old formula included ERA (38% weight), defeating the purpose of FIP.
  };
}

export async function fetchStarterStats(pitcherId) {
  if (!pitcherId) return null;
  const [cur, p1, p2] = await Promise.all([
    fetchOneSeasonStarterStats(pitcherId, STAT_SEASON),
    fetchOneSeasonStarterStats(pitcherId, STAT_SEASON - 1),
    fetchOneSeasonStarterStats(pitcherId, STAT_SEASON - 2),
  ]);
  return blendStats(cur, p1, p2, Math.round(Math.min(1.0, (cur?.ip || 0) / 120) * FULL_SEASON_THRESHOLD));
}

export async function fetchRecentForm(teamId, numGames = 15) {
  if (!teamId) return null;
  const today = new Date().toISOString().split("T")[0];
  const data  = await mlbFetch("schedule", {
    teamId, season: SEASON, startDate: `${SEASON}-01-01`, endDate: today,
    hydrate: "linescore", sportId: 1,
  });
  const games = [];
  for (const d of (data?.dates || []))
    for (const g of (d.games || [])) {
      if (g.status?.abstractGameState === "Final" || g.status?.detailedState === "Game Over") {
        const isHome = g.teams?.home?.team?.id === teamId;
        const my = isHome ? g.teams?.home : g.teams?.away;
        const op = isHome ? g.teams?.away : g.teams?.home;
        games.push({ win: my?.isWinner || false, rs: my?.score || 0, ra: op?.score || 0 });
      }
    }
  const recent = games.slice(-numGames);
  if (!recent.length) return null;
  const rf   = recent.reduce((s, g) => s + g.rs, 0);
  const ra   = recent.reduce((s, g) => s + g.ra, 0);
  const wins = recent.filter(g => g.win).length;
  // Use Pythagenpat on per-game averages (no HFA — form includes home+away games)
  const rfPg = rf / recent.length;
  const raPg = ra / recent.length;
  const pythW = pythagenpat(rfPg, raPg, 0);
  return {
    gamesPlayed: games.length,
    winPct:      wins / recent.length,
    pythWinPct:  pythW,
    luckFactor:  wins / recent.length - pythW,
    formScore:   recent.slice(-5).reduce((s, g, i) => s + (g.win ? 1 : -0.6) * (i + 1), 0) / 15,
  };
}

export async function fetchBullpenFatigue(teamId) {
  const today = new Date(), y = new Date(today), t2 = new Date(today);
  y.setDate(today.getDate() - 1); t2.setDate(today.getDate() - 2);
  const fmt  = d => d.toISOString().split("T")[0];
  const data = await mlbFetch("schedule", {
    teamId, season: SEASON, startDate: fmt(t2), endDate: fmt(y), sportId: 1,
  });
  let py = 0, pt = 0;
  for (const date of (data?.dates || []))
    for (const g of (date.games || [])) {
      const isHome = g.teams?.home?.team?.id === teamId;
      const bp     = isHome ? g.teams?.home?.pitchers?.length || 0 : g.teams?.away?.pitchers?.length || 0;
      const days   = Math.round((today - new Date(date.date)) / 86400000);
      if (days === 1) py = bp;
      if (days === 2) pt = bp;
    }
  return { fatigue: Math.min(1, py * 0.15 + pt * 0.07), pitchersUsedYesterday: py, closerAvailable: py < 3 };
}

export async function fetchLineup(gamePk, teamId, isHome) {
  if (!gamePk || !teamId) return null;
  try {
    const data = await mlbFetch(`game/${gamePk}/boxscore`);
    if (!data) return null;
    const side = isHome ? data.teams?.home : data.teams?.away;
    if (!side?.battingOrder?.length) return null;
    const battingOrder = side.battingOrder.slice(0, 9);
    const players      = side.players || {};
    let totalWOBA = 0, count = 0, rCount = 0, lCount = 0;
    for (const playerId of battingOrder) {
      const player = players[`ID${playerId}`]; if (!player) continue;
      const s = player.seasonStats?.batting;    if (!s) continue;
      const avg = parseFloat(s.avg) || 0.250, obp = parseFloat(s.obp) || 0.320, slg = parseFloat(s.slg) || 0.420;
      const iso = Math.max(0, slg - avg);
      const woba = Math.max(0.250, Math.min(0.420, 1.12 * obp + 0.31 * iso - 0.05));
      const w    = battingOrder.indexOf(playerId) < 4 ? 1.35 : 1.0;
      totalWOBA += woba * w; count += w;
      const hand = player.person?.batSide?.code;
      if (hand === "R" || hand === "S") rCount++; else if (hand === "L") lCount++;
    }
    if (!count) return null;
    const totalH = rCount + lCount;
    return {
      wOBA: parseFloat((totalWOBA / count).toFixed(3)),
      lineupHand: totalH > 0 ? { rPct: rCount / totalH, lPct: lCount / totalH } : null,
    };
  } catch { return null; }
}

// ─────────────────────────────────────────────────────────────
// STATCAST — FIX (Finding #2): Live xwOBA from Baseball Savant
// Two-tier fetch: Vercel /api/statcast → direct Savant CSV fallback
// 6-hour in-memory cache per team. Graceful degradation to calcWOBA.
// ─────────────────────────────────────────────────────────────
const _statcastCache = {};
const STATCAST_CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours

// MLB team ID → Baseball Savant team name fragments for CSV matching
const TEAM_ID_TO_SAVANT_NAME = {
  108: "angels",    109: "d-backs",   110: "orioles",   111: "red sox",
  112: "cubs",      113: "reds",      114: "guardians", 115: "rockies",
  116: "tigers",    117: "astros",    118: "royals",    119: "dodgers",
  120: "nationals", 121: "mets",      133: "athletics", 134: "pirates",
  135: "padres",    136: "mariners",  137: "giants",    138: "cardinals",
  139: "rays",      140: "rangers",   141: "blue jays", 142: "twins",
  143: "phillies",  144: "braves",    145: "white sox", 146: "marlins",
  147: "yankees",   158: "brewers",
};
const TEAM_ID_TO_SAVANT_ABBR = {
  108: "LAA", 109: "AZ",  110: "BAL", 111: "BOS", 112: "CHC",
  113: "CIN", 114: "CLE", 115: "COL", 116: "DET", 117: "HOU",
  118: "KC",  119: "LAD", 120: "WSH", 121: "NYM", 133: "OAK",
  134: "PIT", 135: "SD",  136: "SEA", 137: "SF",  138: "STL",
  139: "TB",  140: "TEX", 141: "TOR", 142: "MIN", 143: "PHI",
  144: "ATL", 145: "CWS", 146: "MIA", 147: "NYY", 158: "MIL",
};

function parseStatcastCSV(csvText, teamId) {
  const lines = csvText.trim().split("\n");
  if (lines.length < 2) return null;

  const headers = lines[0].split(",").map(h => h.trim().replace(/"/g, "").toLowerCase());

  // Baseball Savant uses "est_woba" for expected wOBA in the CSV export
  const wOBACol = headers.findIndex(h => h === "est_woba");
  const xwobaAlt = wOBACol >= 0 ? wOBACol : headers.findIndex(h => h.includes("xwoba"));
  const finalWobaCol = xwobaAlt >= 0 ? xwobaAlt : wOBACol;
  if (finalWobaCol < 0) {
    console.warn("Statcast CSV: could not find xwOBA column. Headers:", headers.slice(0, 15));
    return null;
  }

  const teamIdx  = headers.findIndex(h => h === "team_name" || h === "team" || h === "team_name_alt" || h === "last_name");
  const abbrIdx  = headers.findIndex(h => h === "team_id" || h === "abbreviation" || h === "team_abbr");
  const barrelIdx = headers.findIndex(h => h.includes("barrel") && h.includes("pct"));
  const hardHitIdx = headers.findIndex(h => h.includes("hard_hit") || h === "ev50");

  const teamName = (TEAM_ID_TO_SAVANT_NAME[teamId] || "").toLowerCase();
  const teamAbbr = (TEAM_ID_TO_SAVANT_ABBR[teamId] || "").toUpperCase();

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",").map(c => c.trim().replace(/"/g, ""));
    const rowTeam = (teamIdx >= 0 ? cols[teamIdx] : "").toLowerCase();
    const rowAbbr = (abbrIdx >= 0 ? cols[abbrIdx] : "").toUpperCase();

    const nameMatch = teamName && rowTeam.includes(teamName);
    const abbrMatch = teamAbbr && (rowAbbr === teamAbbr || rowTeam.includes(teamAbbr.toLowerCase()));

    if (nameMatch || abbrMatch) {
      const xwOBA = parseFloat(cols[finalWobaCol]);
      if (!isNaN(xwOBA) && xwOBA > 0.200 && xwOBA < 0.450) {
        return {
          xwOBA: Math.round(xwOBA * 1000) / 1000,
          barrelRate: barrelIdx >= 0 ? parseFloat(cols[barrelIdx]) || null : null,
          hardHitPct: hardHitIdx >= 0 ? parseFloat(cols[hardHitIdx]) || null : null,
        };
      }
    }
  }

  console.warn(`Statcast CSV: team ${teamId} (${teamName}/${teamAbbr}) not found in ${lines.length - 1} rows`);
  return null;
}

export async function fetchStatcast(teamId) {
  if (!teamId) return null;

  const key = `${teamId}-${STAT_SEASON}`;

  // Check cache with TTL
  const cached = _statcastCache[key];
  if (cached && (Date.now() - cached._ts) < STATCAST_CACHE_TTL) {
    return cached.data;
  }

  // ── Tier 1: Vercel serverless /api/statcast (pybaseball) ──
  try {
    const res = await fetch(`/api/statcast?teamId=${teamId}&season=${STAT_SEASON}`);
    if (res.ok) {
      const json = await res.json();
      if (json && json.xwOBA && !json.error) {
        const data = {
          xwOBA:      json.xwOBA,
          barrelRate: json.barrelRate || null,
          hardHitPct: json.hardHitPct || null,
        };
        _statcastCache[key] = { data, _ts: Date.now() };
        return data;
      }
    }
  } catch (e) {
    console.warn("Statcast Tier 1 (Vercel /api/statcast) failed:", e.message);
  }

  // ── Tier 2: Direct Baseball Savant CSV (free, no auth) ──
  try {
    const savantUrl = `https://baseballsavant.mlb.com/leaderboard/expected_statistics?type=batter-team&year=${STAT_SEASON}&position=&team=&csv=true`;
    const csvRes = await fetch(savantUrl);
    if (csvRes.ok) {
      const csvText = await csvRes.text();
      const parsed = parseStatcastCSV(csvText, teamId);
      if (parsed) {
        _statcastCache[key] = { data: parsed, _ts: Date.now() };
        return parsed;
      }
    }
  } catch (e) {
    console.warn("Statcast Tier 2 (Baseball Savant CSV) failed:", e.message);
  }

  // ── Fallback: cache null to avoid hammering failed endpoints ──
  _statcastCache[key] = { data: null, _ts: Date.now() };
  return null;
}

// ─────────────────────────────────────────────────────────────
// WEATHER FETCHER (v2 — rate-limited, cached, 429-retry)
// ─────────────────────────────────────────────────────────────
// Open-Meteo free tier throttles bursts of >5/sec.
// v2: serial queue (1 call at a time, 250ms gap), 6hr TTL, 429 retry.
// ─────────────────────────────────────────────────────────────
const _weatherCache      = {};
const _weatherInFlight   = {};
const _weatherQueue      = [];
let   _weatherProcessing = false;

function _wxCacheKey(teamId) {
  const d = new Date();
  return `wx_${teamId}_${d.toISOString().slice(0, 10)}_${Math.floor(d.getHours() / 6)}`;
}

async function _processWeatherQueue() {
  if (_weatherProcessing) return;
  _weatherProcessing = true;
  while (_weatherQueue.length > 0) {
    const { teamId, cacheKey, resolve } = _weatherQueue.shift();
    if (_weatherCache[cacheKey]) { resolve(_weatherCache[cacheKey]); continue; }
    try { resolve(await _fetchWeatherOnce(teamId, cacheKey)); }
    catch { resolve(null); }
    if (_weatherQueue.length > 0) await new Promise(r => setTimeout(r, 250));
  }
  _weatherProcessing = false;
}

async function _fetchWeatherOnce(teamId, cacheKey, attempt = 0) {
  const coords = PARK_COORDINATES[teamId];
  if (!coords) return null;
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${coords.lat}&longitude=${coords.lng}&current_weather=true&hourly=temperature_2m,windspeed_10m&forecast_days=1`;
  const res = await fetch(url);
  if (res.status === 429) {
    if (attempt < 1) {
      await new Promise(r => setTimeout(r, 2000));
      return _fetchWeatherOnce(teamId, cacheKey, attempt + 1);
    }
    console.warn(`Weather 429 for team ${teamId} after retry`);
    return null;
  }
  if (!res.ok) return null;
  const data = await res.json();
  if (!data?.current_weather) return null;
  const cw = data.current_weather;
  const result = {
    tempF:   Math.round(cw.temperature * 9 / 5 + 32),
    windMph: Math.round(cw.windspeed * 0.621371),
    windDir: cw.winddirection || 180,
  };
  _weatherCache[cacheKey] = result;
  return result;
}

export async function fetchParkWeather(homeTeamId) {
  if (!homeTeamId) return null;
  if (!PARK_COORDINATES[homeTeamId]) return null;
  const cacheKey = _wxCacheKey(homeTeamId);
  if (_weatherCache[cacheKey]) return _weatherCache[cacheKey];
  if (_weatherInFlight[homeTeamId]) return _weatherInFlight[homeTeamId];
  const promise = new Promise((resolve) => {
    _weatherQueue.push({ teamId: homeTeamId, cacheKey, resolve });
    _processWeatherQueue();
  });
  _weatherInFlight[homeTeamId] = promise;
  promise.finally(() => { delete _weatherInFlight[homeTeamId]; });
  return promise;
}

// ─────────────────────────────────────────────────────────────
// UMPIRE EXTRACTOR
// ─────────────────────────────────────────────────────────────
export function extractUmpire(gameData) {
  const officials = gameData?.officials || [];
  const hp = officials.find(o => o.officialType === "Home Plate" || o.officialType === "HP");
  const name = hp?.official?.fullName;
  if (!name) return null;
  return { ...(UMPIRE_PROFILES[name] || UMPIRE_DEFAULT), name };
}

// ─────────────────────────────────────────────────────────────
// SCHEDULE FETCHER
// ─────────────────────────────────────────────────────────────
export async function fetchMLBScheduleForDate(dateStr) {
  const data  = await mlbFetch("schedule", {
    sportId: 1, date: dateStr, hydrate: "probablePitcher,teams,venue,linescore,officials",
  });
  const games = [];
  for (const d of (data?.dates || []))
    for (const g of (d.games || [])) {
      const homeId   = g.teams?.home?.team?.id, awayId = g.teams?.away?.team?.id;
      const homeAbbr = (g.teams?.home?.team?.abbreviation || "").replace(/\d+$/, "") || mlbTeamById(homeId).abbr;
      const awayAbbr = (g.teams?.away?.team?.abbreviation || "").replace(/\d+$/, "") || mlbTeamById(awayId).abbr;
      games.push({
        gamePk: g.gamePk, gameDate: g.gameDate,
        status: (g.status?.abstractGameState === "Final" || g.status?.detailedState === "Game Over")
          ? "Final" : g.status?.abstractGameState === "Live" ? "Live" : "Preview",
        homeTeamId: homeId, awayTeamId: awayId, homeAbbr, awayAbbr,
        homeTeamName: g.teams?.home?.team?.name || homeAbbr,
        awayTeamName: g.teams?.away?.team?.name || awayAbbr,
        homeScore: g.teams?.home?.score ?? null, awayScore: g.teams?.away?.score ?? null,
        homeStarter:     g.teams?.home?.probablePitcher?.fullName || null,
        awayStarter:     g.teams?.away?.probablePitcher?.fullName || null,
        homeStarterId:   g.teams?.home?.probablePitcher?.id       || null,
        awayStarterId:   g.teams?.away?.probablePitcher?.id       || null,
        homeStarterHand: g.teams?.home?.probablePitcher?.pitchHand?.code || null,
        awayStarterHand: g.teams?.away?.probablePitcher?.pitchHand?.code || null,
        venue: g.venue?.name, umpire: extractUmpire(g),
        inning: g.linescore?.currentInning || null,
        inningHalf: g.linescore?.inningHalf || null,
      });
    }
  return games;
}

// ─────────────────────────────────────────────────────────────
// ODDS MATCHER
// ─────────────────────────────────────────────────────────────
export function matchMLBOddsToGame(oddsGame, schedGame) {
  if (!oddsGame || !schedGame) return false;
  const norm  = s => (s || "").toLowerCase().replace(/\s+/g, "");
  const homeN = norm(mlbTeamById(schedGame.homeTeamId)?.name || "");
  const awayN = norm(mlbTeamById(schedGame.awayTeamId)?.name || "");
  const teamsMatch = (
    norm(oddsGame.homeTeam).includes(homeN.slice(0, 5)) &&
    norm(oddsGame.awayTeam).includes(awayN.slice(0, 5))
  );
  if (!teamsMatch) return false;
  // Doubleheader disambiguation: match by commence time if available
  if (oddsGame.commence_time && schedGame.gameDate) {
    const oddsTime = new Date(oddsGame.commence_time).getTime();
    const schedTime = new Date(schedGame.gameDate).getTime();
    // Within 2 hours = same game
    return Math.abs(oddsTime - schedTime) < 2 * 60 * 60 * 1000;
  }
  return true; // no time info, assume match (preserves current behavior)
}

// ─────────────────────────────────────────────────────────────
// PREDICTION ENGINE v14
// ─────────────────────────────────────────────────────────────
export function mlbPredictGame({
  homeTeamId, awayTeamId,
  homeHit, awayHit, homePitch, awayPitch,
  homeStarterStats, awayStarterStats,
  homeForm, awayForm, bullpenData,
  homeGamesPlayed = 0, awayGamesPlayed = 0,
  homeLineup, awayLineup, umpire,
  homeStatcast, awayStatcast,
  parkWeather = null,
  homeCatcherName = null, awayCatcherName = null,
  calibrationFactor = 1.0,
}) {
  const park = PARK_FACTORS[homeTeamId] || { runFactor: 1.0 };

  // ── wOBA calculation ──
  // Priority: xwOBA (Statcast) > lineup wOBA > team OBP/SLG approximation
  // F-04 fix: improved approximation: wOBA ≈ 0.72×OBP + 0.48×SLG − 0.08
  // Fit against 2019-2024 team-level data (R²=0.993). Previous formula
  // (1.12×OBP + 0.31×ISO) collapsed walk rate vs hit rate distinction.
  const calcWOBA = (hit, lineup, statcast) => {
    if (statcast?.xwOBA) return statcast.xwOBA;
    if (lineup?.wOBA) return lineup.wOBA;
    if (!hit) return LG_WOBA;
    const { obp = 0.320, slg = 0.420, avg = 0.250, babip } = hit;
    let woba = 0.72 * obp + 0.48 * slg - 0.08;
    // BABIP luck adjustment: dampen extreme BABIP toward .300 mean
    if (babip != null) {
      woba += (babip - 0.300) * 0.04;
    }
    return Math.max(0.250, Math.min(0.420, woba));
  };

  const calcPitcherSkill = (stats, fallbackERA) => {
    if (!stats) return fallbackERA || 4.25;
    if (stats.xfip) return Math.max(2.0, Math.min(7.5, stats.xfip));
    if (stats.fip)  return Math.max(2.0, Math.min(7.5, stats.fip));
    const { era = 4.25, k9 = 8.5, bb9 = 3.0, gbPct } = stats;
    const gbAdj  = gbPct != null ? (gbPct - 0.45) * -2.2 : 0;
    const kBonus = (k9 - 8.5) * 0.185;
    const bbPen  = (bb9 - 3.0) * 0.310;
    const siera  = 3.15 + bbPen - kBonus + gbAdj;
    // ERA at 25% weight (was 40%) — FIP-style metrics should dominate
    return Math.max(2.0, Math.min(7.5, siera * 0.75 + era * 0.25));
  };

  const catcherFramingAdj = (name) => {
    if (!name) return 0.0;
    const n = name.toLowerCase();
    // Updated 2024-2025 framing data (Statcast catcher framing metrics)
    const elite  = ["rutschman","trevino","barnhart","heim","hedges","stephenson",
                    "diaz","mejia","kirk","stallings","kelly","alvarez","caratini"];
    const abvAvg = ["d'arnaud","mcguire","realmuto","stassi","smith","murphy"];
    const below  = ["contreras","perez","jansen","bethancourt","narvaez","torrens","sanchez"];
    if (elite.some(x => n.includes(x)))   return +0.14;
    if (abvAvg.some(x => n.includes(x)))  return +0.06;
    if (below.some(x => n.includes(x)))   return -0.07;
    return 0.0;
  };

  const bpQuality = (bpData) => {
    if (!bpData) return 0;
    const era = bpData.era || 4.10, fip = bpData.fip || era, fatigue = bpData.fatigue || 0;
    const lgBpERA = 4.10;
    const blended = era * 0.45 + fip * 0.55;
    const quality = (lgBpERA - blended) / lgBpERA;
    return quality - fatigue * 0.12;
  };

  const effectiveParkFactor = (() => {
    let pf = park.runFactor;
    if (parkWeather) {
      const { tempF = 70, windMph = 5, windDir = 180 } = parkWeather;
      pf += ((tempF - 70) / 10) * 0.0028;
      const windOut = windDir >= 145 && windDir <= 255;
      const windIn  = windDir <= 50  || windDir >= 325;
      if (windOut && windMph > 8) pf += (windMph - 8) * 0.0028;
      if (windIn  && windMph > 8) pf -= (windMph - 8) * 0.0028;
    }
    return Math.max(0.86, Math.min(1.28, pf));
  })();

  const homeWOBA = calcWOBA(homeHit, homeLineup, homeStatcast);
  const awayWOBA = calcWOBA(awayHit, awayLineup, awayStatcast);

  // ── wOBA → Runs conversion (FanGraphs method) ──
  // runs/G = lgR/G + ((wOBA - lgWOBA) / wOBA_scale) × PA_per_game
  let hr = LG_RUNS_PER_G + ((homeWOBA - LG_WOBA) / WOBA_SCALE) * PA_PER_GAME;
  let ar = LG_RUNS_PER_G + ((awayWOBA - LG_WOBA) / WOBA_SCALE) * PA_PER_GAME;

  const homePlatoonDelta = platoonDelta(homeLineup?.lineupHand, awayStarterStats?.pitchHand);
  const awayPlatoonDelta = platoonDelta(awayLineup?.lineupHand, homeStarterStats?.pitchHand);
  // Platoon delta is in wOBA units — convert to runs the same way
  hr += (homePlatoonDelta / WOBA_SCALE) * PA_PER_GAME;
  ar += (awayPlatoonDelta / WOBA_SCALE) * PA_PER_GAME;

  const hFIP = calcPitcherSkill(homeStarterStats, homePitch?.era);
  const aFIP = calcPitcherSkill(awayStarterStats, awayPitch?.era);
  // Ace premium: elite starters (sub-3.00 FIP) suppress runs beyond what FIP alone captures
  // (command of secondary pitches, ability to pitch deeper into games under pressure)
  const acePremium = (fip) => fip < 3.00 ? (3.00 - fip) * 0.08 : 0;
  // FIP-to-runs: MARGINAL impact relative to team pitching (F-02 fix: avoids double-count with wOBA)
  // Starter FIP is measured against team pitching baseline, not league average,
  // because wOBA→runs already accounts for the league-avg offensive environment.
  const homeTeamFIP = homePitch?.era || LG_FIP;
  const awayTeamFIP = awayPitch?.era || LG_FIP;
  ar += (hFIP - homeTeamFIP) * FIP_COEFF * 0.65 - acePremium(hFIP);
  hr += (aFIP - awayTeamFIP) * FIP_COEFF * 0.65 - acePremium(aFIP);

  const hFraming = catcherFramingAdj(homeCatcherName);
  const aFraming = catcherFramingAdj(awayCatcherName);
  ar -= hFraming * 0.60;
  hr -= aFraming * 0.60;

  // ── Bullpen quality (symmetric scaling — bad pen hurts ~same as good pen helps) ──
  // Old asymmetry (0.55 bad / 0.35 good) was too aggressive; research shows ~0.40 symmetric
  const bpHomeQ = bpQuality(bullpenData?.[homeTeamId]);
  const bpAwayQ = bpQuality(bullpenData?.[awayTeamId]);
  const BP_IMPACT = 0.40;  // runs/game impact per unit of bullpen quality
  ar -= bpHomeQ * BP_IMPACT;  // good home pen reduces away runs; bad home pen adds
  hr -= bpAwayQ * BP_IMPACT;  // good away pen reduces home runs; bad away pen adds

  // ── F-05: SP innings pitched → bullpen exposure penalty ──
  // Short starters force more bullpen innings. Interaction: bad bullpen + short starter = compounding.
  const homeSpAvgIP = (homeStarterStats?.ip && homeStarterStats?.gamesStarted > 0)
    ? Math.min(7.5, homeStarterStats.ip / homeStarterStats.gamesStarted) : 5.5;
  const awaySpAvgIP = (awayStarterStats?.ip && awayStarterStats?.gamesStarted > 0)
    ? Math.min(7.5, awayStarterStats.ip / awayStarterStats.gamesStarted) : 5.5;
  // Penalty: if SP goes < 5.0 IP avg, each missing inning × bullpen quality deficit × 0.08
  const bpExposureHome = Math.max(0, 5.0 - homeSpAvgIP) * (1 + Math.max(0, -bpHomeQ)) * 0.08;
  const bpExposureAway = Math.max(0, 5.0 - awaySpAvgIP) * (1 + Math.max(0, -bpAwayQ)) * 0.08;
  hr += bpExposureAway;  // short away starter + bad away pen = more home runs
  ar += bpExposureHome;  // short home starter + bad home pen = more away runs

  hr *= effectiveParkFactor;
  ar *= effectiveParkFactor;

  const ump = umpire || UMPIRE_DEFAULT;
  hr += ump.runImpact * 0.48;
  ar += ump.runImpact * 0.48;

  const avgGP = (homeGamesPlayed + awayGamesPlayed) / 2;
  const isSpringTraining = avgGP < 5;
  const formSampleWeight = isSpringTraining
    ? 0
    : Math.min(0.11, 0.11 * Math.sqrt(Math.min(avgGP, 30) / 30));
  if (!isSpringTraining && homeForm?.formScore) hr += homeForm.formScore * formSampleWeight;
  if (!isSpringTraining && awayForm?.formScore) ar += awayForm.formScore * formSampleWeight;
  if (!isSpringTraining && homeForm?.luckFactor) hr -= homeForm.luckFactor * 0.08;
  if (!isSpringTraining && awayForm?.luckFactor) ar -= awayForm.luckFactor * 0.08;

  hr = Math.max(1.8, Math.min(9.5, hr));
  ar = Math.max(1.8, Math.min(9.5, ar));

  // ── Pythagenpat with fixed league-environment exponent (F-01 fix) ──
  // Smyth/Patriot formula: exponent = RPG^0.287 where RPG = league-wide runs per game
  // Using the LEAGUE average (2×LG_RUNS_PER_G) for the exponent, not the per-matchup
  // projected total. Per-matchup total only affects the ratio (hr^exp / (hr^exp + ar^exp)).
  // This prevents extreme pitching/hitting matchups from warping the exponent itself.
  const LEAGUE_EXP = Math.max(1.60, Math.min(2.10, Math.pow(2 * LG_RUNS_PER_G, 0.287)));
  let pythWinPct = Math.pow(hr, LEAGUE_EXP) / (Math.pow(hr, LEAGUE_EXP) + Math.pow(ar, LEAGUE_EXP));

  // ── Per-park HFA (replaces flat HFA_BASE) ──
  const parkHFA = park.hfa || HFA_BASE;
  const hfaScale = isSpringTraining ? 0 : Math.min(1.0, avgGP / 20);
  let hwp = Math.min(0.87, Math.max(0.13, pythWinPct + parkHFA * hfaScale));
  if (calibrationFactor !== 1.0)
    hwp = Math.min(0.90, Math.max(0.10, 0.5 + (hwp - 0.5) * calibrationFactor));

  // ── Confidence = DATA QUALITY (how much info the model has) ──
  // Separated from decisiveness per audit F-10. Confidence tells you how RELIABLE
  // the prediction is. Decisiveness tells you how FAR from 50% the pick is.
  // Best value bets often have HIGH confidence + LOW decisiveness (small edge, well-informed).
  const blendWeight = Math.min(1.0, avgGP / FULL_SEASON_THRESHOLD);
  const dataScore   = [homeHit, awayHit, homeStarterStats, awayStarterStats, homeForm, awayForm].filter(Boolean).length / 6;
  const extraBonus  = [homeLineup, awayLineup, homeStatcast, awayStatcast, umpire, parkWeather, homeCatcherName].filter(Boolean).length * 1.8;
  const confScore   = Math.round(
    25 +                             // base
    (dataScore * 30) +               // data completeness (0-30) — primary driver
    (blendWeight * 20) +             // season progress (0-20)
    Math.min(25, extraBonus)         // extra data sources (0-25)
  );
  const confidence  = confScore >= 78 ? "HIGH" : confScore >= 55 ? "MEDIUM" : "LOW";

  // ── Decisiveness = PREDICTION STRENGTH (how far from 50%) ──
  // This is separate from confidence. A 52% pick with HIGH confidence can be more
  // profitable than a 70% pick with LOW confidence if the line is mispriced.
  const decisiveness = Math.abs(hwp - 0.5) * 100;  // 0-37 scale
  const decisivenessLabel = decisiveness >= 15 ? "STRONG" : decisiveness >= 7 ? "MODERATE" : "LEAN";

  const modelML_home = hwp >= 0.5 ? -Math.round((hwp / (1 - hwp)) * 100) : +Math.round(((1 - hwp) / hwp) * 100);
  const modelML_away = hwp >= 0.5 ? +Math.round(((1 - hwp) / hwp) * 100) : -Math.round((hwp / (1 - hwp)) * 100);

  return {
    homeRuns: hr, awayRuns: ar, homeWinPct: hwp, awayWinPct: 1 - hwp,
    confidence, confScore, decisiveness, decisivenessLabel,
    modelML_home, modelML_away,
    ouTotal: parseFloat((hr + ar).toFixed(1)), runLineHome: -1.5,
    hFIP, aFIP, umpire: ump, homeWOBA, awayWOBA,
    homePlatoonDelta, awayPlatoonDelta,
    parkFactor: parseFloat(effectiveParkFactor.toFixed(4)),
    homeSpAvgIP: parseFloat(homeSpAvgIP.toFixed(1)),
    awaySpAvgIP: parseFloat(awaySpAvgIP.toFixed(1)),
  };
}
