import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, LineChart, Line, ReferenceLine,
  ScatterChart, Scatter, Cell
} from "recharts";

// ============================================================
// MULTI-SPORT PREDICTOR v12
// ⚾ MLB  +  🏀 NCAA Basketball  +  🏀 NBA  +  🏈 NFL
// ============================================================

const SUPABASE_URL = "https://lxaaqtqvlwjvyuedyauo.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx4YWFxdHF2bHdqdnl1ZWR5YXVvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE4MDYzNTUsImV4cCI6MjA4NzM4MjM1NX0.UItPw2j2oo5F2_zJZmf43gmZnNHVQ5FViQgbd4QEii0";

async function supabaseQuery(path, method = "GET", body = null, onConflict = null) {
  try {
    const isUpsert = method === "UPSERT";
    const sep = path.includes("?") ? "&" : "?";
    const url = (isUpsert && onConflict)
      ? `${SUPABASE_URL}/rest/v1${path}${sep}on_conflict=${onConflict}`
      : `${SUPABASE_URL}/rest/v1${path}`;
    const opts = {
      method: isUpsert ? "POST" : method,
      headers: {
        "Content-Type": "application/json",
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
        "Prefer": isUpsert ? "resolution=merge-duplicates,return=representation"
          : method === "POST" ? "return=representation" : "",
      },
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(url, opts);
    if (!res.ok) { console.error("Supabase error:", await res.text()); return null; }
    const text = await res.text();
    return text ? JSON.parse(text) : [];
  } catch (e) { console.error("Supabase:", e); return null; }
}

const SEASON = new Date().getFullYear();
const _now = new Date();
const STAT_SEASON = (_now.getMonth() < 3) ? SEASON - 1 : SEASON;
const FULL_SEASON_THRESHOLD = 100;
const MLB_SEASON_START = `${SEASON}-02-01`;
const MLB_REG_SEASON_START = `${SEASON}-03-27`;

function getMLBGameType(dateStr) {
  if (!dateStr) return "R";
  return dateStr < MLB_REG_SEASON_START ? "S" : "R";
}

function mlToImplied(ml) {
  if (!ml) return 0.5;
  return ml > 0 ? 100 / (ml + 100) : Math.abs(ml) / (Math.abs(ml) + 100);
}
function trueImplied(homeML, awayML) {
  const rawHome = mlToImplied(homeML), rawAway = mlToImplied(awayML);
  const total = rawHome + rawAway;
  return { home: rawHome / total, away: rawAway / total };
}
function mlToDecimal(ml) { return ml >= 100 ? ml / 100 + 1 : 100 / Math.abs(ml) + 1; }
function decimalToML(dec) { return dec >= 2 ? `+${Math.round((dec - 1) * 100)}` : `-${Math.round(100 / (dec - 1))}`; }
function combinedParlayOdds(legs) { return legs.reduce((acc, l) => acc * mlToDecimal(l.ml), 1); }
function combinedParlayProb(legs) { return legs.reduce((acc, l) => acc * l.prob, 1); }
const EDGE_THRESHOLD = 0.035;
const OU_EDGE_THRESHOLD = 0.04; // model total must differ from market by 4%+ of total
const CONF_BET_THRESHOLD = "HIGH";

// Returns individual bet signals for ML, O/U, spread, and confidence
// Used to green-highlight banner pills and populate the BET SIGNALS panel
function getBetSignals({ pred, odds, sport = "ncaa" }) {
  if (!pred) return { ml: null, ou: null, spread: null, conf: null, anyEdge: false };

  const homeWin = pred.homeWinPct;
  const awayWin = 1 - homeWin;

  // ── ML SIGNAL ──────────────────────────────────────────────
  // Edge = model win% minus market implied win% (vig-removed)
  let mlSignal = null;
  if (odds?.homeML && odds?.awayML) {
    const market = trueImplied(odds.homeML, odds.awayML);
    const homeEdge = homeWin - market.home;
    const awayEdge = awayWin - market.away;
    const bestEdge = Math.abs(homeEdge) >= Math.abs(awayEdge) ? homeEdge : -awayEdge;
    const side = homeEdge >= 0 ? "HOME" : "AWAY";
    const edgePct = Math.abs(bestEdge) * 100;
    if (Math.abs(bestEdge) >= EDGE_THRESHOLD) {
      mlSignal = {
        verdict: edgePct >= 7 ? "GO" : "LEAN",
        side, edgePct: edgePct.toFixed(1),
        ml: homeEdge >= 0 ? (odds.homeML > 0 ? `+${odds.homeML}` : odds.homeML) : (odds.awayML > 0 ? `+${odds.awayML}` : odds.awayML),
        reason: `Model gives ${side === "HOME" ? "home" : "away"} ${edgePct.toFixed(1)}% more chance than market`,
      };
    } else {
      mlSignal = { verdict: "SKIP", edgePct: edgePct.toFixed(1), reason: `Only ${edgePct.toFixed(1)}% edge — below ${(EDGE_THRESHOLD * 100).toFixed(1)}% threshold` };
    }
  } else {
    // No market odds — use model confidence as proxy
    const winPct = Math.max(homeWin, awayWin);
    if (winPct >= 0.65) {
      mlSignal = { verdict: "LEAN", side: homeWin >= 0.65 ? "HOME" : "AWAY", edgePct: ((winPct - 0.5) * 100).toFixed(1), reason: `Strong model win probability (${(winPct * 100).toFixed(1)}%) — no market to compare` };
    } else {
      mlSignal = { verdict: "SKIP", reason: "No market odds and model win% < 65%" };
    }
  }

  // ── O/U SIGNAL ─────────────────────────────────────────────
  // Compare model projected total vs market O/U line
  let ouSignal = null;
  const projTotal = sport === "mlb" ? (pred.homeRuns + pred.awayRuns) : (pred.homeScore + pred.awayScore);
  const mktTotal = odds?.ouLine ?? odds?.marketTotal ?? null;
  if (mktTotal) {
    const diff = projTotal - mktTotal;
    const diffPct = Math.abs(diff) / mktTotal;
    if (diffPct >= OU_EDGE_THRESHOLD) {
      ouSignal = {
        verdict: diffPct >= 0.08 ? "GO" : "LEAN",
        side: diff > 0 ? "OVER" : "UNDER",
        diff: Math.abs(diff).toFixed(1),
        reason: `Model projects ${projTotal.toFixed(1)} vs market ${mktTotal} — ${Math.abs(diff).toFixed(1)} pt gap`,
      };
    } else {
      ouSignal = { verdict: "SKIP", reason: `Model total (${projTotal.toFixed(1)}) within ${(OU_EDGE_THRESHOLD * 100).toFixed(0)}% of market (${mktTotal})` };
    }
  } else {
    ouSignal = { verdict: "NO LINE", reason: "No market O/U line available" };
  }

  // ── SPREAD SIGNAL ──────────────────────────────────────────
  // Compare model spread vs market spread
  let spreadSignal = null;
  const projSpread = sport === "mlb" ? pred.runLineHome : pred.projectedSpread;
  const mktSpread = odds?.homeSpread ?? odds?.marketSpreadHome ?? null;
  if (mktSpread !== null && mktSpread !== undefined) {
    const spreadDiff = projSpread - mktSpread;
    if (Math.abs(spreadDiff) >= (sport === "mlb" ? 0.5 : 3.0)) {
      spreadSignal = {
        verdict: "LEAN",
        side: spreadDiff > 0 ? "HOME -" : "AWAY +",
        diff: Math.abs(spreadDiff).toFixed(1),
        reason: `Model spread ${projSpread > 0 ? "-" : "+"}${Math.abs(projSpread).toFixed(1)} vs market ${mktSpread > 0 ? "-" : "+"}${Math.abs(mktSpread).toFixed(1)}`,
      };
    } else {
      spreadSignal = { verdict: "SKIP", reason: `Spread difference (${Math.abs(spreadDiff).toFixed(1)} pts) too small` };
    }
  }

  // ── CONFIDENCE SIGNAL ──────────────────────────────────────
  const confSignal = {
    verdict: pred.confidence === "HIGH" ? "GO" : pred.confidence === "MEDIUM" ? "LEAN" : "SKIP",
    reason: pred.confidence === "HIGH"
      ? `High confidence — large EM gap and decisive win probability`
      : pred.confidence === "MEDIUM"
      ? `Medium confidence — moderate signal strength`
      : `Low confidence — small sample or near-even matchup`,
  };

  const anyEdge = mlSignal?.verdict === "GO" || mlSignal?.verdict === "LEAN" ||
                  ouSignal?.verdict === "GO" || ouSignal?.verdict === "LEAN" ||
                  spreadSignal?.verdict === "LEAN";

  return { ml: mlSignal, ou: ouSignal, spread: spreadSignal, conf: confSignal, anyEdge };
}

let _oddsCache = {}, _oddsCacheTime = {};
async function fetchOdds(sport = "baseball_mlb") {
  const key = sport;
  if (_oddsCache[key] && Date.now() - (_oddsCacheTime[key] || 0) < 10 * 60 * 1000) return _oddsCache[key];
  try {
    const res = await fetch(`/api/odds?sport=${sport}`);
    if (!res.ok) return null;
    const data = await res.json();
    if (data?.error === "NO_API_KEY") return { games: [], noKey: true };
    _oddsCache[key] = data; _oddsCacheTime[key] = Date.now();
    return data;
  } catch { return null; }
}

function computeAccuracy(records) {
  const withResults = records.filter(r => r.result_entered);
  if (!withResults.length) return null;
  const ml = withResults.filter(r => r.ml_correct !== null);
  const rl = withResults.filter(r => r.rl_correct !== null);
  const ou = withResults.filter(r => r.ou_correct !== null);
  const tiers = { HIGH: { total: 0, correct: 0 }, MEDIUM: { total: 0, correct: 0 }, LOW: { total: 0, correct: 0 } };
  withResults.forEach(r => { if (r.confidence && tiers[r.confidence]) { tiers[r.confidence].total++; if (r.ml_correct) tiers[r.confidence].correct++; } });
  let roi = 0;
  ml.forEach(r => { roi += r.ml_correct ? 90.9 : -100; });
  let win = 0, loss = 0, longestWin = 0, longestLoss = 0;
  ml.forEach(r => {
    if (r.ml_correct) { win++; loss = 0; longestWin = Math.max(longestWin, win); }
    else { loss++; win = 0; longestLoss = Math.max(longestLoss, loss); }
  });
  const currentStreak = ml.length > 0 ? (ml[ml.length - 1].ml_correct ? win : -loss) : 0;
  const byMonth = {};
  withResults.forEach(r => {
    const m = r.game_date?.slice(0, 7); if (!m) return;
    if (!byMonth[m]) byMonth[m] = { month: m, total: 0, correct: 0 };
    if (r.ml_correct !== null) { byMonth[m].total++; if (r.ml_correct) byMonth[m].correct++; }
  });
  const calibration = computeCalibration(withResults);
  // Flag whether spread data is market-based or model-based
  const hasMarketSpreads = rl.some(r => r.market_spread_home != null);
  return {
    total: withResults.length, mlTotal: ml.length,
    mlAcc: ml.length ? (ml.filter(r => r.ml_correct).length / ml.length * 100).toFixed(1) : null,
    rlAcc: rl.length ? (rl.filter(r => r.rl_correct).length / rl.length * 100).toFixed(1) : null,
    rlGames: rl.length, hasMarketSpreads,
    ouAcc: ou.length ? (ou.filter(r => r.ou_correct === "OVER").length / ou.filter(r => r.ou_correct !== "PUSH").length * 100).toFixed(1) : null,
    ouGames: ou.filter(r => r.ou_correct !== "PUSH").length,
    tiers, roi: roi.toFixed(0), roiPct: ml.length ? (roi / (ml.length * 100) * 100).toFixed(1) : null,
    longestWin, longestLoss, currentStreak,
    byMonth: Object.values(byMonth).sort((a, b) => a.month.localeCompare(b.month)).map(m => ({ ...m, pct: m.total ? parseFloat((m.correct / m.total * 100).toFixed(1)) : 0 })),
    calibration,
  };
}

function computeCalibration(records) {
  const valid = records.filter(r => r.win_pct_home != null && r.ml_correct !== null && r.result_entered);
  if (valid.length < 20) return null;
  const bins = Array.from({ length: 10 }, (_, i) => ({ binMin: i * 0.1, binMax: (i + 1) * 0.1, label: `${i * 10}-${(i + 1) * 10}%`, midpoint: (i + 0.05) * 10, predictions: [] }));
  valid.forEach(r => { const p = parseFloat(r.win_pct_home); const binIdx = Math.min(9, Math.floor(p * 10)); bins[binIdx].predictions.push({ p, actual: r.ml_correct ? 1 : 0 }); });
  const calibrationCurve = bins.filter(b => b.predictions.length >= 3).map(b => {
    const n = b.predictions.length, actualRate = b.predictions.reduce((s, p) => s + p.actual, 0) / n, expectedRate = b.predictions.reduce((s, p) => s + p.p, 0) / n;
    return { label: b.label, midpoint: b.midpoint, expected: parseFloat((expectedRate * 100).toFixed(1)), actual: parseFloat((actualRate * 100).toFixed(1)), n, error: parseFloat(((actualRate - expectedRate) * 100).toFixed(1)) };
  });
  const brierScore = valid.reduce((sum, r) => sum + Math.pow(parseFloat(r.win_pct_home) - (r.ml_correct ? 1 : 0), 2), 0) / valid.length;
  const overallBias = calibrationCurve.reduce((s, b) => s + (b.actual - b.expected) * b.n, 0) / (calibrationCurve.reduce((s, b) => s + b.n, 0) || 1);
  return { curve: calibrationCurve, brierScore: parseFloat(brierScore.toFixed(4)), brierSkill: parseFloat((1 - brierScore / 0.25).toFixed(3)), meanCalibrationError: parseFloat((calibrationCurve.reduce((s, b) => s + Math.abs(b.error), 0) / (calibrationCurve.length || 1)).toFixed(1)), overallBias: parseFloat(overallBias.toFixed(1)), suggestedFactor: Math.abs(overallBias) > 2 && valid.length >= 50 ? (overallBias < 0 ? 0.85 : 1.15) : 1.0, n: valid.length };
}

// ═══════════════════════════════════════════════════════════════
// ⚾ MLB ENGINE
// ═══════════════════════════════════════════════════════════════

const MLB_TEAMS = [
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

const mlbTeamById = (id) => MLB_TEAMS.find(t => t.id === id) || { name: String(id), abbr: String(id), id, league: "?" };

const _resolvedIdCache = {};
function resolveStatTeamId(teamId, abbr) {
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

const PARK_FACTORS = {
  108: { runFactor: 1.02, name: "Angel Stadium" }, 109: { runFactor: 1.03, name: "Chase Field" },
  110: { runFactor: 0.95, name: "Camden Yards" },  111: { runFactor: 1.04, name: "Fenway Park" },
  112: { runFactor: 1.04, name: "Wrigley Field" }, 113: { runFactor: 1.00, name: "Great American" },
  114: { runFactor: 0.97, name: "Progressive" },   115: { runFactor: 1.16, name: "Coors Field" },
  116: { runFactor: 0.98, name: "Comerica" },      117: { runFactor: 0.99, name: "Minute Maid" },
  118: { runFactor: 1.01, name: "Kauffman" },      119: { runFactor: 1.00, name: "Dodger Stadium" },
  120: { runFactor: 1.01, name: "Nationals Park" },121: { runFactor: 1.03, name: "Citi Field" },
  133: { runFactor: 0.99, name: "Oakland Coliseum"},134: { runFactor: 0.96, name: "PNC Park" },
  135: { runFactor: 0.95, name: "Petco Park" },    136: { runFactor: 0.94, name: "T-Mobile Park" },
  137: { runFactor: 0.91, name: "Oracle Park" },   138: { runFactor: 0.97, name: "Busch Stadium" },
  139: { runFactor: 0.96, name: "Tropicana" },     140: { runFactor: 1.05, name: "Globe Life" },
  141: { runFactor: 1.03, name: "Rogers Centre" }, 142: { runFactor: 1.00, name: "Target Field" },
  143: { runFactor: 1.06, name: "Citizens Bank" }, 144: { runFactor: 1.02, name: "Truist Park" },
  145: { runFactor: 1.00, name: "Guaranteed Rate"},146: { runFactor: 0.97, name: "loanDepot" },
  147: { runFactor: 1.05, name: "Yankee Stadium" },158: { runFactor: 0.97, name: "Am. Family Field" },
};

const UMPIRE_PROFILES = {
  "CB Bucknor": { runImpact: -0.28, size: "Large" }, "Dan Bellino": { runImpact: -0.22, size: "Large" },
  "Mike Estabrook": { runImpact: -0.18, size: "Large" }, "Manny Gonzalez": { runImpact: -0.15, size: "Large" },
  "Quinn Wolcott": { runImpact: -0.14, size: "Large" }, "Nic Lentz": { runImpact: -0.12, size: "Above Avg" },
  "Phil Cuzzi": { runImpact: 0.00, size: "Average" }, "Laz Diaz": { runImpact: 0.02, size: "Average" },
  "Mark Carlson": { runImpact: 0.01, size: "Average" }, "Ron Kulpa": { runImpact: 0.03, size: "Average" },
  "Ted Barrett": { runImpact: 0.08, size: "Small" }, "James Hoye": { runImpact: 0.10, size: "Small" },
  "John Tumpane": { runImpact: 0.12, size: "Small" }, "Vic Carapazza": { runImpact: 0.18, size: "Small" },
  "Angel Hernandez": { runImpact: 0.22, size: "Very Small" }, "Fieldin Culbreth": { runImpact: 0.30, size: "Very Small" },
};
const UMPIRE_DEFAULT = { runImpact: 0.0, size: "Average" };

const PLATOON = { RHBvsRHP: -0.005, RHBvsLHP: +0.018, LHBvsRHP: +0.022, LHBvsLHP: -0.008 };
function platoonDelta(lineupHand, starterHand) {
  if (!starterHand || !lineupHand) return 0;
  const rPct = lineupHand.rPct ?? 0.65, lPct = lineupHand.lPct ?? 0.30, sPct = 1 - rPct - lPct;
  if (starterHand === "R") return rPct * PLATOON.RHBvsRHP + lPct * PLATOON.LHBvsRHP + sPct * ((PLATOON.LHBvsRHP + PLATOON.RHBvsRHP) / 2);
  return rPct * PLATOON.RHBvsLHP + lPct * PLATOON.LHBvsLHP + sPct * ((PLATOON.LHBvsLHP + PLATOON.RHBvsLHP) / 2);
}

function mlbPredictGame({ homeTeamId, awayTeamId, homeHit, awayHit, homePitch, awayPitch, homeStarterStats, awayStarterStats, homeForm, awayForm, bullpenData, homeGamesPlayed = 0, awayGamesPlayed = 0, homeLineup, awayLineup, umpire, homeStatcast, awayStatcast, calibrationFactor = 1.0 }) {
  const park = PARK_FACTORS[homeTeamId] || { runFactor: 1.0 };
  const calcOffenseWOBA = (hit, lineup, statcast) => {
    if (statcast?.xwOBA) return statcast.xwOBA;
    if (lineup?.wOBA) return lineup.wOBA;
    if (!hit) return 0.315;
    const { obp = 0.320, slg = 0.420, avg = 0.250 } = hit;
    return Math.max(0.250, Math.min(0.420, obp * 0.90 + Math.max(0, slg - avg) * 0.25));
  };
  const calcFIP = (stats, fallbackERA) => {
    if (!stats) return fallbackERA || 4.25;
    if (stats.fip) return stats.fip;
    const { era = 4.25, k9 = 8.5, bb9 = 3.0 } = stats;
    return Math.max(2.5, Math.min(7.0, 3.80 + (bb9 - 3.0) * 0.28 - (k9 - 8.5) * 0.16 + (era - 4.00) * 0.38));
  };
  const homeWOBA = calcOffenseWOBA(homeHit, homeLineup, homeStatcast);
  const awayWOBA = calcOffenseWOBA(awayHit, awayLineup, awayStatcast);
  const BASE_RUNS = 4.55, wOBA_SCALE = 14.0;
  let hr = BASE_RUNS + (homeWOBA - 0.315) * wOBA_SCALE;
  let ar = BASE_RUNS + (awayWOBA - 0.315) * wOBA_SCALE;
  const homePlatoonDelta = platoonDelta(homeLineup?.lineupHand, awayStarterStats?.pitchHand);
  const awayPlatoonDelta = platoonDelta(awayLineup?.lineupHand, homeStarterStats?.pitchHand);
  hr += homePlatoonDelta * wOBA_SCALE;
  ar += awayPlatoonDelta * wOBA_SCALE;
  const hFIP = calcFIP(homeStarterStats, homePitch?.era);
  const aFIP = calcFIP(awayStarterStats, awayPitch?.era);
  ar += (hFIP - 4.25) * 0.40;
  hr += (aFIP - 4.25) * 0.40;
  const bpHome = bullpenData?.[homeTeamId], bpAway = bullpenData?.[awayTeamId];
  if (bpHome?.fatigue > 0) ar += bpHome.fatigue * 0.5;
  if (bpAway?.fatigue > 0) hr += bpAway.fatigue * 0.5;
  hr *= park.runFactor; ar *= park.runFactor;
  const ump = umpire || UMPIRE_DEFAULT;
  hr += ump.runImpact * 0.5; ar += ump.runImpact * 0.5;
  const avgGP = (homeGamesPlayed + awayGamesPlayed) / 2;
  const isSpringTraining = avgGP < 5;
  const formSampleWeight = isSpringTraining ? 0 : Math.min(0.12, 0.12 * Math.sqrt(Math.min(avgGP, 30) / 30));
  if (!isSpringTraining && homeForm?.formScore) hr += homeForm.formScore * formSampleWeight;
  if (!isSpringTraining && awayForm?.formScore) ar += awayForm.formScore * formSampleWeight;
  hr = Math.max(1.8, Math.min(9.5, hr));
  ar = Math.max(1.8, Math.min(9.5, ar));
  const EXP = 1.83;
  let pythWinPct = Math.pow(hr, EXP) / (Math.pow(hr, EXP) + Math.pow(ar, EXP));
  const hfaScale = isSpringTraining ? 0 : Math.min(1.0, avgGP / 20);
  let hwp = Math.min(0.88, Math.max(0.12, pythWinPct + 0.038 * hfaScale));
  if (calibrationFactor !== 1.0) hwp = Math.min(0.90, Math.max(0.10, 0.5 + (hwp - 0.5) * calibrationFactor));
  const blendWeight = Math.min(1.0, avgGP / FULL_SEASON_THRESHOLD);
  const dataScore = [homeHit, awayHit, homeStarterStats, awayStarterStats, homeForm, awayForm].filter(Boolean).length / 6;
  const v9Bonus = [homeLineup, awayLineup, homeStatcast, awayStatcast, umpire].filter(Boolean).length * 2;
  const confScore = Math.round(35 + (dataScore * 30) + (blendWeight * 20) + Math.min(15, v9Bonus));
  const confidence = confScore >= 80 ? "HIGH" : confScore >= 60 ? "MEDIUM" : "LOW";
  const modelML_home = hwp >= 0.5 ? -Math.round((hwp / (1 - hwp)) * 100) : +Math.round(((1 - hwp) / hwp) * 100);
  const modelML_away = hwp >= 0.5 ? +Math.round(((1 - hwp) / hwp) * 100) : -Math.round((hwp / (1 - hwp)) * 100);
  return { homeRuns: hr, awayRuns: ar, homeWinPct: hwp, awayWinPct: 1 - hwp, confidence, confScore, modelML_home, modelML_away, ouTotal: parseFloat((hr + ar).toFixed(1)), runLineHome: -1.5, hFIP, aFIP, umpire: ump, homeWOBA, awayWOBA, homePlatoonDelta, awayPlatoonDelta };
}

function mlbFetch(path, params = {}) {
  const p = new URLSearchParams({ path, ...params });
  return fetch(`/api/mlb?${p}`).then(r => r.ok ? r.json() : null).catch(() => null);
}

const _statcastCache = {};
async function fetchStatcast(teamId) {
  if (!teamId) return null;
  const key = `${teamId}-${STAT_SEASON}`;
  if (_statcastCache[key] !== undefined) return _statcastCache[key];
  _statcastCache[key] = null; return null;
}

function extractUmpire(gameData) {
  const officials = gameData?.officials || [];
  const hp = officials.find(o => o.officialType === "Home Plate" || o.officialType === "HP");
  const name = hp?.official?.fullName;
  if (!name) return null;
  return { ...(UMPIRE_PROFILES[name] || UMPIRE_DEFAULT), name };
}

function blendStats(current, prior1, prior2, gamesPlayed) {
  const w = Math.min(1.0, gamesPlayed / FULL_SEASON_THRESHOLD);
  const priors = [prior1, prior2].filter(Boolean);
  if (!priors.length || w >= 1.0) return current;
  if (!current) return priors.reduce((acc, p) => { Object.keys(p).forEach(k => { acc[k] = (acc[k] || 0) + p[k] / priors.length; }); return acc; }, {});
  const priorAvg = priors.reduce((acc, p) => { Object.keys(p).forEach(k => { acc[k] = (acc[k] || 0) + p[k] / priors.length; }); return acc; }, {});
  const result = {};
  Object.keys(current).forEach(k => { const c = current[k] ?? priorAvg[k], p = priorAvg[k] ?? current[k]; result[k] = (typeof c === "number" && typeof p === "number") ? c * w + p * (1 - w) : current[k]; });
  return result;
}

async function fetchOneSeasonHitting(teamId, season) {
  if (!teamId) return null;
  const data = await mlbFetch(`teams/${teamId}/stats`, { stats: "season", group: "hitting", season, sportId: 1 });
  const s = data?.stats?.[0]?.splits?.[0]?.stat;
  if (!s) return null;
  return { avg: parseFloat(s.avg) || 0.250, obp: parseFloat(s.obp) || 0.320, slg: parseFloat(s.slg) || 0.420, gamesPlayed: parseInt(s.gamesPlayed) || 0 };
}
async function fetchTeamHitting(teamId) {
  if (!teamId) return null;
  const [cur, p1, p2] = await Promise.all([fetchOneSeasonHitting(teamId, STAT_SEASON), fetchOneSeasonHitting(teamId, STAT_SEASON - 1), fetchOneSeasonHitting(teamId, STAT_SEASON - 2)]);
  return blendStats(cur, p1, p2, cur?.gamesPlayed || 0);
}
async function fetchOneSeasonPitching(teamId, season) {
  if (!teamId) return null;
  const data = await mlbFetch(`teams/${teamId}/stats`, { stats: "season", group: "pitching", season, sportId: 1 });
  const s = data?.stats?.[0]?.splits?.[0]?.stat;
  if (!s) return null;
  return { era: parseFloat(s.era) || 4.00, whip: parseFloat(s.whip) || 1.30, k9: parseFloat(s.strikeoutsPer9Inn) || 8.5, bb9: parseFloat(s.walksPer9Inn) || 3.0 };
}
async function fetchTeamPitching(teamId) {
  if (!teamId) return null;
  const [cur, p1, p2, gpData] = await Promise.all([fetchOneSeasonPitching(teamId, STAT_SEASON), fetchOneSeasonPitching(teamId, STAT_SEASON - 1), fetchOneSeasonPitching(teamId, STAT_SEASON - 2), fetchOneSeasonHitting(teamId, STAT_SEASON)]);
  return blendStats(cur, p1, p2, gpData?.gamesPlayed || 0);
}
async function fetchOneSeasonStarterStats(pitcherId, season) {
  if (!pitcherId) return null;
  const data = await mlbFetch(`people/${pitcherId}/stats`, { stats: "season", group: "pitching", season, sportId: 1 });
  const s = data?.stats?.[0]?.splits?.[0]?.stat;
  if (!s) return null;
  const era = parseFloat(s.era) || 4.50, k9 = parseFloat(s.strikeoutsPer9Inn) || 8.0, bb9 = parseFloat(s.walksPer9Inn) || 3.2, ip = parseFloat(s.inningsPitched) || 0;
  return { era, whip: parseFloat(s.whip) || 1.35, k9, bb9, ip, fip: Math.max(2.5, Math.min(7.0, 3.80 + (bb9 - 3.0) * 0.28 - (k9 - 8.5) * 0.16 + (era - 4.00) * 0.38)) };
}
async function fetchStarterStats(pitcherId) {
  if (!pitcherId) return null;
  const [cur, p1, p2] = await Promise.all([fetchOneSeasonStarterStats(pitcherId, STAT_SEASON), fetchOneSeasonStarterStats(pitcherId, STAT_SEASON - 1), fetchOneSeasonStarterStats(pitcherId, STAT_SEASON - 2)]);
  return blendStats(cur, p1, p2, Math.round(Math.min(1.0, (cur?.ip || 0) / 120) * FULL_SEASON_THRESHOLD));
}
async function fetchRecentForm(teamId, numGames = 15) {
  if (!teamId) return null;
  const today = new Date().toISOString().split("T")[0];
  const data = await mlbFetch("schedule", { teamId, season: SEASON, startDate: `${SEASON}-01-01`, endDate: today, hydrate: "linescore", sportId: 1 });
  const games = [];
  for (const d of (data?.dates || [])) for (const g of (d.games || [])) {
    if (g.status?.abstractGameState === "Final" || g.status?.detailedState === "Game Over") {
      const isHome = g.teams?.home?.team?.id === teamId;
      const my = isHome ? g.teams?.home : g.teams?.away, op = isHome ? g.teams?.away : g.teams?.home;
      games.push({ win: my?.isWinner || false, rs: my?.score || 0, ra: op?.score || 0 });
    }
  }
  const recent = games.slice(-numGames);
  if (!recent.length) return null;
  const rf = recent.reduce((s, g) => s + g.rs, 0), ra = recent.reduce((s, g) => s + g.ra, 0), wins = recent.filter(g => g.win).length;
  return { gamesPlayed: games.length, winPct: wins / recent.length, pythWinPct: Math.pow(rf, 1.83) / (Math.pow(rf, 1.83) + Math.pow(ra, 1.83)), luckFactor: wins / recent.length - Math.pow(rf, 1.83) / (Math.pow(rf, 1.83) + Math.pow(ra, 1.83)), formScore: recent.slice(-5).reduce((s, g, i) => s + (g.win ? 1 : -0.6) * (i + 1), 0) / 15 };
}
async function fetchBullpenFatigue(teamId) {
  const today = new Date(), y = new Date(today), t2 = new Date(today);
  y.setDate(today.getDate() - 1); t2.setDate(today.getDate() - 2);
  const fmt = d => d.toISOString().split("T")[0];
  const data = await mlbFetch("schedule", { teamId, season: SEASON, startDate: fmt(t2), endDate: fmt(y), sportId: 1 });
  let py = 0, pt = 0;
  for (const date of (data?.dates || [])) for (const g of (date.games || [])) {
    const isHome = g.teams?.home?.team?.id === teamId, bp = isHome ? g.teams?.home?.pitchers?.length || 0 : g.teams?.away?.pitchers?.length || 0, days = Math.round((today - new Date(date.date)) / 86400000);
    if (days === 1) py = bp; if (days === 2) pt = bp;
  }
  return { fatigue: Math.min(1, py * 0.15 + pt * 0.07), pitchersUsedYesterday: py, closerAvailable: py < 3 };
}
async function fetchLineup(gamePk, teamId, isHome) {
  if (!gamePk || !teamId) return null;
  try {
    const data = await mlbFetch(`game/${gamePk}/boxscore`);
    if (!data) return null;
    const side = isHome ? data.teams?.home : data.teams?.away;
    if (!side?.battingOrder?.length) return null;
    const battingOrder = side.battingOrder.slice(0, 9), players = side.players || {};
    let totalWOBA = 0, count = 0, rCount = 0, lCount = 0;
    for (const playerId of battingOrder) {
      const player = players[`ID${playerId}`]; if (!player) continue;
      const s = player.seasonStats?.batting; if (!s) continue;
      const avg = parseFloat(s.avg) || 0.250, obp = parseFloat(s.obp) || 0.320, slg = parseFloat(s.slg) || 0.420;
      const woba = Math.max(0.250, Math.min(0.420, obp * 0.90 + Math.max(0, slg - avg) * 0.25));
      const w = battingOrder.indexOf(playerId) < 4 ? 1.2 : 1.0;
      totalWOBA += woba * w; count += w;
      const hand = player.person?.batSide?.code;
      if (hand === "R" || hand === "S") rCount++; else if (hand === "L") lCount++;
    }
    if (!count) return null;
    const totalH = rCount + lCount;
    return { wOBA: parseFloat((totalWOBA / count).toFixed(3)), lineupHand: totalH > 0 ? { rPct: rCount / totalH, lPct: lCount / totalH } : null };
  } catch { return null; }
}
async function fetchMLBScheduleForDate(dateStr) {
  const data = await mlbFetch("schedule", { sportId: 1, date: dateStr, hydrate: "probablePitcher,teams,venue,linescore,officials" });
  const games = [];
  for (const d of (data?.dates || [])) for (const g of (d.games || [])) {
    const homeId = g.teams?.home?.team?.id, awayId = g.teams?.away?.team?.id;
    const homeAbbr = (g.teams?.home?.team?.abbreviation || "").replace(/\d+$/, "") || mlbTeamById(homeId).abbr;
    const awayAbbr = (g.teams?.away?.team?.abbreviation || "").replace(/\d+$/, "") || mlbTeamById(awayId).abbr;
    games.push({
      gamePk: g.gamePk, gameDate: g.gameDate,
      status: (g.status?.abstractGameState === "Final" || g.status?.detailedState === "Game Over") ? "Final" : g.status?.abstractGameState === "Live" ? "Live" : "Preview",
      homeTeamId: homeId, awayTeamId: awayId, homeAbbr, awayAbbr,
      homeTeamName: g.teams?.home?.team?.name || homeAbbr, awayTeamName: g.teams?.away?.team?.name || awayAbbr,
      homeScore: g.teams?.home?.score ?? null, awayScore: g.teams?.away?.score ?? null,
      homeStarter: g.teams?.home?.probablePitcher?.fullName || null, awayStarter: g.teams?.away?.probablePitcher?.fullName || null,
      homeStarterId: g.teams?.home?.probablePitcher?.id || null, awayStarterId: g.teams?.away?.probablePitcher?.id || null,
      homeStarterHand: g.teams?.home?.probablePitcher?.pitchHand?.code || null, awayStarterHand: g.teams?.away?.probablePitcher?.pitchHand?.code || null,
      venue: g.venue?.name, umpire: extractUmpire(g),
      inning: g.linescore?.currentInning || null, inningHalf: g.linescore?.inningHalf || null,
    });
  }
  return games;
}

function matchMLBOddsToGame(oddsGame, schedGame) {
  if (!oddsGame || !schedGame) return false;
  const norm = s => (s || "").toLowerCase().replace(/\s+/g, "");
  const homeN = norm(mlbTeamById(schedGame.homeTeamId)?.name || "");
  const awayN = norm(mlbTeamById(schedGame.awayTeamId)?.name || "");
  return norm(oddsGame.homeTeam).includes(homeN.slice(0, 5)) && norm(oddsGame.awayTeam).includes(awayN.slice(0, 5));
}

const normAbbr = s => (s || "").replace(/\d+$/, "").toUpperCase();

async function mlbBuildPredictionRow(game, dateStr) {
  const homeStatId = resolveStatTeamId(game.homeTeamId, game.homeAbbr);
  const awayStatId = resolveStatTeamId(game.awayTeamId, game.awayAbbr);
  if (!homeStatId || !awayStatId) return null;
  const [homeHit, awayHit, homePitch, awayPitch, homeStarter, awayStarter, homeForm, awayForm, homeStatcast, awayStatcast, homeLineup, awayLineup] =
    await Promise.all([fetchTeamHitting(homeStatId), fetchTeamHitting(awayStatId), fetchTeamPitching(homeStatId), fetchTeamPitching(awayStatId), fetchStarterStats(game.homeStarterId), fetchStarterStats(game.awayStarterId), fetchRecentForm(homeStatId), fetchRecentForm(awayStatId), fetchStatcast(homeStatId), fetchStatcast(awayStatId), fetchLineup(game.gamePk, homeStatId, true), fetchLineup(game.gamePk, awayStatId, false)]);
  if (homeStarter) homeStarter.pitchHand = game.homeStarterHand;
  if (awayStarter) awayStarter.pitchHand = game.awayStarterHand;
  const [homeBullpen, awayBullpen] = await Promise.all([fetchBullpenFatigue(game.homeTeamId), fetchBullpenFatigue(game.awayTeamId)]);
  const pred = mlbPredictGame({ homeTeamId: game.homeTeamId, awayTeamId: game.awayTeamId, homeHit, awayHit, homePitch, awayPitch, homeStarterStats: homeStarter, awayStarterStats: awayStarter, homeForm, awayForm, homeGamesPlayed: homeForm?.gamesPlayed || 0, awayGamesPlayed: awayForm?.gamesPlayed || 0, bullpenData: { [game.homeTeamId]: homeBullpen, [game.awayTeamId]: awayBullpen }, homeLineup, awayLineup, umpire: game.umpire, homeStatcast, awayStatcast });
  if (!pred) return null;
  const home = mlbTeamById(game.homeTeamId), away = mlbTeamById(game.awayTeamId);
  return { game_date: dateStr, home_team: game.homeAbbr || (home?.abbr || String(game.homeTeamId)).replace(/\d+$/, ''), away_team: game.awayAbbr || (away?.abbr || String(game.awayTeamId)).replace(/\d+$/, ''), game_pk: game.gamePk, game_type: getMLBGameType(dateStr), model_ml_home: pred.modelML_home, model_ml_away: pred.modelML_away, run_line_home: pred.runLineHome, run_line_away: -pred.runLineHome, ou_total: pred.ouTotal, win_pct_home: parseFloat(pred.homeWinPct.toFixed(4)), confidence: pred.confidence, pred_home_runs: parseFloat(pred.homeRuns.toFixed(2)), pred_away_runs: parseFloat(pred.awayRuns.toFixed(2)) };
}

async function mlbFillFinalScores(pendingRows) {
  if (!pendingRows.length) return 0;
  let filled = 0;
  const byDate = {};
  for (const row of pendingRows) { if (!byDate[row.game_date]) byDate[row.game_date] = []; byDate[row.game_date].push(row); }
  const teamIdToAbbr = {}; MLB_TEAMS.forEach(t => { teamIdToAbbr[t.id] = t.abbr; });
  for (const [dateStr, rows] of Object.entries(byDate)) {
    try {
      const data = await mlbFetch("schedule", { sportId: 1, date: dateStr, hydrate: "probablePitcher,teams,venue,linescore" });
      if (!data) continue;
      for (const dt of (data?.dates || [])) for (const g of (dt.games || [])) {
        const state = g.status?.abstractGameState || "", detail = g.status?.detailedState || "", coded = g.status?.codedGameState || "";
        if (!(state === "Final" || detail === "Game Over" || detail.startsWith("Final") || coded === "F" || coded === "O")) continue;
        const homeScore = g.teams?.home?.score ?? null, awayScore = g.teams?.away?.score ?? null;
        if (homeScore === null || awayScore === null) continue;
        const rawHomeId = g.teams?.home?.team?.id, rawAwayId = g.teams?.away?.team?.id;
        const homeId = resolveStatTeamId(rawHomeId, "") || rawHomeId, awayId = resolveStatTeamId(rawAwayId, "") || rawAwayId;
        const hAbbr = normAbbr(teamIdToAbbr[homeId] || g.teams?.home?.team?.abbreviation || "");
        const aAbbr = normAbbr(teamIdToAbbr[awayId] || g.teams?.away?.team?.abbreviation || "");
        if (!hAbbr || !aAbbr) continue;
        const matchedRow = rows.find(row => (row.game_pk && row.game_pk === g.gamePk) || (normAbbr(row.home_team) === hAbbr && normAbbr(row.away_team) === aAbbr));
        if (!matchedRow) continue;
        const modelPickedHome = (matchedRow.win_pct_home ?? 0.5) >= 0.5;
        const homeWon = homeScore > awayScore;
        const ml_correct = modelPickedHome ? homeWon : !homeWon;
        const spread = homeScore - awayScore;
        const rl_correct = modelPickedHome ? (spread > 1.5 ? true : spread < -1.5 ? false : null) : (spread < -1.5 ? true : spread > 1.5 ? false : null);
        const total = homeScore + awayScore;
        const ou_correct = matchedRow.ou_total ? (total > matchedRow.ou_total ? "OVER" : total < matchedRow.ou_total ? "UNDER" : "PUSH") : null;
        await supabaseQuery(`/mlb_predictions?id=eq.${matchedRow.id}`, "PATCH", { actual_home_runs: homeScore, actual_away_runs: awayScore, result_entered: true, ml_correct, rl_correct, ou_correct, game_pk: g.gamePk, home_team: hAbbr, away_team: aAbbr });
        filled++;
      }
    } catch (e) { console.warn("mlbFillFinalScores error", dateStr, e); }
  }
  return filled;
}

async function mlbRegradeAllResults(onProgress) {
  onProgress?.("⏳ Loading all graded MLB records…");
  const allGraded = await supabaseQuery(`/mlb_predictions?result_entered=eq.true&select=id,win_pct_home,pred_home_runs,pred_away_runs,actual_home_runs,actual_away_runs,ou_total&limit=2000`);
  if (!allGraded?.length) { onProgress?.("No graded records found"); return 0; }
  let fixed = 0;
  for (const row of allGraded) {
    const homeScore = row.actual_home_runs, awayScore = row.actual_away_runs;
    if (homeScore === null || awayScore === null) continue;
    let winPctHome = row.win_pct_home ?? 0.5;
    if (row.pred_home_runs && row.pred_away_runs) {
      const hr = parseFloat(row.pred_home_runs), ar = parseFloat(row.pred_away_runs);
      if (hr > 0 && ar > 0) { const hrE = Math.pow(hr, 1.83), arE = Math.pow(ar, 1.83); winPctHome = Math.min(0.88, Math.max(0.12, hrE / (hrE + arE) + 0.038)); }
    }
    const modelPickedHome = winPctHome >= 0.5, homeWon = homeScore > awayScore;
    const ml_correct = modelPickedHome ? homeWon : !homeWon;
    const spread = homeScore - awayScore;
    const rl_correct = modelPickedHome ? (spread > 1.5 ? true : spread < -1.5 ? false : null) : (spread < -1.5 ? true : spread > 1.5 ? false : null);
    const total = homeScore + awayScore;
    let ouTotal = row.ou_total;
    if (row.pred_home_runs && row.pred_away_runs) ouTotal = parseFloat((parseFloat(row.pred_home_runs) + parseFloat(row.pred_away_runs)).toFixed(1));
    const ou_correct = ouTotal ? (total > ouTotal ? "OVER" : total < ouTotal ? "UNDER" : "PUSH") : null;
    await supabaseQuery(`/mlb_predictions?id=eq.${row.id}`, "PATCH", { ml_correct, rl_correct, ou_correct, win_pct_home: parseFloat(winPctHome.toFixed(4)), ou_total: ouTotal });
    fixed++;
  }
  onProgress?.(`✅ Regraded ${fixed} MLB result(s)`);
  return fixed;
}

async function mlbRefreshPredictions(rows, onProgress) {
  if (!rows?.length) return 0;
  let updated = 0;
  const byDate = {};
  for (const row of rows) { if (!byDate[row.game_date]) byDate[row.game_date] = []; byDate[row.game_date].push(row); }
  for (const [dateStr, dateRows] of Object.entries(byDate)) {
    onProgress?.(`🔄 Refreshing ${dateStr}…`);
    const schedData = await mlbFetch("schedule", { sportId: 1, date: dateStr, hydrate: "probablePitcher,teams,officials" });
    const schedGames = [];
    for (const d of (schedData?.dates || [])) for (const g of (d.games || [])) schedGames.push(g);
    for (const row of dateRows) {
      try {
        const schedGame = schedGames.find(g => (row.game_pk && g.gamePk === row.game_pk) || (normAbbr(g.teams?.home?.team?.abbreviation) === normAbbr(row.home_team) && normAbbr(g.teams?.away?.team?.abbreviation) === normAbbr(row.away_team)));
        const homeTeamId = schedGame?.teams?.home?.team?.id || MLB_TEAMS.find(t => t.abbr === row.home_team)?.id;
        const awayTeamId = schedGame?.teams?.away?.team?.id || MLB_TEAMS.find(t => t.abbr === row.away_team)?.id;
        if (!homeTeamId || !awayTeamId) continue;
        const homeStatId = resolveStatTeamId(homeTeamId, row.home_team), awayStatId = resolveStatTeamId(awayTeamId, row.away_team);
        const umpire = extractUmpire(schedGame);
        const [homeHit, awayHit, homePitch, awayPitch, homeStarter, awayStarter, homeForm, awayForm] = await Promise.all([fetchTeamHitting(homeStatId), fetchTeamHitting(awayStatId), fetchTeamPitching(homeStatId), fetchTeamPitching(awayStatId), fetchStarterStats(schedGame?.teams?.home?.probablePitcher?.id), fetchStarterStats(schedGame?.teams?.away?.probablePitcher?.id), fetchRecentForm(homeStatId), fetchRecentForm(awayStatId)]);
        if (homeStarter) homeStarter.pitchHand = schedGame?.teams?.home?.probablePitcher?.pitchHand?.code;
        if (awayStarter) awayStarter.pitchHand = schedGame?.teams?.away?.probablePitcher?.pitchHand?.code;
        const pred = mlbPredictGame({ homeTeamId, awayTeamId, homeHit, awayHit, homePitch, awayPitch, homeStarterStats: homeStarter, awayStarterStats: awayStarter, homeForm, awayForm, homeGamesPlayed: homeForm?.gamesPlayed || 0, awayGamesPlayed: awayForm?.gamesPlayed || 0, umpire });
        if (!pred) continue;
        await supabaseQuery(`/mlb_predictions?id=eq.${row.id}`, "PATCH", { model_ml_home: pred.modelML_home, model_ml_away: pred.modelML_away, ou_total: pred.ouTotal, win_pct_home: parseFloat(pred.homeWinPct.toFixed(4)), confidence: pred.confidence, pred_home_runs: parseFloat(pred.homeRuns.toFixed(2)), pred_away_runs: parseFloat(pred.awayRuns.toFixed(2)) });
        updated++;
      } catch (e) { console.warn("mlbRefreshPredictions error:", row.id, e); }
    }
  }
  onProgress?.(`✅ Refreshed ${updated} MLB prediction(s)`);
  return updated;
}

async function mlbAutoSync(onProgress) {
  onProgress?.("⚾ Syncing MLB…");
  try {
    const missing = await supabaseQuery("/mlb_predictions?game_type=is.null&select=id,game_date&limit=500");
    if (missing?.length) {
      for (const row of missing) await supabaseQuery(`/mlb_predictions?id=eq.${row.id}`, "PATCH", { game_type: getMLBGameType(row.game_date) });
    }
  } catch (e) { console.warn("MLB game_type migration:", e); }
  const today = new Date().toISOString().split("T")[0];
  const allDates = []; const cur = new Date(MLB_SEASON_START);
  while (cur.toISOString().split("T")[0] <= today) { allDates.push(cur.toISOString().split("T")[0]); cur.setDate(cur.getDate() + 1); }
  const existing = await supabaseQuery(`/mlb_predictions?select=id,game_date,home_team,away_team,result_entered,ou_total,game_pk,model_ml_home&order=game_date.asc&limit=5000`);
  const savedKeys = new Set((existing || []).map(r => `${r.game_date}|${normAbbr(r.away_team)}@${normAbbr(r.home_team)}`));
  const pendingResults = (existing || []).filter(r => !r.result_entered);
  if (pendingResults.length) { const filled = await mlbFillFinalScores(pendingResults); if (filled) onProgress?.(`⚾ ${filled} MLB result(s) recorded`); }
  let newPred = 0;
  for (const dateStr of allDates) {
    const schedule = await fetchMLBScheduleForDate(dateStr);
    if (!schedule.length) continue;
    const unsaved = schedule.filter(g => { const ha = normAbbr(g.homeAbbr || mlbTeamById(g.homeTeamId).abbr), aa = normAbbr(g.awayAbbr || mlbTeamById(g.awayTeamId).abbr); return !savedKeys.has(`${dateStr}|${aa}@${ha}`); });
    if (!unsaved.length) continue;
    const rows = (await Promise.all(unsaved.map(g => mlbBuildPredictionRow(g, dateStr)))).filter(Boolean);
    if (rows.length) { await supabaseQuery("/mlb_predictions", "UPSERT", rows, "game_pk"); newPred += rows.length; const ns = await supabaseQuery(`/mlb_predictions?game_date=eq.${dateStr}&result_entered=eq.false&select=id,game_pk,home_team,away_team,ou_total,result_entered,game_date`); if (ns?.length) await mlbFillFinalScores(ns); }
  }
  onProgress?.(newPred ? `⚾ MLB sync complete — ${newPred} new` : "⚾ MLB up to date");
}

// ═══════════════════════════════════════════════════════════════
// 🏀 NCAA BASKETBALL ENGINE
// ═══════════════════════════════════════════════════════════════

function espnFetch(path) {
  return fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/${path}`)
    .then(r => r.ok ? r.json() : null).catch(() => null);
}

const NCAA_HOME_COURT_ADV = 3.5;
const _ncaaStatsCache = {};

async function fetchNCAATeamStats(teamId) {
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
    const fgPct = getStat("fieldGoalPct") || 0.455;
    const threePct = getStat("threePointFieldGoalPct") || 0.340;
    const ftPct = getStat("freeThrowPct") || 0.720;
    const assists = getStat("avgAssists") || 14.0;
    const turnovers = getStat("avgTurnovers") || 12.0;
    const estTempo = 68 + (assists * 0.3) - (turnovers * 0.2);
    const tempo = Math.max(58, Math.min(80, estTempo));
    const adjOE = (ppg / tempo) * 100;
    const adjDE = (oppPpg / tempo) * 100;
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

async function fetchNCAAGamesForDate(dateStr) {
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

function ncaaPredictGame({ homeStats, awayStats, neutralSite = false, calibrationFactor = 1.0 }) {
  if (!homeStats || !awayStats) return null;
  const possessions = (homeStats.tempo + awayStats.tempo) / 2;
  const lgAvgOE = 105.0;
  const homeOffVsAwayDef = (homeStats.adjOE / lgAvgOE) * (lgAvgOE / awayStats.adjDE) * lgAvgOE;
  const awayOffVsHomeDef = (awayStats.adjOE / lgAvgOE) * (lgAvgOE / homeStats.adjDE) * lgAvgOE;
  let homeScore = (homeOffVsAwayDef / 100) * possessions;
  let awayScore = (awayOffVsHomeDef / 100) * possessions;
  const hca = neutralSite ? 0 : NCAA_HOME_COURT_ADV;
  homeScore += hca / 2; awayScore -= hca / 2;
  const formWeight = Math.min(0.10, 0.10 * Math.sqrt(Math.min(homeStats.totalGames, 30) / 30));
  homeScore += homeStats.formScore * formWeight * 3;
  awayScore += awayStats.formScore * formWeight * 3;
  homeScore = Math.max(45, Math.min(115, homeScore));
  awayScore = Math.max(45, Math.min(115, awayScore));
  const projectedSpread = homeScore - awayScore;
  let homeWinPct = 1 / (1 + Math.pow(10, -projectedSpread / 11));
  homeWinPct = Math.min(0.92, Math.max(0.08, homeWinPct));
  if (calibrationFactor !== 1.0) homeWinPct = Math.min(0.92, Math.max(0.08, 0.5 + (homeWinPct - 0.5) * calibrationFactor));
  const spread = parseFloat(projectedSpread.toFixed(1));
  const modelML_home = homeWinPct >= 0.5 ? -Math.round((homeWinPct / (1 - homeWinPct)) * 100) : +Math.round(((1 - homeWinPct) / homeWinPct) * 100);
  const modelML_away = homeWinPct >= 0.5 ? +Math.round(((1 - homeWinPct) / homeWinPct) * 100) : -Math.round((homeWinPct / (1 - homeWinPct)) * 100);
  // Confidence based on meaningful factors:
  // 1. Efficiency margin gap between teams (bigger gap = more predictable)
  // 2. Win probability distance from 50% (how decisive is the pick)
  // 3. Sample size — how many games each team has played
  // 4. Whether both teams have reliable data (games played > 5)
  const emGap = Math.abs(homeStats.adjEM - awayStats.adjEM);           // 0–30+ pts
  const winPctStrength = Math.abs(homeWinPct - 0.5) * 2;              // 0–1 scale
  const minGames = Math.min(homeStats.totalGames, awayStats.totalGames);
  const sampleWeight = Math.min(1.0, minGames / 15);                  // full weight at 15 games
  const hasData = minGames >= 5 ? 1 : 0;

  // Score out of 100:
  //   EM gap contributes up to 40 pts (gap of 10+ = full score)
  //   Win% strength contributes up to 35 pts
  //   Sample size contributes up to 20 pts
  //   Data availability contributes 5 pts
  const confScore = Math.round(
    (Math.min(emGap, 10) / 10) * 40 +
    winPctStrength * 35 +
    sampleWeight * 20 +
    hasData * 5
  );
  // Thresholds tuned so roughly: HIGH ~top 20%, MEDIUM ~middle 60%, LOW ~bottom 20%
  const confidence = confScore >= 62 ? "HIGH" : confScore >= 35 ? "MEDIUM" : "LOW";
  return {
    homeScore: parseFloat(homeScore.toFixed(1)),
    awayScore: parseFloat(awayScore.toFixed(1)),
    homeWinPct, awayWinPct: 1 - homeWinPct,
    projectedSpread: spread,
    ouTotal: parseFloat((homeScore + awayScore).toFixed(1)),
    modelML_home, modelML_away,
    confidence, confScore,
    possessions: parseFloat(possessions.toFixed(1)),
    homeAdjEM: parseFloat(homeStats.adjEM?.toFixed(2)),
    awayAdjEM: parseFloat(awayStats.adjEM?.toFixed(2)),
    emDiff: parseFloat((homeStats.adjEM - awayStats.adjEM).toFixed(2)),
    neutralSite,
  };
}

async function ncaaBuildPredictionRow(game, dateStr, marketOdds = null) {
  const [homeStats, awayStats] = await Promise.all([fetchNCAATeamStats(game.homeTeamId), fetchNCAATeamStats(game.awayTeamId)]);
  if (!homeStats || !awayStats) return null;
  const pred = ncaaPredictGame({ homeStats, awayStats, neutralSite: game.neutralSite });
  if (!pred) return null;
  // Store market lines when available — used for accurate ATS and O/U grading
  // marketOdds.marketSpreadHome: actual Vegas spread (e.g. -6.5 = home favored by 6.5)
  // marketOdds.marketTotal: actual Vegas O/U total (e.g. 145.5)
  const market_spread_home = marketOdds?.marketSpreadHome ?? null;
  const market_ou_total    = marketOdds?.marketTotal ?? null;

  return {
    game_date: dateStr, home_team: game.homeAbbr || game.homeTeamName, away_team: game.awayAbbr || game.awayTeamName,
    home_team_name: game.homeTeamName, away_team_name: game.awayTeamName, game_id: game.gameId,
    home_team_id: game.homeTeamId, away_team_id: game.awayTeamId,
    model_ml_home: pred.modelML_home, model_ml_away: pred.modelML_away, spread_home: pred.projectedSpread,
    ou_total: pred.ouTotal, win_pct_home: parseFloat(pred.homeWinPct.toFixed(4)), confidence: pred.confidence,
    pred_home_score: parseFloat(pred.homeScore.toFixed(1)), pred_away_score: parseFloat(pred.awayScore.toFixed(1)),
    home_adj_em: pred.homeAdjEM, away_adj_em: pred.awayAdjEM, neutral_site: game.neutralSite || false,
    ...(market_spread_home !== null && { market_spread_home }),
    ...(market_ou_total    !== null && { market_ou_total }),
  };
}

async function ncaaFillFinalScores(pendingRows) {
  if (!pendingRows.length) return 0;
  let filled = 0;
  const byDate = {};
  for (const row of pendingRows) { if (!byDate[row.game_date]) byDate[row.game_date] = []; byDate[row.game_date].push(row); }
  for (const [dateStr, rows] of Object.entries(byDate)) {
    try {
      const games = await fetchNCAAGamesForDate(dateStr);
      for (const g of games) {
        if (g.status !== "Final" || g.homeScore === null || g.awayScore === null) continue;
        const matchedRow = rows.find(row =>
          (row.game_id && row.game_id === g.gameId) ||
          (row.home_team_id && row.home_team_id === g.homeTeamId && row.away_team_id === g.awayTeamId)
        );
        if (!matchedRow) continue;
        const homeScore = g.homeScore, awayScore = g.awayScore;
        const modelPickedHome = (matchedRow.win_pct_home ?? 0.5) >= 0.5;
        const homeWon = homeScore > awayScore;
        const ml_correct = modelPickedHome ? homeWon : !homeWon;
        const actualMargin = homeScore - awayScore; // positive = home won by X
        // ATS grading:
        //   market_spread_home = the Vegas line (e.g. -6.5 means home is 6.5pt fav)
        //   If we have a market spread, grade against it (did the favored team cover?)
        //   If no market spread, grade as simple ML pick direction (same as ml_correct)
        const mktSpread = matchedRow.market_spread_home ?? null;
        let rl_correct = null;
        if (mktSpread !== null) {
          // Home covers if actual margin > market spread (e.g. won by 8 when spread was -6.5)
          // Away covers if actual margin < market spread (e.g. home won by 4 when spread was -6.5)
          if (actualMargin > mktSpread) rl_correct = true;       // home covered
          else if (actualMargin < mktSpread) rl_correct = false; // away covered
          else rl_correct = null;                                 // push
        } else {
          // No market spread stored — fall back to model's projected spread direction
          // This at least tells us if the model correctly identified the dominant team
          const projSpread = matchedRow.spread_home || 0;
          const modelPickedHomeBySpread = projSpread > 0;
          if (actualMargin > 0 && modelPickedHomeBySpread) rl_correct = true;
          else if (actualMargin < 0 && !modelPickedHomeBySpread) rl_correct = true;
          else if (actualMargin === 0) rl_correct = null;
          else rl_correct = false;
        }
        const total = homeScore + awayScore;
        // Grade O/U against market total when available, otherwise skip (null)
        // Never grade O/U against model's own projected total — that's circular
        // Grade O/U: did the model's predicted total land on the correct side?
        // Model predicts OVER if pred_total > ou_line, UNDER if pred_total < ou_line
        const ouLine = matchedRow.market_ou_total ?? matchedRow.ou_total ?? null;
        const predTotal = (matchedRow.pred_home_score ?? 0) + (matchedRow.pred_away_score ?? 0);
        let ou_correct = null;
        if (ouLine !== null && total !== ouLine) {
          const actualOver = total > ouLine;
          const modelPredictedOver = predTotal > ouLine;
          ou_correct = (actualOver === modelPredictedOver) ? "OVER" : "UNDER";
          // "OVER" = model was correct, "UNDER" = model was wrong (reusing field to avoid schema change)
          // PUSH if total === ouLine
        } else if (ouLine !== null && total === ouLine) {
          ou_correct = "PUSH";
        }
        await supabaseQuery(`/ncaa_predictions?id=eq.${matchedRow.id}`, "PATCH", { actual_home_score: homeScore, actual_away_score: awayScore, result_entered: true, ml_correct, rl_correct, ou_correct });
        filled++;
      }
    } catch (e) { console.warn("ncaaFillFinalScores error", dateStr, e); }
  }
  return filled;
}

// Regrade all existing NCAA results with updated confidence + ATS logic.
// Re-fetches team stats to recalculate confidence tiers, then recomputes
// rl_correct using the stored spread_home as direction proxy (no market spread
// available for historical games, but at least direction is now correct).
async function ncaaRegradeAllResults(onProgress) {
  onProgress?.("⏳ Loading all graded NCAA records…");
  const allGraded = await supabaseQuery(
    `/ncaa_predictions?result_entered=eq.true&select=id,win_pct_home,spread_home,market_spread_home,market_ou_total,actual_home_score,actual_away_score,ou_total,pred_home_score,pred_away_score,home_team_id,away_team_id,home_adj_em,away_adj_em&limit=5000`
  );
  if (!allGraded?.length) { onProgress?.("No graded records found"); return 0; }
  onProgress?.(`⏳ Regrading ${allGraded.length} records…`);
  let fixed = 0;
  for (const row of allGraded) {
    const homeScore = row.actual_home_score, awayScore = row.actual_away_score;
    if (homeScore === null || awayScore === null) continue;

    const winPctHome = row.win_pct_home ?? 0.5;
    const modelPickedHome = winPctHome >= 0.5;
    const homeWon = homeScore > awayScore;
    const ml_correct = modelPickedHome ? homeWon : !homeWon;

    // ATS — use market spread if stored, else use model spread direction
    const actualMargin = homeScore - awayScore;
    const mktSpread = row.market_spread_home ?? null;
    let rl_correct = null;
    if (mktSpread !== null) {
      if (actualMargin > mktSpread) rl_correct = true;
      else if (actualMargin < mktSpread) rl_correct = false;
      else rl_correct = null;
    } else {
      const projSpread = row.spread_home || 0;
      const modelPickedHomeBySpread = projSpread > 0;
      if (actualMargin === 0) rl_correct = null;
      else if (actualMargin > 0 && modelPickedHomeBySpread) rl_correct = true;
      else if (actualMargin < 0 && !modelPickedHomeBySpread) rl_correct = true;
      else rl_correct = false;
    }

    // O/U — only grade against market total, not model total (circular)
    const total = homeScore + awayScore;
    // Grade O/U: did the model correctly predict the over/under?
    const ouLine = row.market_ou_total ?? row.ou_total ?? null;
    const predTotal = (row.pred_home_score ?? 0) + (row.pred_away_score ?? 0);
    let ou_correct = null;
    if (ouLine !== null && total !== ouLine) {
      const actualOver = total > ouLine;
      const modelPredictedOver = predTotal > ouLine;
      ou_correct = (actualOver === modelPredictedOver) ? "OVER" : "UNDER";
    } else if (ouLine !== null && total === ouLine) {
      ou_correct = "PUSH";
    }

    // Recalculate confidence from stored EM values using new formula
    let confidence = "MEDIUM";
    if (row.home_adj_em != null && row.away_adj_em != null) {
      const emGap = Math.abs(row.home_adj_em - row.away_adj_em);
      const winPctStrength = Math.abs(winPctHome - 0.5) * 2;
      const confScore = Math.round(
        (Math.min(emGap, 10) / 10) * 40 +
        winPctStrength * 35 +
        20 + // assume full sample (historical games)
        5    // assume data available
      );
      confidence = confScore >= 62 ? "HIGH" : confScore >= 35 ? "MEDIUM" : "LOW";
    }

    await supabaseQuery(`/ncaa_predictions?id=eq.${row.id}`, "PATCH",
      { ml_correct, rl_correct, ou_correct, confidence }
    );
    fixed++;
    if (fixed % 100 === 0) onProgress?.(`⏳ Regraded ${fixed}/${allGraded.length}…`);
  }
  onProgress?.(`✅ Regraded ${fixed} NCAA records`);
  return fixed;
}

// NCAA season starts Nov 1 of the prior calendar year
// LIVE_CUTOFF: date from which predictions use real-time stats (not backfilled).
// Set to today's date — all games on/after this are "forward-only" (trustworthy).
// Games before this date used end-of-season ESPN stats applied retroactively,
// which inflates historical accuracy. Change this if you redeploy later.
const NCAA_LIVE_CUTOFF = "2026-02-23";
const _ncaaSeasonStart = (() => {
  const now = new Date();
  // Before August = still in prior season year (e.g. Feb 2026 → Nov 2024)
  const seasonYear = now.getMonth() < 7 ? now.getFullYear() - 1 : now.getFullYear();
  return `${seasonYear}-11-01`;
})();

// Light delay between ESPN API calls to avoid throttling during backfill
const _sleep = ms => new Promise(r => setTimeout(r, ms));

async function ncaaAutoSync(onProgress) {
  onProgress?.("🏀 Syncing NCAA…");
  const today = new Date().toISOString().split("T")[0];

  // Load all existing records so we can skip already-saved games
  const existing = await supabaseQuery(
    `/ncaa_predictions?select=id,game_date,home_team_id,away_team_id,result_entered,game_id&order=game_date.asc&limit=10000`
  );
  const savedKeys = new Set((existing || []).map(r => r.game_id || `${r.game_date}|${r.home_team_id}|${r.away_team_id}`));

  // Fill in any results that came in since last sync
  const pendingResults = (existing || []).filter(r => !r.result_entered);
  if (pendingResults.length) {
    const filled = await ncaaFillFinalScores(pendingResults);
    if (filled) onProgress?.(`🏀 ${filled} NCAA result(s) recorded`);
  }

  // Build full date list from season start → today
  const allDates = [];
  const cur = new Date(_ncaaSeasonStart);
  const todayDate = new Date(today);
  while (cur <= todayDate) {
    allDates.push(cur.toISOString().split("T")[0]);
    cur.setDate(cur.getDate() + 1);
  }

  // Fetch live odds once for today — used to store market spread/total on new predictions
  const todayOdds = await fetchOdds("basketball_ncaab");
  const todayOddsGames = todayOdds?.games || [];

  let newPred = 0;
  let datesChecked = 0;

  for (const dateStr of allDates) {
    const games = await fetchNCAAGamesForDate(dateStr);
    datesChecked++;

    // Progress update every 14 days
    if (datesChecked % 14 === 0) {
      onProgress?.(`🏀 Scanning ${dateStr} (${datesChecked}/${allDates.length})… ${newPred} new`);
    }

    if (!games.length) {
      await _sleep(80); // short pause on empty dates too
      continue;
    }

    const unsaved = games.filter(g =>
      !savedKeys.has(g.gameId || `${dateStr}|${g.homeTeamId}|${g.awayTeamId}`)
    );
    if (!unsaved.length) { await _sleep(80); continue; }

    // For today's games, attach live odds so market spread/total get stored
    const isToday = dateStr === today;
    const rows = (await Promise.all(unsaved.map(g => {
      const gameOdds = isToday
        ? (todayOddsGames.find(o => matchNCAAOddsToGame(o, g)) || null)
        : null;
      return ncaaBuildPredictionRow(g, dateStr, gameOdds);
    }))).filter(Boolean);

    if (rows.length) {
      await supabaseQuery("/ncaa_predictions", "UPSERT", rows, "game_id");
      newPred += rows.length;
      // Immediately try to fill final scores for this date
      const ns = await supabaseQuery(
        `/ncaa_predictions?game_date=eq.${dateStr}&result_entered=eq.false&select=id,game_id,home_team_id,away_team_id,ou_total,market_ou_total,market_spread_home,result_entered,game_date,win_pct_home,spread_home,pred_home_score,pred_away_score`
      );
      if (ns?.length) await ncaaFillFinalScores(ns);
      // Update savedKeys so subsequent iterations skip these
      rows.forEach(r => savedKeys.add(r.game_id || `${dateStr}|${r.home_team_id}|${r.away_team_id}`));
    }

    // Throttle to ~250ms per date with games — keeps ESPN happy
    await _sleep(250);
  }

  onProgress?.(newPred ? `🏀 NCAA sync complete — ${newPred} new predictions` : "🏀 NCAA up to date");
}

// Full backfill: same as autoSync but with a visible progress callback
// and a longer throttle so it can run in the background without hammering ESPN
async function ncaaFullBackfill(onProgress, signal) {
  onProgress?.("🏀 Starting full NCAA season backfill…");
  const today = new Date().toISOString().split("T")[0];

  const existing = await supabaseQuery(
    `/ncaa_predictions?select=id,game_date,home_team_id,away_team_id,result_entered,game_id&order=game_date.asc&limit=10000`
  );
  const savedKeys = new Set((existing || []).map(r => r.game_id || `${r.game_date}|${r.home_team_id}|${r.away_team_id}`));

  // Fetch today's live odds once for attaching to today's new predictions
  const backfillTodayOdds = (await fetchOdds("basketball_ncaab"))?.games || [];

  // Fill pending results first
  const pendingResults = (existing || []).filter(r => !r.result_entered);
  if (pendingResults.length) {
    onProgress?.(`🏀 Grading ${pendingResults.length} pending result(s)…`);
    const filled = await ncaaFillFinalScores(pendingResults);
    if (filled) onProgress?.(`🏀 ${filled} result(s) recorded`);
  }

  const allDates = [];
  const cur = new Date(_ncaaSeasonStart);
  while (cur.toISOString().split("T")[0] <= today) {
    allDates.push(cur.toISOString().split("T")[0]);
    cur.setDate(cur.getDate() + 1);
  }

  let newPred = 0, skipped = 0, errors = 0;

  for (let i = 0; i < allDates.length; i++) {
    // Allow caller to cancel via AbortSignal
    if (signal?.aborted) { onProgress?.("🏀 Backfill cancelled"); return; }

    const dateStr = allDates[i];
    onProgress?.(`🏀 [${i + 1}/${allDates.length}] ${dateStr} — ${newPred} saved so far`);

    let games;
    try {
      games = await fetchNCAAGamesForDate(dateStr);
    } catch (e) {
      errors++;
      await _sleep(1000); // back off on fetch error
      continue;
    }

    if (!games.length) { await _sleep(120); continue; }

    const unsaved = games.filter(g =>
      !savedKeys.has(g.gameId || `${dateStr}|${g.homeTeamId}|${g.awayTeamId}`)
    );
    skipped += games.length - unsaved.length;
    if (!unsaved.length) { await _sleep(120); continue; }

    let rows;
    try {
      // Attach live odds for today's games only
      rows = (await Promise.all(unsaved.map(g => {
        const gameOdds = (dateStr === today && backfillTodayOdds)
          ? (backfillTodayOdds.find(o => matchNCAAOddsToGame(o, g)) || null)
          : null;
        return ncaaBuildPredictionRow(g, dateStr, gameOdds);
      }))).filter(Boolean);
    } catch (e) {
      errors++;
      await _sleep(500);
      continue;
    }

    if (rows.length) {
      await supabaseQuery("/ncaa_predictions", "UPSERT", rows, "game_id");
      newPred += rows.length;
      const ns = await supabaseQuery(
        `/ncaa_predictions?game_date=eq.${dateStr}&result_entered=eq.false&select=id,game_id,home_team_id,away_team_id,ou_total,market_ou_total,market_spread_home,result_entered,game_date,win_pct_home,spread_home,pred_home_score,pred_away_score`
      );
      if (ns?.length) await ncaaFillFinalScores(ns);
      rows.forEach(r => savedKeys.add(r.game_id || `${dateStr}|${r.home_team_id}|${r.away_team_id}`));
    }

    // 400ms between dates during full backfill — respectful to ESPN API
    await _sleep(400);
  }

  onProgress?.(
    `✅ NCAA backfill complete — ${newPred} new, ${skipped} already saved, ${errors} errors`
  );
}

function matchNCAAOddsToGame(oddsGame, schedGame) {
  if (!oddsGame || !schedGame) return false;
  const norm = s => (s || "").toLowerCase().replace(/[\s\W]/g, "");
  const hName = norm(schedGame.homeTeamName || "");
  const aName = norm(schedGame.awayTeamName || "");
  const oHome = norm(oddsGame.homeTeam || "");
  const oAway = norm(oddsGame.awayTeam || "");
  return (oHome.includes(hName.slice(0, 6)) || hName.includes(oHome.slice(0, 6))) &&
    (oAway.includes(aName.slice(0, 6)) || aName.includes(oAway.slice(0, 6)));
}

// ═══════════════════════════════════════════════════════════════
// 🏀 NBA ENGINE
// ═══════════════════════════════════════════════════════════════

const NBA_TEAMS_LIST = [
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

const NBA_ESPN_IDS = {
  ATL:1,BOS:2,BKN:17,CHA:30,CHI:4,CLE:5,DAL:6,DEN:7,DET:8,GSW:9,
  HOU:10,IND:11,LAC:12,LAL:13,MEM:29,MIA:14,MIL:15,MIN:16,NOP:3,NYK:18,
  OKC:25,ORL:19,PHI:20,PHX:21,POR:22,SAC:23,SAS:24,TOR:28,UTA:26,WAS:27,
};

const NBA_TEAM_COLORS = {
  ATL:"#E03A3E",BOS:"#007A33",BKN:"#000",CHA:"#1D1160",CHI:"#CE1141",
  CLE:"#860038",DAL:"#00538C",DEN:"#0E2240",DET:"#C8102E",GSW:"#1D428A",
  HOU:"#CE1141",IND:"#002D62",LAC:"#C8102E",LAL:"#552583",MEM:"#5D76A9",
  MIA:"#98002E",MIL:"#00471B",MIN:"#0C2340",NOP:"#0C2340",NYK:"#006BB6",
  OKC:"#007AC1",ORL:"#0077C0",PHI:"#006BB6",PHX:"#1D1160",POR:"#E03A3E",
  SAC:"#5A2D81",SAS:"#C4CED4",TOR:"#CE1141",UTA:"#002B5C",WAS:"#002B5C",
};

const _nbaStatsCache = {};

async function fetchNBATeamStats(abbr) {
  if (_nbaStatsCache[abbr]) return _nbaStatsCache[abbr];
  const espnId = NBA_ESPN_IDS[abbr];
  if (!espnId) return null;
  try {
    const [teamData, statsData, schedData] = await Promise.all([
      fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${espnId}`).then(r=>r.ok?r.json():null).catch(()=>null),
      fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${espnId}/statistics`).then(r=>r.ok?r.json():null).catch(()=>null),
      fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${espnId}/schedule`).then(r=>r.ok?r.json():null).catch(()=>null),
    ]);
    const stats = statsData?.results?.stats?.categories || [];
    const getStat = (...names) => {
      for (const cat of stats) for (const name of names) {
        const s = cat.stats?.find(s => s.name===name||s.displayName===name);
        if (s) return parseFloat(s.value)||null;
      }
      return null;
    };
    const ppg = getStat("avgPoints","pointsPerGame") || 112.0;
    const oppPpg = getStat("avgPointsAllowed","opponentPointsPerGame") || 112.0;
    const estPace = 96 + (ppg-110)*0.3;
    const pace = Math.max(92,Math.min(105,estPace));
    const adjOE = (ppg/pace)*100, adjDE = (oppPpg/pace)*100;
    let formScore=0, wins=0, losses=0;
    try {
      const events = schedData?.events||[];
      const completed = events.filter(e=>e.competitions?.[0]?.status?.type?.completed);
      wins = completed.filter(e=>e.competitions?.[0]?.competitors?.find(c=>c.team?.id===String(espnId))?.winner).length;
      losses = completed.length - wins;
      formScore = completed.slice(-5).reduce((s,e,i)=>{
        const comp=e.competitions?.[0];
        const tc=comp?.competitors?.find(c=>c.team?.id===String(espnId));
        return s+((tc?.winner||false)?1:-0.6)*(i+1);
      },0)/15;
    } catch {}
    const result = { abbr, espnId, name:teamData?.team?.displayName||abbr, ppg, oppPpg, pace, adjOE, adjDE, netRtg:adjOE-adjDE, formScore, wins, losses, totalGames:wins+losses };
    _nbaStatsCache[abbr]=result;
    return result;
  } catch(e) { console.warn("fetchNBATeamStats:",abbr,e); return null; }
}

async function fetchNBAGamesForDate(dateStr) {
  try {
    const compact = dateStr.replace(/-/g,"");
    const data = await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${compact}&limit=50`).then(r=>r.ok?r.json():null).catch(()=>null);
    if (!data?.events) return [];
    const mapAbbr = a => ({"GS":"GSW","NY":"NYK","NO":"NOP","SA":"SAS"}[a]||a);
    return data.events.map(ev=>{
      const comp=ev.competitions?.[0];
      const home=comp?.competitors?.find(c=>c.homeAway==="home");
      const away=comp?.competitors?.find(c=>c.homeAway==="away");
      const status=comp?.status?.type;
      return { gameId:ev.id, gameDate:ev.date, status:status?.completed?"Final":status?.state==="in"?"Live":"Preview",
        homeAbbr:mapAbbr(home?.team?.abbreviation||""), awayAbbr:mapAbbr(away?.team?.abbreviation||""),
        homeTeamName:home?.team?.displayName, awayTeamName:away?.team?.displayName,
        homeScore:status?.completed?parseInt(home?.score):null, awayScore:status?.completed?parseInt(away?.score):null, neutralSite:comp?.neutralSite||false };
    }).filter(g=>g.homeAbbr&&g.awayAbbr);
  } catch(e) { console.warn("fetchNBAGamesForDate:",dateStr,e); return []; }
}

function nbaPredictGame({ homeStats, awayStats, neutralSite=false, homeDaysRest=2, awayDaysRest=2, calibrationFactor=1.0 }) {
  if (!homeStats||!awayStats) return null;
  const poss = (homeStats.pace+awayStats.pace)/2;
  const lgAvg = 112.0;
  let homeScore = ((homeStats.adjOE/lgAvg)*(lgAvg/awayStats.adjDE)*lgAvg/100)*poss;
  let awayScore = ((awayStats.adjOE/lgAvg)*(lgAvg/homeStats.adjDE)*lgAvg/100)*poss;
  homeScore += (neutralSite?0:2.8)/2; awayScore -= (neutralSite?0:2.8)/2;
  if (homeDaysRest===0){homeScore-=1.6;awayScore+=1.6;} if(awayDaysRest===0){awayScore-=1.6;homeScore+=1.6;}
  else if(homeDaysRest-awayDaysRest>=2) homeScore+=1.5; else if(awayDaysRest-homeDaysRest>=2) awayScore+=1.5;
  const fw=Math.min(0.10,0.10*Math.sqrt(Math.min(homeStats.totalGames,30)/30));
  homeScore+=homeStats.formScore*fw*3; awayScore+=awayStats.formScore*fw*3;
  homeScore=Math.max(85,Math.min(145,homeScore)); awayScore=Math.max(85,Math.min(145,awayScore));
  const spread=parseFloat((homeScore-awayScore).toFixed(1));
  let hwp=1/(1+Math.pow(10,-spread/12));
  hwp=Math.min(0.92,Math.max(0.08,hwp));
  if(calibrationFactor!==1.0) hwp=Math.min(0.92,Math.max(0.08,0.5+(hwp-0.5)*calibrationFactor));
  const mml=hwp>=0.5?-Math.round((hwp/(1-hwp))*100):+Math.round(((1-hwp)/hwp)*100);
  const aml=hwp>=0.5?+Math.round(((1-hwp)/hwp)*100):-Math.round((hwp/(1-hwp))*100);
  const gap=Math.abs(homeStats.netRtg-awayStats.netRtg);
  const cs=Math.round((Math.min(gap,8)/8)*40+Math.abs(hwp-0.5)*2*35+Math.min(1,homeStats.totalGames/20)*20+(homeStats.totalGames>=10?5:0));
  return { homeScore:parseFloat(homeScore.toFixed(1)), awayScore:parseFloat(awayScore.toFixed(1)), homeWinPct:hwp, awayWinPct:1-hwp,
    projectedSpread:spread, ouTotal:parseFloat((homeScore+awayScore).toFixed(1)), modelML_home:mml, modelML_away:aml,
    confidence:cs>=62?"HIGH":cs>=35?"MEDIUM":"LOW", confScore:cs,
    possessions:parseFloat(poss.toFixed(1)), homeNetRtg:parseFloat(homeStats.netRtg?.toFixed(2)), awayNetRtg:parseFloat(awayStats.netRtg?.toFixed(2)), neutralSite };
}

function matchNBAOddsToGame(o,g) {
  if(!o||!g) return false;
  const n=s=>(s||"").toLowerCase().replace(/[\s\W]/g,"");
  return (n(o.homeTeam).includes(n(g.homeTeamName||"").slice(0,6))||n(g.homeTeamName||"").includes(n(o.homeTeam).slice(0,6)))&&
         (n(o.awayTeam).includes(n(g.awayTeamName||"").slice(0,6))||n(g.awayTeamName||"").includes(n(o.awayTeam).slice(0,6)));
}

async function nbaFillFinalScores(pendingRows) {
  if(!pendingRows.length) return 0;
  let filled=0;
  const byDate={};
  for(const r of pendingRows){if(!byDate[r.game_date])byDate[r.game_date]=[];byDate[r.game_date].push(r);}
  for(const [dateStr,rows] of Object.entries(byDate)){
    try{
      const games=await fetchNBAGamesForDate(dateStr);
      for(const g of games){
        if(g.status!=="Final"||g.homeScore===null) continue;
        const row=rows.find(r=>(r.game_id&&r.game_id===g.gameId)||(r.home_team===g.homeAbbr&&r.away_team===g.awayAbbr));
        if(!row) continue;
        const hW=g.homeScore>g.awayScore, mH=(row.win_pct_home??0.5)>=0.5, ml=mH?hW:!hW;
        const margin=g.homeScore-g.awayScore, mktSpr=row.market_spread_home??null;
        let rl=null;
        if(mktSpr!==null){if(margin>mktSpr)rl=true;else if(margin<mktSpr)rl=false;}
        else{const ps=row.spread_home||0;if(margin===0)rl=null;else if(margin>0&&ps>0)rl=true;else if(margin<0&&ps<0)rl=true;else rl=false;}
        const total=g.homeScore+g.awayScore, ouL=row.market_ou_total??row.ou_total??null;
        const predT=(row.pred_home_score??0)+(row.pred_away_score??0);
        let ou=null;
        if(ouL!==null&&total!==ouL) ou=((total>ouL)===(predT>ouL))?"OVER":"UNDER";
        else if(ouL!==null&&total===ouL) ou="PUSH";
        await supabaseQuery(`/nba_predictions?id=eq.${row.id}`,"PATCH",{actual_home_score:g.homeScore,actual_away_score:g.awayScore,result_entered:true,ml_correct:ml,rl_correct:rl,ou_correct:ou});
        filled++;
      }
    }catch(e){console.warn("nbaFillFinalScores:",dateStr,e);}
  }
  return filled;
}

const _nbaSeason=(()=>{const n=new Date();return `${n.getMonth()<7?n.getFullYear()-1:n.getFullYear()}-10-01`;})();

async function nbaAutoSync(onProgress) {
  onProgress?.("🏀 Syncing NBA…");
  const today=new Date().toISOString().split("T")[0];
  const existing=await supabaseQuery(`/nba_predictions?select=id,game_date,home_team,away_team,result_entered,game_id&order=game_date.asc&limit=10000`);
  const savedKeys=new Set((existing||[]).map(r=>r.game_id||`${r.game_date}|${r.home_team}|${r.away_team}`));
  const pending=(existing||[]).filter(r=>!r.result_entered);
  if(pending.length){const f=await nbaFillFinalScores(pending);if(f)onProgress?.(`🏀 ${f} NBA result(s) recorded`);}
  const allDates=[]; const cur=new Date(_nbaSeason);
  while(cur.toISOString().split("T")[0]<=today){allDates.push(cur.toISOString().split("T")[0]);cur.setDate(cur.getDate()+1);}
  const todayOdds=(await fetchOdds("basketball_nba"))?.games||[];
  let newPred=0;
  for(const dateStr of allDates){
    const games=await fetchNBAGamesForDate(dateStr);
    if(!games.length){await _sleep(50);continue;}
    const unsaved=games.filter(g=>!savedKeys.has(g.gameId||`${dateStr}|${g.homeAbbr}|${g.awayAbbr}`));
    if(!unsaved.length){await _sleep(50);continue;}
    const isToday=dateStr===today;
    const rows=(await Promise.all(unsaved.map(async g=>{
      const [hs,as_]=await Promise.all([fetchNBATeamStats(g.homeAbbr),fetchNBATeamStats(g.awayAbbr)]);
      if(!hs||!as_) return null;
      const pred=nbaPredictGame({homeStats:hs,awayStats:as_,neutralSite:g.neutralSite});
      if(!pred) return null;
      const odds=isToday?(todayOdds.find(o=>matchNBAOddsToGame(o,g))||null):null;
      return {game_date:dateStr,game_id:g.gameId,home_team:g.homeAbbr,away_team:g.awayAbbr,home_team_name:g.homeTeamName,away_team_name:g.awayTeamName,
        model_ml_home:pred.modelML_home,model_ml_away:pred.modelML_away,spread_home:pred.projectedSpread,ou_total:pred.ouTotal,
        win_pct_home:parseFloat(pred.homeWinPct.toFixed(4)),confidence:pred.confidence,pred_home_score:pred.homeScore,pred_away_score:pred.awayScore,
        home_net_rtg:pred.homeNetRtg,away_net_rtg:pred.awayNetRtg,
        ...(odds?.marketSpreadHome!=null&&{market_spread_home:odds.marketSpreadHome}),
        ...(odds?.marketTotal!=null&&{market_ou_total:odds.marketTotal})};
    }))).filter(Boolean);
    if(rows.length){
      await supabaseQuery("/nba_predictions","UPSERT",rows,"game_id");
      newPred+=rows.length;
      const ns=await supabaseQuery(`/nba_predictions?game_date=eq.${dateStr}&result_entered=eq.false&select=id,game_id,home_team,away_team,ou_total,market_ou_total,market_spread_home,result_entered,game_date,win_pct_home,spread_home,pred_home_score,pred_away_score`);
      if(ns?.length) await nbaFillFinalScores(ns);
      rows.forEach(r=>savedKeys.add(r.game_id||`${dateStr}|${r.home_team}|${r.away_team}`));
    }
    await _sleep(150);
  }
  onProgress?.(newPred?`🏀 NBA sync complete — ${newPred} new`:"🏀 NBA up to date");
}

// ═══════════════════════════════════════════════════════════════
// 🏈 NFL ENGINE — v3 model ported to React/Supabase
// Factors: EPA/play, turnover margin, red zone, third down,
//          weather, dome, rest/bye week, home field, form
// ═══════════════════════════════════════════════════════════════

const NFL_TEAMS = [
  {abbr:"ARI",name:"Arizona Cardinals",  espnId:22,conf:"NFC",div:"West", color:"#97233F"},
  {abbr:"ATL",name:"Atlanta Falcons",    espnId:1, conf:"NFC",div:"South",color:"#A71930"},
  {abbr:"BAL",name:"Baltimore Ravens",   espnId:33,conf:"AFC",div:"North",color:"#241773"},
  {abbr:"BUF",name:"Buffalo Bills",      espnId:2, conf:"AFC",div:"East", color:"#00338D"},
  {abbr:"CAR",name:"Carolina Panthers",  espnId:29,conf:"NFC",div:"South",color:"#0085CA"},
  {abbr:"CHI",name:"Chicago Bears",      espnId:3, conf:"NFC",div:"North",color:"#0B162A"},
  {abbr:"CIN",name:"Cincinnati Bengals", espnId:4, conf:"AFC",div:"North",color:"#FB4F14"},
  {abbr:"CLE",name:"Cleveland Browns",   espnId:5, conf:"AFC",div:"North",color:"#311D00"},
  {abbr:"DAL",name:"Dallas Cowboys",     espnId:6, conf:"NFC",div:"East", color:"#003594"},
  {abbr:"DEN",name:"Denver Broncos",     espnId:7, conf:"AFC",div:"West", color:"#FB4F14"},
  {abbr:"DET",name:"Detroit Lions",      espnId:8, conf:"NFC",div:"North",color:"#0076B6"},
  {abbr:"GB", name:"Green Bay Packers",  espnId:9, conf:"NFC",div:"North",color:"#203731"},
  {abbr:"HOU",name:"Houston Texans",     espnId:34,conf:"AFC",div:"South",color:"#03202F"},
  {abbr:"IND",name:"Indianapolis Colts", espnId:11,conf:"AFC",div:"South",color:"#002C5F"},
  {abbr:"JAC",name:"Jacksonville Jaguars",espnId:30,conf:"AFC",div:"South",color:"#006778"},
  {abbr:"KC", name:"Kansas City Chiefs", espnId:12,conf:"AFC",div:"West", color:"#E31837"},
  {abbr:"LV", name:"Las Vegas Raiders",  espnId:13,conf:"AFC",div:"West", color:"#000000"},
  {abbr:"LAC",name:"LA Chargers",        espnId:24,conf:"AFC",div:"West", color:"#0080C6"},
  {abbr:"LAR",name:"LA Rams",            espnId:14,conf:"NFC",div:"West", color:"#003594"},
  {abbr:"MIA",name:"Miami Dolphins",     espnId:15,conf:"AFC",div:"East", color:"#008E97"},
  {abbr:"MIN",name:"Minnesota Vikings",  espnId:16,conf:"NFC",div:"North",color:"#4F2683"},
  {abbr:"NE", name:"New England Patriots",espnId:17,conf:"AFC",div:"East",color:"#002244"},
  {abbr:"NO", name:"New Orleans Saints", espnId:18,conf:"NFC",div:"South",color:"#D3BC8D"},
  {abbr:"NYG",name:"NY Giants",          espnId:19,conf:"NFC",div:"East", color:"#0B2265"},
  {abbr:"NYJ",name:"NY Jets",            espnId:20,conf:"AFC",div:"East", color:"#125740"},
  {abbr:"PHI",name:"Philadelphia Eagles",espnId:21,conf:"NFC",div:"East", color:"#004C54"},
  {abbr:"PIT",name:"Pittsburgh Steelers",espnId:23,conf:"AFC",div:"North",color:"#FFB612"},
  {abbr:"SF", name:"San Francisco 49ers",espnId:25,conf:"NFC",div:"West", color:"#AA0000"},
  {abbr:"SEA",name:"Seattle Seahawks",   espnId:26,conf:"NFC",div:"West", color:"#002244"},
  {abbr:"TB", name:"Tampa Bay Buccaneers",espnId:27,conf:"NFC",div:"South",color:"#D50A0A"},
  {abbr:"TEN",name:"Tennessee Titans",   espnId:10,conf:"AFC",div:"South",color:"#0C2340"},
  {abbr:"WSH",name:"Washington Commanders",espnId:28,conf:"NFC",div:"East",color:"#5A1414"},
];

const nflTeamByAbbr = a => NFL_TEAMS.find(t=>t.abbr===a)||{abbr:a,name:a,espnId:null,color:"#444"};
const NFL_ABBR_MAP = {"WAS":"WSH","JAX":"JAC","LVR":"LV","LA":"LAR"};
const normNFLAbbr = a => NFL_ABBR_MAP[a]||a;

// Dome + altitude stadium factors
const NFL_STADIUM = {
  ARI:{dome:true,alt:1.0},ATL:{dome:true,alt:1.0},BAL:{dome:false,alt:1.0},BUF:{dome:false,alt:0.98},
  CAR:{dome:false,alt:1.0},CHI:{dome:false,alt:0.99},CIN:{dome:false,alt:1.0},CLE:{dome:false,alt:0.98},
  DAL:{dome:true,alt:1.0},DEN:{dome:false,alt:1.04},DET:{dome:true,alt:1.0},GB:{dome:false,alt:0.97},
  HOU:{dome:true,alt:1.0},IND:{dome:true,alt:1.0},JAC:{dome:false,alt:1.01},KC:{dome:false,alt:1.0},
  LV:{dome:true,alt:1.0},LAC:{dome:false,alt:1.0},LAR:{dome:true,alt:1.0},MIA:{dome:false,alt:1.01},
  MIN:{dome:true,alt:1.0},NE:{dome:false,alt:0.98},NO:{dome:true,alt:1.0},NYG:{dome:false,alt:1.0},
  NYJ:{dome:false,alt:1.0},PHI:{dome:false,alt:1.0},PIT:{dome:false,alt:0.99},SF:{dome:false,alt:1.0},
  SEA:{dome:false,alt:1.02},TB:{dome:false,alt:1.01},TEN:{dome:false,alt:1.0},WSH:{dome:false,alt:1.0},
};

const _nflStatsCache = {};

async function fetchNFLTeamStats(abbr) {
  if (_nflStatsCache[abbr]) return _nflStatsCache[abbr];
  const team = nflTeamByAbbr(abbr);
  if (!team?.espnId) return null;
  try {
    const [statsData, schedData] = await Promise.all([
      fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${team.espnId}/statistics`)
        .then(r=>r.ok?r.json():null).catch(()=>null),
      fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${team.espnId}/schedule`)
        .then(r=>r.ok?r.json():null).catch(()=>null),
    ]);

    // ESPN NFL stats have nested categories — try multiple stat name variants
    const cats = statsData?.results?.stats?.categories || statsData?.splits?.categories || [];
    const getStat = (...names) => {
      for (const cat of cats) for (const name of names) {
        const s = cat.stats?.find(s=>s.name===name||s.abbreviation===name||s.displayName?.toLowerCase()===name.toLowerCase());
        if (s) return parseFloat(s.value)||null;
      }
      return null;
    };

    const ppg        = getStat("avgPoints","pointsPerGame","scoringAverage") || 22.5;
    const oppPpg     = getStat("avgPointsAllowed","opponentPointsPerGame","pointsAgainstAverage") || 22.5;
    const ypPlay     = getStat("yardsPerPlay","totalYardsPerPlay","offensiveYardsPerPlay") || 5.5;
    const oppYpPlay  = getStat("opponentYardsPerPlay","yardsPerPlayAllowed","defensiveYardsPerPlay") || 5.5;
    const thirdPct   = getStat("thirdDownPct","thirdDownConversionPct","thirdDownEfficiency") || 0.40;
    const rzPct      = getStat("redZonePct","redZoneScoringPct","redZoneEfficiency") || 0.55;
    const qbRating   = getStat("passerRating","totalQBRating","netPasserRating") || 85.0;
    const rushYpc    = getStat("rushingYardsPerAttempt","yardsPerRushAttempt","rushingYardsPerCarry") || 4.2;
    const sacks      = getStat("sacks","totalSacks","defensiveSacks") || 2.0;
    const sacksAllowed = getStat("sacksAllowed","qbSacksAllowed","offensiveSacksAllowed") || 2.0;
    const turnoversLost   = getStat("turnovers","totalTurnovers","offensiveTurnovers") || 1.5;
    const turnoversForced = getStat("defensiveTurnovers","takeaways","totalTakeaways") || 1.5;

    // EPA proxy from scoring + efficiency differentials (calibrated to ~0.05–0.15 range)
    const lgPpg=22.5, lgYpp=5.5;
    const offEPA = ((ppg-lgPpg)/lgPpg)*0.08 + ((ypPlay-lgYpp)/lgYpp)*0.06 + ((thirdPct-0.40)/0.40)*0.04 + ((rzPct-0.55)/0.55)*0.03;
    const defEPA = ((lgPpg-oppPpg)/lgPpg)*0.08 + ((lgYpp-oppYpPlay)/lgYpp)*0.06 + (sacks-2.0)*0.004;

    // Recent form — last 5 results with margin weighting
    let formScore=0, wins=0, losses=0;
    try {
      const events = schedData?.events||[];
      const completed = events.filter(e=>e.competitions?.[0]?.status?.type?.completed);
      completed.forEach(e=>{
        const comp=e.competitions?.[0];
        const tc=comp?.competitors?.find(c=>c.team?.id===String(team.espnId));
        if(tc?.winner) wins++; else losses++;
      });
      formScore = completed.slice(-5).reduce((s,e,i)=>{
        const comp=e.competitions?.[0];
        const tc=comp?.competitors?.find(c=>c.team?.id===String(team.espnId));
        const won=tc?.winner||false;
        const myScore=parseInt(tc?.score)||0;
        const oppScore=parseInt(comp?.competitors?.find(c=>c.team?.id!==String(team.espnId))?.score)||0;
        const margin=myScore-oppScore;
        return s+(won?1+Math.min(margin/21,0.5):-0.6-Math.min(Math.abs(margin)/21,0.4))*(i+1);
      },0)/15;
    } catch {}

    const result = {
      abbr, name:team.name, espnId:team.espnId,
      ppg, oppPpg, ypPlay, oppYpPlay, thirdPct, rzPct, qbRating, rushYpc,
      sacks, sacksAllowed, turnoversLost, turnoversForced,
      turnoverMargin: turnoversForced-turnoversLost,
      offEPA, defEPA, netEPA: offEPA+defEPA,
      formScore, wins, losses, totalGames: wins+losses,
    };
    _nflStatsCache[abbr] = result;
    return result;
  } catch(e) { console.warn("fetchNFLTeamStats:",abbr,e); return null; }
}

async function fetchNFLGamesForDate(dateStr) {
  try {
    const compact = dateStr.replace(/-/g,"");
    const data = await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${compact}&limit=20`)
      .then(r=>r.ok?r.json():null).catch(()=>null);
    if (!data?.events) return [];
    return data.events.map(ev=>{
      const comp=ev.competitions?.[0];
      const home=comp?.competitors?.find(c=>c.homeAway==="home");
      const away=comp?.competitors?.find(c=>c.homeAway==="away");
      const status=comp?.status?.type;
      const wx=comp?.weather;
      return {
        gameId:ev.id, gameDate:ev.date,
        status:status?.completed?"Final":status?.state==="in"?"Live":"Preview",
        homeAbbr:normNFLAbbr(home?.team?.abbreviation||""),
        awayAbbr:normNFLAbbr(away?.team?.abbreviation||""),
        homeTeamName:home?.team?.displayName, awayTeamName:away?.team?.displayName,
        homeScore:status?.completed?parseInt(home?.score):null,
        awayScore:status?.completed?parseInt(away?.score):null,
        week:ev.week?.number||null, season:ev.season?.year||new Date().getFullYear(),
        neutralSite:comp?.neutralSite||false,
        weather:{ desc:wx?.displayValue||null, temp:wx?.temperature||null, wind:parseInt(wx?.wind)||0 },
      };
    }).filter(g=>g.homeAbbr&&g.awayAbbr);
  } catch(e) { console.warn("fetchNFLGamesForDate:",dateStr,e); return []; }
}

// Weather adjustment — cold temps + high wind kill scoring
function nflWeatherAdj(wx) {
  if (!wx) return { pts:0, note:null };
  const temp = wx.temp||65, wind = wx.wind||0;
  let pts=0, notes=[];
  if (temp<25) { pts-=4.5; notes.push(`❄ ${temp}°F`); }
  else if (temp<32) { pts-=3.0; notes.push(`🥶 ${temp}°F`); }
  else if (temp<40) { pts-=1.5; notes.push(`🥶 ${temp}°F`); }
  if (wind>25) { pts-=3.5; notes.push(`💨 ${wind}mph`); }
  else if (wind>20) { pts-=2.5; notes.push(`💨 ${wind}mph`); }
  else if (wind>15) { pts-=1.5; notes.push(`💨 ${wind}mph`); }
  return { pts, note: notes.join(" ") || null };
}

function nflPredictGame({ homeStats, awayStats, neutralSite=false, weather={}, homeRestDays=7, awayRestDays=7, calibrationFactor=1.0 }) {
  if (!homeStats||!awayStats) return null;
  const lgPpg=22.5;

  // 1. Base scoring from offensive vs defensive matchup
  const homeOff = (homeStats.ppg-lgPpg)/6;   // +1 per 6ppg above avg
  const awayDef = (awayStats.oppPpg-lgPpg)/6; // positive = leaky defense
  const awayOff = (awayStats.ppg-lgPpg)/6;
  const homeDef = (homeStats.oppPpg-lgPpg)/6;
  let homeScore = lgPpg + homeOff*3 + awayDef*2;
  let awayScore = lgPpg + awayOff*3 + homeDef*2;

  // 2. EPA overlay — efficiency signal
  homeScore += homeStats.offEPA*12 + awayStats.defEPA*10;
  awayScore += awayStats.offEPA*12 + homeStats.defEPA*10;

  // 3. Turnover margin (~3.5 pts per turnover swing in NFL)
  const toAdj = (homeStats.turnoverMargin - awayStats.turnoverMargin) * 1.75;
  homeScore += toAdj*0.5; awayScore -= toAdj*0.5;

  // 4. Third down efficiency
  const tdAdj = (homeStats.thirdPct - awayStats.thirdPct) * 18;
  homeScore += tdAdj*0.25; awayScore -= tdAdj*0.1;

  // 5. Red zone — scoring efficiency differential
  const rzAdj = (homeStats.rzPct - awayStats.rzPct) * 12;
  homeScore += rzAdj*0.25; awayScore -= rzAdj*0.1;

  // 6. Pass rush / sack rate
  const sackAdj = (homeStats.sacks - awayStats.sacksAllowed)*0.5;
  homeScore += sackAdj*0.15; awayScore -= sackAdj*0.15;

  // 7. Yards per play differential
  const yppAdj = (homeStats.ypPlay - awayStats.oppYpPlay)*1.8;
  homeScore += yppAdj*0.2; awayScore -= yppAdj*0.1;

  // 8. Recent form
  const fw = Math.min(0.12,0.12*Math.sqrt(Math.min(homeStats.totalGames,17)/17));
  homeScore += homeStats.formScore*fw*5; awayScore += awayStats.formScore*fw*5;

  // 9. Home field advantage (2.5pts, disabled on neutral)
  if (!neutralSite) { homeScore+=1.25; awayScore-=1.25; }

  // 10. Rest / bye week
  if (homeRestDays>=10) homeScore+=2.0; // bye week
  if (awayRestDays>=10) awayScore+=2.0;
  else if (homeRestDays-awayRestDays>=3) homeScore+=0.8;
  else if (awayRestDays-homeRestDays>=3) awayScore+=0.8;

  // 11. Dome/altitude factor
  const sf = NFL_STADIUM[homeStats.abbr]||{dome:false,alt:1.0};
  homeScore *= sf.alt; awayScore *= sf.alt;

  // 12. Weather — reduces both teams' scoring
  const wxAdj = nflWeatherAdj(weather);
  homeScore += wxAdj.pts/2; awayScore += wxAdj.pts/2;

  homeScore = Math.max(3,Math.min(55,homeScore));
  awayScore = Math.max(3,Math.min(55,awayScore));
  const spread = parseFloat((homeScore-awayScore).toFixed(1));

  // Win probability — logistic, calibrated for NFL spread scale
  let hwp = 1/(1+Math.pow(10,-spread/10));
  hwp = Math.min(0.94,Math.max(0.06,hwp));
  if (calibrationFactor!==1.0) hwp=Math.min(0.94,Math.max(0.06,0.5+(hwp-0.5)*calibrationFactor));
  const mml=hwp>=0.5?-Math.round((hwp/(1-hwp))*100):+Math.round(((1-hwp)/hwp)*100);
  const aml=hwp>=0.5?+Math.round(((1-hwp)/hwp)*100):-Math.round((hwp/(1-hwp))*100);

  // Confidence
  const spreadSize=Math.abs(spread), wps=Math.abs(hwp-0.5)*2;
  const minG=Math.min(homeStats.totalGames,awayStats.totalGames);
  const epaQ=Math.min(1,(Math.abs(homeStats.netEPA)+Math.abs(awayStats.netEPA))/0.2);
  const cs=Math.round((Math.min(spreadSize,10)/10)*35+wps*30+Math.min(1,minG/10)*20+epaQ*10+(minG>=6?5:0));
  const confidence=cs>=62?"HIGH":cs>=35?"MEDIUM":"LOW";

  // Key factors for card display
  const factors=[];
  if(Math.abs(toAdj)>1.5) factors.push({label:"Turnover Margin",val:toAdj>0?`HOME +${toAdj.toFixed(1)}`:`AWAY +${(-toAdj).toFixed(1)}`,type:toAdj>0?"home":"away"});
  if(Math.abs(homeStats.netEPA-awayStats.netEPA)>0.04) factors.push({label:"EPA Edge",val:homeStats.netEPA>awayStats.netEPA?`HOME +${(homeStats.netEPA-awayStats.netEPA).toFixed(3)} EPA/play`:`AWAY +${(awayStats.netEPA-homeStats.netEPA).toFixed(3)} EPA/play`,type:homeStats.netEPA>awayStats.netEPA?"home":"away"});
  if(Math.abs(homeStats.formScore-awayStats.formScore)>0.15) factors.push({label:"Recent Form",val:homeStats.formScore>awayStats.formScore?"HOME hot":"AWAY hot",type:homeStats.formScore>awayStats.formScore?"home":"away"});
  if(homeRestDays>=10) factors.push({label:"Bye Week Rest",val:"HOME rested",type:"home"});
  if(awayRestDays>=10) factors.push({label:"Bye Week Rest",val:"AWAY rested",type:"away"});
  if(wxAdj.note) factors.push({label:"Weather",val:wxAdj.note,type:"neutral"});
  if(!neutralSite) factors.push({label:"Home Field",val:"+2.5 pts",type:"home"});
  if(sf.dome) factors.push({label:"Dome Advantage",val:"Indoor — no weather",type:"home"});

  return { homeScore:parseFloat(homeScore.toFixed(1)), awayScore:parseFloat(awayScore.toFixed(1)),
    homeWinPct:hwp, awayWinPct:1-hwp, projectedSpread:spread, ouTotal:parseFloat((homeScore+awayScore).toFixed(1)),
    modelML_home:mml, modelML_away:aml, confidence, confScore:cs,
    homeEPA:parseFloat(homeStats.netEPA?.toFixed(3)), awayEPA:parseFloat(awayStats.netEPA?.toFixed(3)),
    weather:wxAdj, factors, neutralSite };
}

function matchNFLOddsToGame(o,g) {
  if(!o||!g) return false;
  const n=s=>(s||"").toLowerCase().replace(/[\s\W]/g,"");
  return (n(o.homeTeam).includes(n(g.homeTeamName||"").slice(0,5))||n(g.homeTeamName||"").includes(n(o.homeTeam).slice(0,5)))&&
         (n(o.awayTeam).includes(n(g.awayTeamName||"").slice(0,5))||n(g.awayTeamName||"").includes(n(o.awayTeam).slice(0,5)));
}

async function nflFillFinalScores(pendingRows) {
  if (!pendingRows.length) return 0;
  let filled=0;
  const byDate={};
  for(const r of pendingRows){if(!byDate[r.game_date])byDate[r.game_date]=[];byDate[r.game_date].push(r);}
  for(const [dateStr,rows] of Object.entries(byDate)){
    try{
      const games=await fetchNFLGamesForDate(dateStr);
      for(const g of games){
        if(g.status!=="Final"||g.homeScore===null) continue;
        const row=rows.find(r=>(r.game_id&&r.game_id===g.gameId)||(r.home_team===g.homeAbbr&&r.away_team===g.awayAbbr));
        if(!row) continue;
        const hW=g.homeScore>g.awayScore, mH=(row.win_pct_home??0.5)>=0.5, ml=mH?hW:!hW;
        const margin=g.homeScore-g.awayScore, mktSpr=row.market_spread_home??null;
        let rl=null;
        if(mktSpr!==null){if(margin>mktSpr)rl=true;else if(margin<mktSpr)rl=false;}
        else{const ps=row.spread_home||0;if(margin===0)rl=null;else if(margin>0&&ps>0)rl=true;else if(margin<0&&ps<0)rl=true;else rl=false;}
        const total=g.homeScore+g.awayScore,ouL=row.market_ou_total??row.ou_total??null;
        const predT=(row.pred_home_score??0)+(row.pred_away_score??0);
        let ou=null;
        if(ouL!==null&&total!==ouL) ou=((total>ouL)===(predT>ouL))?"OVER":"UNDER";
        else if(ouL!==null&&total===ouL) ou="PUSH";
        await supabaseQuery(`/nfl_predictions?id=eq.${row.id}`,"PATCH",{actual_home_score:g.homeScore,actual_away_score:g.awayScore,result_entered:true,ml_correct:ml,rl_correct:rl,ou_correct:ou});
        filled++;
      }
    }catch(e){console.warn("nflFillFinalScores:",dateStr,e);}
  }
  return filled;
}

async function nflAutoSync(onProgress) {
  onProgress?.("🏈 Syncing NFL…");
  const today=new Date().toISOString().split("T")[0];
  const existing=await supabaseQuery(`/nfl_predictions?select=id,game_date,home_team,away_team,result_entered,game_id&order=game_date.asc&limit=5000`);
  const savedKeys=new Set((existing||[]).map(r=>r.game_id||`${r.game_date}|${r.home_team}|${r.away_team}`));
  const pending=(existing||[]).filter(r=>!r.result_entered);
  if(pending.length){const f=await nflFillFinalScores(pending);if(f)onProgress?.(`🏈 ${f} NFL result(s) recorded`);}
  // NFL season: weekly scans Aug–Feb
  const yr=new Date().getFullYear();
  const seasonStart=`${yr}-08-01`;
  const dates=[]; const cur=new Date(seasonStart);
  while(cur.toISOString().split("T")[0]<=today){dates.push(cur.toISOString().split("T")[0]);cur.setDate(cur.getDate()+1);}
  const todayOdds=(await fetchOdds("americanfootball_nfl"))?.games||[];
  let newPred=0;
  for(const dateStr of dates){
    const games=await fetchNFLGamesForDate(dateStr);
    if(!games.length){await _sleep(50);continue;}
    const unsaved=games.filter(g=>!savedKeys.has(g.gameId||`${dateStr}|${g.homeAbbr}|${g.awayAbbr}`));
    if(!unsaved.length){await _sleep(50);continue;}
    const isToday=dateStr===today;
    const rows=(await Promise.all(unsaved.map(async g=>{
      const [hs,as_]=await Promise.all([fetchNFLTeamStats(g.homeAbbr),fetchNFLTeamStats(g.awayAbbr)]);
      if(!hs||!as_) return null;
      const pred=nflPredictGame({homeStats:hs,awayStats:as_,neutralSite:g.neutralSite,weather:g.weather});
      if(!pred) return null;
      const odds=isToday?(todayOdds.find(o=>matchNFLOddsToGame(o,g))||null):null;
      return {game_date:dateStr,game_id:g.gameId,home_team:g.homeAbbr,away_team:g.awayAbbr,
        home_team_name:g.homeTeamName,away_team_name:g.awayTeamName,week:g.week,season:g.season,
        model_ml_home:pred.modelML_home,model_ml_away:pred.modelML_away,spread_home:pred.projectedSpread,
        ou_total:pred.ouTotal,win_pct_home:parseFloat(pred.homeWinPct.toFixed(4)),confidence:pred.confidence,
        pred_home_score:pred.homeScore,pred_away_score:pred.awayScore,
        home_epa:pred.homeEPA,away_epa:pred.awayEPA,key_factors:pred.factors,
        ...(odds?.marketSpreadHome!=null&&{market_spread_home:odds.marketSpreadHome}),
        ...(odds?.marketTotal!=null&&{market_ou_total:odds.marketTotal})};
    }))).filter(Boolean);
    if(rows.length){
      await supabaseQuery("/nfl_predictions","UPSERT",rows,"game_id");
      newPred+=rows.length;
      const ns=await supabaseQuery(`/nfl_predictions?game_date=eq.${dateStr}&result_entered=eq.false&select=id,game_id,home_team,away_team,ou_total,market_ou_total,market_spread_home,result_entered,game_date,win_pct_home,spread_home,pred_home_score,pred_away_score`);
      if(ns?.length) await nflFillFinalScores(ns);
      rows.forEach(r=>savedKeys.add(r.game_id||`${dateStr}|${r.home_team}|${r.away_team}`));
    }
    await _sleep(100);
  }
  onProgress?.(newPred?`🏈 NFL sync complete — ${newPred} new`:"🏈 NFL up to date");
}

// ═══════════════════════════════════════════════════════════════
// SHARED UI COMPONENTS
// ═══════════════════════════════════════════════════════════════

function Pill({ label, value, color, highlight }) {
  return (
    <div style={{
      textAlign: "center", minWidth: 44, position: "relative",
      background: highlight ? "rgba(46,160,67,0.15)" : "transparent",
      border: highlight ? "1px solid #2ea04355" : "1px solid transparent",
      borderRadius: 6, padding: highlight ? "2px 6px" : "0",
    }}>
      {highlight && (
        <div style={{ position: "absolute", top: -7, right: -4, fontSize: 8, background: "#2ea043",
          color: "#fff", borderRadius: 3, padding: "0 3px", fontWeight: 800, letterSpacing: 0.5, lineHeight: "14px" }}>BET</div>
      )}
      <div style={{ fontSize: 14, fontWeight: 800, color: highlight ? "#3fb950" : (color || "#e2e8f0") }}>{value}</div>
      <div style={{ fontSize: 8, color: "#484f58", letterSpacing: 1.5, textTransform: "uppercase" }}>{label}</div>
    </div>
  );
}
function Kv({ k, v }) {
  return <div style={{ padding: "8px 10px", background: "#080c10", borderRadius: 6 }}>
    <div style={{ fontSize: 9, color: "#484f58", letterSpacing: 1.5, marginBottom: 2, textTransform: "uppercase" }}>{k}</div>
    <div style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0" }}>{v ?? '—'}</div>
  </div>;
}

const C = { green: "#3fb950", yellow: "#e3b341", red: "#f85149", blue: "#58a6ff", orange: "#f97316", dim: "#484f58", muted: "#8b949e", border: "#21262d", bg: "#080c10", card: "#0d1117" };
const confColor2 = c => c === "HIGH" ? C.green : c === "MEDIUM" ? C.yellow : C.muted;

// ── ACCURACY DASHBOARD ─────────────────────────────────────────
function AccuracyDashboard({ table, refreshKey, onCalibrationChange, spreadLabel = "Run Line", isNCAA = false }) {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeSection, setActiveSection] = useState("overview");
  const [gameTypeFilter, setGameTypeFilter] = useState(table === "mlb_predictions" ? "R" : "ALL");
  const [forwardOnly, setForwardOnly] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const typeFilter = (table === "mlb_predictions" && gameTypeFilter !== "ALL") ? `&game_type=eq.${gameTypeFilter}` : "";
      const data = await supabaseQuery(`/${table}?result_entered=eq.true${typeFilter}&order=game_date.asc&limit=2000`);
      setRecords(data || []);
      setLoading(false);
    })();
  }, [refreshKey, gameTypeFilter, table]);

  // forwardOnly filters to games on/after NCAA_LIVE_CUTOFF — these used real-time stats
  const filteredRecords = useMemo(() => {
    if (!isNCAA || !forwardOnly) return records;
    return records.filter(r => r.game_date >= NCAA_LIVE_CUTOFF);
  }, [records, forwardOnly, isNCAA]);
  const acc = useMemo(() => filteredRecords.length ? computeAccuracy(filteredRecords) : null, [filteredRecords]);
  const calib = acc?.calibration;

  if (loading) return <div style={{ color: C.dim, textAlign: "center", marginTop: 60, fontSize: 13 }}>Loading…</div>;
  if (!acc) return (
    <div style={{ color: C.dim, textAlign: "center", marginTop: 60 }}>
      <div style={{ fontSize: 24, marginBottom: 12 }}>📊</div>
      {table === "mlb_predictions" && gameTypeFilter === "R"
        ? <div><div style={{ marginBottom: 8 }}>No regular season games graded yet.</div>
          <div style={{ fontSize: 11, color: "#3a3a3a", marginBottom: 16 }}>Regular season starts ~March 27.</div>
          <button onClick={() => setGameTypeFilter("S")} style={{ background: C.card, color: C.yellow, border: `1px solid #3a2a00`, borderRadius: 6, padding: "7px 16px", cursor: "pointer", fontSize: 11, fontWeight: 700 }}>🌸 View Spring Training Stats</button>
        </div>
        : <div>No graded predictions yet. Results auto-record as games finish.</div>}
    </div>
  );

  const cumData = []; let correct = 0, total = 0;
  filteredRecords.filter(r => r.ml_correct !== null).forEach(r => { total++; if (r.ml_correct) correct++; cumData.push({ game: total, pct: parseFloat((correct / total * 100).toFixed(1)) }); });
  const roiData = []; let cumRoi = 0;
  filteredRecords.filter(r => r.ml_correct !== null).forEach((r, i) => { cumRoi += r.ml_correct ? 90.9 : -100; roiData.push({ game: i + 1, roi: parseFloat(cumRoi.toFixed(0)) }); });

  return (
    <div style={{ maxWidth: 900 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
        <h2 style={{ margin: 0, fontSize: 16, color: C.blue, letterSpacing: 2, textTransform: "uppercase" }}>📊 Accuracy Dashboard</h2>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {table === "mlb_predictions" && (
            <div style={{ display: "flex", gap: 3, background: C.card, border: `1px solid ${C.border}`, borderRadius: 6, padding: 3 }}>
              {[["R", "⚾ Regular"], ["S", "🌸 Spring"], ["ALL", "All"]].map(([v, l]) => (
                <button key={v} onClick={() => setGameTypeFilter(v)} style={{ padding: "3px 10px", borderRadius: 4, border: "none", cursor: "pointer", fontSize: 10, fontWeight: 700, background: gameTypeFilter === v ? C.blue : "transparent", color: gameTypeFilter === v ? C.bg : C.dim }}>{l}</button>
              ))}
            </div>
          )}
          {isNCAA && (
            <div style={{ display: "flex", gap: 3, background: C.card, border: `1px solid ${C.border}`, borderRadius: 6, padding: 3 }}>
              <button onClick={() => setForwardOnly(false)} style={{ padding: "3px 10px", borderRadius: 4, border: "none", cursor: "pointer", fontSize: 10, fontWeight: 700, background: !forwardOnly ? C.orange : "transparent", color: !forwardOnly ? C.bg : C.dim }}>All Games</button>
              <button onClick={() => setForwardOnly(true)} style={{ padding: "3px 10px", borderRadius: 4, border: "none", cursor: "pointer", fontSize: 10, fontWeight: 700, background: forwardOnly ? C.green : "transparent", color: forwardOnly ? C.bg : C.dim }}>✓ Live Only</button>
            </div>
          )}
          {["overview", "calibration", "monthly"].map(s => (
            <button key={s} onClick={() => setActiveSection(s)} style={{ padding: "4px 12px", borderRadius: 6, border: `1px solid ${activeSection === s ? "#30363d" : "transparent"}`, background: activeSection === s ? "#161b22" : "transparent", color: activeSection === s ? C.blue : C.dim, cursor: "pointer", fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase" }}>{s}</button>
          ))}
        </div>
      </div>
      {table === "mlb_predictions" && gameTypeFilter === "S" && <div style={{ background: "#1a1200", border: "1px solid #3a2a00", borderRadius: 8, padding: "8px 14px", marginBottom: 12, fontSize: 11, color: C.yellow }}>⚠️ Spring Training: lower accuracy expected — rosters experimental, home advantage disabled.</div>}
      {isNCAA && !forwardOnly && (
        <div style={{ background: "#1a0f00", border: "1px solid #5a3a00", borderRadius: 8, padding: "10px 14px", marginBottom: 12, fontSize: 11, color: C.orange, lineHeight: 1.6 }}>
          ⚠️ <strong>Backtested data warning:</strong> Historical games (before {NCAA_LIVE_CUTOFF}) were predicted using end-of-season ESPN stats retroactively applied — not the stats available on game day. This inflates ML accuracy significantly (teams' final stats are better predictors than mid-season stats would be). Switch to <strong>✓ Live Only</strong> for real-world accuracy once enough live games accumulate.
        </div>
      )}
      {isNCAA && forwardOnly && filteredRecords.length < 20 && (
        <div style={{ background: "#0d1a10", border: "1px solid #1a3a1a", borderRadius: 8, padding: "10px 14px", marginBottom: 12, fontSize: 11, color: C.green }}>
          ✓ Showing live predictions only (on/after {NCAA_LIVE_CUTOFF}). {filteredRecords.length} games graded so far — accuracy will stabilize after ~50 games.
        </div>
      )}

      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        {[
          { label: "ML ACCURACY", value: `${acc.mlAcc}%`, sub: `${acc.mlTotal} picks`, color: parseFloat(acc.mlAcc) >= 55 ? C.green : parseFloat(acc.mlAcc) >= 52 ? C.yellow : C.red },
          { label: spreadLabel.toUpperCase(), value: acc.rlAcc ? `${acc.rlAcc}%` : "—", sub: acc.rlGames > 0 ? (acc.hasMarketSpreads ? `${acc.rlGames}g vs market` : `${acc.rlGames}g *model line`) : null, color: acc.hasMarketSpreads ? (parseFloat(acc.rlAcc) >= 52 ? C.green : C.red) : C.yellow },
          { label: "OVER/UNDER", value: acc.ouAcc ? `${acc.ouAcc}%` : "—", color: parseFloat(acc.ouAcc) >= 50 ? C.green : C.red },
          { label: "NET ROI", value: `$${acc.roi}`, sub: `${acc.roiPct}% on stake`, color: parseFloat(acc.roi) >= 0 ? C.green : C.red },
          calib ? { label: "BRIER SCORE", value: calib.brierScore, sub: `${(calib.brierSkill * 100).toFixed(1)}% vs coin flip`, color: calib.brierScore < 0.22 ? C.green : calib.brierScore < 0.24 ? C.yellow : C.red } : null,
        ].filter(Boolean).map(s => (
          <div key={s.label} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: "14px 18px", flex: 1, minWidth: 100, textAlign: "center" }}>
            <div style={{ fontSize: 26, fontWeight: 800, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 10, color: C.muted, letterSpacing: 1, marginTop: 2 }}>{s.label}</div>
            {s.sub && <div style={{ fontSize: 9, color: C.dim, marginTop: 2 }}>{s.sub}</div>}
          </div>
        ))}
      </div>

      {activeSection === "overview" && (
        <>
          <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: "14px 18px", flex: 1 }}>
              <div style={{ fontSize: 10, color: C.dim, letterSpacing: 2, marginBottom: 10 }}>STREAKS</div>
              <div style={{ display: "flex", gap: 16 }}>
                <div><div style={{ fontSize: 20, fontWeight: 800, color: C.green }}>{acc.longestWin}</div><div style={{ fontSize: 9, color: C.dim }}>LONGEST W</div></div>
                <div><div style={{ fontSize: 20, fontWeight: 800, color: C.red }}>{acc.longestLoss}</div><div style={{ fontSize: 9, color: C.dim }}>LONGEST L</div></div>
                <div><div style={{ fontSize: 20, fontWeight: 800, color: acc.currentStreak > 0 ? C.green : C.red }}>{acc.currentStreak > 0 ? `W${acc.currentStreak}` : `L${Math.abs(acc.currentStreak)}`}</div><div style={{ fontSize: 9, color: C.dim }}>CURRENT</div></div>
              </div>
            </div>
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: "14px 18px", flex: 1 }}>
              <div style={{ fontSize: 10, color: C.dim, letterSpacing: 2, marginBottom: 10 }}>BY CONFIDENCE</div>
              <div style={{ display: "flex", gap: 14 }}>
                {["HIGH", "MEDIUM", "LOW"].map(tier => { const t = acc.tiers[tier]; const p = t.total ? Math.round(t.correct / t.total * 100) : null; return (<div key={tier} style={{ textAlign: "center" }}><div style={{ fontSize: 18, fontWeight: 800, color: p ? (p >= 60 ? C.green : p >= 52 ? C.yellow : C.red) : C.dim }}>{p ? `${p}%` : "—"}</div><div style={{ fontSize: 9, color: C.dim }}>{tier}</div><div style={{ fontSize: 9, color: C.dim }}>{t.total}g</div></div>); })}
              </div>
            </div>
          </div>
          {cumData.length > 2 && <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: "16px", marginBottom: 12 }}>
            <div style={{ fontSize: 10, color: C.muted, letterSpacing: 2, marginBottom: 12 }}>ML ACCURACY OVER TIME</div>
            <ResponsiveContainer width="100%" height={160}>
              <LineChart data={cumData}><CartesianGrid strokeDasharray="3 3" stroke="#161b22" /><XAxis dataKey="game" tick={{ fill: C.dim, fontSize: 10 }} /><YAxis domain={[40, 70]} tick={{ fill: C.dim, fontSize: 10 }} tickFormatter={v => `${v}%`} /><Tooltip contentStyle={{ background: "#161b22", border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 11 }} /><ReferenceLine y={55} stroke={C.green} strokeDasharray="4 4" /><ReferenceLine y={50} stroke={C.dim} strokeDasharray="4 4" /><Line type="monotone" dataKey="pct" stroke={C.blue} strokeWidth={2} dot={false} /></LineChart>
            </ResponsiveContainer>
          </div>}
          {roiData.length > 2 && <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: "16px" }}>
            <div style={{ fontSize: 10, color: C.muted, letterSpacing: 2, marginBottom: 12 }}>CUMULATIVE ROI ($100/bet, -110)</div>
            <ResponsiveContainer width="100%" height={130}>
              <LineChart data={roiData}><CartesianGrid strokeDasharray="3 3" stroke="#161b22" /><XAxis dataKey="game" tick={{ fill: C.dim, fontSize: 10 }} /><YAxis tick={{ fill: C.dim, fontSize: 10 }} tickFormatter={v => `$${v}`} /><Tooltip contentStyle={{ background: "#161b22", border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 11 }} /><ReferenceLine y={0} stroke={C.dim} /><Line type="monotone" dataKey="roi" stroke={parseFloat(acc.roi) >= 0 ? C.green : C.red} strokeWidth={2} dot={false} /></LineChart>
            </ResponsiveContainer>
          </div>}
        </>
      )}

      {activeSection === "calibration" && calib && (
        <div style={{ background: "#0a0f14", border: "1px solid #1e3448", borderRadius: 10, padding: "14px 18px" }}>
          <div style={{ fontSize: 11, color: C.blue, fontWeight: 700, letterSpacing: 1, marginBottom: 8 }}>CALIBRATION ANALYSIS</div>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 10 }}>
            <Kv k="Brier Score" v={calib.brierScore} /><Kv k="Skill vs Coin" v={`${(calib.brierSkill * 100).toFixed(1)}%`} /><Kv k="Mean Cal. Error" v={`${calib.meanCalibrationError}%`} /><Kv k="Overall Bias" v={`${calib.overallBias > 0 ? "+" : ""}${calib.overallBias}%`} /><Kv k="Sample Size" v={`${calib.n} games`} />
          </div>
          {/* Show current applied factor when it differs from 1.0 */}
          {onCalibrationChange && (() => {
            // Read current factor from localStorage to display it
            let curFactor = 1.0;
            try { curFactor = parseFloat(localStorage.getItem(table === "mlb_predictions" ? "cal_mlb" : "cal_ncaa")) || 1.0; } catch {}
            return curFactor !== 1.0 ? (
              <div style={{ background: "#0d1a10", border: "1px solid #1a4a1a", borderRadius: 8, padding: "10px 14px", marginBottom: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontSize: 11, color: C.green }}>✅ Calibration factor ×{curFactor} is active — win probabilities on Calendar tab are adjusted</div>
                <button onClick={() => onCalibrationChange?.(1.0)} style={{ background: "#21262d", color: C.muted, border: `1px solid ${C.border}`, borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontSize: 10 }}>Reset</button>
              </div>
            ) : null;
          })()}
          {calib.suggestedFactor !== 1.0 && <div style={{ background: "#1a1400", border: "1px solid #3a2a00", borderRadius: 8, padding: "10px 14px", marginBottom: 10 }}>
            <div style={{ fontSize: 11, color: C.yellow, marginBottom: 6 }}>💡 Model is {calib.overallBias < 0 ? "over-confident" : "under-confident"} by ~{Math.abs(calib.overallBias).toFixed(1)}%. Suggested factor: ×{calib.suggestedFactor}</div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => onCalibrationChange?.(calib.suggestedFactor)} style={{ background: "#238636", color: "#fff", border: "none", borderRadius: 6, padding: "5px 12px", cursor: "pointer", fontSize: 11, fontWeight: 700 }}>Apply ×{calib.suggestedFactor}</button>
              <button onClick={() => onCalibrationChange?.(1.0)} style={{ background: "#21262d", color: C.muted, border: `1px solid ${C.border}`, borderRadius: 6, padding: "5px 12px", cursor: "pointer", fontSize: 11 }}>Reset to 1.0</button>
            </div>
          </div>}
          {calib.curve.length > 0 && <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}>
            <thead><tr style={{ color: C.dim }}>{["BIN", "N", "PRED", "ACTUAL", "ERROR", "VERDICT"].map(h => <th key={h} style={{ padding: "4px 8px", textAlign: "left", borderBottom: `1px solid ${C.border}` }}>{h}</th>)}</tr></thead>
            <tbody>{calib.curve.map((b, i) => <tr key={i} style={{ borderBottom: `1px solid #0d1117` }}>
              <td style={{ padding: "5px 8px", color: C.muted }}>{b.label}</td><td style={{ padding: "5px 8px", color: C.dim }}>{b.n}</td>
              <td style={{ padding: "5px 8px", color: C.blue }}>{b.expected}%</td><td style={{ padding: "5px 8px", color: C.green }}>{b.actual}%</td>
              <td style={{ padding: "5px 8px", color: Math.abs(b.error) < 3 ? C.green : Math.abs(b.error) < 6 ? C.yellow : C.red }}>{b.error > 0 ? "+" : ""}{b.error}%</td>
              <td style={{ padding: "5px 8px", fontSize: 9, color: Math.abs(b.error) < 3 ? C.green : Math.abs(b.error) < 6 ? C.yellow : C.red }}>{Math.abs(b.error) < 3 ? "✓ Good" : Math.abs(b.error) < 6 ? "⚠ Minor bias" : "✗ Needs correction"}</td>
            </tr>)}</tbody>
          </table></div>}
        </div>
      )}

      {activeSection === "monthly" && acc.byMonth?.length > 0 && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: "16px" }}>
          <div style={{ fontSize: 10, color: C.muted, letterSpacing: 2, marginBottom: 12 }}>MONTHLY ML ACCURACY</div>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={acc.byMonth}><CartesianGrid strokeDasharray="3 3" stroke="#161b22" /><XAxis dataKey="month" tick={{ fill: C.dim, fontSize: 10 }} /><YAxis domain={[40, 70]} tick={{ fill: C.dim, fontSize: 10 }} tickFormatter={v => `${v}%`} /><Tooltip contentStyle={{ background: "#161b22", border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 11 }} /><ReferenceLine y={55} stroke={C.green} strokeDasharray="4 4" /><Bar dataKey="pct" radius={[3, 3, 0, 0]}>{acc.byMonth.map((e, i) => <Cell key={i} fill={e.pct >= 55 ? C.green : e.pct >= 50 ? C.yellow : C.red} />)}</Bar></BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

// ── HISTORY TAB ───────────────────────────────────────────────
function HistoryTab({ table, refreshKey }) {
  const [records, setRecords] = useState([]); const [loading, setLoading] = useState(true); const [filterDate, setFilterDate] = useState(""); const [gameTypeFilter, setGameTypeFilter] = useState("ALL");
  const isMLB = table === "mlb_predictions";
  const load = useCallback(async () => {
    setLoading(true);
    let path = `/${table}?order=game_date.desc&limit=200`;
    if (filterDate) path += `&game_date=eq.${filterDate}`;
    if (isMLB && gameTypeFilter !== "ALL") path += `&game_type=eq.${gameTypeFilter}`;
    const data = await supabaseQuery(path); setRecords(data || []); setLoading(false);
  }, [filterDate, gameTypeFilter, table]);
  useEffect(() => { load(); }, [load, refreshKey]);
  const deleteRecord = async (id) => { if (!window.confirm("Delete?")) return; await supabaseQuery(`/${table}?id=eq.${id}`, "DELETE"); load(); };
  const grouped = records.reduce((acc, r) => { if (!acc[r.game_date]) acc[r.game_date] = []; acc[r.game_date].push(r); return acc; }, {});
  const confColor = c => c === "HIGH" ? C.green : c === "MEDIUM" ? C.yellow : C.muted;
  const mlSign = ml => ml > 0 ? `+${ml}` : ml;

  return (
    <div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 14, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontSize: 14, color: C.blue, letterSpacing: 2, textTransform: "uppercase" }}>📋 History</h2>
        <input type="date" value={filterDate} onChange={e => setFilterDate(e.target.value)} style={{ background: C.card, color: "#e2e8f0", border: `1px solid ${C.border}`, borderRadius: 6, padding: "5px 10px", fontSize: 11, fontFamily: "inherit" }} />
        {filterDate && <button onClick={() => setFilterDate("")} style={{ background: C.card, color: C.muted, border: `1px solid ${C.border}`, borderRadius: 6, padding: "5px 10px", cursor: "pointer", fontSize: 11 }}>Clear</button>}
        <button onClick={load} style={{ background: C.card, color: C.blue, border: `1px solid ${C.border}`, borderRadius: 6, padding: "5px 10px", cursor: "pointer", fontSize: 11 }}>↻</button>
        {isMLB && <div style={{ display: "flex", gap: 2, background: C.card, border: `1px solid ${C.border}`, borderRadius: 6, padding: 2 }}>
          {[["ALL", "All"], ["R", "⚾ RS"], ["S", "🌸 ST"]].map(([v, l]) => (
            <button key={v} onClick={() => setGameTypeFilter(v)} style={{ padding: "3px 9px", borderRadius: 4, border: "none", cursor: "pointer", fontSize: 10, fontWeight: 700, background: gameTypeFilter === v ? C.blue : "transparent", color: gameTypeFilter === v ? C.bg : C.dim }}>{l}</button>
          ))}
        </div>}
        <button onClick={async () => { const p = records.filter(r => !r.result_entered); if (!p.length) return alert("No pending"); const n = isMLB ? await mlbFillFinalScores(p) : await ncaaFillFinalScores(p); load(); if (!n) alert("No matched games yet"); }} style={{ background: C.card, color: C.yellow, border: `1px solid ${C.border}`, borderRadius: 6, padding: "5px 10px", cursor: "pointer", fontSize: 11 }}>⚡ Sync</button>
        {isMLB && <>
          <button onClick={async () => { if (!records.length) return; const n = await mlbRefreshPredictions(records, m => console.log(m)); load(); alert(`Refreshed ${n}`); }} style={{ background: C.card, color: C.blue, border: `1px solid ${C.border}`, borderRadius: 6, padding: "5px 10px", cursor: "pointer", fontSize: 11 }}>🔁 Refresh</button>
          <button onClick={async () => { if (!window.confirm("Regrade all?")) return; const n = await mlbRegradeAllResults(m => console.log(m)); load(); alert(`Regraded ${n}`); }} style={{ background: "#1a0a2e", color: "#d2a8ff", border: "1px solid #3d1f6e", borderRadius: 6, padding: "5px 10px", cursor: "pointer", fontSize: 11 }}>🔧 Regrade</button>
        </>}
      </div>
      {loading && <div style={{ color: C.dim, textAlign: "center", marginTop: 40 }}>Loading…</div>}
      {!loading && records.length === 0 && <div style={{ color: C.dim, textAlign: "center", marginTop: 40 }}>No predictions yet</div>}
      {Object.entries(grouped).map(([date, recs]) => (
        <div key={date} style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.yellow, marginBottom: 6, borderBottom: `1px solid #161b22`, paddingBottom: 5, letterSpacing: 2 }}>📅 {date}</div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
              <thead><tr style={{ color: C.dim, fontSize: 9 }}>{["MATCHUP", "MODEL ML", "O/U", "WIN %", "CONF", "RESULT", "ML✓", "ATS✓", "O/U✓", ""].map(h => <th key={h} style={{ padding: "5px 8px", textAlign: "left", borderBottom: `1px solid #161b22`, whiteSpace: "nowrap" }}>{h}</th>)}</tr></thead>
              <tbody>
                {recs.map(r => {
                  const bg = r.result_entered ? (r.ml_correct ? "rgba(63,185,80,0.06)" : "rgba(248,81,73,0.06)") : "transparent";
                  const homeScore = isMLB ? r.actual_home_runs : r.actual_home_score;
                  const awayScore = isMLB ? r.actual_away_runs : r.actual_away_score;
                  const homeName = isMLB ? r.home_team : (r.home_team_name || r.home_team);
                  const awayName = isMLB ? r.away_team : (r.away_team_name || r.away_team);
                  return <tr key={r.id} style={{ borderBottom: `1px solid #0d1117`, background: bg }}>
                    <td style={{ padding: "7px 8px", fontWeight: 700, whiteSpace: "nowrap" }}>{awayName} @ {homeName} {r.game_type === "S" && <span style={{ fontSize: 8, color: C.yellow, marginLeft: 4 }}>ST</span>}</td>
                    <td style={{ padding: "7px 8px", whiteSpace: "nowrap" }}><span style={{ color: C.blue }}>H:{mlSign(r.model_ml_home)}</span><span style={{ color: C.dim, margin: "0 3px" }}>|</span><span style={{ color: C.dim }}>A:{mlSign(r.model_ml_away)}</span></td>
                    <td style={{ padding: "7px 8px", color: C.yellow }}>{r.ou_total}</td>
                    <td style={{ padding: "7px 8px", color: C.blue }}>{r.win_pct_home != null ? `${Math.round(r.win_pct_home * 100)}%` : "—"}</td>
                    <td style={{ padding: "7px 8px" }}><span style={{ color: confColor(r.confidence), fontWeight: 700, fontSize: 10 }}>{r.confidence}</span></td>
                    <td style={{ padding: "7px 8px", whiteSpace: "nowrap" }}>{r.result_entered ? <span style={{ color: C.green }}>{awayName} {awayScore} — {homeName} {homeScore}</span> : <span style={{ color: "#4a3a00", fontSize: 10 }}>⏳ Pending</span>}</td>
                    <td style={{ padding: "7px 8px", textAlign: "center" }}>{r.result_entered ? (r.ml_correct ? "✅" : "❌") : "—"}</td>
                    <td style={{ padding: "7px 8px", textAlign: "center" }}>{r.result_entered ? (r.rl_correct === null ? "🔲" : r.rl_correct ? "✅" : "❌") : "—"}</td>
                    <td style={{ padding: "7px 8px", textAlign: "center" }}>{r.result_entered ? <span style={{ color: r.ou_correct === "PUSH" ? C.yellow : "#e2e8f0", fontSize: 10 }}>{r.ou_correct}</span> : "—"}</td>
                    <td style={{ padding: "7px 8px" }}><button onClick={() => deleteRecord(r.id)} style={{ background: "transparent", border: "none", color: C.dim, cursor: "pointer", fontSize: 12 }}>🗑</button></td>
                  </tr>;
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── PARLAY BUILDER ────────────────────────────────────────────
function ParlayBuilder({ mlbGames = [], ncaaGames = [] }) {
  const [sportFilter, setSportFilter] = useState("ALL");
  const [legCount, setLegCount] = useState(3);
  const [mode, setMode] = useState("auto");
  const [customLegs, setCustomLegs] = useState([]);
  const [wager, setWager] = useState(100);

  const allGameLegs = useMemo(() => {
    const mlbLegs = mlbGames.filter(g => g.pred).map(g => {
      const home = mlbTeamById(g.homeTeamId), away = mlbTeamById(g.awayTeamId);
      const pickHome = g.pred.homeWinPct >= 0.5;
      const ml = pickHome ? (g.odds?.homeML || g.pred.modelML_home) : (g.odds?.awayML || g.pred.modelML_away);
      return { sport: "MLB", gamePk: g.gamePk || g.gameId, label: `${away.abbr} @ ${home.abbr}`, pick: pickHome ? home.abbr : away.abbr, prob: pickHome ? g.pred.homeWinPct : g.pred.awayWinPct, ml, confidence: g.pred.confidence, confScore: g.pred.confScore, hasOdds: !!g.odds?.homeML };
    });
    const ncaaLegs = ncaaGames.filter(g => g.pred).map(g => {
      const pickHome = g.pred.homeWinPct >= 0.5;
      const ml = pickHome ? (g.odds?.homeML || g.pred.modelML_home) : (g.odds?.awayML || g.pred.modelML_away);
      const hName = (g.homeAbbr || g.homeTeamName || "HOME").slice(0, 8);
      const aName = (g.awayAbbr || g.awayTeamName || "AWAY").slice(0, 8);
      return { sport: "NCAA", gamePk: g.gameId, label: `${aName} @ ${hName}`, pick: pickHome ? hName : aName, prob: pickHome ? g.pred.homeWinPct : g.pred.awayWinPct, ml, confidence: g.pred.confidence, confScore: g.pred.confScore, hasOdds: !!g.odds?.homeML };
    });
    return [...mlbLegs, ...ncaaLegs].sort((a, b) => b.prob - a.prob);
  }, [mlbGames, ncaaGames]);

  const filteredLegs = useMemo(() => {
    if (sportFilter === "MLB") return allGameLegs.filter(l => l.sport === "MLB");
    if (sportFilter === "NCAA") return allGameLegs.filter(l => l.sport === "NCAA");
    return allGameLegs;
  }, [allGameLegs, sportFilter]);

  const autoParlay = useMemo(() => filteredLegs.slice(0, legCount), [filteredLegs, legCount]);
  const active = mode === "auto" ? autoParlay : customLegs;
  const combinedProb = active.length ? combinedParlayProb(active) : 0;
  const decOdds = active.length ? combinedParlayOdds(active) : 1;
  const ev = active.length ? ((combinedProb * (decOdds - 1) * wager) - ((1 - combinedProb) * wager)).toFixed(2) : null;
  const toggleCustomLeg = (leg) => {
    const exists = customLegs.find(l => l.gamePk === leg.gamePk && l.sport === leg.sport);
    if (exists) setCustomLegs(customLegs.filter(l => !(l.gamePk === leg.gamePk && l.sport === leg.sport)));
    else setCustomLegs([...customLegs, leg]);
  };
  const sportColor = s => s === "MLB" ? C.blue : C.orange;
  const sportBadge = s => <span style={{ fontSize: 8, padding: "1px 5px", borderRadius: 3, background: s === "MLB" ? "#0d1a2e" : "#2a1a0a", color: sportColor(s), marginLeft: 4 }}>{s === "MLB" ? "⚾" : "🏀"}</span>;

  return (
    <div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 14, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontSize: 14, color: C.blue, letterSpacing: 2, textTransform: "uppercase" }}>🎯 Parlay Builder</h2>
        <div style={{ display: "flex", gap: 3, background: C.card, border: `1px solid ${C.border}`, borderRadius: 6, padding: 3 }}>
          {[["ALL", "⚾+🏀"], ["MLB", "⚾"], ["NCAA", "🏀"]].map(([v, l]) => (
            <button key={v} onClick={() => setSportFilter(v)} style={{ padding: "3px 10px", borderRadius: 4, border: "none", cursor: "pointer", fontSize: 10, fontWeight: 700, background: sportFilter === v ? C.blue : "transparent", color: sportFilter === v ? C.bg : C.dim }}>{l}</button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 3 }}>
          {[2, 3, 4, 5, 6, 7, 8].map(n => (
            <button key={n} onClick={() => { setLegCount(n); setMode("auto"); }} style={{ width: 26, height: 26, borderRadius: "50%", border: "none", cursor: "pointer", fontSize: 11, fontWeight: 800, background: mode === "auto" && legCount === n ? C.blue : "#161b22", color: mode === "auto" && legCount === n ? C.bg : C.dim }}>{n}</button>
          ))}
        </div>
        <button onClick={() => setMode(m => m === "auto" ? "custom" : "auto")} style={{ background: mode === "custom" ? C.blue : "#161b22", color: mode === "custom" ? C.bg : "#e2e8f0", border: `1px solid ${C.border}`, borderRadius: 6, padding: "5px 12px", cursor: "pointer", fontSize: 11 }}>{mode === "custom" ? "✏️ Custom" : "⚡ Auto"}</button>
      </div>

      {active.length > 0 && <div style={{ background: "linear-gradient(135deg,#0d1a2e,#0a1520)", border: "1px solid #1e3448", borderRadius: 10, padding: "14px 18px", marginBottom: 16 }}>
        <div style={{ fontSize: 10, fontWeight: 800, color: C.blue, marginBottom: 10, letterSpacing: 2 }}>{active.length}-LEG PARLAY</div>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 10 }}>
          <Pill label="COMBINED PROB" value={`${(combinedProb * 100).toFixed(1)}%`} color={combinedProb > 0.15 ? C.green : C.red} />
          <Pill label="FAIR ODDS" value={decimalToML(decOdds)} color={C.yellow} />
          <Pill label={`PAYOUT $${wager}`} value={`$${(wager * decOdds).toFixed(0)}`} color={C.green} />
          {ev && <Pill label="MODEL EV" value={`$${ev}`} color={parseFloat(ev) >= 0 ? C.green : C.red} />}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
          <span style={{ fontSize: 10, color: C.dim }}>Wager: $</span>
          <input type="number" value={wager} onChange={e => setWager(Number(e.target.value))} style={{ width: 70, background: C.card, color: "#e2e8f0", border: `1px solid ${C.border}`, borderRadius: 5, padding: "3px 7px", fontSize: 11, fontFamily: "inherit" }} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          {active.map((leg, i) => <div key={`${leg.sport}-${leg.gamePk}`} style={{ display: "flex", alignItems: "center", gap: 10, background: "rgba(255,255,255,0.03)", borderRadius: 7, padding: "7px 10px" }}>
            <div style={{ width: 20, height: 20, borderRadius: "50%", background: sportColor(leg.sport), display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 800, color: C.bg }}>{i + 1}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 700 }}>{leg.label}{sportBadge(leg.sport)}</div>
              <div style={{ fontSize: 10, color: C.dim }}>Pick: <span style={{ color: C.green }}>{leg.pick}</span></div>
            </div>
            <Pill label="PROB" value={`${(leg.prob * 100).toFixed(1)}%`} />
            <Pill label="ML" value={leg.ml > 0 ? `+${leg.ml}` : leg.ml} />
            {mode === "custom" && <button onClick={() => toggleCustomLeg(leg)} style={{ background: "none", border: "none", color: C.dim, cursor: "pointer" }}>✕</button>}
          </div>)}
        </div>
      </div>}

      {filteredLegs.length === 0 && <div style={{ color: C.dim, textAlign: "center", marginTop: 40, fontSize: 12 }}>No games loaded — visit Calendar tab first to load today's games</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {filteredLegs.map((leg, i) => {
          const isAutoSel = mode === "auto" && autoParlay.find(l => l.gamePk === leg.gamePk && l.sport === leg.sport);
          const isCustomSel = customLegs.find(l => l.gamePk === leg.gamePk && l.sport === leg.sport);
          return <div key={`${leg.sport}-${leg.gamePk}`} style={{ background: isAutoSel ? "#0e2015" : C.card, border: `1px solid ${isAutoSel ? "#2ea043" : C.border}`, borderRadius: 8, padding: "10px 14px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <div style={{ width: 22, fontSize: 10, color: C.dim }}>{isAutoSel ? "✅" : `#${i + 1}`}</div>
            <div style={{ flex: 1, minWidth: 120 }}>
              <div style={{ fontSize: 13, fontWeight: 700 }}>{leg.label}{sportBadge(leg.sport)}</div>
              <div style={{ fontSize: 10, color: C.dim }}>Pick: {leg.pick} — {(leg.prob * 100).toFixed(1)}%</div>
            </div>
            <Pill label="ML" value={leg.ml > 0 ? `+${leg.ml}` : leg.ml} />
            <Pill label="CONF" value={leg.confidence} color={confColor2(leg.confidence)} />
            {mode === "custom" && <button onClick={() => toggleCustomLeg(leg)} style={{ background: isCustomSel ? "#2ea043" : "#161b22", color: isCustomSel ? "#fff" : C.dim, border: `1px solid ${C.border}`, borderRadius: 5, padding: "3px 10px", cursor: "pointer", fontSize: 11 }}>{isCustomSel ? "✓ Added" : "+ Add"}</button>}
          </div>;
        })}
      </div>
    </div>
  );
}

// ── BET SIGNALS PANEL (shared by MLB + NCAA expanded card) ──────
function BetSignalsPanel({ signals, pred, odds, sport, homeName, awayName }) {
  if (!signals) return null;
  const verdictStyle = v => ({
    GO:       { bg: "#0d2818", border: "#2ea043", color: C.green,  icon: "🟢" },
    LEAN:     { bg: "#1a1200", border: "#d29922", color: C.yellow, icon: "🟡" },
    SKIP:     { bg: "#111",    border: C.border,  color: C.dim,    icon: "⚪" },
    "NO LINE":{ bg: "#111",    border: C.border,  color: C.dim,    icon: "—"  },
  }[v] || { bg: "#111", border: C.border, color: C.dim, icon: "?" });

  const Row = ({ label, signal }) => {
    if (!signal) return null;
    const s = verdictStyle(signal.verdict);
    return (
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "8px 10px", background: s.bg, border: `1px solid ${s.border}`, borderRadius: 7, marginBottom: 6 }}>
        <div style={{ fontSize: 14, lineHeight: 1 }}>{s.icon}</div>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: s.color }}>{label}</span>
            <span style={{ fontSize: 11, fontWeight: 800, color: s.color, letterSpacing: 1 }}>{signal.verdict}</span>
          </div>
          <div style={{ fontSize: 10, color: C.muted, marginTop: 2, lineHeight: 1.5 }}>{signal.reason}</div>
          {signal.side && signal.verdict !== "SKIP" && (
            <div style={{ fontSize: 11, fontWeight: 700, color: s.color, marginTop: 3 }}>
              → Bet: {signal.side}{signal.ml ? ` (${signal.ml})` : ""}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ fontSize: 10, color: C.dim, letterSpacing: 2, marginBottom: 8 }}>BET SIGNALS</div>
      <Row label="⚾ MONEYLINE" signal={signals.ml} />
      <Row label="📊 OVER/UNDER" signal={signals.ou} />
      {signals.spread && <Row label="📏 SPREAD/RUN LINE" signal={signals.spread} />}
      <Row label="🎯 CONFIDENCE" signal={signals.conf} />

      {/* Edge Analysis */}
      {odds?.homeML && odds?.awayML && (() => {
        const market = trueImplied(odds.homeML, odds.awayML);
        const homeWin = pred.homeWinPct;
        const awayWin = 1 - homeWin;
        const hEdge = ((homeWin - market.home) * 100).toFixed(1);
        const aEdge = ((awayWin - market.away) * 100).toFixed(1);
        return (
          <div style={{ padding: "10px 12px", background: "#0a0f14", borderRadius: 6, marginTop: 10 }}>
            <div style={{ fontSize: 10, color: C.dim, letterSpacing: 2, marginBottom: 6 }}>EDGE ANALYSIS</div>
            <div style={{ display: "flex", gap: 20, flexWrap: "wrap", marginBottom: 8 }}>
              <div><span style={{ color: parseFloat(hEdge) >= 3.5 ? C.green : parseFloat(hEdge) < 0 ? C.red : C.muted, fontWeight: 700 }}>{parseFloat(hEdge) > 0 ? "+" : ""}{hEdge}%</span> <span style={{ fontSize: 10, color: C.dim }}>{homeName}</span></div>
              <div><span style={{ color: parseFloat(aEdge) >= 3.5 ? C.green : parseFloat(aEdge) < 0 ? C.red : C.muted, fontWeight: 700 }}>{parseFloat(aEdge) > 0 ? "+" : ""}{aEdge}%</span> <span style={{ fontSize: 10, color: C.dim }}>{awayName}</span></div>
              <div style={{ fontSize: 10, color: C.dim }}>Mkt: {(market.home * 100).toFixed(1)}% / {(market.away * 100).toFixed(1)}%</div>
            </div>
            <div style={{ fontSize: 10, color: C.muted, lineHeight: 1.6, borderTop: `1px solid ${C.border}`, paddingTop: 8 }}>
              <strong style={{ color: C.blue }}>What is Edge Analysis?</strong><br/>
              The market sets a price (e.g. {homeName} -145) that implies a {(market.home * 100).toFixed(1)}% win probability after removing the sportsbook's vig (built-in profit margin). Our model independently calculates win probability using efficiency stats, tempo, and scoring trends. <strong>Edge</strong> is the gap between these two numbers — if the model gives {homeName} {(homeWin * 100).toFixed(1)}% but the market only prices them at {(market.home * 100).toFixed(1)}%, that is a <strong>{Math.abs(parseFloat(hEdge)).toFixed(1)}% edge</strong> on the {homeName} moneyline. A consistent edge of 3.5%+ is statistically exploitable over a large sample. Below 3.5% the edge is within the noise of normal variance.
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// ⚾ MLB CALENDAR TAB
// ═══════════════════════════════════════════════════════════════

function MLBCalendarTab({ calibrationFactor, onGamesLoaded }) {
  const todayStr = new Date().toISOString().split("T")[0];
  const [dateStr, setDateStr] = useState(todayStr);
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const [oddsData, setOddsData] = useState(null);

  const loadGames = useCallback(async (d) => {
    setLoading(true); setGames([]);
    const [raw, odds] = await Promise.all([fetchMLBScheduleForDate(d), fetchOdds("baseball_mlb")]);
    setOddsData(odds);
    setGames(raw.map(g => ({ ...g, pred: null, loading: true })));
    const enriched = await Promise.all(raw.map(async (g) => {
      const homeStatId = resolveStatTeamId(g.homeTeamId, g.homeAbbr);
      const awayStatId = resolveStatTeamId(g.awayTeamId, g.awayAbbr);
      const [homeHit, awayHit, homePitch, awayPitch, homeStarter, awayStarter, homeForm, awayForm, homeLineup, awayLineup] =
        await Promise.all([fetchTeamHitting(homeStatId), fetchTeamHitting(awayStatId), fetchTeamPitching(homeStatId), fetchTeamPitching(awayStatId), fetchStarterStats(g.homeStarterId), fetchStarterStats(g.awayStarterId), fetchRecentForm(homeStatId), fetchRecentForm(awayStatId), fetchLineup(g.gamePk, homeStatId, true), fetchLineup(g.gamePk, awayStatId, false)]);
      if (homeStarter) homeStarter.pitchHand = g.homeStarterHand;
      if (awayStarter) awayStarter.pitchHand = g.awayStarterHand;
      const [homeBullpen, awayBullpen] = await Promise.all([fetchBullpenFatigue(g.homeTeamId), fetchBullpenFatigue(g.awayTeamId)]);
      const pred = mlbPredictGame({ homeTeamId: g.homeTeamId, awayTeamId: g.awayTeamId, homeHit, awayHit, homePitch, awayPitch, homeStarterStats: homeStarter, awayStarterStats: awayStarter, homeForm, awayForm, homeGamesPlayed: homeForm?.gamesPlayed || 0, awayGamesPlayed: awayForm?.gamesPlayed || 0, bullpenData: { [g.homeTeamId]: homeBullpen, [g.awayTeamId]: awayBullpen }, homeLineup, awayLineup, umpire: g.umpire, calibrationFactor });
      const gameOdds = odds?.games?.find(o => matchMLBOddsToGame(o, g)) || null;
      return { ...g, pred, loading: false, odds: gameOdds };
    }));
    setGames(enriched);
    onGamesLoaded?.(enriched);
    setLoading(false);
  }, [calibrationFactor]);

  useEffect(() => { loadGames(dateStr); }, [dateStr, calibrationFactor]);

  const getBannerInfo = (pred, odds, hasStarter) => {
    if (!pred) return { color: "yellow", label: "⚠ No prediction" };
    if (!hasStarter) return { color: "yellow", label: "⚠ Starters TBD" };
    if (odds?.homeML && odds?.awayML) {
      const market = trueImplied(odds.homeML, odds.awayML);
      const homeEdge = pred.homeWinPct - market.home;
      if (Math.abs(homeEdge) >= EDGE_THRESHOLD)
        return { color: "green", edge: homeEdge, label: homeEdge >= EDGE_THRESHOLD ? `+${(homeEdge * 100).toFixed(1)}% HOME edge` : `+${((-homeEdge) * 100).toFixed(1)}% AWAY edge` };
      return { color: "neutral", edge: homeEdge, label: `${(Math.abs(homeEdge) * 100).toFixed(1)}% edge` };
    }
    if (pred.homeWinPct >= 0.60 || pred.homeWinPct <= 0.40) return { color: "green", label: "Strong signal" };
    return { color: "neutral", label: "Close matchup" };
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <input type="date" value={dateStr} onChange={e => setDateStr(e.target.value)} style={{ background: C.card, color: "#e2e8f0", border: `1px solid ${C.border}`, borderRadius: 6, padding: "6px 10px", fontSize: 12, fontFamily: "inherit" }} />
        <button onClick={() => loadGames(dateStr)} style={{ background: "#161b22", color: C.blue, border: `1px solid ${C.border}`, borderRadius: 6, padding: "6px 14px", cursor: "pointer", fontSize: 11, fontWeight: 700 }}>↻ REFRESH</button>
        {!loading && oddsData?.games?.length > 0 && <span style={{ fontSize: 11, color: C.green }}>✓ Live odds ({oddsData.games.length})</span>}
        {!loading && oddsData?.noKey && <span style={{ fontSize: 11, color: C.dim }}>⚠ Add ODDS_API_KEY for live lines</span>}
        {loading && <span style={{ color: C.dim, fontSize: 11 }}>⏳ Loading predictions…</span>}
      </div>
      {!loading && games.length === 0 && <div style={{ color: C.dim, textAlign: "center", marginTop: 40 }}>No games scheduled for {dateStr}</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {games.map(game => {
          const home = mlbTeamById(game.homeTeamId), away = mlbTeamById(game.awayTeamId);
          const bannerInfo = game.loading ? { color: "yellow", label: "Calculating…" } : getBannerInfo(game.pred, game.odds, game.homeStarter && game.awayStarter);
          const color = bannerInfo.color;
          const isOpen = expanded === game.gamePk;
          const bannerBg = color === "green" ? "linear-gradient(135deg,#0b2012,#0e2315)" : color === "yellow" ? "linear-gradient(135deg,#1a1200,#1a1500)" : `linear-gradient(135deg,${C.card},#111822)`;
          const borderColor = color === "green" ? "#2ea043" : color === "yellow" ? "#4a3a00" : C.border;
          return (
            <div key={game.gamePk} style={{ background: bannerBg, border: `1px solid ${borderColor}`, borderRadius: 10, overflow: "hidden" }}>
              <div onClick={() => setExpanded(isOpen ? null : game.gamePk)} style={{ padding: "14px 18px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 160 }}>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 20, fontWeight: 800 }}>{away.abbr}</div>
                    <div style={{ fontSize: 9, color: C.dim }}>AWAY</div>
                    {game.awayStarter && <div style={{ fontSize: 10, color: C.muted }}>{game.awayStarter.split(" ").pop()}{game.awayStarterHand ? ` (${game.awayStarterHand})` : ""}</div>}
                  </div>
                  <div style={{ fontSize: 14, color: C.dim }}>@</div>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 20, fontWeight: 800 }}>{home.abbr}</div>
                    <div style={{ fontSize: 9, color: C.dim }}>HOME</div>
                    {game.homeStarter && <div style={{ fontSize: 10, color: C.muted }}>{game.homeStarter.split(" ").pop()}{game.homeStarterHand ? ` (${game.homeStarterHand})` : ""}</div>}
                  </div>
                </div>
                {game.loading ? <div style={{ color: C.dim, fontSize: 11 }}>Calculating…</div>
                  : game.pred ? (() => {
                    const mlbOddsWithSpread = game.odds || null;
                    const sigs = getBetSignals({ pred: game.pred, odds: mlbOddsWithSpread, sport: "mlb" });
                    return <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                      <Pill label="PROJ" value={`${away.abbr} ${game.pred.awayRuns.toFixed(1)} — ${home.abbr} ${game.pred.homeRuns.toFixed(1)}`} />
                      <Pill label="MDL ML" value={game.pred.modelML_home > 0 ? `+${game.pred.modelML_home}` : game.pred.modelML_home} highlight={sigs.ml?.verdict === "GO" || sigs.ml?.verdict === "LEAN"} />
                      {game.odds?.homeML && <Pill label="MKT ML" value={game.odds.homeML > 0 ? `+${game.odds.homeML}` : game.odds.homeML} color={C.yellow} />}
                      <Pill label="O/U" value={game.pred.ouTotal} highlight={sigs.ou?.verdict === "GO" || sigs.ou?.verdict === "LEAN"} />
                      <Pill label="WIN%" value={`${Math.round(game.pred.homeWinPct * 100)}%`} color={game.pred.homeWinPct >= 0.55 ? C.green : "#e2e8f0"} />
                      <Pill label="CONF" value={game.pred.confidence} color={confColor2(game.pred.confidence)} highlight={sigs.conf?.verdict === "GO"} />
                    </div>;
                  })() : <div style={{ color: C.dim, fontSize: 11 }}>⚠ Data unavailable</div>}
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  {game.status === "Final" && <span style={{ fontSize: 10, color: C.green, fontWeight: 700 }}>FINAL {game.awayScore}-{game.homeScore}</span>}
                  {game.status === "Live" && <span style={{ fontSize: 10, color: C.orange, fontWeight: 700 }}>LIVE {game.inningHalf} {game.inning}</span>}
                  {game.umpire?.name && <span style={{ fontSize: 9, color: C.dim }}>⚖ {game.umpire.name.split(" ").pop()}</span>}
                  <span style={{ color: C.dim, fontSize: 12 }}>{isOpen ? "▲" : "▼"}</span>
                </div>
              </div>
              {isOpen && game.pred && (
                <div style={{ borderTop: `1px solid ${borderColor}`, padding: "14px 18px", background: "rgba(0,0,0,0.3)" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(130px,1fr))", gap: 8, marginBottom: 10 }}>
                    <Kv k="Projected Score" v={`${away.abbr} ${game.pred.awayRuns.toFixed(1)} — ${home.abbr} ${game.pred.homeRuns.toFixed(1)}`} />
                    <Kv k="Home Win %" v={`${(game.pred.homeWinPct * 100).toFixed(1)}%`} />
                    <Kv k="O/U Total" v={`${game.pred.ouTotal}`} />
                    <Kv k="Model ML (H)" v={game.pred.modelML_home > 0 ? `+${game.pred.modelML_home}` : game.pred.modelML_home} />
                    {game.odds?.homeML && <Kv k="Market ML (H)" v={game.odds.homeML > 0 ? `+${game.odds.homeML}` : game.odds.homeML} />}
                    <Kv k="Home FIP" v={game.pred.hFIP?.toFixed(2)} />
                    <Kv k="Away FIP" v={game.pred.aFIP?.toFixed(2)} />
                    <Kv k="Home wOBA" v={game.pred.homeWOBA?.toFixed(3)} />
                    <Kv k="Away wOBA" v={game.pred.awayWOBA?.toFixed(3)} />
                    {game.umpire?.name && <Kv k="Umpire" v={`${game.umpire.name} (${game.umpire.size})`} />}
                    <Kv k="Confidence" v={`${game.pred.confidence} (${game.pred.confScore})`} />
                    {game.venue && <Kv k="Venue" v={game.venue} />}
                  </div>
                  <BetSignalsPanel
                    signals={getBetSignals({ pred: game.pred, odds: game.odds, sport: "mlb" })}
                    pred={game.pred} odds={game.odds} sport="mlb"
                    homeName={home.abbr} awayName={away.abbr}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// 🏀 NCAA CALENDAR TAB
// ═══════════════════════════════════════════════════════════════

function NCAACalendarTab({ calibrationFactor, onGamesLoaded }) {
  const todayStr = new Date().toISOString().split("T")[0];
  const [dateStr, setDateStr] = useState(todayStr);
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const [oddsData, setOddsData] = useState(null);

  const loadGames = useCallback(async (d) => {
    setLoading(true); setGames([]);
    const [raw, odds] = await Promise.all([fetchNCAAGamesForDate(d), fetchOdds("basketball_ncaab")]);
    setOddsData(odds);
    const enriched = await Promise.all(raw.map(async (g) => {
      const [homeStats, awayStats] = await Promise.all([fetchNCAATeamStats(g.homeTeamId), fetchNCAATeamStats(g.awayTeamId)]);
      const pred = homeStats && awayStats ? ncaaPredictGame({ homeStats, awayStats, neutralSite: g.neutralSite, calibrationFactor }) : null;
      const gameOdds = odds?.games?.find(o => matchNCAAOddsToGame(o, g)) || null;
      if (gameOdds) console.log("[NCAA odds matched]", g.homeTeamName, "vs", g.awayTeamName, gameOdds);
      else if (odds?.games?.length) console.log("[NCAA odds NO MATCH]", g.homeTeamName, "vs", g.awayTeamName, "available:", odds.games.map(o => o.homeTeam + " vs " + o.awayTeam));
      return { ...g, homeStats, awayStats, pred, loading: false, odds: gameOdds };
    }));
    setGames(enriched);
    onGamesLoaded?.(enriched);
    setLoading(false);
  }, [calibrationFactor]);

  useEffect(() => { loadGames(dateStr); }, [dateStr, calibrationFactor]);

  const getBannerInfo = (pred, odds) => {
    if (!pred) return { color: "yellow", label: "⚠ No prediction" };
    if (odds?.homeML && odds?.awayML) {
      const market = trueImplied(odds.homeML, odds.awayML);
      const homeEdge = pred.homeWinPct - market.home;
      if (Math.abs(homeEdge) >= EDGE_THRESHOLD)
        return { color: "green", edge: homeEdge, label: homeEdge >= EDGE_THRESHOLD ? `+${(homeEdge * 100).toFixed(1)}% HOME edge` : `+${((-homeEdge) * 100).toFixed(1)}% AWAY edge` };
      return { color: "neutral", edge: homeEdge, label: `${(Math.abs(homeEdge) * 100).toFixed(1)}% edge` };
    }
    if (pred.homeWinPct >= 0.65 || pred.homeWinPct <= 0.35) return { color: "green", label: "Strong signal" };
    return { color: "neutral", label: "Close matchup" };
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <input type="date" value={dateStr} onChange={e => setDateStr(e.target.value)} style={{ background: C.card, color: "#e2e8f0", border: `1px solid ${C.border}`, borderRadius: 6, padding: "6px 10px", fontSize: 12, fontFamily: "inherit" }} />
        <button onClick={() => loadGames(dateStr)} style={{ background: "#161b22", color: C.orange, border: `1px solid ${C.border}`, borderRadius: 6, padding: "6px 14px", cursor: "pointer", fontSize: 11, fontWeight: 700 }}>↻ REFRESH</button>
        {!loading && oddsData?.games?.length > 0 && <span style={{ fontSize: 11, color: C.green }}>✓ Live odds ({oddsData.games.length})</span>}
        {!loading && oddsData?.noKey && <span style={{ fontSize: 11, color: C.dim }}>⚠ Add ODDS_API_KEY for live lines</span>}
        {loading && <span style={{ color: C.dim, fontSize: 11 }}>⏳ Loading {games.length > 0 ? `${games.length} games` : "schedule"}…</span>}
        <span style={{ fontSize: 10, color: C.dim }}>NCAA Men's Basketball · ESPN API</span>
      </div>
      {!loading && games.length === 0 && <div style={{ color: C.dim, textAlign: "center", marginTop: 40 }}>No games scheduled for {dateStr}</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {games.map(game => {
          const bannerInfo = game.loading ? { color: "yellow", label: "Calculating…" } : getBannerInfo(game.pred, game.odds);
          const color = bannerInfo.color;
          const isOpen = expanded === game.gameId;
          const bannerBg = color === "green" ? "linear-gradient(135deg,#1a0a00,#221005)" : color === "yellow" ? "linear-gradient(135deg,#1a1200,#1a1500)" : `linear-gradient(135deg,${C.card},#111822)`;
          const borderColor = color === "green" ? "#f97316" : color === "yellow" ? "#4a3a00" : C.border;
          const hName = game.homeAbbr || (game.homeTeamName || "").slice(0, 8);
          const aName = game.awayAbbr || (game.awayTeamName || "").slice(0, 8);

          return (
            <div key={game.gameId} style={{ background: bannerBg, border: `1px solid ${borderColor}`, borderRadius: 10, overflow: "hidden" }}>
              <div onClick={() => setExpanded(isOpen ? null : game.gameId)} style={{ padding: "14px 18px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 200 }}>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 16, fontWeight: 800 }}>{aName}</div>
                    {game.awayRank && <div style={{ fontSize: 9, color: C.orange }}>#{game.awayRank}</div>}
                    <div style={{ fontSize: 9, color: C.dim }}>AWAY</div>
                  </div>
                  <div style={{ fontSize: 13, color: C.dim }}>@</div>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 16, fontWeight: 800 }}>{hName}</div>
                    {game.homeRank && <div style={{ fontSize: 9, color: C.orange }}>#{game.homeRank}</div>}
                    <div style={{ fontSize: 9, color: C.dim }}>HOME{game.neutralSite ? " (N)" : ""}</div>
                  </div>
                </div>
                {game.pred ? (() => {
                  const sigs = getBetSignals({ pred: game.pred, odds: game.odds, sport: "ncaa" });
                  return <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                    <Pill label="PROJ" value={`${aName} ${game.pred.awayScore.toFixed(0)} — ${hName} ${game.pred.homeScore.toFixed(0)}`} />
                    <Pill label="SPREAD" value={game.pred.projectedSpread > 0 ? `${hName} -${game.pred.projectedSpread.toFixed(1)}` : `${aName} -${(-game.pred.projectedSpread).toFixed(1)}`} highlight={sigs.spread?.verdict === "LEAN"} />
                    <Pill label="MDL ML" value={game.pred.modelML_home > 0 ? `+${game.pred.modelML_home}` : game.pred.modelML_home} highlight={sigs.ml?.verdict === "GO" || sigs.ml?.verdict === "LEAN"} />
                    {game.odds?.homeML && <Pill label="MKT ML" value={game.odds.homeML > 0 ? `+${game.odds.homeML}` : game.odds.homeML} color={C.yellow} />}
                    <Pill label="O/U" value={game.pred.ouTotal} highlight={sigs.ou?.verdict === "GO" || sigs.ou?.verdict === "LEAN"} />
                    <Pill label="CONF" value={game.pred.confidence} color={confColor2(game.pred.confidence)} highlight={sigs.conf?.verdict === "GO"} />
                  </div>;
                })() : <div style={{ color: C.dim, fontSize: 11 }}>{game.loading ? "Calculating…" : "⚠ Stats unavailable"}</div>}
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  {game.status === "Final" && <span style={{ fontSize: 10, color: C.green, fontWeight: 700 }}>FINAL {game.awayScore}-{game.homeScore}</span>}
                  {game.status === "Live" && <span style={{ fontSize: 10, color: C.orange, fontWeight: 700 }}>LIVE</span>}
                  {bannerInfo.edge != null && <span style={{ fontSize: 10, color: Math.abs(bannerInfo.edge) >= EDGE_THRESHOLD ? C.orange : C.dim }}>{bannerInfo.label}</span>}
                  <span style={{ color: C.dim, fontSize: 12 }}>{isOpen ? "▲" : "▼"}</span>
                </div>
              </div>
              {isOpen && game.pred && (
                <div style={{ borderTop: `1px solid ${borderColor}`, padding: "14px 18px", background: "rgba(0,0,0,0.3)" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(140px,1fr))", gap: 8, marginBottom: 10 }}>
                    <Kv k="Projected Score" v={`${aName} ${game.pred.awayScore.toFixed(1)} — ${hName} ${game.pred.homeScore.toFixed(1)}`} />
                    <Kv k="Home Win %" v={`${(game.pred.homeWinPct * 100).toFixed(1)}%`} />
                    <Kv k="O/U Total" v={game.pred.ouTotal} />
                    <Kv k="Spread" v={game.pred.projectedSpread > 0 ? `${hName} -${game.pred.projectedSpread.toFixed(1)}` : `${aName} -${(-game.pred.projectedSpread).toFixed(1)}`} />
                    <Kv k="Possessions" v={game.pred.possessions.toFixed(1)} />
                    {game.homeStats && <Kv k={`${hName} Adj EM`} v={game.pred.homeAdjEM} />}
                    {game.awayStats && <Kv k={`${aName} Adj EM`} v={game.pred.awayAdjEM} />}
                    {game.homeStats && <Kv k={`${hName} PPG`} v={game.homeStats.ppg?.toFixed(1)} />}
                    {game.awayStats && <Kv k={`${aName} PPG`} v={game.awayStats.ppg?.toFixed(1)} />}
                    <Kv k="Confidence" v={`${game.pred.confidence} (${game.pred.confScore})`} />
                    {game.neutralSite && <Kv k="Site" v="Neutral" />}
                    {game.venue && <Kv k="Venue" v={game.venue} />}
                  </div>
                  <BetSignalsPanel
                    signals={getBetSignals({ pred: game.pred, odds: game.odds, sport: "ncaa" })}
                    pred={game.pred} odds={game.odds} sport="ncaa"
                    homeName={hName} awayName={aName}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// SPORT-LEVEL WRAPPERS (tabs per sport)
// ═══════════════════════════════════════════════════════════════

function MLBSection({ mlbGames, setMlbGames, calibrationMLB, setCalibrationMLB, refreshKey, setRefreshKey }) {
  const [tab, setTab] = useState("calendar");
  const TABS = ["calendar", "accuracy", "history", "parlay"];
  return (
    <div>
      <div style={{ display: "flex", gap: 4, marginBottom: 16, flexWrap: "wrap" }}>
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ padding: "6px 16px", borderRadius: 7, border: `1px solid ${tab === t ? "#30363d" : "transparent"}`, background: tab === t ? "#161b22" : "transparent", color: tab === t ? C.blue : C.dim, cursor: "pointer", fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase" }}>
            {t === "calendar" ? "📅" : t === "accuracy" ? "📊" : t === "history" ? "📋" : "🎯"} {t}
          </button>
        ))}
        <button onClick={async () => { setRefreshKey(k => k + 1); await mlbAutoSync(msg => console.log(msg)); setRefreshKey(k => k + 1); }} style={{ marginLeft: "auto", background: "#161b22", color: C.muted, border: `1px solid ${C.border}`, borderRadius: 7, padding: "6px 14px", cursor: "pointer", fontSize: 10 }}>⟳ Auto Sync</button>
      </div>
      {tab === "calendar" && <MLBCalendarTab calibrationFactor={calibrationMLB} onGamesLoaded={setMlbGames} />}
      {tab === "accuracy" && <AccuracyDashboard table="mlb_predictions" refreshKey={refreshKey} onCalibrationChange={setCalibrationMLB} spreadLabel="Run Line" />}
      {tab === "history" && <HistoryTab table="mlb_predictions" refreshKey={refreshKey} />}
      {tab === "parlay" && <ParlayBuilder mlbGames={mlbGames} ncaaGames={[]} />}
    </div>
  );
}

function NCAASection({ ncaaGames, setNcaaGames, calibrationNCAA, setCalibrationNCAA, refreshKey, setRefreshKey }) {
  const [tab, setTab] = useState("calendar");
  const [syncMsg, setSyncMsg] = useState("");
  const [backfilling, setBackfilling] = useState(false);
  const abortRef = useRef(null);
  const TABS = ["calendar", "accuracy", "history", "parlay"];

  const handleAutoSync = async () => {
    setSyncMsg("🏀 Syncing…");
    await ncaaAutoSync(msg => setSyncMsg(msg));
    setRefreshKey(k => k + 1);
    setTimeout(() => setSyncMsg(""), 4000);
  };

  const handleFullBackfill = async () => {
    if (backfilling) {
      abortRef.current?.abort();
      setBackfilling(false);
      setSyncMsg("🏀 Backfill cancelled");
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setBackfilling(true);
    setSyncMsg("🏀 Starting full season backfill…");
    await ncaaFullBackfill(msg => setSyncMsg(msg), controller.signal);
    setBackfilling(false);
    setRefreshKey(k => k + 1);
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 4, marginBottom: 8, flexWrap: "wrap", alignItems: "center" }}>
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ padding: "6px 16px", borderRadius: 7, border: `1px solid ${tab === t ? "#30363d" : "transparent"}`, background: tab === t ? "#161b22" : "transparent", color: tab === t ? C.orange : C.dim, cursor: "pointer", fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase" }}>
            {t === "calendar" ? "📅" : t === "accuracy" ? "📊" : t === "history" ? "📋" : "🎯"} {t}
          </button>
        ))}
        <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <button
            onClick={handleAutoSync}
            disabled={backfilling}
            style={{ background: "#161b22", color: C.muted, border: `1px solid ${C.border}`, borderRadius: 7, padding: "6px 12px", cursor: backfilling ? "not-allowed" : "pointer", fontSize: 10 }}
          >⟳ Sync</button>
          <button
            onClick={handleFullBackfill}
            style={{
              background: backfilling ? "#2a0a0a" : "#1a0a00",
              color: backfilling ? C.red : C.orange,
              border: `1px solid ${backfilling ? "#5a1a1a" : "#3a1a00"}`,
              borderRadius: 7, padding: "6px 12px", cursor: "pointer", fontSize: 10, fontWeight: 700,
              animation: backfilling ? "pulse 1.5s ease infinite" : "none"
            }}
          >{backfilling ? "⏹ Cancel" : "⏮ Full Season Backfill"}</button>
          <button
            onClick={async () => {
              if (!window.confirm("Regrade all 967+ NCAA records with updated confidence + ATS logic?")) return;
              setSyncMsg("⏳ Regrading…");
              const n = await ncaaRegradeAllResults(msg => setSyncMsg(msg));
              setRefreshKey(k => k + 1);
              setTimeout(() => setSyncMsg(""), 4000);
            }}
            disabled={backfilling}
            style={{ background: "#1a0a2e", color: "#d2a8ff", border: "1px solid #3d1f6e", borderRadius: 7, padding: "6px 12px", cursor: "pointer", fontSize: 10, fontWeight: 700 }}
          >🔧 Regrade</button>
        </div>
      </div>

      {/* Sync progress bar */}
      {syncMsg && (
        <div style={{ background: "#0d1a10", border: `1px solid #1a3a1a`, borderRadius: 7, padding: "8px 14px", marginBottom: 12, fontSize: 11, color: backfilling ? C.orange : C.green, fontFamily: "monospace", display: "flex", alignItems: "center", gap: 8 }}>
          {backfilling && <span style={{ animation: "pulse 1s ease infinite", fontSize: 14 }}>⏳</span>}
          {syncMsg}
        </div>
      )}

      {/* Season info banner */}
      {!syncMsg && (
        <div style={{ fontSize: 10, color: C.dim, marginBottom: 12, letterSpacing: 1 }}>
          NCAA Men's Basketball · Season starts {_ncaaSeasonStart} · ESPN API (free, no key)
        </div>
      )}

      {tab === "calendar" && <NCAACalendarTab calibrationFactor={calibrationNCAA} onGamesLoaded={setNcaaGames} />}
      {tab === "accuracy" && <AccuracyDashboard table="ncaa_predictions" refreshKey={refreshKey} onCalibrationChange={setCalibrationNCAA} spreadLabel="Spread" isNCAA={true} />}
      {tab === "history" && <HistoryTab table="ncaa_predictions" refreshKey={refreshKey} />}
      {tab === "parlay" && <ParlayBuilder mlbGames={[]} ncaaGames={ncaaGames} />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// 🏀 NBA UI
// ═══════════════════════════════════════════════════════════════

function NBACalendarTab({ calibrationFactor, onGamesLoaded }) {
  const todayStr = new Date().toISOString().split("T")[0];
  const [dateStr, setDateStr] = useState(todayStr);
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const [oddsInfo, setOddsInfo] = useState(null);

  const load = useCallback(async (d) => {
    setLoading(true); setGames([]);
    const [raw, odds] = await Promise.all([fetchNBAGamesForDate(d), fetchOdds("basketball_nba")]);
    setOddsInfo(odds);
    setGames(raw.map(g => ({ ...g, loading: true })));
    const enriched = await Promise.all(raw.map(async g => {
      const [hs, as_] = await Promise.all([fetchNBATeamStats(g.homeAbbr), fetchNBATeamStats(g.awayAbbr)]);
      const pred = hs && as_ ? nbaPredictGame({ homeStats: hs, awayStats: as_, neutralSite: g.neutralSite, calibrationFactor }) : null;
      const gameOdds = odds?.games?.find(o => matchNBAOddsToGame(o, g)) || null;
      return { ...g, homeStats: hs, awayStats: as_, pred, loading: false, odds: gameOdds };
    }));
    setGames(enriched); onGamesLoaded?.(enriched); setLoading(false);
  }, [calibrationFactor]);

  useEffect(() => { load(dateStr); }, [dateStr, calibrationFactor]);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <input type="date" value={dateStr} onChange={e => setDateStr(e.target.value)}
          style={{ background: C.card, color: "#e2e8f0", border: `1px solid ${C.border}`, borderRadius: 6, padding: "6px 10px", fontSize: 12, fontFamily: "inherit" }} />
        <button onClick={() => load(dateStr)}
          style={{ background: "#161b22", color: C.orange, border: `1px solid ${C.border}`, borderRadius: 6, padding: "6px 14px", cursor: "pointer", fontSize: 11, fontWeight: 700 }}>
          ↻ REFRESH
        </button>
        {!loading && oddsInfo?.games?.length > 0 && <span style={{ fontSize: 11, color: C.green }}>✓ Live odds ({oddsInfo.games.length})</span>}
        {loading && <span style={{ color: C.dim, fontSize: 11 }}>⏳ Loading…</span>}
        {!loading && games.length === 0 && <span style={{ color: C.dim, fontSize: 11 }}>No NBA games on {dateStr}</span>}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {games.map(game => {
          const homeColor = NBA_TEAM_COLORS[game.homeAbbr] || "#334";
          const awayColor = NBA_TEAM_COLORS[game.awayAbbr] || "#334";
          const isOpen = expanded === game.gameId;
          const sigs = game.pred ? getBetSignals({ pred: game.pred, odds: game.odds, sport: "nba" }) : null;
          const hasBet = sigs && (sigs.ml?.verdict === "GO" || sigs.spread?.verdict === "LEAN" || sigs.ou?.verdict === "GO");
          return (
            <div key={game.gameId} style={{ background: hasBet ? "linear-gradient(135deg,#0b2012,#0e2315)" : "linear-gradient(135deg,#0d1117,#111822)", border: `1px solid ${hasBet ? "#2ea043" : C.border}`, borderRadius: 10, overflow: "hidden" }}>
              <div style={{ height: 3, background: `linear-gradient(90deg,${awayColor},${homeColor})` }} />
              <div onClick={() => setExpanded(isOpen ? null : game.gameId)}
                style={{ padding: "14px 18px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ width: 36, height: 36, borderRadius: "50%", background: awayColor, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 800, color: "#fff", margin: "0 auto 2px" }}>{game.awayAbbr}</div>
                    <div style={{ fontSize: 9, color: C.dim }}>AWAY</div>
                  </div>
                  <span style={{ color: C.dim }}>@</span>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ width: 36, height: 36, borderRadius: "50%", background: homeColor, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 800, color: "#fff", margin: "0 auto 2px" }}>{game.homeAbbr}</div>
                    <div style={{ fontSize: 9, color: C.dim }}>HOME</div>
                  </div>
                </div>
                {game.pred ? (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <Pill label="PROJ" value={`${game.awayAbbr} ${game.pred.awayScore.toFixed(0)}–${game.pred.homeScore.toFixed(0)} ${game.homeAbbr}`} />
                    <Pill label="SPREAD" value={game.pred.projectedSpread > 0 ? `${game.homeAbbr} -${game.pred.projectedSpread}` : `${game.awayAbbr} -${-game.pred.projectedSpread}`} highlight={sigs?.spread?.verdict === "LEAN"} />
                    <Pill label="MDL ML" value={game.pred.modelML_home > 0 ? `+${game.pred.modelML_home}` : game.pred.modelML_home} highlight={sigs?.ml?.verdict === "GO" || sigs?.ml?.verdict === "LEAN"} />
                    {game.odds?.homeML && <Pill label="MKT ML" value={game.odds.homeML > 0 ? `+${game.odds.homeML}` : game.odds.homeML} color={C.yellow} />}
                    <Pill label="O/U" value={game.pred.ouTotal} highlight={sigs?.ou?.verdict === "GO"} />
                    <Pill label="CONF" value={game.pred.confidence} color={confColor2(game.pred.confidence)} highlight={game.pred.confidence === "HIGH"} />
                  </div>
                ) : (
                  <span style={{ color: C.dim, fontSize: 11 }}>{game.loading ? "Calculating…" : "Stats unavailable"}</span>
                )}
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  {game.status === "Final" && <span style={{ fontSize: 10, color: C.green, fontWeight: 700 }}>FINAL {game.awayScore}–{game.homeScore}</span>}
                  {game.status === "Live" && <span style={{ fontSize: 10, color: C.orange, fontWeight: 700 }}>LIVE</span>}
                  <span style={{ color: C.dim, fontSize: 12 }}>{isOpen ? "▲" : "▼"}</span>
                </div>
              </div>
              {isOpen && game.pred && (
                <div style={{ borderTop: `1px solid ${C.border}`, padding: "14px 18px", background: "rgba(0,0,0,0.3)" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(140px,1fr))", gap: 8, marginBottom: 10 }}>
                    <Kv k="Win %" v={`${game.homeAbbr} ${(game.pred.homeWinPct*100).toFixed(1)}% / ${game.awayAbbr} ${(game.pred.awayWinPct*100).toFixed(1)}%`} />
                    <Kv k="O/U Total" v={game.pred.ouTotal} />
                    <Kv k="Possessions" v={game.pred.possessions} />
                    <Kv k={`${game.homeAbbr} Net Rtg`} v={game.pred.homeNetRtg} />
                    <Kv k={`${game.awayAbbr} Net Rtg`} v={game.pred.awayNetRtg} />
                    {game.homeStats && <Kv k={`${game.homeAbbr} PPG`} v={game.homeStats.ppg?.toFixed(1)} />}
                    {game.awayStats && <Kv k={`${game.awayAbbr} PPG`} v={game.awayStats.ppg?.toFixed(1)} />}
                    {game.homeStats && <Kv k={`${game.homeAbbr} Opp PPG`} v={game.homeStats.oppPpg?.toFixed(1)} />}
                    {game.awayStats && <Kv k={`${game.awayAbbr} Opp PPG`} v={game.awayStats.oppPpg?.toFixed(1)} />}
                    <Kv k="Confidence" v={`${game.pred.confidence} (${game.pred.confScore})`} />
                  </div>
                  <BetSignalsPanel signals={sigs} pred={game.pred} odds={game.odds} sport="nba" homeName={game.homeAbbr} awayName={game.awayAbbr} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function NBASection({ nbaGames, setNbaGames, calibrationNBA, setCalibrationNBA, refreshKey, setRefreshKey }) {
  const [tab, setTab] = useState("calendar");
  const [syncMsg, setSyncMsg] = useState("");
  return (
    <div>
      <div style={{ display: "flex", gap: 4, marginBottom: 8, flexWrap: "wrap", alignItems: "center" }}>
        {["calendar","accuracy","history","parlay"].map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: "6px 16px", borderRadius: 7, border: `1px solid ${tab === t ? "#30363d" : "transparent"}`,
            background: tab === t ? "#161b22" : "transparent", color: tab === t ? C.orange : C.dim,
            cursor: "pointer", fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase",
          }}>
            {t === "calendar" ? "📅" : t === "accuracy" ? "📊" : t === "history" ? "📋" : "🎯"} {t}
          </button>
        ))}
        <div style={{ marginLeft: "auto" }}>
          <button onClick={async () => { setSyncMsg("Syncing…"); await nbaAutoSync(m => setSyncMsg(m)); setRefreshKey(k => k+1); setTimeout(() => setSyncMsg(""), 4000); }}
            style={{ background: "#161b22", color: C.muted, border: `1px solid ${C.border}`, borderRadius: 7, padding: "6px 12px", cursor: "pointer", fontSize: 10 }}>
            ⟳ Sync
          </button>
        </div>
      </div>
      {syncMsg && <div style={{ background: "#0d1a10", border: "1px solid #1a3a1a", borderRadius: 7, padding: "8px 14px", marginBottom: 12, fontSize: 11, color: C.green, fontFamily: "monospace" }}>{syncMsg}</div>}
      {tab === "calendar" && <NBACalendarTab calibrationFactor={calibrationNBA} onGamesLoaded={setNbaGames} />}
      {tab === "accuracy" && <AccuracyDashboard table="nba_predictions" refreshKey={refreshKey} onCalibrationChange={setCalibrationNBA} spreadLabel="Spread" />}
      {tab === "history" && <HistoryTab table="nba_predictions" refreshKey={refreshKey} />}
      {tab === "parlay" && <ParlayBuilder mlbGames={[]} ncaaGames={nbaGames} />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// 🏈 NFL UI
// ═══════════════════════════════════════════════════════════════

function NFLCalendarTab({ calibrationFactor, onGamesLoaded }) {
  const todayStr = new Date().toISOString().split("T")[0];
  const [dateStr, setDateStr] = useState(todayStr);
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const [oddsInfo, setOddsInfo] = useState(null);

  const load = useCallback(async (d) => {
    setLoading(true); setGames([]);
    const [raw, odds] = await Promise.all([fetchNFLGamesForDate(d), fetchOdds("americanfootball_nfl")]);
    setOddsInfo(odds);
    setGames(raw.map(g => ({ ...g, loading: true })));
    const enriched = await Promise.all(raw.map(async g => {
      const [hs, as_] = await Promise.all([fetchNFLTeamStats(g.homeAbbr), fetchNFLTeamStats(g.awayAbbr)]);
      const pred = hs && as_ ? nflPredictGame({ homeStats: hs, awayStats: as_, neutralSite: g.neutralSite, weather: g.weather, calibrationFactor }) : null;
      const gameOdds = odds?.games?.find(o => matchNFLOddsToGame(o, g)) || null;
      return { ...g, homeStats: hs, awayStats: as_, pred, loading: false, odds: gameOdds };
    }));
    setGames(enriched); onGamesLoaded?.(enriched); setLoading(false);
  }, [calibrationFactor]);

  useEffect(() => { load(dateStr); }, [dateStr, calibrationFactor]);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <input type="date" value={dateStr} onChange={e => setDateStr(e.target.value)}
          style={{ background: C.card, color: "#e2e8f0", border: `1px solid ${C.border}`, borderRadius: 6, padding: "6px 10px", fontSize: 12, fontFamily: "inherit" }} />
        <button onClick={() => load(dateStr)}
          style={{ background: "#161b22", color: "#f97316", border: `1px solid ${C.border}`, borderRadius: 6, padding: "6px 14px", cursor: "pointer", fontSize: 11, fontWeight: 700 }}>
          ↻ REFRESH
        </button>
        {!loading && oddsInfo?.games?.length > 0 && <span style={{ fontSize: 11, color: C.green }}>✓ Live odds ({oddsInfo.games.length})</span>}
        {loading && <span style={{ color: C.dim, fontSize: 11 }}>⏳ Loading NFL games…</span>}
        {!loading && games.length === 0 && <span style={{ color: C.dim, fontSize: 11 }}>No NFL games on {dateStr} — try Thu/Sun/Mon</span>}
        {!loading && games.length > 0 && <span style={{ fontSize: 10, color: C.dim }}>Week {games[0]?.week || "—"} · {games[0]?.season || ""} Season</span>}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {games.map(game => {
          const homeTeam = nflTeamByAbbr(game.homeAbbr);
          const awayTeam = nflTeamByAbbr(game.awayAbbr);
          const isOpen = expanded === game.gameId;
          const sigs = game.pred ? getBetSignals({ pred: game.pred, odds: game.odds, sport: "nfl" }) : null;
          const hasBet = sigs && (sigs.ml?.verdict === "GO" || sigs.spread?.verdict === "LEAN" || sigs.ou?.verdict === "GO");
          return (
            <div key={game.gameId} style={{ background: hasBet ? "linear-gradient(135deg,#0b2012,#0e2315)" : "linear-gradient(135deg,#0d1117,#111822)", border: `1px solid ${hasBet ? "#2ea043" : C.border}`, borderRadius: 10, overflow: "hidden" }}>
              <div style={{ height: 3, background: `linear-gradient(90deg,${awayTeam.color},${homeTeam.color})` }} />
              <div onClick={() => setExpanded(isOpen ? null : game.gameId)}
                style={{ padding: "14px 18px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ width: 36, height: 36, borderRadius: "50%", background: awayTeam.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 800, color: "#fff", margin: "0 auto 2px" }}>{game.awayAbbr}</div>
                    <div style={{ fontSize: 9, color: C.dim }}>AWAY</div>
                  </div>
                  <span style={{ color: C.dim, fontSize: 13 }}>@</span>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ width: 36, height: 36, borderRadius: "50%", background: homeTeam.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 800, color: "#fff", margin: "0 auto 2px" }}>{game.homeAbbr}</div>
                    <div style={{ fontSize: 9, color: C.dim }}>HOME{game.neutralSite ? " (N)" : ""}</div>
                  </div>
                  {game.weather?.note && <span style={{ fontSize: 9, color: C.dim, marginLeft: 4 }}>{game.weather.note}</span>}
                </div>
                {game.pred ? (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <Pill label="PROJ" value={`${game.awayAbbr} ${game.pred.awayScore.toFixed(0)}–${game.pred.homeScore.toFixed(0)} ${game.homeAbbr}`} />
                    <Pill label="SPREAD" value={game.pred.projectedSpread > 0 ? `${game.homeAbbr} -${game.pred.projectedSpread}` : `${game.awayAbbr} -${-game.pred.projectedSpread}`} highlight={sigs?.spread?.verdict === "LEAN"} />
                    <Pill label="MDL ML" value={game.pred.modelML_home > 0 ? `+${game.pred.modelML_home}` : game.pred.modelML_home} highlight={sigs?.ml?.verdict === "GO" || sigs?.ml?.verdict === "LEAN"} />
                    {game.odds?.homeML && <Pill label="MKT ML" value={game.odds.homeML > 0 ? `+${game.odds.homeML}` : game.odds.homeML} color={C.yellow} />}
                    <Pill label="O/U" value={game.pred.ouTotal} highlight={sigs?.ou?.verdict === "GO"} />
                    <Pill label="CONF" value={game.pred.confidence} color={confColor2(game.pred.confidence)} highlight={game.pred.confidence === "HIGH"} />
                  </div>
                ) : (
                  <span style={{ color: C.dim, fontSize: 11 }}>{game.loading ? "Calculating…" : "Stats unavailable"}</span>
                )}
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  {game.status === "Final" && <span style={{ fontSize: 10, color: C.green, fontWeight: 700 }}>FINAL {game.awayScore}–{game.homeScore}</span>}
                  {game.status === "Live" && <span style={{ fontSize: 10, color: "#f97316", fontWeight: 700 }}>LIVE</span>}
                  <span style={{ color: C.dim, fontSize: 12 }}>{isOpen ? "▲" : "▼"}</span>
                </div>
              </div>
              {isOpen && game.pred && (
                <div style={{ borderTop: `1px solid ${C.border}`, padding: "14px 18px", background: "rgba(0,0,0,0.3)" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(140px,1fr))", gap: 8, marginBottom: 10 }}>
                    <Kv k="Projected Score" v={`${game.awayAbbr} ${game.pred.awayScore.toFixed(1)} — ${game.homeAbbr} ${game.pred.homeScore.toFixed(1)}`} />
                    <Kv k="Home Win %" v={`${(game.pred.homeWinPct*100).toFixed(1)}%`} />
                    <Kv k="O/U Total" v={game.pred.ouTotal} />
                    <Kv k="Spread" v={game.pred.projectedSpread > 0 ? `${game.homeAbbr} -${game.pred.projectedSpread}` : `${game.awayAbbr} -${-game.pred.projectedSpread}`} />
                    {game.homeStats && <Kv k={`${game.homeAbbr} PPG / OppPPG`} v={`${game.homeStats.ppg?.toFixed(1)} / ${game.homeStats.oppPpg?.toFixed(1)}`} />}
                    {game.awayStats && <Kv k={`${game.awayAbbr} PPG / OppPPG`} v={`${game.awayStats.ppg?.toFixed(1)} / ${game.awayStats.oppPpg?.toFixed(1)}`} />}
                    {game.homeStats && <Kv k={`${game.homeAbbr} Yds/Play`} v={`${game.homeStats.ypPlay?.toFixed(1)} off / ${game.homeStats.oppYpPlay?.toFixed(1)} def`} />}
                    {game.awayStats && <Kv k={`${game.awayAbbr} Yds/Play`} v={`${game.awayStats.ypPlay?.toFixed(1)} off / ${game.awayStats.oppYpPlay?.toFixed(1)} def`} />}
                    {game.pred.homeEPA != null && <Kv k={`${game.homeAbbr} Net EPA`} v={game.pred.homeEPA > 0 ? `+${game.pred.homeEPA}` : `${game.pred.homeEPA}`} />}
                    {game.pred.awayEPA != null && <Kv k={`${game.awayAbbr} Net EPA`} v={game.pred.awayEPA > 0 ? `+${game.pred.awayEPA}` : `${game.pred.awayEPA}`} />}
                    {game.homeStats && <Kv k={`${game.homeAbbr} TO Margin`} v={game.homeStats.turnoverMargin > 0 ? `+${game.homeStats.turnoverMargin?.toFixed(1)}` : game.homeStats.turnoverMargin?.toFixed(1)} />}
                    {game.awayStats && <Kv k={`${game.awayAbbr} TO Margin`} v={game.awayStats.turnoverMargin > 0 ? `+${game.awayStats.turnoverMargin?.toFixed(1)}` : game.awayStats.turnoverMargin?.toFixed(1)} />}
                    <Kv k="Confidence" v={`${game.pred.confidence} (${game.pred.confScore})`} />
                    {game.week && <Kv k="Week" v={game.week} />}
                    {game.weather?.note && <Kv k="Weather" v={game.weather.note} />}
                  </div>
                  {game.pred.factors?.length > 0 && (
                    <div style={{ marginBottom: 10 }}>
                      <div style={{ fontSize: 10, color: C.dim, letterSpacing: 2, marginBottom: 6 }}>KEY FACTORS</div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {game.pred.factors.map((f, i) => (
                          <div key={i} style={{
                            background: f.type==="home"?"#001a0f":f.type==="away"?"#1a0008":"#1a1200",
                            border: `1px solid ${f.type==="home"?"#003820":f.type==="away"?"#330011":"#3a2a00"}`,
                            borderRadius: 6, padding: "4px 10px", fontSize: 11,
                            color: f.type==="home"?C.green:f.type==="away"?"#ff4466":C.yellow,
                          }}>
                            {f.label}: {f.val}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  <BetSignalsPanel signals={sigs} pred={game.pred} odds={game.odds} sport="nfl" homeName={game.homeAbbr} awayName={game.awayAbbr} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function NFLSection({ nflGames, setNflGames, calibrationNFL, setCalibrationNFL, refreshKey, setRefreshKey }) {
  const [tab, setTab] = useState("calendar");
  const [syncMsg, setSyncMsg] = useState("");
  return (
    <div>
      <div style={{ display: "flex", gap: 4, marginBottom: 8, flexWrap: "wrap", alignItems: "center" }}>
        {["calendar","accuracy","history","parlay"].map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: "6px 16px", borderRadius: 7, border: `1px solid ${tab === t ? "#30363d" : "transparent"}`,
            background: tab === t ? "#161b22" : "transparent", color: tab === t ? "#f97316" : C.dim,
            cursor: "pointer", fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase",
          }}>
            {t === "calendar" ? "📅" : t === "accuracy" ? "📊" : t === "history" ? "📋" : "🎯"} {t}
          </button>
        ))}
        <div style={{ marginLeft: "auto" }}>
          <button onClick={async () => { setSyncMsg("Syncing NFL…"); await nflAutoSync(m => setSyncMsg(m)); setRefreshKey(k => k+1); setTimeout(() => setSyncMsg(""), 4000); }}
            style={{ background: "#161b22", color: C.muted, border: `1px solid ${C.border}`, borderRadius: 7, padding: "6px 12px", cursor: "pointer", fontSize: 10 }}>
            ⟳ Sync
          </button>
        </div>
      </div>
      {syncMsg && <div style={{ background: "#0d1a10", border: "1px solid #1a3a1a", borderRadius: 7, padding: "8px 14px", marginBottom: 12, fontSize: 11, color: C.green, fontFamily: "monospace" }}>{syncMsg}</div>}
      <div style={{ fontSize: 10, color: C.dim, marginBottom: 12, letterSpacing: 1 }}>
        NFL · ESPN API (free, no key) · Games: Thu / Sun / Mon · Weather + EPA + Turnover model
      </div>
      {tab === "calendar" && <NFLCalendarTab calibrationFactor={calibrationNFL} onGamesLoaded={setNflGames} />}
      {tab === "accuracy" && <AccuracyDashboard table="nfl_predictions" refreshKey={refreshKey} onCalibrationChange={setCalibrationNFL} spreadLabel="Spread" />}
      {tab === "history" && <HistoryTab table="nfl_predictions" refreshKey={refreshKey} />}
      {tab === "parlay" && <ParlayBuilder mlbGames={[]} ncaaGames={nflGames} />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// ROOT APP
// ═══════════════════════════════════════════════════════════════

export default function App() {
  const [sport, setSport] = useState("MLB");
  const [mlbGames, setMlbGames] = useState([]);
  const [ncaaGames, setNcaaGames] = useState([]);
  const [nbaGames, setNbaGames] = useState([]);
  const [nflGames, setNflGames] = useState([]);
  const [calibrationMLB, setCalibrationMLB] = useState(() => {
    try { const v = parseFloat(localStorage.getItem("cal_mlb")); return isNaN(v) ? 1.0 : v; } catch { return 1.0; }
  });
  const [calibrationNCAA, setCalibrationNCAA] = useState(() => {
    try { const v = parseFloat(localStorage.getItem("cal_ncaa")); return isNaN(v) ? 1.0 : v; } catch { return 1.0; }
  });
  const [calibrationNBA, setCalibrationNBA] = useState(() => {
    try { const v = parseFloat(localStorage.getItem("cal_nba")); return isNaN(v) ? 1.0 : v; } catch { return 1.0; }
  });
  const [calibrationNFL, setCalibrationNFL] = useState(() => {
    try { const v = parseFloat(localStorage.getItem("cal_nfl")); return isNaN(v) ? 1.0 : v; } catch { return 1.0; }
  });
  useEffect(() => { try { localStorage.setItem("cal_mlb", calibrationMLB); } catch {} }, [calibrationMLB]);
  useEffect(() => { try { localStorage.setItem("cal_ncaa", calibrationNCAA); } catch {} }, [calibrationNCAA]);
  useEffect(() => { try { localStorage.setItem("cal_nba", calibrationNBA); } catch {} }, [calibrationNBA]);
  useEffect(() => { try { localStorage.setItem("cal_nfl", calibrationNFL); } catch {} }, [calibrationNFL]);

  const [refreshKey, setRefreshKey] = useState(0);
  const [syncMsg, setSyncMsg] = useState("");

  useEffect(() => {
    (async () => {
      setSyncMsg("⚾ Syncing MLB…");
      await mlbAutoSync(m => setSyncMsg(m));
      setSyncMsg("🏀 Syncing NCAA…");
      await ncaaAutoSync(m => setSyncMsg(m));
      setSyncMsg("🏀 Syncing NBA…");
      await nbaAutoSync(m => setSyncMsg(m));
      setSyncMsg("🏈 Syncing NFL…");
      await nflAutoSync(m => setSyncMsg(m));
      setSyncMsg("");
      setRefreshKey(k => k + 1);
    })();
  }, []);

  const calActive = [
    calibrationMLB !== 1.0 && `MLB×${calibrationMLB}`,
    calibrationNCAA !== 1.0 && `NCAA×${calibrationNCAA}`,
    calibrationNBA !== 1.0 && `NBA×${calibrationNBA}`,
    calibrationNFL !== 1.0 && `NFL×${calibrationNFL}`,
  ].filter(Boolean);

  return (
    <div style={{ background: C.bg, minHeight: "100vh", color: "#e2e8f0", fontFamily: "'JetBrains Mono','Fira Code','Courier New',monospace" }}>
      <style>{`
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 5px; height: 5px; }
        ::-webkit-scrollbar-track { background: ${C.bg}; }
        ::-webkit-scrollbar-thumb { background: #21262d; border-radius: 3px; }
        select option { background: #0d1117; }
        button { font-family: inherit; }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.5} }
      `}</style>

      {/* NAV */}
      <div style={{ borderBottom: `1px solid ${C.border}`, padding: "0 16px", display: "flex", alignItems: "center", gap: 12, height: 52, position: "sticky", top: 0, background: "#0d1117", zIndex: 100, flexWrap: "wrap" }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: "#e2e8f0", letterSpacing: 1, whiteSpace: "nowrap" }}>
          ⚾🏀🏀🏈 <span style={{ fontSize: 9, color: C.dim, letterSpacing: 2 }}>PREDICTOR v12</span>
        </div>
        <div style={{ display: "flex", gap: 2, background: "#080c10", border: `1px solid ${C.border}`, borderRadius: 8, padding: 3, marginLeft: "auto" }}>
          {[["MLB","⚾",C.blue],["NCAA","🏀",C.orange],["NBA","🏀","#58a6ff"],["NFL","🏈","#f97316"]].map(([s,icon,col]) => (
            <button key={s} onClick={() => setSport(s)} style={{
              padding: "4px 12px", borderRadius: 6, border: "none", cursor: "pointer",
              fontSize: 11, fontWeight: 800, background: sport === s ? col : "transparent",
              color: sport === s ? C.bg : C.dim, transition: "all 0.15s",
            }}>{icon} {s}</button>
          ))}
          <button onClick={() => setSport("PARLAY")} style={{
            padding: "4px 12px", borderRadius: 6, border: "none", cursor: "pointer",
            fontSize: 11, fontWeight: 800, background: sport === "PARLAY" ? C.green : "transparent",
            color: sport === "PARLAY" ? C.bg : C.dim, transition: "all 0.15s",
          }}>🎯 PARLAY</button>
        </div>
        {syncMsg && <div style={{ fontSize: 10, color: C.dim, animation: "pulse 1.5s ease infinite", whiteSpace: "nowrap" }}>{syncMsg}</div>}
        {calActive.length > 0 && (
          <div style={{ fontSize: 10, color: C.yellow, background: "#1a1200", border: `1px solid #3a2a00`, borderRadius: 5, padding: "3px 8px" }}>
            Cal: {calActive.join(" ")}
          </div>
        )}
      </div>

      {/* CONTENT */}
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "24px 16px" }}>
        {sport === "MLB" && <MLBSection mlbGames={mlbGames} setMlbGames={setMlbGames} calibrationMLB={calibrationMLB} setCalibrationMLB={setCalibrationMLB} refreshKey={refreshKey} setRefreshKey={setRefreshKey} />}
        {sport === "NCAA" && <NCAASection ncaaGames={ncaaGames} setNcaaGames={setNcaaGames} calibrationNCAA={calibrationNCAA} setCalibrationNCAA={setCalibrationNCAA} refreshKey={refreshKey} setRefreshKey={setRefreshKey} />}
        {sport === "NBA" && <NBASection nbaGames={nbaGames} setNbaGames={setNbaGames} calibrationNBA={calibrationNBA} setCalibrationNBA={setCalibrationNBA} refreshKey={refreshKey} setRefreshKey={setRefreshKey} />}
        {sport === "NFL" && <NFLSection nflGames={nflGames} setNflGames={setNflGames} calibrationNFL={calibrationNFL} setCalibrationNFL={setCalibrationNFL} refreshKey={refreshKey} setRefreshKey={setRefreshKey} />}
        {sport === "PARLAY" && (
          <div>
            <div style={{ fontSize: 12, color: C.dim, marginBottom: 16, letterSpacing: 1 }}>Combined parlay builder — load games in each sport's calendar first, then build here</div>
            <ParlayBuilder mlbGames={mlbGames} ncaaGames={[...ncaaGames, ...nbaGames, ...nflGames]} />
          </div>
        )}
      </div>

      {/* FOOTER */}
      <div style={{ textAlign: "center", padding: "16px", borderTop: `1px solid ${C.border}`, fontSize: 9, color: "#21262d", letterSpacing: 2 }}>
        MULTI-SPORT PREDICTOR v12 · MLB (statsapi.mlb.com) · NCAA + NBA + NFL (ESPN API) · {SEASON}
      </div>
    </div>
  );
}
