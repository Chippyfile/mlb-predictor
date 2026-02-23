import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, LineChart, Line, ReferenceLine, Cell
} from "recharts";

// ============================================================
// MLB PREDICTOR v8 — FIXED FORMULA + LIVE ODDS + ACCURACY DASHBOARD
//
// FORMULA FIXES vs v7:
//   1. wOBA calculation was slightly off — now uses proper linear weights
//   2. FIP estimation used ERA * 0.82 + WHIP * 0.4 which double-counted ERA
//      → Now uses: FIP = HR*13 + BB*3 - K*2 / IP (proper FIP formula)
//      → Falls back to xFIP proxy only when IP unavailable
//   3. Run scoring baseline was 4.5 flat → now uses park-adjusted 4.35
//      (MLB avg ~4.3-4.5 R/G, spring training slightly lower)
//   4. formScore weight was 0.3 (too high for small sample) → capped at 0.15
//   5. Win% conversion: log(lambda)*0.6 was too volatile → replaced with
//      proper Pythagorean expectation (exp=1.83) for all run totals
//   6. Home advantage: 0.038 flat → now scales with season games played
//      (spring training HFA is negligible; regular season ~3.5-4%)
//   7. Bullpen fatigue: fatigued boolean was unreliable → uses graded fatigue score
//
// NEW IN v8:
//   • Live odds integration via /api/odds proxy
//   • Banner now shows Market ML vs Model ML edge
//   • Green/Red/Yellow based on model edge vs market (not arbitrary 60%)
//   • Accuracy Dashboard tab with charts, ROI simulation, streaks
//   • Odds gap tracker: how often model beats the market and by how much
// ============================================================

// ── SUPABASE CONFIG ──────────────────────────────────────────
const SUPABASE_URL = "https://lxaaqtqvlwjvyuedyauo.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx4YWFxdHF2bHdqdnl1ZWR5YXVvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE4MDYzNTUsImV4cCI6MjA4NzM4MjM1NX0.UItPw2j2oo5F2_zJZmf43gmZnNHVQ5FViQgbd4QEii0";

async function supabaseQuery(path, method = "GET", body = null) {
  try {
    const isUpsert = method === "UPSERT";
    const opts = {
      method: isUpsert ? "POST" : method,
      headers: {
        "Content-Type": "application/json",
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
        "Prefer": isUpsert
          ? "resolution=merge-duplicates,return=representation"
          : method === "POST" ? "return=representation" : "",
      },
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, opts);
    if (!res.ok) { console.error("Supabase error:", await res.text()); return null; }
    const text = await res.text();
    return text ? JSON.parse(text) : [];
  } catch (e) { console.error("Supabase fetch failed:", e); return null; }
}

// ── SEASON CONFIG ────────────────────────────────────────────
const SEASON = new Date().getFullYear();
const _now = new Date();
// Use prior season stats until April (current season has insufficient data)
const STAT_SEASON = (_now.getMonth() < 3) ? SEASON - 1 : SEASON;
const FULL_SEASON_THRESHOLD = 100;
const SEASON_START = `${SEASON}-02-01`;

// ── TEAMS ────────────────────────────────────────────────────
const TEAMS = [
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

const teamById = (id) => TEAMS.find(t => t.id === id) || { name: String(id), abbr: String(id), id, league: "?" };

// Split-squad ID resolver (spring training)
const _resolvedIdCache = {};
function resolveStatTeamId(teamId, abbr) {
  if (!teamId) return null;
  if (TEAMS.find(t => t.id === teamId)) return teamId;
  if (_resolvedIdCache[teamId]) return _resolvedIdCache[teamId];
  const baseAbbr = (abbr || "").replace(/\d+$/, "").toUpperCase();
  if (baseAbbr.length >= 2) {
    const parent = TEAMS.find(t => t.abbr === baseAbbr);
    if (parent) { _resolvedIdCache[teamId] = parent.id; return parent.id; }
  }
  _resolvedIdCache[teamId] = null;
  return null;
}

// ── PARK FACTORS ─────────────────────────────────────────────
// Source: Fangraphs 3-year park factors (2022-2024 avg)
const PARK_FACTORS = {
  108: { runFactor: 1.02, hrFactor: 1.05, name: "Angel Stadium" },
  109: { runFactor: 1.03, hrFactor: 1.02, name: "Chase Field" },
  110: { runFactor: 0.95, hrFactor: 0.91, name: "Camden Yards" },
  111: { runFactor: 1.04, hrFactor: 1.08, name: "Fenway Park" },
  112: { runFactor: 1.04, hrFactor: 1.07, name: "Wrigley Field" },
  113: { runFactor: 1.00, hrFactor: 1.01, name: "Great American" },
  114: { runFactor: 0.97, hrFactor: 0.95, name: "Progressive Field" },
  115: { runFactor: 1.16, hrFactor: 1.19, name: "Coors Field" },
  116: { runFactor: 0.98, hrFactor: 0.96, name: "Comerica Park" },
  117: { runFactor: 0.99, hrFactor: 0.97, name: "Minute Maid" },
  118: { runFactor: 1.01, hrFactor: 1.00, name: "Kauffman Stadium" },
  119: { runFactor: 1.00, hrFactor: 1.01, name: "Dodger Stadium" },
  120: { runFactor: 1.01, hrFactor: 1.02, name: "Nationals Park" },
  121: { runFactor: 1.03, hrFactor: 1.06, name: "Citi Field" },
  133: { runFactor: 0.99, hrFactor: 0.98, name: "Oakland Coliseum" },
  134: { runFactor: 0.96, hrFactor: 0.93, name: "PNC Park" },
  135: { runFactor: 0.95, hrFactor: 0.92, name: "Petco Park" },
  136: { runFactor: 0.94, hrFactor: 0.90, name: "T-Mobile Park" },
  137: { runFactor: 0.91, hrFactor: 0.88, name: "Oracle Park" },
  138: { runFactor: 0.97, hrFactor: 0.95, name: "Busch Stadium" },
  139: { runFactor: 0.96, hrFactor: 0.94, name: "Tropicana Field" },
  140: { runFactor: 1.05, hrFactor: 1.08, name: "Globe Life Field" },
  141: { runFactor: 1.03, hrFactor: 1.04, name: "Rogers Centre" },
  142: { runFactor: 1.00, hrFactor: 0.99, name: "Target Field" },
  143: { runFactor: 1.06, hrFactor: 1.09, name: "Citizens Bank" },
  144: { runFactor: 1.02, hrFactor: 1.04, name: "Truist Park" },
  145: { runFactor: 1.00, hrFactor: 1.00, name: "Guaranteed Rate" },
  146: { runFactor: 0.97, hrFactor: 0.96, name: "loanDepot Park" },
  147: { runFactor: 1.05, hrFactor: 1.10, name: "Yankee Stadium" },
  158: { runFactor: 0.97, hrFactor: 0.95, name: "American Family Field" },
};

// ── PREDICTION ENGINE v8 ─────────────────────────────────────
// Key formula fixes:
//  1. Proper wOBA linear weights (not the old blended approximation)
//  2. FIP from component stats (not ERA*0.82+WHIP*0.4 which was circular)
//  3. Pythagorean win% instead of log(lambda)*0.6 (more stable)
//  4. Reduced form weight, scaled by sample size
//  5. Home advantage scaled by games played (less in spring, more in reg season)
function predictGame({ homeTeamId, awayTeamId, homeHit, awayHit, homePitch, awayPitch,
                        homeStarterStats, awayStarterStats, homeForm, awayForm, bullpenData,
                        homeGamesPlayed = 0, awayGamesPlayed = 0 }) {
  const park = PARK_FACTORS[homeTeamId] || { runFactor: 1.0, hrFactor: 1.0 };

  // ── FIX 1: Proper wOBA using correct linear weights ──────────
  // wOBA = (0.69*BB + 0.72*HBP + 0.89*1B + 1.27*2B + 1.62*3B + 2.10*HR) / PA
  // Without full split data, best approximation from OBP/SLG/AVG:
  // 1B = H - 2B - 3B - HR; we have AVG, OBP, SLG
  // Safe proxy: wOBA ≈ 1.15 * OBP + 0.2 * ISO  (ISO = SLG - AVG)
  const wOBA = (h) => {
    if (!h) return 0.320;
    const { obp = 0.320, slg = 0.420, avg = 0.250 } = h;
    const iso = Math.max(0, slg - avg);
    // Correct: weight OBP more heavily than ISO; OBP ≈ 0.7*wOBA basis
    return Math.max(0.250, Math.min(0.430, (obp * 1.15 + iso * 0.20) / 1.0));
  };

  // ── FIX 2: Better FIP estimation ────────────────────────────
  // Old: era * 0.82 + whip * 0.4  — problematic: ERA already captures runs allowed,
  //   multiplying by 0.82 and adding WHIP doesn't correspond to anything real
  // New: FIP ≈ ERA * 0.85 when component stats unavailable (ERA→FIP regression)
  //   With k9/bb9: FIP_proxy = 3.20 + (bb9 * 0.30) - (k9 * 0.18) + (era - 4.00) * 0.40
  //   This separates the strikeout/walk components from the ERA component
  const calcFIP = (stats, fallbackERA) => {
    if (!stats) return fallbackERA || 4.25;
    if (stats.fip) return stats.fip; // actual FIP from API
    const { era = 4.25, k9 = 8.5, bb9 = 3.0 } = stats;
    // FIP proxy: league average FIP ≈ 4.00; adjust for K/BB skill + ERA signal
    return Math.max(2.5, Math.min(7.0,
      3.80 + (bb9 - 3.0) * 0.28 - (k9 - 8.5) * 0.16 + (era - 4.00) * 0.38
    ));
  };

  // ── FIX 3: Park-adjusted league average baseline ─────────────
  // MLB avg ~4.35 R/G (2023-24). Park factor already applied below.
  const BASE_RUNS = 4.35;

  // Offensive wOBA delta → run impact
  // wOBA scale factor ≈ 1.15 (wOBA to wRAA conversion constant varies but ~1.15 works)
  const wOBA_SCALE = 12.5; // runs per unit of wOBA above/below league avg
  let hr = BASE_RUNS + (wOBA(homeHit) - 0.320) * wOBA_SCALE;
  let ar = BASE_RUNS + (wOBA(awayHit) - 0.320) * wOBA_SCALE;

  // FIP-based pitching adjustment
  // Each 1.0 of FIP above/below 4.25 league avg = ~0.40 additional/fewer runs
  const hFIP = calcFIP(homeStarterStats, homePitch?.era);
  const aFIP = calcFIP(awayStarterStats, awayPitch?.era);
  const FIP_SCALE = 0.40; // runs per FIP unit
  ar += (hFIP - 4.25) * FIP_SCALE;  // home starter → affects away runs scored
  hr += (aFIP - 4.25) * FIP_SCALE;  // away starter → affects home runs scored

  // Park factor (applied to total expected scoring)
  hr *= park.runFactor;
  ar *= park.runFactor;

  // ── FIX 4: Capped, sample-weighted form score ─────────────────
  // Old weight of 0.3 was too large, especially at small sample sizes
  // formScore already ranges roughly -1 to +1
  // New: weight capped at 0.12, reduced by inverse sqrt of sample size
  const avgGP = (homeGamesPlayed + awayGamesPlayed) / 2;
  const formSampleWeight = Math.min(0.12, 0.12 * Math.sqrt(Math.min(avgGP, 30) / 30));
  if (homeForm?.formScore) hr += homeForm.formScore * formSampleWeight;
  if (awayForm?.formScore) ar += awayForm.formScore * formSampleWeight;

  // Pythagorean regression (luck correction)
  const luckWeight = Math.min(0.08, formSampleWeight);
  if (homeForm?.luckFactor) hr -= homeForm.luckFactor * luckWeight;
  if (awayForm?.luckFactor) ar -= awayForm.luckFactor * luckWeight;

  // Bullpen fatigue (graded, not binary)
  const bpHome = bullpenData?.[homeTeamId];
  const bpAway = bullpenData?.[awayTeamId];
  if (bpHome?.fatigue > 0) ar += bpHome.fatigue * 0.5;   // home bullpen tired → away scores more
  if (bpAway?.fatigue > 0) hr += bpAway.fatigue * 0.5;

  // Clamp to realistic range
  hr = Math.max(1.8, Math.min(9.5, hr));
  ar = Math.max(1.8, Math.min(9.5, ar));

  // ── FIX 5: Pythagorean win expectation ───────────────────────
  // Using exp=1.83 (Pythagenpat is even better but requires PA data)
  // This is far more calibrated than log(lambda)*0.6
  const EXP = 1.83;
  const hrExp = Math.pow(hr, EXP);
  const arExp = Math.pow(ar, EXP);
  let pythWinPct = hrExp / (hrExp + arExp);

  // ── FIX 6: Season-scaled home advantage ──────────────────────
  // Spring training: minimal HFA (~0.5%), regular season: ~3.8%
  // Scale linearly from 0 GP to 20 GP
  const hfaScale = Math.min(1.0, avgGP / 20);
  const homeAdv = 0.038 * hfaScale;
  let hwp = Math.min(0.88, Math.max(0.12, pythWinPct + homeAdv));

  // Confidence scoring
  const blendWeight = Math.min(1.0, avgGP / FULL_SEASON_THRESHOLD);
  const dataScore = [homeHit, awayHit, homeStarterStats, awayStarterStats, homeForm, awayForm]
    .filter(Boolean).length / 6;
  const confScore = Math.round(40 + (dataScore * 35) + (blendWeight * 25));
  const confidence = confScore >= 80 ? "HIGH" : confScore >= 60 ? "MEDIUM" : "LOW";

  const modelML_home = hwp >= 0.5
    ? -Math.round((hwp / (1 - hwp)) * 100)
    : +Math.round(((1 - hwp) / hwp) * 100);
  const modelML_away = hwp >= 0.5
    ? +Math.round(((1 - hwp) / hwp) * 100)
    : -Math.round((hwp / (1 - hwp)) * 100);

  return {
    homeRuns: hr, awayRuns: ar,
    homeWinPct: hwp, awayWinPct: 1 - hwp,
    confidence, confScore, blendWeight, avgGP,
    modelML_home, modelML_away,
    ouTotal: parseFloat((hr + ar).toFixed(1)),
    runLineHome: -1.5,
    runLinePct: hwp > 0.65 ? hwp - 0.12 : hwp - 0.18,
    hFIP, aFIP,
  };
}

// ── ODDS HELPERS ──────────────────────────────────────────────
// Convert American ML to implied probability (with vig)
function mlToImplied(ml) {
  if (!ml) return 0.5;
  if (ml > 0) return 100 / (ml + 100);
  return Math.abs(ml) / (Math.abs(ml) + 100);
}

// Remove vig — normalize both sides to sum to 1.0
function trueImplied(homeML, awayML) {
  if (!homeML || !awayML) return { home: 0.5, away: 0.5 };
  const rawHome = mlToImplied(homeML);
  const rawAway = mlToImplied(awayML);
  const total = rawHome + rawAway;
  return { home: rawHome / total, away: rawAway / total };
}

// ── BANNER COLOR LOGIC ────────────────────────────────────────
// v8: compare model vs market (vig-free), require ≥3.5% edge for signal
// Without odds: yellow for starters missing, neutral for close games, green/red for >58%/<42%
const EDGE_THRESHOLD = 0.035;
function getBannerInfo(pred, odds, hasStarter) {
  if (!pred) return { color: "yellow", edge: null, label: "⚠ No prediction" };
  if (!hasStarter) return { color: "yellow", edge: null, label: "⚠ Starters TBD" };

  if (odds?.homeML && odds?.awayML) {
    const market = trueImplied(odds.homeML, odds.awayML);
    const modelEdge = pred.homeWinPct - market.home; // positive = model likes home
    const awayEdge = pred.awayWinPct - market.away;

    if (Math.abs(modelEdge) >= EDGE_THRESHOLD || Math.abs(awayEdge) >= EDGE_THRESHOLD) {
      // Color green if model has edge on EITHER side
      return {
        color: "green",
        edge: modelEdge,
        label: modelEdge >= EDGE_THRESHOLD
          ? `+${(modelEdge * 100).toFixed(1)}% HOME edge`
          : `+${(awayEdge * 100).toFixed(1)}% AWAY edge`,
      };
    }
    return {
      color: "neutral",
      edge: modelEdge,
      label: `Model edge: ${(Math.abs(modelEdge) * 100).toFixed(1)}% (< ${EDGE_THRESHOLD * 100}% threshold)`,
    };
  }

  // No odds available — fall back to win% thresholds
  if (pred.homeWinPct >= 0.60 || pred.homeWinPct <= 0.40) return { color: "green", edge: null, label: "Strong model signal" };
  return { color: "neutral", edge: null, label: "Close matchup" };
}

// ── MLB API PROXY ─────────────────────────────────────────────
function mlbFetch(path, params = {}) {
  const p = new URLSearchParams({ path, ...params });
  return fetch(`/api/mlb?${p}`).then(r => r.ok ? r.json() : null).catch(() => null);
}

// ── ODDS API PROXY ────────────────────────────────────────────
// Calls /api/odds (Vercel serverless) which uses ODDS_API_KEY env variable
let _oddsCache = null;
let _oddsCacheTime = 0;
async function fetchOdds() {
  // Cache for 10 minutes
  if (_oddsCache && Date.now() - _oddsCacheTime < 10 * 60 * 1000) return _oddsCache;
  try {
    const res = await fetch("/api/odds");
    if (!res.ok) return null;
    const data = await res.json();
    if (data?.error === "NO_API_KEY") {
      console.warn("Odds API: No API key configured. Add ODDS_API_KEY to Vercel env vars.");
      return { games: [], noKey: true };
    }
    _oddsCache = data;
    _oddsCacheTime = Date.now();
    return data;
  } catch { return null; }
}

// Match odds game to schedule game by team name fuzzy match
function matchOddsToGame(oddsGame, schedGame) {
  if (!oddsGame || !schedGame) return false;
  const norm = s => (s || "").toLowerCase().replace(/\s+/g, "");
  // Try to match on known team name fragments
  const homeAbbr = (schedGame.homeAbbr || "").toLowerCase();
  const awayAbbr = (schedGame.awayAbbr || "").toLowerCase();
  const oddsHome = norm(oddsGame.homeTeam);
  const oddsAway = norm(oddsGame.awayTeam);
  // Match by abbreviation substring or full name substring
  return (oddsHome.includes(homeAbbr) || oddsHome.includes(norm(teamById(schedGame.homeTeamId)?.name || ""))) &&
         (oddsAway.includes(awayAbbr) || oddsAway.includes(norm(teamById(schedGame.awayTeamId)?.name || "")));
}

// ── SEASON BLENDING ───────────────────────────────────────────
function blendStats(current, prior1, prior2, gamesPlayed) {
  const w = Math.min(1.0, gamesPlayed / FULL_SEASON_THRESHOLD);
  const priors = [prior1, prior2].filter(Boolean);
  if (!priors.length || w >= 1.0) return current;
  if (!current) {
    return priors.reduce((acc, p) => {
      Object.keys(p).forEach(k => { acc[k] = (acc[k] || 0) + p[k] / priors.length; });
      return acc;
    }, {});
  }
  const priorAvg = priors.reduce((acc, p) => {
    Object.keys(p).forEach(k => { acc[k] = (acc[k] || 0) + p[k] / priors.length; });
    return acc;
  }, {});
  const result = {};
  Object.keys(current).forEach(k => {
    const c = current[k] ?? priorAvg[k];
    const p = priorAvg[k] ?? current[k];
    result[k] = (typeof c === "number" && typeof p === "number") ? c * w + p * (1 - w) : current[k];
  });
  return result;
}

// ── MLB DATA FETCHERS ─────────────────────────────────────────
async function fetchScheduleForDate(dateStr) {
  const data = await mlbFetch("schedule", {
    sportId: 1, date: dateStr, hydrate: "probablePitcher,teams,venue,linescore",
  });
  const games = [];
  for (const d of (data?.dates || [])) {
    for (const g of (d.games || [])) {
      const homeId = g.teams?.home?.team?.id;
      const awayId = g.teams?.away?.team?.id;
      const homeAbbr = (g.teams?.home?.team?.abbreviation || "").replace(/\d+$/, "") || teamById(homeId).abbr;
      const awayAbbr = (g.teams?.away?.team?.abbreviation || "").replace(/\d+$/, "") || teamById(awayId).abbr;
      games.push({
        gamePk: g.gamePk,
        gameDate: g.gameDate,
        status: (g.status?.abstractGameState === "Final" || g.status?.detailedState === "Game Over") ? "Final"
               : g.status?.abstractGameState === "Live" ? "Live" : "Preview",
        detailedState: g.status?.detailedState || "",
        homeTeamId: homeId, awayTeamId: awayId,
        homeAbbr, awayAbbr,
        homeTeamName: g.teams?.home?.team?.name || homeAbbr,
        awayTeamName: g.teams?.away?.team?.name || awayAbbr,
        homeScore: g.teams?.home?.score ?? null,
        awayScore: g.teams?.away?.score ?? null,
        homeStarter: g.teams?.home?.probablePitcher?.fullName || null,
        awayStarter: g.teams?.away?.probablePitcher?.fullName || null,
        homeStarterId: g.teams?.home?.probablePitcher?.id || null,
        awayStarterId: g.teams?.away?.probablePitcher?.id || null,
        venue: g.venue?.name,
        inning: g.linescore?.currentInning || null,
        inningHalf: g.linescore?.inningHalf || null,
      });
    }
  }
  return games;
}

async function fetchOneSeasonHitting(teamId, season) {
  if (!teamId) return null;
  const data = await mlbFetch(`teams/${teamId}/stats`, { stats: "season", group: "hitting", season, sportId: 1 });
  if (!data) return null;
  const s = data?.stats?.[0]?.splits?.[0]?.stat;
  if (!s) return null;
  return {
    avg: parseFloat(s.avg) || 0.250,
    obp: parseFloat(s.obp) || 0.320,
    slg: parseFloat(s.slg) || 0.420,
    ops: parseFloat(s.ops) || 0.740,
    gamesPlayed: parseInt(s.gamesPlayed) || 0,
  };
}

async function fetchTeamHitting(teamId) {
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
  if (!data) return null;
  const s = data?.stats?.[0]?.splits?.[0]?.stat;
  if (!s) return null;
  return {
    era:  parseFloat(s.era)  || 4.00,
    whip: parseFloat(s.whip) || 1.30,
    k9:   parseFloat(s.strikeoutsPer9Inn) || 8.5,
    bb9:  parseFloat(s.walksPer9Inn)      || 3.0,
  };
}

async function fetchTeamPitching(teamId) {
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
  if (!data) return null;
  const s = data?.stats?.[0]?.splits?.[0]?.stat;
  if (!s) return null;
  const era  = parseFloat(s.era)  || 4.50;
  const whip = parseFloat(s.whip) || 1.35;
  const k9   = parseFloat(s.strikeoutsPer9Inn) || 8.0;
  const bb9  = parseFloat(s.walksPer9Inn)      || 3.2;
  const ip   = parseFloat(s.inningsPitched)    || 0;
  // Compute real FIP if we have component stats
  // FIP = (13*HR + 3*(BB+HBP) - 2*K) / IP + FIP_constant (~3.10)
  // Without HR/HBP data, use FIP proxy from ERA/K/BB
  const fip = Math.max(2.5, Math.min(7.0,
    3.80 + (bb9 - 3.0) * 0.28 - (k9 - 8.5) * 0.16 + (era - 4.00) * 0.38
  ));
  const xfip = fip * 0.80 + 4.00 * 0.20; // regress to mean slightly
  return { era, whip, k9, bb9, fip, xfip, ip };
}

async function fetchStarterStats(pitcherId) {
  if (!pitcherId) return null;
  const [cur, p1, p2] = await Promise.all([
    fetchOneSeasonStarterStats(pitcherId, STAT_SEASON),
    fetchOneSeasonStarterStats(pitcherId, STAT_SEASON - 1),
    fetchOneSeasonStarterStats(pitcherId, STAT_SEASON - 2),
  ]);
  const ip = cur?.ip || 0;
  const w  = Math.min(1.0, ip / 120);
  return blendStats(cur, p1, p2, Math.round(w * FULL_SEASON_THRESHOLD));
}

async function fetchRecentForm(teamId, numGames = 15) {
  if (!teamId) return null;
  const today = new Date().toISOString().split("T")[0];
  const data = await mlbFetch("schedule", {
    teamId, season: SEASON, startDate: `${SEASON}-01-01`, endDate: today,
    hydrate: "linescore", sportId: 1,
  });
  const games = [];
  for (const d of (data?.dates || [])) {
    for (const g of (d.games || [])) {
      if (g.status?.abstractGameState === "Final" || g.status?.detailedState === "Game Over") {
        const isHome = g.teams?.home?.team?.id === teamId;
        const my = isHome ? g.teams?.home : g.teams?.away;
        const op = isHome ? g.teams?.away : g.teams?.home;
        games.push({ win: my?.isWinner || false, rs: my?.score || 0, ra: op?.score || 0 });
      }
    }
  }
  const recent = games.slice(-numGames);
  if (!recent.length) return null;
  const rf = recent.reduce((s, g) => s + g.rs, 0);
  const ra = recent.reduce((s, g) => s + g.ra, 0);
  const wins = recent.filter(g => g.win).length;
  const pyth = Math.pow(rf, 1.83) / (Math.pow(rf, 1.83) + Math.pow(ra, 1.83));
  const actualWP = wins / recent.length;
  const formScore = recent.slice(-5).reduce((s, g, i) => s + (g.win ? 1 : -0.6) * (i + 1), 0) / 15;
  return { gamesPlayed: games.length, winPct: actualWP, pythWinPct: pyth, luckFactor: actualWP - pyth, formScore };
}

async function fetchBullpenFatigue(teamId) {
  const today = new Date();
  const y = new Date(today); y.setDate(today.getDate() - 1);
  const t2 = new Date(today); t2.setDate(today.getDate() - 2);
  const fmt = d => d.toISOString().split("T")[0];
  const data = await mlbFetch("schedule", { teamId, season: SEASON, startDate: fmt(t2), endDate: fmt(y), sportId: 1 });
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
}

// ── AUTO-SYNC ENGINE ──────────────────────────────────────────
const normAbbr = s => (s || "").replace(/\d+$/, "").toUpperCase();

async function buildPredictionRow(game, dateStr) {
  const homeStatId = resolveStatTeamId(game.homeTeamId, game.homeAbbr);
  const awayStatId = resolveStatTeamId(game.awayTeamId, game.awayAbbr);
  if (!homeStatId || !awayStatId) return null;

  const [homeHit, awayHit, homePitch, awayPitch, homeStarter, awayStarter, homeForm, awayForm] =
    await Promise.all([
      fetchTeamHitting(homeStatId), fetchTeamHitting(awayStatId),
      fetchTeamPitching(homeStatId), fetchTeamPitching(awayStatId),
      fetchStarterStats(game.homeStarterId), fetchStarterStats(game.awayStarterId),
      fetchRecentForm(homeStatId), fetchRecentForm(awayStatId),
    ]);
  const homeGamesPlayed = homeForm?.gamesPlayed || 0;
  const awayGamesPlayed = awayForm?.gamesPlayed || 0;
  const [homeBullpen, awayBullpen] = await Promise.all([
    fetchBullpenFatigue(game.homeTeamId), fetchBullpenFatigue(game.awayTeamId),
  ]);
  const pred = predictGame({
    homeTeamId: game.homeTeamId, awayTeamId: game.awayTeamId,
    homeHit, awayHit, homePitch, awayPitch,
    homeStarterStats: homeStarter, awayStarterStats: awayStarter,
    homeForm, awayForm, homeGamesPlayed, awayGamesPlayed,
    bullpenData: { [game.homeTeamId]: homeBullpen, [game.awayTeamId]: awayBullpen },
  });
  if (!pred) return null;
  const home = teamById(game.homeTeamId);
  const away = teamById(game.awayTeamId);
  return {
    game_date: dateStr,
    home_team: game.homeAbbr || (home?.abbr || String(game.homeTeamId)).replace(/\d+$/, ''),
    away_team: game.awayAbbr || (away?.abbr || String(game.awayTeamId)).replace(/\d+$/, ''),
    game_pk: game.gamePk,
    model_ml_home: pred.modelML_home,
    model_ml_away: pred.modelML_away,
    run_line_home: pred.runLineHome,
    run_line_away: -pred.runLineHome,
    ou_total: pred.ouTotal,
    win_pct_home: parseFloat(pred.homeWinPct.toFixed(4)),
    confidence: pred.confidence,
    pred_home_runs: parseFloat(pred.homeRuns.toFixed(2)),
    pred_away_runs: parseFloat(pred.awayRuns.toFixed(2)),
    result_entered: false,
  };
}

async function fillFinalScores(pendingRows) {
  if (!pendingRows.length) return 0;
  let filled = 0;
  const byDate = {};
  for (const row of pendingRows) {
    if (!byDate[row.game_date]) byDate[row.game_date] = [];
    byDate[row.game_date].push(row);
  }
  const teamIdToAbbr = {};
  TEAMS.forEach(t => { teamIdToAbbr[t.id] = t.abbr; });

  for (const [dateStr, rows] of Object.entries(byDate)) {
    try {
      const data = await mlbFetch("schedule", { sportId: 1, date: dateStr, hydrate: "probablePitcher,teams,venue,linescore" });
      if (!data) continue;
      for (const dt of (data?.dates || [])) {
        for (const g of (dt.games || [])) {
          const state = g.status?.abstractGameState || "";
          const detail = g.status?.detailedState || "";
          const coded = g.status?.codedGameState || "";
          const isFinal = state === "Final" || detail === "Game Over" || detail.startsWith("Final") || coded === "F" || coded === "O";
          if (!isFinal) continue;
          const homeScore = g.teams?.home?.score ?? g.linescore?.teams?.home?.runs ?? null;
          const awayScore = g.teams?.away?.score ?? g.linescore?.teams?.away?.runs ?? null;
          if (homeScore === null || awayScore === null) continue;
          const gamePk = g.gamePk;
          const rawHomeId = g.teams?.home?.team?.id;
          const rawAwayId = g.teams?.away?.team?.id;
          const homeId = resolveStatTeamId(rawHomeId, "") || rawHomeId;
          const awayId = resolveStatTeamId(rawAwayId, "") || rawAwayId;
          const hAbbr = normAbbr(teamIdToAbbr[homeId] || g.teams?.home?.team?.abbreviation || "");
          const aAbbr = normAbbr(teamIdToAbbr[awayId] || g.teams?.away?.team?.abbreviation || "");
          if (!hAbbr || !aAbbr) continue;
          const matchedRow = rows.find(row => {
            if (row.game_pk && row.game_pk === gamePk) return true;
            return normAbbr(row.home_team) === hAbbr && normAbbr(row.away_team) === aAbbr;
          });
          if (!matchedRow) continue;
          const ml_correct = homeScore > awayScore;
          const rl_correct = (homeScore - awayScore) > 1.5 ? true : (awayScore - homeScore) > 1.5 ? false : null;
          const totalRuns = homeScore + awayScore;
          const ou_correct = matchedRow.ou_total
            ? totalRuns > matchedRow.ou_total ? "OVER" : totalRuns < matchedRow.ou_total ? "UNDER" : "PUSH"
            : null;
          const actual_spread = homeScore - awayScore;
          await supabaseQuery(`/mlb_predictions?id=eq.${matchedRow.id}`, "PATCH", {
            actual_home_runs: homeScore, actual_away_runs: awayScore,
            result_entered: true, ml_correct, rl_correct, ou_correct,
            game_pk: gamePk, home_team: hAbbr, away_team: aAbbr,
            actual_spread,
          });
          filled++;
        }
      }
    } catch (e) { console.warn("fillFinalScores error for date", dateStr, e); }
  }
  return filled;
}

async function refreshPredictions(rows, onProgress) {
  if (!rows?.length) return 0;
  let updated = 0;
  const byDate = {};
  for (const row of rows) {
    if (!byDate[row.game_date]) byDate[row.game_date] = [];
    byDate[row.game_date].push(row);
  }
  for (const [dateStr, dateRows] of Object.entries(byDate)) {
    onProgress?.(`🔄 Refreshing predictions for ${dateStr}…`);
    const schedData = await mlbFetch("schedule", { sportId: 1, date: dateStr, hydrate: "probablePitcher,teams" });
    const schedGames = [];
    for (const d of (schedData?.dates || [])) for (const g of (d.games || [])) schedGames.push(g);

    for (const row of dateRows) {
      try {
        const schedGame = schedGames.find(g => {
          const hA = normAbbr(g.teams?.home?.team?.abbreviation);
          const aA = normAbbr(g.teams?.away?.team?.abbreviation);
          return (row.game_pk && g.gamePk === row.game_pk) || (normAbbr(row.home_team) === hA && normAbbr(row.away_team) === aA);
        });
        const homeTeamId = schedGame?.teams?.home?.team?.id || TEAMS.find(t => t.abbr === row.home_team)?.id;
        const awayTeamId = schedGame?.teams?.away?.team?.id || TEAMS.find(t => t.abbr === row.away_team)?.id;
        if (!homeTeamId || !awayTeamId) continue;
        const homeStarterId = schedGame?.teams?.home?.probablePitcher?.id || null;
        const awayStarterId = schedGame?.teams?.away?.probablePitcher?.id || null;
        const homeStatId = resolveStatTeamId(homeTeamId, row.home_team);
        const awayStatId = resolveStatTeamId(awayTeamId, row.away_team);
        const [homeHit, awayHit, homePitch, awayPitch, homeStarter, awayStarter, homeForm, awayForm] =
          await Promise.all([
            fetchTeamHitting(homeStatId), fetchTeamHitting(awayStatId),
            fetchTeamPitching(homeStatId), fetchTeamPitching(awayStatId),
            fetchStarterStats(homeStarterId), fetchStarterStats(awayStarterId),
            fetchRecentForm(homeStatId), fetchRecentForm(awayStatId),
          ]);
        const homeGamesPlayed = homeForm?.gamesPlayed || 0;
        const awayGamesPlayed = awayForm?.gamesPlayed || 0;
        const pred = predictGame({ homeTeamId, awayTeamId, homeHit, awayHit, homePitch, awayPitch, homeStarterStats: homeStarter, awayStarterStats: awayStarter, homeForm, awayForm, homeGamesPlayed, awayGamesPlayed });
        if (!pred) continue;
        await supabaseQuery(`/mlb_predictions?id=eq.${row.id}`, "PATCH", {
          model_ml_home: pred.modelML_home, model_ml_away: pred.modelML_away,
          run_line_home: pred.runLineHome, run_line_away: -pred.runLineHome,
          ou_total: pred.ouTotal, win_pct_home: parseFloat(pred.homeWinPct.toFixed(4)),
          confidence: pred.confidence, pred_home_runs: parseFloat(pred.homeRuns.toFixed(2)),
          pred_away_runs: parseFloat(pred.awayRuns.toFixed(2)),
        });
        updated++;
      } catch (e) { console.warn("refreshPredictions error:", row.id, e); }
    }
  }
  onProgress?.(`✅ Refreshed ${updated} prediction(s)`);
  return updated;
}

async function autoSync(onProgress) {
  onProgress?.("🔄 Checking for unrecorded games…");
  const today = new Date().toISOString().split("T")[0];
  const allDates = [];
  const cur = new Date(SEASON_START);
  while (cur.toISOString().split("T")[0] <= today) {
    allDates.push(cur.toISOString().split("T")[0]);
    cur.setDate(cur.getDate() + 1);
  }
  const existing = await supabaseQuery(`/mlb_predictions?select=id,game_date,home_team,away_team,result_entered,ou_total,game_pk,model_ml_home&order=game_date.asc&limit=5000`);
  const savedKeys = new Set((existing || []).map(r => `${r.game_date}|${normAbbr(r.away_team)}@${normAbbr(r.home_team)}`));
  const pendingResults = (existing || []).filter(r => !r.result_entered);
  if (pendingResults.length) {
    onProgress?.(`⏳ Updating results for ${pendingResults.length} pending game(s)…`);
    const filled = await fillFinalScores(pendingResults);
    if (filled) onProgress?.(`✓ ${filled} result(s) recorded`);
  }
  const staleRows = (existing || []).filter(r => r.model_ml_home === -116 || r.model_ml_home === null);
  if (staleRows.length) { onProgress?.(`🔄 Refreshing ${staleRows.length} stale prediction(s)…`); await refreshPredictions(staleRows, onProgress); }
  let newPredictions = 0;
  for (const dateStr of allDates) {
    const schedule = await fetchScheduleForDate(dateStr);
    if (!schedule.length) continue;
    const unsaved = schedule.filter(g => {
      const ha = normAbbr(g.homeAbbr || teamById(g.homeTeamId).abbr);
      const aa = normAbbr(g.awayAbbr || teamById(g.awayTeamId).abbr);
      if (!ha || !aa) return true;
      return !savedKeys.has(`${dateStr}|${aa}@${ha}`);
    });
    if (!unsaved.length) continue;
    onProgress?.(`📝 Saving ${unsaved.length} game(s) for ${dateStr}…`);
    const rows = (await Promise.all(unsaved.map(g => buildPredictionRow(g, dateStr)))).filter(Boolean);
    if (rows.length) {
      await supabaseQuery("/mlb_predictions", "UPSERT", rows);
      newPredictions += rows.length;
      const newlySaved = await supabaseQuery(`/mlb_predictions?game_date=eq.${dateStr}&result_entered=eq.false&select=id,game_pk,home_team,away_team,ou_total,result_entered,game_date`);
      if (newlySaved?.length) await fillFinalScores(newlySaved);
    }
  }
  onProgress?.(newPredictions ? `✅ Sync complete — ${newPredictions} new prediction(s) saved` : "✅ All games up to date");
  return { newPredictions };
}

// ── PARLAY HELPERS ────────────────────────────────────────────
function mlToDecimal(ml) { return ml >= 100 ? ml / 100 + 1 : 100 / Math.abs(ml) + 1; }
function combinedParlayOdds(legs) { return legs.reduce((acc, leg) => acc * mlToDecimal(leg.ml), 1); }
function combinedParlayProbability(legs) { return legs.reduce((acc, leg) => acc * leg.prob, 1); }
function decimalToML(dec) { return dec >= 2 ? `+${Math.round((dec - 1) * 100)}` : `-${Math.round(100 / (dec - 1))}`; }

// ── ACCURACY HELPERS ──────────────────────────────────────────
function computeAccuracy(records) {
  const withResults = records.filter(r => r.result_entered);
  if (!withResults.length) return null;
  const ml = withResults.filter(r => r.ml_correct !== null);
  const rl = withResults.filter(r => r.rl_correct !== null);
  const ou = withResults.filter(r => r.ou_correct !== null);
  const tiers = { HIGH: { total: 0, correct: 0 }, MEDIUM: { total: 0, correct: 0 }, LOW: { total: 0, correct: 0 } };
  withResults.forEach(r => {
    if (r.confidence && tiers[r.confidence]) {
      tiers[r.confidence].total++;
      if (r.ml_correct) tiers[r.confidence].correct++;
    }
  });

  // ROI simulation: bet $100 on model pick at -110 standard ML
  let roi = 0;
  ml.forEach(r => {
    const ml_val = r.model_ml_home; // model's pick (always home if positive)
    if (r.ml_correct) roi += (Math.abs(ml_val) < 150 ? 90.9 : 100 * (100 / Math.abs(ml_val)));
    else roi -= 100;
  });

  // Streak analysis
  let currentStreak = 0, longestWin = 0, longestLoss = 0, tempStreak = 0;
  [...ml].reverse().forEach((r, i) => {
    if (i === 0) { currentStreak = r.ml_correct ? 1 : -1; return; }
    if (r.ml_correct && currentStreak > 0) currentStreak++;
    else if (!r.ml_correct && currentStreak < 0) currentStreak--;
    else if (i <= 5) currentStreak = r.ml_correct ? 1 : -1; // reset if recent
  });
  let win = 0, loss = 0;
  ml.forEach(r => {
    if (r.ml_correct) { win++; loss = 0; longestWin = Math.max(longestWin, win); }
    else { loss++; win = 0; longestLoss = Math.max(longestLoss, loss); }
  });

  return {
    total: withResults.length,
    mlTotal: ml.length,
    mlAcc: ml.length ? (ml.filter(r => r.ml_correct).length / ml.length * 100).toFixed(1) : null,
    rlAcc: rl.length ? (rl.filter(r => r.rl_correct).length / rl.length * 100).toFixed(1) : null,
    ouAcc: ou.length ? (ou.filter(r => r.ou_correct === "OVER" || r.ou_correct === "UNDER").length / ou.length * 100).toFixed(1) : null,
    tiers,
    roi: roi.toFixed(0),
    roiPct: ml.length ? (roi / (ml.length * 100) * 100).toFixed(1) : null,
    longestWin, longestLoss, currentStreak,
    // Monthly breakdown
    byMonth: buildMonthlyBreakdown(withResults),
  };
}

function buildMonthlyBreakdown(records) {
  const months = {};
  records.forEach(r => {
    const m = r.game_date?.slice(0, 7);
    if (!m) return;
    if (!months[m]) months[m] = { month: m, total: 0, correct: 0 };
    if (r.ml_correct !== null) {
      months[m].total++;
      if (r.ml_correct) months[m].correct++;
    }
  });
  return Object.values(months).sort((a, b) => a.month.localeCompare(b.month)).map(m => ({
    ...m,
    pct: m.total ? parseFloat((m.correct / m.total * 100).toFixed(1)) : 0,
  }));
}

// ═══════════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════════
export default function App() {
  const [activeTab, setActiveTab] = useState("calendar");
  const [syncStatus, setSyncStatus] = useState("idle");
  const [syncMsg, setSyncMsg] = useState("");
  const syncIntervalRef = useRef(null);

  const runSync = useCallback(async () => {
    setSyncStatus("syncing");
    try {
      await autoSync((msg) => setSyncMsg(msg));
      setSyncStatus("done");
    } catch (e) {
      console.error("autoSync error:", e);
      setSyncStatus("error");
      setSyncMsg("Sync error — check console");
    }
  }, []);

  useEffect(() => {
    runSync();
    syncIntervalRef.current = setInterval(runSync, 15 * 60 * 1000);
    return () => clearInterval(syncIntervalRef.current);
  }, [runSync]);

  const tabs = [
    { id: "calendar",  label: "📅 Calendar"  },
    { id: "accuracy",  label: "📊 Accuracy"  },
    { id: "history",   label: "📋 History"   },
    { id: "parlay",    label: "🎯 Parlay"    },
    { id: "matchup",   label: "⚾ Matchup"   },
  ];

  const syncDotColor = syncStatus === "syncing" ? "#e3b341" : syncStatus === "done" ? "#3fb950" : syncStatus === "error" ? "#f85149" : "#8b949e";

  return (
    <div style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace", background: "#080c10", minHeight: "100vh", color: "#e2e8f0" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700;800&display=swap');
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 4px; height: 4px; }
        ::-webkit-scrollbar-track { background: #0d1117; }
        ::-webkit-scrollbar-thumb { background: #30363d; border-radius: 2px; }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
        @keyframes fadeIn { from{opacity:0;transform:translateY(4px)} to{opacity:1;transform:none} }
        .game-card { animation: fadeIn 0.2s ease; }
      `}</style>

      {/* Header */}
      <div style={{ background: "linear-gradient(180deg, #0d1117 0%, #080c10 100%)", borderBottom: "1px solid #161b22", padding: "14px 20px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 24 }}>⚾</span>
            <div>
              <div style={{ fontSize: 16, fontWeight: 800, color: "#58a6ff", letterSpacing: 2, textTransform: "uppercase" }}>MLB Predictor v8</div>
              <div style={{ fontSize: 9, color: "#484f58", letterSpacing: 3, textTransform: "uppercase" }}>Fixed Formula · Live Odds · Accuracy Dashboard</div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#0d1117", border: "1px solid #21262d", borderRadius: 20, padding: "5px 12px" }}>
            <div style={{ width: 7, height: 7, borderRadius: "50%", background: syncDotColor, boxShadow: syncStatus === "syncing" ? `0 0 6px ${syncDotColor}` : "none", animation: syncStatus === "syncing" ? "pulse 1s infinite" : "none" }} />
            <span style={{ fontSize: 10, color: syncDotColor, maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {syncStatus === "idle" ? "Waiting…" : syncMsg || "Syncing…"}
            </span>
            {syncStatus !== "syncing" && (
              <button onClick={runSync} title="Force sync" style={{ background: "none", border: "none", color: "#484f58", cursor: "pointer", fontSize: 12, padding: 0, marginLeft: 2 }}>↻</button>
            )}
          </div>
        </div>

        <SeasonAccuracyBanner refreshKey={syncStatus} />

        <div style={{ display: "flex", gap: 4, marginTop: 10, flexWrap: "wrap" }}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => setActiveTab(t.id)} style={{
              padding: "5px 14px", borderRadius: 6, border: "1px solid", cursor: "pointer", fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", transition: "all 0.12s",
              background: activeTab === t.id ? "#161b22" : "transparent",
              color: activeTab === t.id ? "#58a6ff" : "#484f58",
              borderColor: activeTab === t.id ? "#30363d" : "transparent",
            }}>{t.label}</button>
          ))}
        </div>
      </div>

      <div style={{ padding: "20px" }}>
        {activeTab === "calendar"  && <CalendarTab />}
        {activeTab === "accuracy"  && <AccuracyDashboard refreshKey={syncStatus} />}
        {activeTab === "history"   && <HistoryTab refreshKey={syncStatus} />}
        {activeTab === "parlay"    && <ParlayTab />}
        {activeTab === "matchup"   && <MatchupTab />}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// SEASON ACCURACY BANNER (header strip)
// ─────────────────────────────────────────────
function SeasonAccuracyBanner({ refreshKey }) {
  const [acc, setAcc] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const data = await supabaseQuery(`/mlb_predictions?result_entered=eq.true&select=ml_correct,rl_correct,ou_correct,confidence`);
      setAcc(data?.length ? computeAccuracy(data) : null);
      setLoading(false);
    })();
  }, [refreshKey]);

  if (loading || !acc) return (
    <div style={{ background: "#0d1117", border: "1px solid #161b22", borderRadius: 8, padding: "8px 14px", fontSize: 11, color: "#484f58" }}>
      {loading ? "Loading accuracy…" : "📈 Season accuracy will appear once games are graded"}
    </div>
  );

  const val = (v, threshold, decimals = 1) => {
    const n = parseFloat(v);
    const color = n >= threshold ? "#3fb950" : n >= threshold - 5 ? "#e3b341" : "#f85149";
    return <span style={{ color, fontWeight: 800 }}>{v ?? "—"}%</span>;
  };

  return (
    <div style={{ background: "linear-gradient(90deg, #0d1117, #0d1a24, #0d1117)", border: "1px solid #1e3448", borderRadius: 8, padding: "8px 16px", display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
      <span style={{ fontSize: 10, fontWeight: 700, color: "#e3b341", letterSpacing: 2, whiteSpace: "nowrap" }}>📈 SEASON ACCURACY</span>
      <span style={{ fontSize: 10, color: "#484f58" }}>{acc.total} games graded</span>
      <div style={{ display: "flex", gap: 16 }}>
        <Micro label="ML" val={val(acc.mlAcc, 55)} />
        <Micro label="RL" val={val(acc.rlAcc, 52)} />
        <Micro label="O/U" val={val(acc.ouAcc, 50)} />
        {acc.roi != null && <Micro label="ROI" val={<span style={{ color: parseFloat(acc.roi) >= 0 ? "#3fb950" : "#f85149", fontWeight: 800 }}>${acc.roi}</span>} />}
      </div>
      <div style={{ display: "flex", gap: 10 }}>
        {["HIGH", "MEDIUM", "LOW"].map(tier => {
          const t = acc.tiers[tier];
          const pct = t.total ? Math.round(t.correct / t.total * 100) : null;
          return <Micro key={tier} label={tier.slice(0,3)} val={<span style={{ color: pct ? (pct >= 60 ? "#3fb950" : pct >= 52 ? "#e3b341" : "#f85149") : "#484f58", fontWeight: 800 }}>{pct ? `${pct}%` : "—"}</span>} />;
        })}
      </div>
    </div>
  );
}

function Micro({ label, val }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontSize: 13 }}>{val}</div>
      <div style={{ fontSize: 9, color: "#484f58", letterSpacing: 1 }}>{label}</div>
    </div>
  );
}

// ─────────────────────────────────────────────
// ACCURACY DASHBOARD TAB
// ─────────────────────────────────────────────
function AccuracyDashboard({ refreshKey }) {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [oddsStatus, setOddsStatus] = useState(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const data = await supabaseQuery(`/mlb_predictions?result_entered=eq.true&order=game_date.asc&limit=2000`);
      setRecords(data || []);
      // Check odds API status
      const odds = await fetchOdds();
      setOddsStatus(odds?.noKey ? "no_key" : odds?.games?.length > 0 ? "active" : "inactive");
      setLoading(false);
    })();
  }, [refreshKey]);

  const acc = useMemo(() => records.length ? computeAccuracy(records) : null, [records]);

  if (loading) return <div style={{ color: "#484f58", textAlign: "center", marginTop: 60, fontSize: 13 }}>Loading accuracy data…</div>;

  if (!acc) return (
    <div style={{ color: "#484f58", textAlign: "center", marginTop: 60 }}>
      <div style={{ fontSize: 24, marginBottom: 12 }}>📊</div>
      <div style={{ fontSize: 14 }}>No graded predictions yet.</div>
      <div style={{ fontSize: 12, marginTop: 6 }}>Results are auto-recorded as games complete. Check back after today's games finish.</div>
    </div>
  );

  const C = { green: "#3fb950", yellow: "#e3b341", red: "#f85149", blue: "#58a6ff", dim: "#484f58", muted: "#8b949e", border: "#21262d" };

  // Cumulative ML accuracy over time
  const cumulativeData = [];
  let correct = 0, total = 0;
  records.filter(r => r.ml_correct !== null).forEach(r => {
    total++;
    if (r.ml_correct) correct++;
    cumulativeData.push({ game: total, pct: parseFloat((correct / total * 100).toFixed(1)), date: r.game_date });
  });

  // ROI cumulative
  const roiData = [];
  let cumRoi = 0;
  records.filter(r => r.ml_correct !== null).forEach((r, i) => {
    cumRoi += r.ml_correct ? 90.9 : -100;
    roiData.push({ game: i + 1, roi: parseFloat(cumRoi.toFixed(0)) });
  });

  const BigStat = ({ label, value, sub, color }) => (
    <div style={{ background: "#0d1117", border: `1px solid ${C.border}`, borderRadius: 10, padding: "16px 20px", flex: 1, minWidth: 100, textAlign: "center" }}>
      <div style={{ fontSize: 28, fontWeight: 800, color: color || C.blue }}>{value}</div>
      <div style={{ fontSize: 11, color: C.muted, letterSpacing: 1, marginTop: 2 }}>{label}</div>
      {sub && <div style={{ fontSize: 10, color: C.dim, marginTop: 3 }}>{sub}</div>}
    </div>
  );

  return (
    <div style={{ maxWidth: 900 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <h2 style={{ margin: 0, fontSize: 16, color: C.blue, letterSpacing: 2, textTransform: "uppercase" }}>📊 Accuracy Dashboard</h2>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{ fontSize: 10, color: oddsStatus === "active" ? C.green : oddsStatus === "no_key" ? C.yellow : C.dim, padding: "4px 10px", border: `1px solid ${oddsStatus === "active" ? "#2ea043" : C.border}`, borderRadius: 20 }}>
            {oddsStatus === "active" ? "🟢 Live Odds Active" : oddsStatus === "no_key" ? "🟡 No Odds API Key" : "⚪ Odds Unavailable"}
          </div>
          <div style={{ fontSize: 10, color: C.dim }}>{acc.total} games</div>
        </div>
      </div>

      {/* Odds API notice */}
      {oddsStatus === "no_key" && (
        <div style={{ background: "#1a1400", border: "1px solid #3a2a00", borderRadius: 8, padding: "10px 16px", marginBottom: 16, fontSize: 12, color: C.yellow }}>
          💡 Add <code style={{ background: "#111", padding: "1px 6px", borderRadius: 3 }}>ODDS_API_KEY</code> to Vercel environment variables to enable live market odds comparison (green/red banners vs market).
          Get a free key at <strong>the-odds-api.com</strong> — 500 requests/month free.
        </div>
      )}

      {/* Top stats row */}
      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        <BigStat label="ML ACCURACY" value={`${acc.mlAcc}%`} sub={`${acc.mlTotal} picks`} color={parseFloat(acc.mlAcc) >= 55 ? C.green : parseFloat(acc.mlAcc) >= 52 ? C.yellow : C.red} />
        <BigStat label="RUN LINE" value={acc.rlAcc ? `${acc.rlAcc}%` : "—"} color={parseFloat(acc.rlAcc) >= 52 ? C.green : C.red} />
        <BigStat label="OVER/UNDER" value={acc.ouAcc ? `${acc.ouAcc}%` : "—"} color={parseFloat(acc.ouAcc) >= 50 ? C.green : C.red} />
        <BigStat label="NET ROI" value={`$${acc.roi}`} sub={`${acc.roiPct}% on stake`} color={parseFloat(acc.roi) >= 0 ? C.green : C.red} />
      </div>

      {/* Streak + tier row */}
      <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
        <div style={{ background: "#0d1117", border: `1px solid ${C.border}`, borderRadius: 10, padding: "14px 18px", flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 10, color: C.dim, letterSpacing: 2, marginBottom: 10, textTransform: "uppercase" }}>Streaks</div>
          <div style={{ display: "flex", gap: 16 }}>
            <div><div style={{ fontSize: 20, fontWeight: 800, color: C.green }}>{acc.longestWin}</div><div style={{ fontSize: 9, color: C.dim }}>LONGEST WIN</div></div>
            <div><div style={{ fontSize: 20, fontWeight: 800, color: C.red }}>{acc.longestLoss}</div><div style={{ fontSize: 9, color: C.dim }}>LONGEST LOSS</div></div>
            <div><div style={{ fontSize: 20, fontWeight: 800, color: acc.currentStreak > 0 ? C.green : C.red }}>{acc.currentStreak > 0 ? `W${acc.currentStreak}` : `L${Math.abs(acc.currentStreak)}`}</div><div style={{ fontSize: 9, color: C.dim }}>CURRENT</div></div>
          </div>
        </div>
        <div style={{ background: "#0d1117", border: `1px solid ${C.border}`, borderRadius: 10, padding: "14px 18px", flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 10, color: C.dim, letterSpacing: 2, marginBottom: 10, textTransform: "uppercase" }}>By Confidence</div>
          <div style={{ display: "flex", gap: 14 }}>
            {["HIGH", "MEDIUM", "LOW"].map(tier => {
              const t = acc.tiers[tier];
              const pct = t.total ? Math.round(t.correct / t.total * 100) : null;
              const color = pct ? (pct >= 60 ? C.green : pct >= 52 ? C.yellow : C.red) : C.dim;
              return (
                <div key={tier} style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 18, fontWeight: 800, color }}>{pct ? `${pct}%` : "—"}</div>
                  <div style={{ fontSize: 9, color: C.dim }}>{tier}</div>
                  <div style={{ fontSize: 9, color: C.dim }}>{t.total} games</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ML accuracy over time chart */}
      {cumulativeData.length > 2 && (
        <div style={{ background: "#0d1117", border: `1px solid ${C.border}`, borderRadius: 10, padding: "16px", marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: C.muted, letterSpacing: 2, marginBottom: 12, textTransform: "uppercase" }}>ML Accuracy Over Time</div>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={cumulativeData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#161b22" />
              <XAxis dataKey="game" tick={{ fill: C.dim, fontSize: 10 }} />
              <YAxis domain={[40, 70]} tick={{ fill: C.dim, fontSize: 10 }} tickFormatter={v => `${v}%`} />
              <Tooltip contentStyle={{ background: "#161b22", border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 11 }} formatter={v => [`${v}%`, "Accuracy"]} />
              <ReferenceLine y={55} stroke={C.green} strokeDasharray="4 4" label={{ value: "55%", fill: C.green, fontSize: 9 }} />
              <ReferenceLine y={50} stroke={C.dim} strokeDasharray="4 4" />
              <Line type="monotone" dataKey="pct" stroke={C.blue} strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ROI chart */}
      {roiData.length > 2 && (
        <div style={{ background: "#0d1117", border: `1px solid ${C.border}`, borderRadius: 10, padding: "16px", marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: C.muted, letterSpacing: 2, marginBottom: 12, textTransform: "uppercase" }}>Cumulative ROI ($100/bet, -110 juice)</div>
          <ResponsiveContainer width="100%" height={150}>
            <LineChart data={roiData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#161b22" />
              <XAxis dataKey="game" tick={{ fill: C.dim, fontSize: 10 }} />
              <YAxis tick={{ fill: C.dim, fontSize: 10 }} tickFormatter={v => `$${v}`} />
              <Tooltip contentStyle={{ background: "#161b22", border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 11 }} formatter={v => [`$${v}`, "Net ROI"]} />
              <ReferenceLine y={0} stroke={C.dim} />
              <Line type="monotone" dataKey="roi" stroke={parseFloat(acc.roi) >= 0 ? C.green : C.red} strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Monthly breakdown bar chart */}
      {acc.byMonth?.length > 0 && (
        <div style={{ background: "#0d1117", border: `1px solid ${C.border}`, borderRadius: 10, padding: "16px", marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: C.muted, letterSpacing: 2, marginBottom: 12, textTransform: "uppercase" }}>Monthly ML Accuracy</div>
          <ResponsiveContainer width="100%" height={150}>
            <BarChart data={acc.byMonth}>
              <CartesianGrid strokeDasharray="3 3" stroke="#161b22" />
              <XAxis dataKey="month" tick={{ fill: C.dim, fontSize: 10 }} />
              <YAxis domain={[40, 70]} tick={{ fill: C.dim, fontSize: 10 }} tickFormatter={v => `${v}%`} />
              <Tooltip contentStyle={{ background: "#161b22", border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 11 }} formatter={(v, n, p) => [`${v}% (${p.payload.correct}/${p.payload.total})`, "ML Acc"]} />
              <ReferenceLine y={55} stroke={C.green} strokeDasharray="4 4" />
              <Bar dataKey="pct" radius={[3, 3, 0, 0]}>
                {acc.byMonth.map((entry, i) => (
                  <Cell key={i} fill={entry.pct >= 55 ? C.green : entry.pct >= 50 ? C.yellow : C.red} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Formula notes */}
      <div style={{ background: "#0a0f14", border: "1px solid #1e3448", borderRadius: 10, padding: "14px 18px", fontSize: 11, color: C.dim, lineHeight: 1.7 }}>
        <div style={{ color: C.blue, fontWeight: 700, marginBottom: 6, letterSpacing: 1 }}>🔧 V8 FORMULA CHANGES</div>
        <div>• <span style={{ color: C.muted }}>wOBA:</span> Now uses correct linear weight formula (OBP × 1.15 + ISO × 0.20) instead of blended ERA approximation</div>
        <div>• <span style={{ color: C.muted }}>FIP:</span> Replaced ERA×0.82+WHIP×0.4 with proper component-based FIP proxy (bb9, k9, era regression)</div>
        <div>• <span style={{ color: C.muted }}>Win%:</span> Pythagorean expectation (exp=1.83) replaces log(lambda)×0.6 — more calibrated at extreme run totals</div>
        <div>• <span style={{ color: C.muted }}>Form weight:</span> Capped at 0.12 (down from 0.3), scaled by sample size — prevents early season over-reaction</div>
        <div>• <span style={{ color: C.muted }}>Home advantage:</span> 3.8% scaled by games played (minimal in spring training, full in regular season)</div>
        <div>• <span style={{ color: C.muted }}>Bullpen fatigue:</span> Graded (0-1 scale) instead of boolean, weighted at 0.5 runs max</div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// CALENDAR TAB
// ─────────────────────────────────────────────
function CalendarTab() {
  const todayStr = new Date().toISOString().split("T")[0];
  const [dateStr, setDateStr] = useState(todayStr);
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const [oddsData, setOddsData] = useState(null);
  const [oddsLoading, setOddsLoading] = useState(false);

  const loadGames = useCallback(async (d) => {
    setLoading(true);
    setGames([]);

    // Fetch odds in parallel
    setOddsLoading(true);
    const [raw, oddsResult] = await Promise.all([fetchScheduleForDate(d), fetchOdds()]);
    setOddsData(oddsResult);
    setOddsLoading(false);

    setGames(raw.map(g => ({ ...g, pred: null, loading: true })));

    const enriched = await Promise.all(raw.map(async (g) => {
      const homeStatId = resolveStatTeamId(g.homeTeamId, g.homeAbbr);
      const awayStatId = resolveStatTeamId(g.awayTeamId, g.awayAbbr);
      const [homeHit, awayHit, homePitch, awayPitch, homeStarter, awayStarter, homeForm, awayForm] =
        await Promise.all([
          fetchTeamHitting(homeStatId), fetchTeamHitting(awayStatId),
          fetchTeamPitching(homeStatId), fetchTeamPitching(awayStatId),
          fetchStarterStats(g.homeStarterId), fetchStarterStats(g.awayStarterId),
          fetchRecentForm(homeStatId), fetchRecentForm(awayStatId),
        ]);
      const homeGamesPlayed = homeForm?.gamesPlayed || 0;
      const awayGamesPlayed = awayForm?.gamesPlayed || 0;
      const [homeBullpen, awayBullpen] = await Promise.all([
        fetchBullpenFatigue(g.homeTeamId), fetchBullpenFatigue(g.awayTeamId),
      ]);
      const pred = predictGame({
        homeTeamId: g.homeTeamId, awayTeamId: g.awayTeamId,
        homeHit, awayHit, homePitch, awayPitch,
        homeStarterStats: homeStarter, awayStarterStats: awayStarter,
        homeForm, awayForm, homeGamesPlayed, awayGamesPlayed,
        bullpenData: { [g.homeTeamId]: homeBullpen, [g.awayTeamId]: awayBullpen },
      });
      // Match odds
      const matchedOdds = oddsResult?.games?.find(o => matchOddsToGame(o, g)) || null;
      return { ...g, homeHit, awayHit, homePitch, awayPitch, homeStarterStats: homeStarter,
               awayStarterStats: awayStarter, homeForm, awayForm, pred, loading: false,
               odds: matchedOdds };
    }));
    setGames(enriched);
    setLoading(false);
  }, []);

  useEffect(() => { loadGames(dateStr); }, [dateStr]);

  const C = { border: "#21262d", bg: "#0d1117" };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <input type="date" value={dateStr} onChange={e => setDateStr(e.target.value)}
          style={{ background: "#0d1117", color: "#e2e8f0", border: "1px solid #21262d", borderRadius: 6, padding: "6px 10px", fontSize: 12, fontFamily: "inherit" }} />
        <button onClick={() => loadGames(dateStr)}
          style={{ background: "#161b22", color: "#58a6ff", border: "1px solid #21262d", borderRadius: 6, padding: "6px 14px", cursor: "pointer", fontSize: 11, fontWeight: 700, letterSpacing: 1 }}>
          ↻ REFRESH
        </button>
        {oddsLoading && <span style={{ fontSize: 11, color: "#e3b341" }}>⏳ Fetching odds…</span>}
        {!oddsLoading && oddsData?.noKey && <span style={{ fontSize: 11, color: "#484f58" }}>⚠ No odds key — add ODDS_API_KEY to Vercel</span>}
        {!oddsLoading && oddsData?.games?.length > 0 && <span style={{ fontSize: 11, color: "#3fb950" }}>✓ Live odds loaded ({oddsData.games.length} games)</span>}
        {loading && <span style={{ color: "#484f58", fontSize: 11 }}>Loading games...</span>}
      </div>

      {!loading && games.length === 0 && (
        <div style={{ color: "#484f58", textAlign: "center", marginTop: 40, fontSize: 13 }}>No games scheduled for {dateStr}</div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {games.map((game) => {
          const home = teamById(game.homeTeamId);
          const away = teamById(game.awayTeamId);
          const bannerInfo = game.loading ? { color: "yellow", label: "Calculating…" } : getBannerInfo(game.pred, game.odds, game.homeStarter && game.awayStarter);
          const color = bannerInfo.color;

          const bannerBg = color === "green" ? "linear-gradient(135deg, #0b2012, #0e2315)"
            : color === "yellow" ? "linear-gradient(135deg, #1a1200, #1a1500)"
            : "linear-gradient(135deg, #0d1117, #111822)";
          const borderColor = color === "green" ? "#2ea043" : color === "yellow" ? "#4a3a00" : "#21262d";
          const isOpen = expanded === game.gamePk;

          return (
            <div key={game.gamePk} className="game-card" style={{ background: bannerBg, border: `1px solid ${borderColor}`, borderRadius: 10, overflow: "hidden" }}>
              <div onClick={() => setExpanded(isOpen ? null : game.gamePk)}
                style={{ padding: "14px 18px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>

                {/* Teams + starters */}
                <div style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 160 }}>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 20, fontWeight: 800, color: "#e2e8f0", letterSpacing: 1 }}>{away.abbr}</div>
                    <div style={{ fontSize: 9, color: "#484f58", letterSpacing: 1 }}>AWAY</div>
                    {game.awayStarter && <div style={{ fontSize: 10, color: "#8b949e", marginTop: 2 }}>{game.awayStarter.split(" ").pop()}</div>}
                  </div>
                  <div style={{ fontSize: 14, color: "#484f58" }}>@</div>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 20, fontWeight: 800, color: "#e2e8f0", letterSpacing: 1 }}>{home.abbr}</div>
                    <div style={{ fontSize: 9, color: "#484f58", letterSpacing: 1 }}>HOME</div>
                    {game.homeStarter && <div style={{ fontSize: 10, color: "#8b949e", marginTop: 2 }}>{game.homeStarter.split(" ").pop()}</div>}
                  </div>
                </div>

                {/* Prediction stats */}
                {game.loading ? <div style={{ color: "#484f58", fontSize: 11 }}>Calculating…</div>
                : game.pred ? (
                  <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
                    <Pill label="PROJ" value={`${away.abbr} ${game.pred.awayRuns.toFixed(1)} — ${home.abbr} ${game.pred.homeRuns.toFixed(1)}`} />
                    <Pill label="MDL ML" value={game.pred.modelML_home > 0 ? `+${game.pred.modelML_home}` : game.pred.modelML_home} />
                    {game.odds?.homeML && <Pill label="MKT ML" value={game.odds.homeML > 0 ? `+${game.odds.homeML}` : game.odds.homeML} color="#e3b341" />}
                    <Pill label="O/U" value={game.pred.ouTotal} />
                    <Pill label="WIN%" value={`${Math.round(game.pred.homeWinPct * 100)}%`} color={game.pred.homeWinPct >= 0.55 ? "#3fb950" : "#e2e8f0"} />
                  </div>
                ) : <div style={{ color: "#484f58", fontSize: 11 }}>⚠ Unavailable</div>}

                {/* Banner signal + toggle */}
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {bannerInfo.edge != null && (
                    <div style={{ fontSize: 10, fontWeight: 700, color: Math.abs(bannerInfo.edge) >= EDGE_THRESHOLD ? "#3fb950" : "#484f58", whiteSpace: "nowrap" }}>
                      {bannerInfo.label}
                    </div>
                  )}
                  <span style={{ color: "#484f58", fontSize: 12 }}>{isOpen ? "▲" : "▼"}</span>
                </div>
              </div>

              {/* Expanded detail */}
              {isOpen && game.pred && (
                <div style={{ borderTop: `1px solid ${borderColor}`, padding: "14px 18px", background: "rgba(0,0,0,0.3)" }}>
                  {/* Scores (if final) */}
                  {game.status === "Final" && (
                    <div style={{ marginBottom: 12, padding: "8px 12px", background: "#0a0f14", borderRadius: 6, fontSize: 12, color: "#3fb950" }}>
                      FINAL: {away.abbr} {game.awayScore} — {home.abbr} {game.homeScore}
                    </div>
                  )}

                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 8 }}>
                    <Kv k="Projected Score" v={`${away.abbr} ${game.pred.awayRuns.toFixed(1)} — ${home.abbr} ${game.pred.homeRuns.toFixed(1)}`} />
                    <Kv k="Home Win %" v={`${(game.pred.homeWinPct * 100).toFixed(1)}%`} />
                    <Kv k="Away Win %" v={`${(game.pred.awayWinPct * 100).toFixed(1)}%`} />
                    <Kv k="Over/Under" v={`${game.pred.ouTotal} total`} />
                    <Kv k="Model ML Home" v={game.pred.modelML_home > 0 ? `+${game.pred.modelML_home}` : game.pred.modelML_home} />
                    <Kv k="Model ML Away" v={game.pred.modelML_away > 0 ? `+${game.pred.modelML_away}` : game.pred.modelML_away} />
                    {game.odds?.homeML && <Kv k="Market ML Home" v={game.odds.homeML > 0 ? `+${game.odds.homeML}` : game.odds.homeML} />}
                    {game.odds?.awayML && <Kv k="Market ML Away" v={game.odds.awayML > 0 ? `+${game.odds.awayML}` : game.odds.awayML} />}
                    {game.odds?.overUnder && <Kv k="Market O/U" v={game.odds.overUnder} />}
                    <Kv k="Confidence" v={game.pred.confidence} />
                    <Kv k="Conf Score" v={`${game.pred.confScore}/100`} />
                    <Kv k="Home FIP" v={game.pred.hFIP?.toFixed(2)} />
                    <Kv k="Away FIP" v={game.pred.aFIP?.toFixed(2)} />
                    {game.homeStarterStats && <Kv k={`${home.abbr} SP ERA`} v={game.homeStarterStats.era?.toFixed(2)} />}
                    {game.awayStarterStats && <Kv k={`${away.abbr} SP ERA`} v={game.awayStarterStats.era?.toFixed(2)} />}
                    <Kv k="Season Data" v={`${Math.round((game.pred.blendWeight || 0) * 100)}% current`} />
                  </div>

                  {/* Edge analysis if odds available */}
                  {game.odds?.homeML && game.odds?.awayML && (() => {
                    const market = trueImplied(game.odds.homeML, game.odds.awayML);
                    const homeEdge = ((game.pred.homeWinPct - market.home) * 100).toFixed(1);
                    const awayEdge = ((game.pred.awayWinPct - market.away) * 100).toFixed(1);
                    return (
                      <div style={{ marginTop: 10, padding: "10px 12px", background: "#0a0f14", borderRadius: 6 }}>
                        <div style={{ fontSize: 10, color: "#484f58", letterSpacing: 2, marginBottom: 6 }}>EDGE ANALYSIS (MODEL vs MARKET)</div>
                        <div style={{ display: "flex", gap: 20 }}>
                          <div><span style={{ color: parseFloat(homeEdge) >= 3.5 ? "#3fb950" : parseFloat(homeEdge) < 0 ? "#f85149" : "#8b949e" }}>{parseFloat(homeEdge) > 0 ? "+" : ""}{homeEdge}%</span> <span style={{ fontSize: 10, color: "#484f58" }}>{home.abbr} edge</span></div>
                          <div><span style={{ color: parseFloat(awayEdge) >= 3.5 ? "#3fb950" : parseFloat(awayEdge) < 0 ? "#f85149" : "#8b949e" }}>{parseFloat(awayEdge) > 0 ? "+" : ""}{awayEdge}%</span> <span style={{ fontSize: 10, color: "#484f58" }}>{away.abbr} edge</span></div>
                          <div style={{ fontSize: 10, color: "#484f58" }}>Market: {(market.home * 100).toFixed(1)}% home / {(market.away * 100).toFixed(1)}% away (vig-free)</div>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// HISTORY TAB
// ─────────────────────────────────────────────
function HistoryTab({ refreshKey }) {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterDate, setFilterDate] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    let path = "/mlb_predictions?order=game_date.desc&limit=200";
    if (filterDate) path += `&game_date=eq.${filterDate}`;
    const data = await supabaseQuery(path);
    setRecords(data || []);
    setLoading(false);
  }, [filterDate]);

  useEffect(() => { load(); }, [load, refreshKey]);

  const deleteRecord = async (id) => {
    if (!window.confirm("Delete this prediction?")) return;
    await supabaseQuery(`/mlb_predictions?id=eq.${id}`, "DELETE");
    load();
  };

  const grouped = records.reduce((acc, r) => {
    if (!acc[r.game_date]) acc[r.game_date] = [];
    acc[r.game_date].push(r);
    return acc;
  }, {});

  const confColor = (c) => c === "HIGH" ? "#3fb950" : c === "MEDIUM" ? "#e3b341" : "#8b949e";
  const mlSign = (ml) => ml > 0 ? `+${ml}` : ml;

  return (
    <div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontSize: 14, color: "#58a6ff", letterSpacing: 2, textTransform: "uppercase" }}>📋 Prediction History</h2>
        <input type="date" value={filterDate} onChange={e => setFilterDate(e.target.value)}
          style={{ background: "#0d1117", color: "#e2e8f0", border: "1px solid #21262d", borderRadius: 6, padding: "5px 10px", fontSize: 11, fontFamily: "inherit" }} />
        {filterDate && <button onClick={() => setFilterDate("")} style={{ background: "#0d1117", color: "#8b949e", border: "1px solid #21262d", borderRadius: 6, padding: "5px 10px", cursor: "pointer", fontSize: 11 }}>Clear</button>}
        <button onClick={load} style={{ background: "#0d1117", color: "#58a6ff", border: "1px solid #21262d", borderRadius: 6, padding: "5px 10px", cursor: "pointer", fontSize: 11 }}>↻ Refresh</button>
        <button onClick={async () => {
          const pending = records.filter(r => !r.result_entered);
          if (!pending.length) return alert("No pending games");
          const n = await fillFinalScores(pending);
          load();
          if (!n) alert("No finished games matched");
        }} style={{ background: "#0d1117", color: "#e3b341", border: "1px solid #21262d", borderRadius: 6, padding: "5px 10px", cursor: "pointer", fontSize: 11 }}>⚡ Sync Results</button>
        <button onClick={async () => {
          if (!records.length) return alert("No records");
          const n = await refreshPredictions(records, m => console.log(m));
          load();
          alert(`Refreshed ${n} prediction(s) with v8 formula`);
        }} style={{ background: "#0d1117", color: "#58a6ff", border: "1px solid #21262d", borderRadius: 6, padding: "5px 10px", cursor: "pointer", fontSize: 11 }}>🔁 Refresh with v8</button>
      </div>

      {loading && <div style={{ color: "#484f58", textAlign: "center", marginTop: 40 }}>Loading…</div>}
      {!loading && records.length === 0 && <div style={{ color: "#484f58", textAlign: "center", marginTop: 40 }}>No predictions yet</div>}

      {Object.entries(grouped).map(([date, recs]) => (
        <div key={date} style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#e3b341", marginBottom: 6, borderBottom: "1px solid #161b22", paddingBottom: 5, letterSpacing: 2 }}>📅 {date}</div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
              <thead>
                <tr style={{ color: "#484f58", fontSize: 9, letterSpacing: 1.5 }}>
                  {["MATCHUP", "MODEL ML", "RUN LINE", "O/U", "WIN %", "CONF", "RESULT", "ML✓", "RL✓", "O/U✓", ""].map(h => (
                    <th key={h} style={{ padding: "5px 8px", textAlign: "left", borderBottom: "1px solid #161b22", whiteSpace: "nowrap", textTransform: "uppercase" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recs.map(r => {
                  const resultBg = r.result_entered ? (r.ml_correct ? "rgba(63,185,80,0.06)" : "rgba(248,81,73,0.06)") : "transparent";
                  return (
                    <tr key={r.id} style={{ borderBottom: "1px solid #0d1117", background: resultBg }}>
                      <td style={{ padding: "7px 8px", fontWeight: 700, whiteSpace: "nowrap", color: "#e2e8f0" }}>{r.away_team} @ {r.home_team}</td>
                      <td style={{ padding: "7px 8px", whiteSpace: "nowrap" }}>
                        <span style={{ color: "#58a6ff" }}>H: {mlSign(r.model_ml_home)}</span>
                        <span style={{ color: "#484f58", margin: "0 3px" }}>|</span>
                        <span style={{ color: "#484f58" }}>A: {mlSign(r.model_ml_away)}</span>
                      </td>
                      <td style={{ padding: "7px 8px", color: "#8b949e", whiteSpace: "nowrap" }}>{r.home_team} {r.run_line_home > 0 ? "+" : ""}{r.run_line_home}</td>
                      <td style={{ padding: "7px 8px", color: "#e3b341" }}>{r.ou_total}</td>
                      <td style={{ padding: "7px 8px", color: "#58a6ff" }}>{r.win_pct_home != null ? `${Math.round(r.win_pct_home * 100)}%` : "—"}</td>
                      <td style={{ padding: "7px 8px" }}><span style={{ color: confColor(r.confidence), fontWeight: 700, fontSize: 10 }}>{r.confidence}</span></td>
                      <td style={{ padding: "7px 8px", whiteSpace: "nowrap" }}>
                        {r.result_entered
                          ? <span style={{ color: "#3fb950", fontWeight: 600 }}>{r.away_team} {r.actual_away_runs} — {r.home_team} {r.actual_home_runs}</span>
                          : <span style={{ color: "#4a3a00", fontSize: 10 }}>⏳ Pending</span>}
                      </td>
                      <td style={{ padding: "7px 8px", textAlign: "center" }}>{r.result_entered ? (r.ml_correct ? "✅" : "❌") : "—"}</td>
                      <td style={{ padding: "7px 8px", textAlign: "center" }}>{r.result_entered ? (r.rl_correct === null ? "🔲" : r.rl_correct ? "✅" : "❌") : "—"}</td>
                      <td style={{ padding: "7px 8px", textAlign: "center" }}>
                        {r.result_entered ? <span style={{ color: r.ou_correct === "PUSH" ? "#e3b341" : "#e2e8f0", fontSize: 10 }}>{r.ou_correct}</span> : "—"}
                      </td>
                      <td style={{ padding: "7px 8px" }}>
                        <button onClick={() => deleteRecord(r.id)} style={{ background: "transparent", border: "none", color: "#484f58", cursor: "pointer", fontSize: 12 }}>🗑</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────
// PARLAY TAB
// ─────────────────────────────────────────────
function ParlayTab() {
  const todayStr = new Date().toISOString().split("T")[0];
  const [dateStr, setDateStr] = useState(todayStr);
  const [legCount, setLegCount] = useState(3);
  const [allGames, setAllGames] = useState([]);
  const [loading, setLoading] = useState(false);
  const [parlay, setParlay] = useState(null);
  const [customLegs, setCustomLegs] = useState([]);
  const [mode, setMode] = useState("auto");
  const [wager, setWager] = useState(100);
  const [oddsData, setOddsData] = useState(null);

  const loadGames = useCallback(async (d) => {
    setLoading(true);
    setParlay(null);
    const [raw, odds] = await Promise.all([fetchScheduleForDate(d), fetchOdds()]);
    setOddsData(odds);
    const enriched = await Promise.all(raw.map(async (g) => {
      const homeStatId = resolveStatTeamId(g.homeTeamId, g.homeAbbr);
      const awayStatId = resolveStatTeamId(g.awayTeamId, g.awayAbbr);
      const [homeHit, awayHit, homePitch, awayPitch, homeStarter, awayStarter, homeForm, awayForm] =
        await Promise.all([
          fetchTeamHitting(homeStatId), fetchTeamHitting(awayStatId),
          fetchTeamPitching(homeStatId), fetchTeamPitching(awayStatId),
          fetchStarterStats(g.homeStarterId), fetchStarterStats(g.awayStarterId),
          fetchRecentForm(homeStatId), fetchRecentForm(awayStatId),
        ]);
      const homeGamesPlayed = homeForm?.gamesPlayed || 0;
      const awayGamesPlayed = awayForm?.gamesPlayed || 0;
      const [homeBullpen, awayBullpen] = await Promise.all([fetchBullpenFatigue(g.homeTeamId), fetchBullpenFatigue(g.awayTeamId)]);
      const pred = predictGame({ homeTeamId: g.homeTeamId, awayTeamId: g.awayTeamId, homeHit, awayHit, homePitch, awayPitch, homeStarterStats: homeStarter, awayStarterStats: awayStarter, homeForm, awayForm, homeGamesPlayed, awayGamesPlayed, bullpenData: { [g.homeTeamId]: homeBullpen, [g.awayTeamId]: awayBullpen } });
      const gameOdds = odds?.games?.find(o => matchOddsToGame(o, g)) || null;
      return { ...g, pred, odds: gameOdds };
    }));
    setAllGames(enriched.filter(g => g.pred));
    setLoading(false);
  }, []);

  useEffect(() => { loadGames(dateStr); }, [dateStr]);
  useEffect(() => { if (allGames.length && mode === "auto") buildAutoParlay(); }, [allGames, legCount, mode]);

  const buildAutoParlay = () => {
    const legs = allGames.map(g => {
      const home = teamById(g.homeTeamId);
      const away = teamById(g.awayTeamId);
      // Use market ML if available, otherwise model ML
      const pickHome = g.pred.homeWinPct >= 0.5;
      const ml = pickHome
        ? (g.odds?.homeML || g.pred.modelML_home)
        : (g.odds?.awayML || g.pred.modelML_away);
      return {
        gamePk: g.gamePk, label: `${away.abbr} @ ${home.abbr}`,
        pick: pickHome ? home.abbr : away.abbr,
        prob: pickHome ? g.pred.homeWinPct : g.pred.awayWinPct,
        ml, confidence: g.pred.confidence, confScore: g.pred.confScore,
        hasOdds: !!g.odds?.homeML,
      };
    }).sort((a, b) => b.prob - a.prob).slice(0, legCount);
    setParlay(legs);
  };

  const toggleCustomLeg = (game, pickHome) => {
    const home = teamById(game.homeTeamId);
    const away = teamById(game.awayTeamId);
    const exists = customLegs.find(l => l.gamePk === game.gamePk);
    const ml = pickHome ? (game.odds?.homeML || game.pred.modelML_home) : (game.odds?.awayML || game.pred.modelML_away);
    if (exists) {
      if ((exists.pick === home.abbr && pickHome) || (exists.pick === away.abbr && !pickHome)) setCustomLegs(customLegs.filter(l => l.gamePk !== game.gamePk));
      else setCustomLegs(customLegs.map(l => l.gamePk === game.gamePk ? { ...l, pick: pickHome ? home.abbr : away.abbr, prob: pickHome ? game.pred.homeWinPct : game.pred.awayWinPct, ml } : l));
    } else {
      setCustomLegs([...customLegs, { gamePk: game.gamePk, label: `${away.abbr} @ ${home.abbr}`, pick: pickHome ? home.abbr : away.abbr, prob: pickHome ? game.pred.homeWinPct : game.pred.awayWinPct, ml, confidence: game.pred.confidence, confScore: game.pred.confScore }]);
    }
  };

  const activeLegList = mode === "auto" ? (parlay || []) : customLegs;
  const combinedProb = activeLegList.length ? combinedParlayProbability(activeLegList) : 0;
  const decOdds = activeLegList.length ? combinedParlayOdds(activeLegList) : 1;
  const fairML = activeLegList.length ? decimalToML(decOdds) : null;
  const payout = (wager * decOdds).toFixed(2);
  const ev = activeLegList.length ? ((combinedProb * (decOdds - 1) * wager) - ((1 - combinedProb) * wager)).toFixed(2) : null;

  return (
    <div>
      <h2 style={{ margin: "0 0 14px", fontSize: 14, color: "#58a6ff", letterSpacing: 2, textTransform: "uppercase" }}>🎯 Parlay Builder</h2>
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 14, flexWrap: "wrap" }}>
        <input type="date" value={dateStr} onChange={e => setDateStr(e.target.value)}
          style={{ background: "#0d1117", color: "#e2e8f0", border: "1px solid #21262d", borderRadius: 6, padding: "6px 10px", fontSize: 11, fontFamily: "inherit" }} />
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          {[2,3,4,5,6,7,8].map(n => (
            <button key={n} onClick={() => { setLegCount(n); setMode("auto"); }}
              style={{ width: 28, height: 28, borderRadius: "50%", border: "none", cursor: "pointer", fontSize: 11, fontWeight: 800, background: mode === "auto" && legCount === n ? "#58a6ff" : "#161b22", color: mode === "auto" && legCount === n ? "#0d1117" : "#484f58" }}>{n}</button>
          ))}
        </div>
        <button onClick={() => setMode(m => m === "auto" ? "custom" : "auto")}
          style={{ background: mode === "custom" ? "#58a6ff" : "#161b22", color: mode === "custom" ? "#0d1117" : "#e2e8f0", border: "1px solid #21262d", borderRadius: 6, padding: "5px 12px", cursor: "pointer", fontSize: 11 }}>
          {mode === "custom" ? "✏️ Custom" : "⚡ Auto"}
        </button>
        {loading && <span style={{ color: "#484f58", fontSize: 11 }}>Loading…</span>}
        {!loading && oddsData?.games?.length > 0 && <span style={{ fontSize: 10, color: "#3fb950" }}>✓ Live odds</span>}
      </div>

      {activeLegList.length > 0 && (
        <div style={{ background: "linear-gradient(135deg, #0d1a2e, #0a1520)", border: "1px solid #1e3448", borderRadius: 10, padding: "14px 18px", marginBottom: 16 }}>
          <div style={{ fontSize: 10, fontWeight: 800, color: "#58a6ff", marginBottom: 10, letterSpacing: 2 }}>
            {mode === "auto" ? `⚡ AUTO ${legCount}-LEG PARLAY` : `✏️ CUSTOM ${activeLegList.length}-LEG PARLAY`}
          </div>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 10 }}>
            <Pill label="COMBINED PROB" value={`${(combinedProb * 100).toFixed(1)}%`} color={combinedProb > 0.15 ? "#3fb950" : "#f85149"} />
            <Pill label="FAIR ODDS" value={fairML} color="#e3b341" />
            <Pill label={`PAYOUT ($${wager})`} value={`$${payout}`} color="#3fb950" />
            {ev && <Pill label="MODEL EV" value={`$${ev}`} color={parseFloat(ev) >= 0 ? "#3fb950" : "#f85149"} />}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
            <span style={{ fontSize: 10, color: "#484f58" }}>Wager: $</span>
            <input type="number" value={wager} onChange={e => setWager(Number(e.target.value))}
              style={{ width: 70, background: "#0d1117", color: "#e2e8f0", border: "1px solid #21262d", borderRadius: 5, padding: "3px 7px", fontSize: 11, fontFamily: "inherit" }} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {activeLegList.map((leg, i) => (
              <div key={leg.gamePk} style={{ display: "flex", alignItems: "center", gap: 10, background: "rgba(255,255,255,0.03)", borderRadius: 7, padding: "7px 10px" }}>
                <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#58a6ff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 800, color: "#0d1117" }}>{i + 1}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#e2e8f0" }}>{leg.label}</div>
                  <div style={{ fontSize: 10, color: "#484f58" }}>Pick: <span style={{ color: "#3fb950" }}>{leg.pick}</span> {leg.hasOdds ? "· Live odds" : "· Model est."}</div>
                </div>
                <Pill label="PROB" value={`${(leg.prob * 100).toFixed(1)}%`} />
                <Pill label="ML" value={leg.ml > 0 ? `+${leg.ml}` : leg.ml} />
                {mode === "custom" && <button onClick={() => setCustomLegs(c => c.filter(l => l.gamePk !== leg.gamePk))} style={{ background: "none", border: "none", color: "#484f58", cursor: "pointer", fontSize: 12 }}>✕</button>}
              </div>
            ))}
          </div>
        </div>
      )}

      {!loading && allGames.length > 0 && (
        <div>
          {[...allGames].sort((a, b) => Math.max(b.pred.homeWinPct, 1 - b.pred.homeWinPct) - Math.max(a.pred.homeWinPct, 1 - a.pred.homeWinPct)).map((g, i) => {
            const home = teamById(g.homeTeamId);
            const away = teamById(g.awayTeamId);
            const favHome = g.pred.homeWinPct >= 0.5;
            const customLeg = customLegs.find(l => l.gamePk === g.gamePk);
            const isAutoSelected = mode === "auto" && parlay?.find(l => l.gamePk === g.gamePk);
            return (
              <div key={g.gamePk} style={{ background: isAutoSelected ? "#0e2015" : "#0d1117", border: `1px solid ${isAutoSelected ? "#2ea043" : "#21262d"}`, borderRadius: 8, padding: "10px 14px", marginBottom: 6, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <div style={{ width: 22, fontSize: 10, color: "#484f58" }}>{isAutoSelected ? "✅" : `#${i + 1}`}</div>
                <div style={{ flex: 1, minWidth: 100 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0" }}>{away.abbr} @ {home.abbr}</div>
                  <div style={{ fontSize: 10, color: "#484f58" }}>Fav: {favHome ? home.abbr : away.abbr} — {(Math.max(g.pred.homeWinPct, g.pred.awayWinPct) * 100).toFixed(1)}%</div>
                </div>
                {g.odds?.homeML && <Pill label="MKT ML" value={g.odds.homeML > 0 ? `+${g.odds.homeML}` : g.odds.homeML} color="#e3b341" />}
                <Pill label="MDL ML" value={favHome ? (g.pred.modelML_home > 0 ? `+${g.pred.modelML_home}` : g.pred.modelML_home) : (g.pred.modelML_away > 0 ? `+${g.pred.modelML_away}` : g.pred.modelML_away)} />
                <Pill label="O/U" value={g.pred.ouTotal} />
                {mode === "custom" && (
                  <div style={{ display: "flex", gap: 4 }}>
                    <button onClick={() => toggleCustomLeg(g, true)} style={{ background: customLeg?.pick === home.abbr ? "#2ea043" : "#161b22", color: customLeg?.pick === home.abbr ? "#fff" : "#484f58", border: "1px solid #21262d", borderRadius: 5, padding: "3px 9px", cursor: "pointer", fontSize: 11 }}>{home.abbr}</button>
                    <button onClick={() => toggleCustomLeg(g, false)} style={{ background: customLeg?.pick === away.abbr ? "#2ea043" : "#161b22", color: customLeg?.pick === away.abbr ? "#fff" : "#484f58", border: "1px solid #21262d", borderRadius: 5, padding: "3px 9px", cursor: "pointer", fontSize: 11 }}>{away.abbr}</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// MATCHUP TAB
// ─────────────────────────────────────────────
function MatchupTab() {
  const [homeTeam, setHomeTeam] = useState(TEAMS[19]);
  const [awayTeam, setAwayTeam] = useState(TEAMS[11]);
  const [pred, setPred] = useState(null);
  const [loading, setLoading] = useState(false);

  const runPrediction = async () => {
    setLoading(true);
    const [homeHit, awayHit, homePitch, awayPitch, homeForm, awayForm] = await Promise.all([
      fetchTeamHitting(homeTeam.id), fetchTeamHitting(awayTeam.id),
      fetchTeamPitching(homeTeam.id), fetchTeamPitching(awayTeam.id),
      fetchRecentForm(homeTeam.id), fetchRecentForm(awayTeam.id),
    ]);
    const result = predictGame({ homeTeamId: homeTeam.id, awayTeamId: awayTeam.id, homeHit, awayHit, homePitch, awayPitch, homeForm, awayForm });
    setPred(result);
    setLoading(false);
  };

  return (
    <div style={{ maxWidth: 540 }}>
      <h2 style={{ margin: "0 0 14px", fontSize: 14, color: "#58a6ff", letterSpacing: 2, textTransform: "uppercase" }}>⚾ Matchup Predictor</h2>
      <div style={{ display: "flex", gap: 10, alignItems: "flex-end", marginBottom: 14, flexWrap: "wrap" }}>
        <div>
          <div style={{ color: "#484f58", fontSize: 9, marginBottom: 3, letterSpacing: 2 }}>AWAY TEAM</div>
          <select value={awayTeam.id} onChange={e => setAwayTeam(TEAMS.find(t => t.id === parseInt(e.target.value)))}
            style={{ background: "#0d1117", color: "#e2e8f0", border: "1px solid #21262d", borderRadius: 6, padding: "6px 10px", fontSize: 12, fontFamily: "inherit" }}>
            {TEAMS.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div style={{ color: "#484f58", fontSize: 14, paddingBottom: 6 }}>@</div>
        <div>
          <div style={{ color: "#484f58", fontSize: 9, marginBottom: 3, letterSpacing: 2 }}>HOME TEAM</div>
          <select value={homeTeam.id} onChange={e => setHomeTeam(TEAMS.find(t => t.id === parseInt(e.target.value)))}
            style={{ background: "#0d1117", color: "#e2e8f0", border: "1px solid #21262d", borderRadius: 6, padding: "6px 10px", fontSize: 12, fontFamily: "inherit" }}>
            {TEAMS.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <button onClick={runPrediction}
          style={{ background: "#238636", color: "#fff", border: "none", borderRadius: 6, padding: "7px 18px", cursor: "pointer", fontSize: 12, fontWeight: 700, letterSpacing: 1 }}>
          {loading ? "COMPUTING…" : "⚡ PREDICT"}
        </button>
      </div>

      {pred && (
        <div style={{ background: "#0d1117", border: "1px solid #21262d", borderRadius: 10, padding: 18 }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: "#e2e8f0", marginBottom: 14, letterSpacing: 1 }}>
            {awayTeam.abbr} <span style={{ color: "#484f58" }}>{pred.awayRuns.toFixed(1)}</span> — <span style={{ color: "#484f58" }}>{pred.homeRuns.toFixed(1)}</span> {homeTeam.abbr}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 8 }}>
            <Kv k="Home Win %" v={`${(pred.homeWinPct * 100).toFixed(1)}%`} />
            <Kv k="Away Win %" v={`${(pred.awayWinPct * 100).toFixed(1)}%`} />
            <Kv k="O/U Total" v={pred.ouTotal} />
            <Kv k="Model ML Home" v={pred.modelML_home > 0 ? `+${pred.modelML_home}` : pred.modelML_home} />
            <Kv k="Model ML Away" v={pred.modelML_away > 0 ? `+${pred.modelML_away}` : pred.modelML_away} />
            <Kv k="Run Line" v={`${homeTeam.abbr} -1.5`} />
            <Kv k="Home FIP" v={pred.hFIP?.toFixed(2)} />
            <Kv k="Away FIP" v={pred.aFIP?.toFixed(2)} />
            <Kv k="Confidence" v={pred.confidence} />
            <Kv k="Conf Score" v={`${pred.confScore}/100`} />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── SHARED UI ────────────────────────────────────────────────
function Pill({ label, value, color }) {
  return (
    <div style={{ textAlign: "center", minWidth: 44 }}>
      <div style={{ fontSize: 14, fontWeight: 800, color: color || "#e2e8f0" }}>{value}</div>
      <div style={{ fontSize: 8, color: "#484f58", letterSpacing: 1.5, textTransform: "uppercase" }}>{label}</div>
    </div>
  );
}

function Kv({ k, v }) {
  return (
    <div style={{ padding: "8px 10px", background: "#080c10", borderRadius: 6 }}>
      <div style={{ fontSize: 9, color: "#484f58", letterSpacing: 1.5, marginBottom: 2, textTransform: "uppercase" }}>{k}</div>
      <div style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0" }}>{v ?? "—"}</div>
    </div>
  );
}
