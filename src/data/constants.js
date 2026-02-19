export const TEAMS = [
  { id: 108, name: "Angels",      abbr: "LAA", league: "AL" },
  { id: 109, name: "D-backs",     abbr: "ARI", league: "NL" },
  { id: 110, name: "Orioles",     abbr: "BAL", league: "AL" },
  { id: 111, name: "Red Sox",     abbr: "BOS", league: "AL" },
  { id: 112, name: "Cubs",        abbr: "CHC", league: "NL" },
  { id: 113, name: "Reds",        abbr: "CIN", league: "NL" },
  { id: 114, name: "Guardians",   abbr: "CLE", league: "AL" },
  { id: 115, name: "Rockies",     abbr: "COL", league: "NL" },
  { id: 116, name: "Tigers",      abbr: "DET", league: "AL" },
  { id: 117, name: "Astros",      abbr: "HOU", league: "AL" },
  { id: 118, name: "Royals",      abbr: "KC",  league: "AL" },
  { id: 119, name: "Dodgers",     abbr: "LAD", league: "NL" },
  { id: 120, name: "Nationals",   abbr: "WSH", league: "NL" },
  { id: 121, name: "Mets",        abbr: "NYM", league: "NL" },
  { id: 133, name: "Athletics",   abbr: "OAK", league: "AL" },
  { id: 134, name: "Pirates",     abbr: "PIT", league: "NL" },
  { id: 135, name: "Padres",      abbr: "SD",  league: "NL" },
  { id: 136, name: "Mariners",    abbr: "SEA", league: "AL" },
  { id: 137, name: "Giants",      abbr: "SF",  league: "NL" },
  { id: 138, name: "Cardinals",   abbr: "STL", league: "NL" },
  { id: 139, name: "Rays",        abbr: "TB",  league: "AL" },
  { id: 140, name: "Rangers",     abbr: "TEX", league: "AL" },
  { id: 141, name: "Blue Jays",   abbr: "TOR", league: "AL" },
  { id: 142, name: "Twins",       abbr: "MIN", league: "AL" },
  { id: 143, name: "Phillies",    abbr: "PHI", league: "NL" },
  { id: 144, name: "Braves",      abbr: "ATL", league: "NL" },
  { id: 145, name: "White Sox",   abbr: "CWS", league: "AL" },
  { id: 146, name: "Marlins",     abbr: "MIA", league: "NL" },
  { id: 147, name: "Yankees",     abbr: "NYY", league: "AL" },
  { id: 158, name: "Brewers",     abbr: "MIL", league: "NL" },
];

export const teamById  = id  => TEAMS.find(t => t.id === id);
export const teamByAbbr = ab => TEAMS.find(t => t.abbr === ab);

export const PARK_FACTORS = {
  108:{name:"Angel Stadium",         runFactor:0.97,hrFactor:0.93,notes:"Spacious, marine air suppresses HRs"},
  109:{name:"Chase Field",           runFactor:1.05,hrFactor:1.08,notes:"Hot dry air, hitter-friendly"},
  110:{name:"Oriole Park",           runFactor:1.03,hrFactor:1.09,notes:"Short RF porch"},
  111:{name:"Fenway Park",           runFactor:1.06,hrFactor:0.94,notes:"Green Monster boosts doubles"},
  112:{name:"Wrigley Field",         runFactor:1.04,hrFactor:1.07,notes:"Wind-dependent"},
  113:{name:"Great American BP",     runFactor:1.08,hrFactor:1.18,notes:"Most HR-friendly in NL"},
  114:{name:"Progressive Field",     runFactor:0.98,hrFactor:0.95,notes:"Slight pitcher park"},
  115:{name:"Coors Field",           runFactor:1.16,hrFactor:1.21,notes:"Most run-inflating park in MLB"},
  116:{name:"Comerica Park",         runFactor:0.94,hrFactor:0.84,notes:"Deep outfield, pitcher park"},
  117:{name:"Minute Maid Park",      runFactor:1.01,hrFactor:1.02,notes:"Retractable roof, near-neutral"},
  118:{name:"Kauffman Stadium",      runFactor:0.96,hrFactor:0.90,notes:"Spacious, pitcher lean"},
  119:{name:"Dodger Stadium",        runFactor:0.95,hrFactor:0.92,notes:"Marine layer suppresses offense"},
  120:{name:"Nationals Park",        runFactor:0.99,hrFactor:0.98,notes:"Near-neutral"},
  121:{name:"Citi Field",            runFactor:0.97,hrFactor:0.93,notes:"Deep gaps, Jamaica Bay air"},
  133:{name:"Oakland Coliseum",      runFactor:0.95,hrFactor:0.89,notes:"Cold, foul territory"},
  134:{name:"PNC Park",              runFactor:0.97,hrFactor:0.93,notes:"River air, pitcher lean"},
  135:{name:"Petco Park",            runFactor:0.93,hrFactor:0.87,notes:"MLB's best pitcher park"},
  136:{name:"T-Mobile Park",         runFactor:0.95,hrFactor:0.91,notes:"Retractable roof"},
  137:{name:"Oracle Park",           runFactor:0.91,hrFactor:0.82,notes:"Best pitcher park in MLB"},
  138:{name:"Busch Stadium",         runFactor:0.97,hrFactor:0.94,notes:"Consistent pitcher park"},
  139:{name:"Tropicana Field",       runFactor:0.97,hrFactor:0.93,notes:"Dome, pitcher lean"},
  140:{name:"Globe Life Field",      runFactor:1.02,hrFactor:1.04,notes:"Dome, slight hitter lean"},
  141:{name:"Rogers Centre",         runFactor:1.05,hrFactor:1.12,notes:"Turf dome, hitter-friendly"},
  142:{name:"Target Field",          runFactor:0.98,hrFactor:0.96,notes:"Cold early season"},
  143:{name:"Citizens Bank Park",    runFactor:1.06,hrFactor:1.13,notes:"Top 3 HR-friendly"},
  144:{name:"Truist Park",           runFactor:1.02,hrFactor:1.05,notes:"Slight hitter lean"},
  145:{name:"Guaranteed Rate Field", runFactor:1.03,hrFactor:1.08,notes:"Short RF, hitter-friendly"},
  146:{name:"loanDepot Park",        runFactor:0.94,hrFactor:0.89,notes:"Large dome, pitcher park"},
  147:{name:"Yankee Stadium",        runFactor:1.04,hrFactor:1.14,notes:"Short RF, LHH HR-friendly"},
  158:{name:"American Family Field", runFactor:1.01,hrFactor:1.02,notes:"Retractable roof, near-neutral"},
};

export const UMPIRE_PROFILES = {
  "Default":          {zoneSize:1.00,runsPerGame:0.00, kRateAdj:0.00},
  "Angel Hernandez":  {zoneSize:0.88,runsPerGame:+0.45,kRateAdj:-0.08,notes:"Small zone, high walk rates"},
  "CB Bucknor":       {zoneSize:0.90,runsPerGame:+0.38,kRateAdj:-0.06,notes:"Inconsistent, smaller zone"},
  "Joe West":         {zoneSize:1.05,runsPerGame:-0.22,kRateAdj:+0.04,notes:"Large zone, pitcher-friendly"},
  "Ted Barrett":      {zoneSize:1.02,runsPerGame:-0.12,kRateAdj:+0.02,notes:"Consistent, slightly large"},
  "Dan Bellino":      {zoneSize:1.04,runsPerGame:-0.18,kRateAdj:+0.03,notes:"Pitcher-friendly"},
  "Mark Carlson":     {zoneSize:0.98,runsPerGame:+0.05,kRateAdj:-0.01,notes:"Near-average"},
  "Alfonso Marquez":  {zoneSize:0.96,runsPerGame:+0.14,kRateAdj:-0.02,notes:"Slightly hitter-friendly"},
  "Bill Miller":      {zoneSize:1.03,runsPerGame:-0.15,kRateAdj:+0.02,notes:"Consistent pitcher lean"},
  "Jeff Nelson":      {zoneSize:0.97,runsPerGame:+0.10,kRateAdj:-0.01,notes:"Slightly small zone"},
};

// ─── Odds utilities ───────────────────────────────────────────
export function moneylineToImplied(ml) {
  if (!ml || ml === 0) return 0.5;
  if (ml > 0) return 100 / (ml + 100);
  return Math.abs(ml) / (Math.abs(ml) + 100);
}

export function impliedToMoneyline(p) {
  if (p <= 0 || p >= 1) return '—';
  if (p >= 0.5) return `-${Math.round(p / (1 - p) * 100)}`;
  return `+${Math.round((1 - p) / p * 100)}`;
}

export function modelWinToMoneyline(winPct) {
  const vig = winPct >= 0.5 ? winPct * 1.045 : winPct * 0.955;
  return impliedToMoneyline(Math.min(0.95, Math.max(0.05, vig)));
}

export function runDiffToSpread(homeRuns, awayRuns) {
  const diff = homeRuns - awayRuns;
  return (Math.round(diff * 2) / 2).toFixed(1);
}

export function runLineOdds(homeWinPct, homeRuns, awayRuns) {
  const diff = homeRuns - awayRuns - 1.5;
  const p = 1 / (1 + Math.exp(-diff * 0.55));
  return {
    homeML: impliedToMoneyline(p * 1.045),
    awayML: impliedToMoneyline((1 - p) * 1.045),
    homeWin: p,
  };
}

// ─── Prediction engine ────────────────────────────────────────
export function estimateWOBA(h) {
  if (!h) return 0.320;
  const { obp = 0.320, slg = 0.420, avg = 0.250 } = h;
  return Math.max(0.25, Math.min(0.42, 0.69*(obp-avg) + 0.89*avg + 1.27*(slg-avg)*0.9 + 0.05));
}

export function estimateWRCPlus(h) {
  return Math.round(((estimateWOBA(h) - 0.320) / 0.32 + 1) * 100);
}

export function estimateFIP(p) {
  if (!p) return 4.20;
  return Math.max(2.0, p.era * 0.82 + p.whip * 0.4 + (p.bb9 - p.k9) * 0.15);
}

export function predictGame({ homeTeam, awayTeam, homeHit, awayHit, homePitch, awayPitch,
  homeStarterStats, awayStarterStats, homeVsAway, awayVsHome,
  homeForm, awayForm, homeBullpen, awayBullpen, umpireName }) {

  const park = PARK_FACTORS[homeTeam?.id] || { runFactor: 1.0 };
  const ump  = UMPIRE_PROFILES[umpireName] || UMPIRE_PROFILES['Default'];

  let hr = 4.5, ar = 4.5;

  // wOBA offense (prefer vsTeam splits)
  const hWOBA = estimateWOBA(homeVsAway?.ops ? homeVsAway : homeHit);
  const aWOBA = estimateWOBA(awayVsHome?.ops ? awayVsHome : awayHit);
  hr += (hWOBA - 0.320) * 14;
  ar += (aWOBA - 0.320) * 14;
  hr += (estimateWRCPlus(homeHit) - 100) * 0.018;
  ar += (estimateWRCPlus(awayHit) - 100) * 0.018;

  // Starter FIP / xFIP
  const hFIP  = homeStarterStats?.fip  || estimateFIP(homePitch);
  const aFIP  = awayStarterStats?.fip  || estimateFIP(awayPitch);
  const hXFIP = homeStarterStats?.xfip || (hFIP * 0.85 + 4.25 * 0.15);
  const aXFIP = awayStarterStats?.xfip || (aFIP * 0.85 + 4.25 * 0.15);
  ar -= (hFIP  - 4.25) * 0.55;
  hr -= (aFIP  - 4.25) * 0.55;
  ar -= (hXFIP - 4.25) * 0.25;
  hr -= (aXFIP - 4.25) * 0.25;

  // Park
  hr *= park.runFactor;
  ar *= park.runFactor;

  // Rolling form + Pythagorean regression
  if (homeForm) { hr += homeForm.formScore * 0.55; ar += homeForm.formScore * -0.15; hr += homeForm.luckFactor * -0.45; }
  if (awayForm) { ar += awayForm.formScore * 0.55; hr += awayForm.formScore * -0.15; ar += awayForm.luckFactor * -0.45; }

  // Bullpen fatigue
  if (homeBullpen) { ar += homeBullpen.fatigue * 1.2; if (!homeBullpen.closerAvailable) ar += 0.3; }
  if (awayBullpen) { hr += awayBullpen.fatigue * 1.2; if (!awayBullpen.closerAvailable) hr += 0.3; }

  // Umpire
  hr += ump.runsPerGame * 0.5;
  ar += ump.runsPerGame * 0.5;

  // Home advantage
  hr += 0.18;

  hr = Math.max(1.2, Math.min(11.5, hr));
  ar = Math.max(1.2, Math.min(11.5, ar));

  const hwp = 1 / (1 + Math.exp(-(hr - ar) * 0.72));
  const confidence = [homeHit, awayHit, homeStarterStats, awayStarterStats, homeForm, awayForm]
    .filter(Boolean).length / 6 * 0.44 + 0.44;

  return { homeRuns: hr, awayRuns: ar, homeWinPct: hwp, confidence, park, ump };
}

// ─── Banner color logic ───────────────────────────────────────
export function getBannerColor(game) {
  if (!game.prediction) return 'yellow';
  if (!game.homeStarter || !game.awayStarter) return 'yellow';
  const { homeWinPct } = game.prediction;
  // Without live odds API key, use model vs league-average 50/50 baseline
  // Green = model strongly favors one side (>58% or <42%)
  // Red = very close game where public might over-bet a side
  // Yellow = missing data
  if (homeWinPct >= 0.58) return 'green';   // model likes home
  if (homeWinPct <= 0.42) return 'green';   // model likes away
  return 'neutral';
}
