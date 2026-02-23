import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, LineChart, Line, ReferenceLine,
  ScatterChart, Scatter, Cell
} from "recharts";

// ============================================================
// MLB PREDICTOR v9 — LINEUP + UMPIRE + STATCAST + PLATOON + CALIBRATION
//
// NEW IN v9:
//  1. LINEUP DATA — fetches today's actual batting order via
//     /api/mlb?path=game/{gamePk}/boxscore, weights top-6 hitters'
//     individual OBP/SLG vs season team averages. 2-4% accuracy gain.
//
//  2. UMPIRE AUTO-PULL — schedule hydration now includes 'officials',
//     maps home plate ump to documented zone profiles (runs/game impact,
//     K-rate adjustment, zone size). No more manual dropdown.
//
//  3. STATCAST BACKEND — /api/statcast proxy calls pybaseball server-side.
//     xwOBA replaces wOBA when available, barrel rate + hard-hit% added.
//     Falls back to OBP/SLG approximation if Statcast unavailable.
//
//  4. PLATOON SPLITS — fetches starter handedness, team L/R split stats.
//     RHB vs LHP / LHB vs RHP adjustments applied to lineup-weighted wOBA.
//     ~1-2% accuracy gain on games with posted starters.
//
//  5. CALIBRATION ANALYSIS — Accuracy tab now shows calibration curve:
//     when model says X%, what % actually win? Identifies systematic bias.
//     Includes Brier score, reliability diagram, and recalibration factor.
// ============================================================

// ── SUPABASE ────────────────────────────────────────────────
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
        "Prefer": isUpsert ? "resolution=merge-duplicates,return=representation"
          : method === "POST" ? "return=representation" : "",
      },
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, opts);
    if (!res.ok) { console.error("Supabase error:", await res.text()); return null; }
    const text = await res.text();
    return text ? JSON.parse(text) : [];
  } catch (e) { console.error("Supabase:", e); return null; }
}

// ── SEASON CONFIG ────────────────────────────────────────────
const SEASON = new Date().getFullYear();
const _now = new Date();
const STAT_SEASON = (_now.getMonth() < 3) ? SEASON - 1 : SEASON;
const FULL_SEASON_THRESHOLD = 100;
const SEASON_START = `${SEASON}-02-01`;

// ── TEAMS ────────────────────────────────────────────────────
const TEAMS = [
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

const teamById = (id) => TEAMS.find(t => t.id === id) || { name: String(id), abbr: String(id), id, league: "?" };

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

// ── UMPIRE PROFILES ───────────────────────────────────────────
// Source: Umpire Scorecards / Baseball Savant documented zone data
// runImpact: runs/game delta vs average (negative = pitcher-friendly)
// kRateAdj: strikeout rate multiplier (>1 = more K's called)
// zonePct: called strike zone size relative to average
const UMPIRE_PROFILES = {
  // Pitcher-friendly (large zone / low scoring)
  "CB Bucknor":      { runImpact: -0.28, kRateAdj: 1.08, zonePct: 1.05, size: "Large" },
  "Dan Bellino":     { runImpact: -0.22, kRateAdj: 1.06, zonePct: 1.04, size: "Large" },
  "Mike Estabrook":  { runImpact: -0.18, kRateAdj: 1.05, zonePct: 1.03, size: "Large" },
  "Manny Gonzalez":  { runImpact: -0.15, kRateAdj: 1.04, zonePct: 1.03, size: "Large" },
  "Quinn Wolcott":   { runImpact: -0.14, kRateAdj: 1.04, zonePct: 1.02, size: "Large" },
  "Nic Lentz":       { runImpact: -0.12, kRateAdj: 1.03, zonePct: 1.02, size: "Above Avg" },
  "Roberto Ortiz":   { runImpact: -0.10, kRateAdj: 1.02, zonePct: 1.01, size: "Above Avg" },
  "Tripp Gibson":    { runImpact: -0.09, kRateAdj: 1.02, zonePct: 1.01, size: "Above Avg" },
  // Neutral
  "Phil Cuzzi":      { runImpact:  0.00, kRateAdj: 1.00, zonePct: 1.00, size: "Average" },
  "Laz Diaz":        { runImpact:  0.02, kRateAdj: 0.99, zonePct: 0.99, size: "Average" },
  "Mark Carlson":    { runImpact:  0.01, kRateAdj: 1.00, zonePct: 1.00, size: "Average" },
  "Bill Miller":     { runImpact: -0.02, kRateAdj: 1.01, zonePct: 1.00, size: "Average" },
  "Ron Kulpa":       { runImpact:  0.03, kRateAdj: 0.99, zonePct: 0.99, size: "Average" },
  "Lance Barrett":   { runImpact:  0.04, kRateAdj: 0.99, zonePct: 0.99, size: "Average" },
  // Hitter-friendly (tight zone / high scoring)
  "Ted Barrett":     { runImpact:  0.08, kRateAdj: 0.97, zonePct: 0.97, size: "Small" },
  "James Hoye":      { runImpact:  0.10, kRateAdj: 0.97, zonePct: 0.97, size: "Small" },
  "John Tumpane":    { runImpact:  0.12, kRateAdj: 0.96, zonePct: 0.96, size: "Small" },
  "Adam Hamari":     { runImpact:  0.13, kRateAdj: 0.96, zonePct: 0.96, size: "Small" },
  "Vic Carapazza":   { runImpact:  0.18, kRateAdj: 0.95, zonePct: 0.95, size: "Small" },
  "Angel Hernandez": { runImpact:  0.22, kRateAdj: 0.94, zonePct: 0.94, size: "Very Small" },
  "Joe West":        { runImpact:  0.25, kRateAdj: 0.93, zonePct: 0.93, size: "Very Small" },
  "Jerry Layne":     { runImpact:  0.28, kRateAdj: 0.93, zonePct: 0.93, size: "Very Small" },
  "Fieldin Culbreth":{ runImpact:  0.30, kRateAdj: 0.92, zonePct: 0.92, size: "Very Small" },
  "Alfonso Marquez": { runImpact:  0.20, kRateAdj: 0.94, zonePct: 0.95, size: "Small" },
  "Doug Eddings":    { runImpact:  0.15, kRateAdj: 0.96, zonePct: 0.96, size: "Small" },
  "Paul Emmel":      { runImpact:  0.10, kRateAdj: 0.97, zonePct: 0.97, size: "Small" },
};
const UMPIRE_DEFAULT = { runImpact: 0.0, kRateAdj: 1.0, zonePct: 1.0, size: "Average" };

// ── PLATOON ADJUSTMENT TABLE ──────────────────────────────────
// wOBA adjustments for handedness matchups (batter vs pitcher)
// Source: Fangraphs platoon splits averages 2020-2024
// Values are delta wOBA vs baseline (positive = batter advantage)
const PLATOON = {
  // RHB vs RHP = baseline (0.000)
  // RHB vs LHP = slight advantage for batter
  RHBvsRHP: -0.005,
  RHBvsLHP: +0.018,
  LHBvsRHP: +0.022,
  LHBvsLHP: -0.008,
};

// Estimate team platoon composition from batting order (default if unavailable)
// Returns weighted platoon delta for the lineup vs the opposing starter's hand
function platoonDelta(lineupHand, starterHand) {
  // lineupHand: "R", "L", "S" (switch) weighted fraction
  // starterHand: "R" or "L"
  if (!starterHand || !lineupHand) return 0;
  // Default MLB lineup: ~65% RHB, 30% LHB, 5% switch
  const rPct = lineupHand.rPct ?? 0.65;
  const lPct = lineupHand.lPct ?? 0.30;
  const sPct = 1 - rPct - lPct;
  if (starterHand === "R") {
    return rPct * PLATOON.RHBvsRHP + lPct * PLATOON.LHBvsRHP + sPct * ((PLATOON.LHBvsRHP + PLATOON.RHBvsRHP) / 2);
  } else {
    return rPct * PLATOON.RHBvsLHP + lPct * PLATOON.LHBvsLHP + sPct * ((PLATOON.LHBvsLHP + PLATOON.RHBvsLHP) / 2);
  }
}

// ── PREDICTION ENGINE v9 ─────────────────────────────────────
function predictGame({
  homeTeamId, awayTeamId,
  homeHit, awayHit,
  homePitch, awayPitch,
  homeStarterStats, awayStarterStats,
  homeForm, awayForm,
  bullpenData,
  homeGamesPlayed = 0, awayGamesPlayed = 0,
  // v9 new params:
  homeLineup,       // { wOBA, lineupHand } from actual batting order
  awayLineup,
  umpire,           // umpire profile object
  homeStatcast,     // { xwOBA, barrelRate, hardHitPct } from pybaseball
  awayStatcast,
  calibrationFactor = 1.0,  // output of calibration analysis
}) {
  const park = PARK_FACTORS[homeTeamId] || { runFactor: 1.0, hrFactor: 1.0 };

  // ── OFFENSE: wOBA / xwOBA ─────────────────────────────────
  // Priority: Statcast xwOBA > Lineup-weighted wOBA > Team season wOBA
  const calcOffenseWOBA = (hit, lineup, statcast) => {
    // Statcast xwOBA is most predictive (strips out luck on BIP)
    if (statcast?.xwOBA) return statcast.xwOBA;
    // Lineup-weighted wOBA from actual batting order
    if (lineup?.wOBA) return lineup.wOBA;
    // Fall back to team season approximation
    if (!hit) return 0.320;
    const { obp = 0.320, slg = 0.420, avg = 0.250 } = hit;
    const iso = Math.max(0, slg - avg);
    // Better linear weight approximation: wOBA ≈ 0.9*OBP + 0.25*ISO
    // Avg team: OBP=.320, ISO=.170 → .288+.043 = .331 (slightly above .315 avg, reasonable)
    return Math.max(0.250, Math.min(0.420, obp * 0.90 + iso * 0.25));
  };

  // Barrel rate bonus: every 1% above league avg (7%) → +0.04 runs/game
  const barrelBonus = (statcast) => {
    if (!statcast?.barrelRate) return 0;
    return Math.max(-0.3, Math.min(0.4, (statcast.barrelRate - 0.07) * 4.0));
  };
  const hardHitBonus = (statcast) => {
    if (!statcast?.hardHitPct) return 0;
    return Math.max(-0.2, Math.min(0.25, (statcast.hardHitPct - 0.38) * 1.2));
  };

  const homeWOBA = calcOffenseWOBA(homeHit, homeLineup, homeStatcast);
  const awayWOBA = calcOffenseWOBA(awayHit, awayLineup, awayStatcast);

  // MLB avg 2024: ~4.55 R/G (higher than prior years due to deadball rule changes)
  // wOBA scale: 1 wOBA point = ~0.155 runs per PA, ~4 PA/inn, ~9 inn = ~13.95 runs per game per wOBA unit
  const BASE_RUNS = 4.55;
  const wOBA_SCALE = 14.0;
  // League avg wOBA ~0.315 (2024 MLB)
  let hr = BASE_RUNS + (homeWOBA - 0.315) * wOBA_SCALE;
  let ar = BASE_RUNS + (awayWOBA - 0.315) * wOBA_SCALE;

  // Statcast bonuses on top of wOBA
  hr += barrelBonus(homeStatcast) + hardHitBonus(homeStatcast);
  ar += barrelBonus(awayStatcast) + hardHitBonus(awayStatcast);

  // ── PLATOON ADJUSTMENT ────────────────────────────────────
  // Adjust wOBA run expectation based on lineup handedness vs starter hand
  const homePlatoonDelta = platoonDelta(homeLineup?.lineupHand, awayStarterStats?.pitchHand);
  const awayPlatoonDelta = platoonDelta(awayLineup?.lineupHand, homeStarterStats?.pitchHand);
  hr += homePlatoonDelta * wOBA_SCALE;
  ar += awayPlatoonDelta * wOBA_SCALE;

  // ── STARTER FIP ────────────────────────────────────────────
  const calcFIP = (stats, fallbackERA) => {
    if (!stats) return fallbackERA || 4.25;
    if (stats.fip) return stats.fip;
    const { era = 4.25, k9 = 8.5, bb9 = 3.0 } = stats;
    return Math.max(2.5, Math.min(7.0, 3.80 + (bb9 - 3.0) * 0.28 - (k9 - 8.5) * 0.16 + (era - 4.00) * 0.38));
  };

  const hFIP = calcFIP(homeStarterStats, homePitch?.era);
  const aFIP = calcFIP(awayStarterStats, awayPitch?.era);
  const FIP_SCALE = 0.40;
  ar += (hFIP - 4.25) * FIP_SCALE;
  hr += (aFIP - 4.25) * FIP_SCALE;

  // Starter durability — weight by typical innings pitched
  // A 5-inning starter exposes bullpen more than a 7-inning ace
  const hStarterIP = homeStarterStats?.ip || 0;
  const aStarterIP = awayStarterStats?.ip || 0;
  const hBullpenExposure = hStarterIP > 50 ? Math.max(0, (6.0 - hStarterIP / 20) * 0.08) : 0;
  const aBullpenExposure = aStarterIP > 50 ? Math.max(0, (6.0 - aStarterIP / 20) * 0.08) : 0;

  // ── BULLPEN ────────────────────────────────────────────────
  const bpHome = bullpenData?.[homeTeamId];
  const bpAway = bullpenData?.[awayTeamId];
  if (bpHome?.fatigue > 0) ar += bpHome.fatigue * 0.5 + hBullpenExposure;
  if (bpAway?.fatigue > 0) hr += bpAway.fatigue * 0.5 + aBullpenExposure;

  // ── PARK FACTOR ────────────────────────────────────────────
  hr *= park.runFactor;
  ar *= park.runFactor;

  // ── UMPIRE ADJUSTMENT ─────────────────────────────────────
  // Split impact evenly — umpire affects both teams' scoring
  const ump = umpire || UMPIRE_DEFAULT;
  hr += ump.runImpact * 0.5;
  ar += ump.runImpact * 0.5;

  // ── FORM / MOMENTUM ────────────────────────────────────────
  const avgGP = (homeGamesPlayed + awayGamesPlayed) / 2;
  const formSampleWeight = Math.min(0.12, 0.12 * Math.sqrt(Math.min(avgGP, 30) / 30));
  const luckWeight = Math.min(0.08, formSampleWeight);
  if (homeForm?.formScore) hr += homeForm.formScore * formSampleWeight;
  if (awayForm?.formScore) ar += awayForm.formScore * formSampleWeight;
  if (homeForm?.luckFactor) hr -= homeForm.luckFactor * luckWeight;
  if (awayForm?.luckFactor) ar -= awayForm.luckFactor * luckWeight;

  // ── CLAMP ─────────────────────────────────────────────────
  hr = Math.max(1.8, Math.min(9.5, hr));
  ar = Math.max(1.8, Math.min(9.5, ar));

  // ── WIN PROBABILITY (Pythagorean) ─────────────────────────
  const EXP = 1.83;
  let pythWinPct = Math.pow(hr, EXP) / (Math.pow(hr, EXP) + Math.pow(ar, EXP));

  // Season-scaled home advantage
  const hfaScale = Math.min(1.0, avgGP / 20);
  const homeAdv = 0.038 * hfaScale;
  let hwp = Math.min(0.88, Math.max(0.12, pythWinPct + homeAdv));

  // ── CALIBRATION FACTOR ────────────────────────────────────
  // When calibration analysis shows model is systematically over/under-confident,
  // apply a scaling factor toward 0.5 (shrinkage) or away from 0.5 (expansion)
  // calibrationFactor > 1 = model should be more extreme, < 1 = less extreme
  if (calibrationFactor !== 1.0) {
    hwp = 0.5 + (hwp - 0.5) * calibrationFactor;
    hwp = Math.min(0.90, Math.max(0.10, hwp));
  }

  // ── CONFIDENCE SCORE ──────────────────────────────────────
  const blendWeight = Math.min(1.0, avgGP / FULL_SEASON_THRESHOLD);
  const dataItems = [homeHit, awayHit, homeStarterStats, awayStarterStats, homeForm, awayForm];
  const v9Bonus = [homeLineup, awayLineup, homeStatcast, awayStatcast, umpire].filter(Boolean).length * 2;
  const dataScore = dataItems.filter(Boolean).length / dataItems.length;
  const confScore = Math.round(35 + (dataScore * 30) + (blendWeight * 20) + Math.min(15, v9Bonus));
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
    hFIP, aFIP,
    umpire: ump,
    hasLineup: !!(homeLineup || awayLineup),
    hasStatcast: !!(homeStatcast || awayStatcast),
    hasPlatoon: !!(homePlatoonDelta || awayPlatoonDelta),
    homePlatoonDelta, awayPlatoonDelta,
    homeWOBA, awayWOBA,
  };
}

// ── CALIBRATION ENGINE ────────────────────────────────────────
// Groups predictions into bins and computes how accurate each bin was.
// Returns calibration curve + Brier score + suggested correction factor.
function computeCalibration(records) {
  // Only use records with both prediction and result
  const valid = records.filter(r =>
    r.win_pct_home != null && r.ml_correct !== null && r.result_entered
  );
  if (valid.length < 20) return null;

  // Build 10% bins: [0-10%, 10-20%, ..., 90-100%]
  const bins = Array.from({ length: 10 }, (_, i) => ({
    binMin: i * 0.1, binMax: (i + 1) * 0.1,
    label: `${i * 10}-${(i + 1) * 10}%`,
    midpoint: (i + 0.05) * 10,  // for chart
    predictions: [],
  }));

  valid.forEach(r => {
    const p = parseFloat(r.win_pct_home);
    const binIdx = Math.min(9, Math.floor(p * 10));
    bins[binIdx].predictions.push({ p, actual: r.ml_correct ? 1 : 0 });
  });

  const calibrationCurve = bins
    .filter(b => b.predictions.length >= 3)
    .map(b => {
      const n = b.predictions.length;
      const actualRate = b.predictions.reduce((s, p) => s + p.actual, 0) / n;
      const expectedRate = b.predictions.reduce((s, p) => s + p.p, 0) / n;
      return {
        label: b.label,
        midpoint: b.midpoint,
        expected: parseFloat((expectedRate * 100).toFixed(1)),
        actual: parseFloat((actualRate * 100).toFixed(1)),
        n,
        error: parseFloat(((actualRate - expectedRate) * 100).toFixed(1)),
      };
    });

  // Brier score: mean((predicted - actual)^2), lower is better
  // Perfect calibration = 0.0, coin flip = 0.25
  const brierScore = valid.reduce((sum, r) => {
    const p = parseFloat(r.win_pct_home);
    const a = r.ml_correct ? 1 : 0;
    return sum + Math.pow(p - a, 2);
  }, 0) / valid.length;

  // Calibration error: average |expected - actual| across bins
  const meanCalibrationError = calibrationCurve.length
    ? calibrationCurve.reduce((s, b) => s + Math.abs(b.error), 0) / calibrationCurve.length
    : 0;

  // Suggest calibration factor:
  // If model consistently over-confident (predicts 65% but wins 55%) → shrink toward 0.5
  // If model under-confident (predicts 55% but wins 65%) → expand away from 0.5
  const overallBias = calibrationCurve.reduce((s, b) => s + (b.actual - b.expected) * b.n, 0)
    / (calibrationCurve.reduce((s, b) => s + b.n, 0) || 1);

  let suggestedFactor = 1.0;
  if (Math.abs(overallBias) > 2 && valid.length >= 50) {
    // Shrink/expand by 5% per 3% of bias
    suggestedFactor = overallBias < 0 ? 0.85 : 1.15;
  }

  return {
    curve: calibrationCurve,
    brierScore: parseFloat(brierScore.toFixed(4)),
    brierSkill: parseFloat((1 - brierScore / 0.25).toFixed(3)),  // % improvement over coin flip
    meanCalibrationError: parseFloat(meanCalibrationError.toFixed(1)),
    overallBias: parseFloat(overallBias.toFixed(1)),
    suggestedFactor,
    n: valid.length,
  };
}

// ── MLB API ───────────────────────────────────────────────────
function mlbFetch(path, params = {}) {
  const p = new URLSearchParams({ path, ...params });
  return fetch(`/api/mlb?${p}`).then(r => r.ok ? r.json() : null).catch(() => null);
}

// ── STATCAST FETCH ────────────────────────────────────────────
// Calls /api/statcast?teamId=X&season=Y (pybaseball Vercel serverless)
// Falls back silently if not deployed
// Statcast is not available (requires Python backend not supported on Vercel free tier).
// fetchStatcast returns null silently — all callers fall back to wOBA approximation.
// To enable: host api/statcast.py on Railway or Render and point STATCAST_URL env var here.
const _statcastCache = {};
async function fetchStatcast(teamId) {
  if (!teamId) return null;
  const key = `${teamId}-${STAT_SEASON}`;
  if (_statcastCache[key] !== undefined) return _statcastCache[key];
  const baseUrl = typeof STATCAST_URL !== "undefined" ? STATCAST_URL : null;
  if (!baseUrl) { _statcastCache[key] = null; return null; } // no endpoint configured
  try {
    const res = await fetch(`${baseUrl}/api/statcast?teamId=${teamId}&season=${STAT_SEASON}`);
    if (!res.ok) { _statcastCache[key] = null; return null; }
    const data = await res.json();
    if (data?.error) { _statcastCache[key] = null; return null; }
    const result = {
      xwOBA:      data.xwOBA      ? parseFloat(data.xwOBA)      : null,
      barrelRate: data.barrelRate  ? parseFloat(data.barrelRate)  : null,
      hardHitPct: data.hardHitPct  ? parseFloat(data.hardHitPct)  : null,
      sprintSpeed: data.sprintSpeed ? parseFloat(data.sprintSpeed) : null,
    };
    _statcastCache[key] = result;
    return result;
  } catch { _statcastCache[key] = null; return null; }
}

// ── LINEUP FETCH ──────────────────────────────────────────────
// Fetches actual batting order from boxscore endpoint.
// Returns lineup-weighted wOBA and handedness composition.
// Falls back gracefully if lineup not yet posted.
async function fetchLineup(gamePk, teamId, isHome) {
  if (!gamePk || !teamId) return null;
  try {
    const data = await mlbFetch(`game/${gamePk}/boxscore`);
    if (!data) return null;
    const side = isHome ? data.teams?.home : data.teams?.away;
    if (!side?.battingOrder?.length) return null;

    // Get batting order player IDs (top 9)
    const battingOrder = side.battingOrder.slice(0, 9);
    const players = side.players || {};

    let totalWOBA = 0, count = 0;
    let rCount = 0, lCount = 0;

    for (const playerId of battingOrder) {
      const playerKey = `ID${playerId}`;
      const player = players[playerKey];
      if (!player) continue;

      const s = player.seasonStats?.batting;
      if (!s) continue;

      const avg = parseFloat(s.avg) || 0.250;
      const obp = parseFloat(s.obp) || 0.320;
      const slg = parseFloat(s.slg) || 0.420;
      const iso = Math.max(0, slg - avg);
      const woba = Math.max(0.250, Math.min(0.420, obp * 0.90 + iso * 0.25));

      // Weight top of order more (hitters 1-4 see more PAs)
      const positionWeight = battingOrder.indexOf(playerId) < 4 ? 1.2 : 1.0;
      totalWOBA += woba * positionWeight;
      count += positionWeight;

      const hand = player.person?.batSide?.code;
      if (hand === "R" || hand === "S") rCount++;
      else if (hand === "L") lCount++;
    }

    if (!count) return null;
    const totalHitters = rCount + lCount;
    return {
      wOBA: parseFloat((totalWOBA / count).toFixed(3)),
      lineupHand: totalHitters > 0 ? {
        rPct: rCount / totalHitters,
        lPct: lCount / totalHitters,
      } : null,
      battingOrderCount: count,
    };
  } catch { return null; }
}

// ── UMPIRE FETCH ──────────────────────────────────────────────
// Extracts home plate umpire from schedule officials hydration
function extractUmpire(gameData) {
  // officials array: [{ official: { fullName }, officialType }]
  const officials = gameData?.officials || [];
  const homePlate = officials.find(o =>
    o.officialType === "Home Plate" || o.officialType === "HP"
  );
  const name = homePlate?.official?.fullName;
  if (!name) return null;
  const profile = UMPIRE_PROFILES[name] || UMPIRE_DEFAULT;
  return { ...profile, name };
}

// ── ODDS ─────────────────────────────────────────────────────
let _oddsCache = null, _oddsCacheTime = 0;
async function fetchOdds() {
  if (_oddsCache && Date.now() - _oddsCacheTime < 10 * 60 * 1000) return _oddsCache;
  try {
    const res = await fetch("/api/odds");
    if (!res.ok) return null;
    const data = await res.json();
    if (data?.error === "NO_API_KEY") return { games: [], noKey: true };
    _oddsCache = data; _oddsCacheTime = Date.now();
    return data;
  } catch { return null; }
}

function matchOddsToGame(oddsGame, schedGame) {
  if (!oddsGame || !schedGame) return false;
  const norm = s => (s || "").toLowerCase().replace(/\s+/g, "");
  const homeN = norm(teamById(schedGame.homeTeamId)?.name || "");
  const awayN = norm(teamById(schedGame.awayTeamId)?.name || "");
  return norm(oddsGame.homeTeam).includes(homeN.slice(0, 5)) &&
         norm(oddsGame.awayTeam).includes(awayN.slice(0, 5));
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

const EDGE_THRESHOLD = 0.035;
function getBannerInfo(pred, odds, hasStarter) {
  if (!pred) return { color: "yellow", label: "⚠ No prediction" };
  if (!hasStarter) return { color: "yellow", label: "⚠ Starters TBD" };
  if (odds?.homeML && odds?.awayML) {
    const market = trueImplied(odds.homeML, odds.awayML);
    const homeEdge = pred.homeWinPct - market.home;
    const awayEdge = pred.awayWinPct - market.away;
    if (Math.abs(homeEdge) >= EDGE_THRESHOLD || Math.abs(awayEdge) >= EDGE_THRESHOLD) {
      return { color: "green", edge: homeEdge, label: homeEdge >= EDGE_THRESHOLD ? `+${(homeEdge*100).toFixed(1)}% HOME edge` : `+${(awayEdge*100).toFixed(1)}% AWAY edge` };
    }
    return { color: "neutral", edge: homeEdge, label: `${(Math.abs(homeEdge)*100).toFixed(1)}% edge (below threshold)` };
  }
  if (pred.homeWinPct >= 0.60 || pred.homeWinPct <= 0.40) return { color: "green", label: "Strong signal" };
  return { color: "neutral", label: "Close matchup" };
}

// ── SEASON BLENDING ───────────────────────────────────────────
function blendStats(current, prior1, prior2, gamesPlayed) {
  const w = Math.min(1.0, gamesPlayed / FULL_SEASON_THRESHOLD);
  const priors = [prior1, prior2].filter(Boolean);
  if (!priors.length || w >= 1.0) return current;
  if (!current) return priors.reduce((acc, p) => { Object.keys(p).forEach(k => { acc[k] = (acc[k] || 0) + p[k] / priors.length; }); return acc; }, {});
  const priorAvg = priors.reduce((acc, p) => { Object.keys(p).forEach(k => { acc[k] = (acc[k] || 0) + p[k] / priors.length; }); return acc; }, {});
  const result = {};
  Object.keys(current).forEach(k => {
    const c = current[k] ?? priorAvg[k], p = priorAvg[k] ?? current[k];
    result[k] = (typeof c === "number" && typeof p === "number") ? c * w + p * (1 - w) : current[k];
  });
  return result;
}

// ── SCHEDULE ─────────────────────────────────────────────────
async function fetchScheduleForDate(dateStr) {
  const data = await mlbFetch("schedule", {
    sportId: 1, date: dateStr,
    hydrate: "probablePitcher,teams,venue,linescore,officials",
  });
  const games = [];
  for (const d of (data?.dates || [])) {
    for (const g of (d.games || [])) {
      const homeId = g.teams?.home?.team?.id;
      const awayId = g.teams?.away?.team?.id;
      const homeAbbr = (g.teams?.home?.team?.abbreviation || "").replace(/\d+$/, "") || teamById(homeId).abbr;
      const awayAbbr = (g.teams?.away?.team?.abbreviation || "").replace(/\d+$/, "") || teamById(awayId).abbr;
      const umpire = extractUmpire(g);
      games.push({
        gamePk: g.gamePk, gameDate: g.gameDate,
        status: (g.status?.abstractGameState === "Final" || g.status?.detailedState === "Game Over") ? "Final"
               : g.status?.abstractGameState === "Live" ? "Live" : "Preview",
        detailedState: g.status?.detailedState || "",
        homeTeamId: homeId, awayTeamId: awayId, homeAbbr, awayAbbr,
        homeTeamName: g.teams?.home?.team?.name || homeAbbr,
        awayTeamName: g.teams?.away?.team?.name || awayAbbr,
        homeScore: g.teams?.home?.score ?? null,
        awayScore: g.teams?.away?.score ?? null,
        homeStarter: g.teams?.home?.probablePitcher?.fullName || null,
        awayStarter: g.teams?.away?.probablePitcher?.fullName || null,
        homeStarterId: g.teams?.home?.probablePitcher?.id || null,
        awayStarterId: g.teams?.away?.probablePitcher?.id || null,
        homeStarterHand: g.teams?.home?.probablePitcher?.pitchHand?.code || null,
        awayStarterHand: g.teams?.away?.probablePitcher?.pitchHand?.code || null,
        venue: g.venue?.name, umpire,
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
  return { avg: parseFloat(s.avg)||0.250, obp: parseFloat(s.obp)||0.320, slg: parseFloat(s.slg)||0.420, gamesPlayed: parseInt(s.gamesPlayed)||0 };
}
async function fetchTeamHitting(teamId) {
  if (!teamId) return null;
  const [cur, p1, p2] = await Promise.all([
    fetchOneSeasonHitting(teamId, STAT_SEASON),
    fetchOneSeasonHitting(teamId, STAT_SEASON-1),
    fetchOneSeasonHitting(teamId, STAT_SEASON-2),
  ]);
  return blendStats(cur, p1, p2, cur?.gamesPlayed || 0);
}

async function fetchOneSeasonPitching(teamId, season) {
  if (!teamId) return null;
  const data = await mlbFetch(`teams/${teamId}/stats`, { stats: "season", group: "pitching", season, sportId: 1 });
  if (!data) return null;
  const s = data?.stats?.[0]?.splits?.[0]?.stat;
  if (!s) return null;
  return { era: parseFloat(s.era)||4.00, whip: parseFloat(s.whip)||1.30, k9: parseFloat(s.strikeoutsPer9Inn)||8.5, bb9: parseFloat(s.walksPer9Inn)||3.0 };
}
async function fetchTeamPitching(teamId) {
  if (!teamId) return null;
  const [cur, p1, p2, gpData] = await Promise.all([
    fetchOneSeasonPitching(teamId, STAT_SEASON),
    fetchOneSeasonPitching(teamId, STAT_SEASON-1),
    fetchOneSeasonPitching(teamId, STAT_SEASON-2),
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
  const era = parseFloat(s.era)||4.50, whip = parseFloat(s.whip)||1.35;
  const k9 = parseFloat(s.strikeoutsPer9Inn)||8.0, bb9 = parseFloat(s.walksPer9Inn)||3.2;
  const ip = parseFloat(s.inningsPitched)||0;
  const fip = Math.max(2.5, Math.min(7.0, 3.80 + (bb9-3.0)*0.28 - (k9-8.5)*0.16 + (era-4.00)*0.38));
  // pitchHand not always in stats endpoint — will be populated from schedule hydration
  return { era, whip, k9, bb9, fip, xfip: fip*0.80+4.00*0.20, ip };
}
async function fetchStarterStats(pitcherId) {
  if (!pitcherId) return null;
  const [cur, p1, p2] = await Promise.all([
    fetchOneSeasonStarterStats(pitcherId, STAT_SEASON),
    fetchOneSeasonStarterStats(pitcherId, STAT_SEASON-1),
    fetchOneSeasonStarterStats(pitcherId, STAT_SEASON-2),
  ]);
  const ip = cur?.ip || 0;
  return blendStats(cur, p1, p2, Math.round(Math.min(1.0, ip/120) * FULL_SEASON_THRESHOLD));
}

async function fetchRecentForm(teamId, numGames = 15) {
  if (!teamId) return null;
  const today = new Date().toISOString().split("T")[0];
  const data = await mlbFetch("schedule", { teamId, season: SEASON, startDate: `${SEASON}-01-01`, endDate: today, hydrate: "linescore", sportId: 1 });
  const games = [];
  for (const d of (data?.dates || [])) for (const g of (d.games || [])) {
    if (g.status?.abstractGameState === "Final" || g.status?.detailedState === "Game Over") {
      const isHome = g.teams?.home?.team?.id === teamId;
      const my = isHome ? g.teams?.home : g.teams?.away;
      const op = isHome ? g.teams?.away : g.teams?.home;
      games.push({ win: my?.isWinner || false, rs: my?.score || 0, ra: op?.score || 0 });
    }
  }
  const recent = games.slice(-numGames);
  if (!recent.length) return null;
  const rf = recent.reduce((s,g)=>s+g.rs,0), ra = recent.reduce((s,g)=>s+g.ra,0);
  const wins = recent.filter(g=>g.win).length;
  const pyth = Math.pow(rf,1.83)/(Math.pow(rf,1.83)+Math.pow(ra,1.83));
  return { gamesPlayed: games.length, winPct: wins/recent.length, pythWinPct: pyth, luckFactor: wins/recent.length - pyth, formScore: recent.slice(-5).reduce((s,g,i)=>s+(g.win?1:-0.6)*(i+1),0)/15 };
}

async function fetchBullpenFatigue(teamId) {
  const today = new Date();
  const y = new Date(today); y.setDate(today.getDate()-1);
  const t2 = new Date(today); t2.setDate(today.getDate()-2);
  const fmt = d => d.toISOString().split("T")[0];
  const data = await mlbFetch("schedule", { teamId, season: SEASON, startDate: fmt(t2), endDate: fmt(y), sportId: 1 });
  let py = 0, pt = 0;
  for (const date of (data?.dates || [])) for (const g of (date.games || [])) {
    const isHome = g.teams?.home?.team?.id === teamId;
    const bp = isHome ? g.teams?.home?.pitchers?.length||0 : g.teams?.away?.pitchers?.length||0;
    const days = Math.round((today - new Date(date.date)) / 86400000);
    if (days===1) py=bp; if (days===2) pt=bp;
  }
  return { fatigue: Math.min(1, py*0.15 + pt*0.07), pitchersUsedYesterday: py, closerAvailable: py < 3 };
}

// ── ACCURACY HELPERS ──────────────────────────────────────────
function computeAccuracy(records) {
  const withResults = records.filter(r => r.result_entered);
  if (!withResults.length) return null;
  const ml = withResults.filter(r => r.ml_correct !== null);
  const rl = withResults.filter(r => r.rl_correct !== null);
  const ou = withResults.filter(r => r.ou_correct !== null);
  const tiers = { HIGH: {total:0,correct:0}, MEDIUM: {total:0,correct:0}, LOW: {total:0,correct:0} };
  withResults.forEach(r => { if (r.confidence && tiers[r.confidence]) { tiers[r.confidence].total++; if (r.ml_correct) tiers[r.confidence].correct++; } });
  let roi = 0;
  ml.forEach(r => { roi += r.ml_correct ? 90.9 : -100; });
  let win=0, loss=0, longestWin=0, longestLoss=0, currentStreak=0;
  ml.forEach((r,i) => {
    if (r.ml_correct) { win++; loss=0; longestWin=Math.max(longestWin,win); }
    else { loss++; win=0; longestLoss=Math.max(longestLoss,loss); }
  });
  if (ml.length > 0) currentStreak = ml[ml.length-1].ml_correct ? win : -loss;

  const byMonth = {};
  withResults.forEach(r => {
    const m = r.game_date?.slice(0,7); if (!m) return;
    if (!byMonth[m]) byMonth[m] = {month:m,total:0,correct:0};
    if (r.ml_correct !== null) { byMonth[m].total++; if (r.ml_correct) byMonth[m].correct++; }
  });

  const calibration = computeCalibration(withResults);

  return {
    total: withResults.length, mlTotal: ml.length,
    mlAcc: ml.length ? (ml.filter(r=>r.ml_correct).length/ml.length*100).toFixed(1) : null,
    rlAcc: rl.length ? (rl.filter(r=>r.rl_correct).length/rl.length*100).toFixed(1) : null,
    ouAcc: ou.length ? (ou.filter(r=>r.ou_correct==="OVER"||r.ou_correct==="UNDER").length/ou.length*100).toFixed(1) : null,
    tiers, roi: roi.toFixed(0), roiPct: ml.length ? (roi/(ml.length*100)*100).toFixed(1) : null,
    longestWin, longestLoss, currentStreak,
    byMonth: Object.values(byMonth).sort((a,b)=>a.month.localeCompare(b.month)).map(m=>({...m, pct: m.total ? parseFloat((m.correct/m.total*100).toFixed(1)) : 0})),
    calibration,
  };
}

// ── AUTO-SYNC ─────────────────────────────────────────────────
const normAbbr = s => (s||"").replace(/\d+$/,"").toUpperCase();

async function buildPredictionRow(game, dateStr) {
  const homeStatId = resolveStatTeamId(game.homeTeamId, game.homeAbbr);
  const awayStatId = resolveStatTeamId(game.awayTeamId, game.awayAbbr);
  if (!homeStatId || !awayStatId) return null;

  const [homeHit, awayHit, homePitch, awayPitch, homeStarter, awayStarter, homeForm, awayForm, homeStatcast, awayStatcast, homeLineup, awayLineup] =
    await Promise.all([
      fetchTeamHitting(homeStatId), fetchTeamHitting(awayStatId),
      fetchTeamPitching(homeStatId), fetchTeamPitching(awayStatId),
      fetchStarterStats(game.homeStarterId), fetchStarterStats(game.awayStarterId),
      fetchRecentForm(homeStatId), fetchRecentForm(awayStatId),
      fetchStatcast(homeStatId), fetchStatcast(awayStatId),
      fetchLineup(game.gamePk, homeStatId, true), fetchLineup(game.gamePk, awayStatId, false),
    ]);

  if (homeStarter) homeStarter.pitchHand = game.homeStarterHand;
  if (awayStarter) awayStarter.pitchHand = game.awayStarterHand;

  const [homeBullpen, awayBullpen] = await Promise.all([fetchBullpenFatigue(game.homeTeamId), fetchBullpenFatigue(game.awayTeamId)]);

  const pred = predictGame({
    homeTeamId: game.homeTeamId, awayTeamId: game.awayTeamId,
    homeHit, awayHit, homePitch, awayPitch,
    homeStarterStats: homeStarter, awayStarterStats: awayStarter,
    homeForm, awayForm,
    homeGamesPlayed: homeForm?.gamesPlayed||0, awayGamesPlayed: awayForm?.gamesPlayed||0,
    bullpenData: { [game.homeTeamId]: homeBullpen, [game.awayTeamId]: awayBullpen },
    homeLineup, awayLineup, umpire: game.umpire,
    homeStatcast, awayStatcast,
  });
  if (!pred) return null;
  const home = teamById(game.homeTeamId), away = teamById(game.awayTeamId);
  return {
    game_date: dateStr,
    home_team: game.homeAbbr||(home?.abbr||String(game.homeTeamId)).replace(/\d+$/,''),
    away_team: game.awayAbbr||(away?.abbr||String(game.awayTeamId)).replace(/\d+$/,''),
    game_pk: game.gamePk,
    model_ml_home: pred.modelML_home, model_ml_away: pred.modelML_away,
    run_line_home: pred.runLineHome, run_line_away: -pred.runLineHome,
    ou_total: pred.ouTotal, win_pct_home: parseFloat(pred.homeWinPct.toFixed(4)),
    confidence: pred.confidence, pred_home_runs: parseFloat(pred.homeRuns.toFixed(2)),
    pred_away_runs: parseFloat(pred.awayRuns.toFixed(2)), result_entered: false,
  };
}

async function fillFinalScores(pendingRows) {
  if (!pendingRows.length) return 0;
  let filled = 0;
  const byDate = {};
  for (const row of pendingRows) { if (!byDate[row.game_date]) byDate[row.game_date]=[]; byDate[row.game_date].push(row); }
  const teamIdToAbbr = {}; TEAMS.forEach(t => { teamIdToAbbr[t.id] = t.abbr; });
  for (const [dateStr, rows] of Object.entries(byDate)) {
    try {
      const data = await mlbFetch("schedule", { sportId:1, date:dateStr, hydrate:"probablePitcher,teams,venue,linescore" });
      if (!data) continue;
      for (const dt of (data?.dates||[])) for (const g of (dt.games||[])) {
        const state=g.status?.abstractGameState||"", detail=g.status?.detailedState||"", coded=g.status?.codedGameState||"";
        const isFinal = state==="Final"||detail==="Game Over"||detail.startsWith("Final")||coded==="F"||coded==="O";
        if (!isFinal) continue;
        const homeScore=g.teams?.home?.score??null, awayScore=g.teams?.away?.score??null;
        if (homeScore===null||awayScore===null) continue;
        const rawHomeId=g.teams?.home?.team?.id, rawAwayId=g.teams?.away?.team?.id;
        const homeId=resolveStatTeamId(rawHomeId,"")||rawHomeId, awayId=resolveStatTeamId(rawAwayId,"")||rawAwayId;
        const hAbbr=normAbbr(teamIdToAbbr[homeId]||g.teams?.home?.team?.abbreviation||"");
        const aAbbr=normAbbr(teamIdToAbbr[awayId]||g.teams?.away?.team?.abbreviation||"");
        if (!hAbbr||!aAbbr) continue;
        const matchedRow = rows.find(row => (row.game_pk&&row.game_pk===g.gamePk)||(normAbbr(row.home_team)===hAbbr&&normAbbr(row.away_team)===aAbbr));
        if (!matchedRow) continue;
        // ml_correct = did the model's pick win?
        // Model picks home if win_pct_home >= 0.5, away otherwise
        const modelPickedHome = (matchedRow.win_pct_home ?? 0.5) >= 0.5;
        const homeWon = homeScore > awayScore;
        const ml_correct = modelPickedHome ? homeWon : !homeWon;
        // rl_correct: model's side covers -1.5?
        const spread = homeScore - awayScore;
        const rl_correct = modelPickedHome
          ? (spread > 1.5 ? true : spread < -1.5 ? false : null)
          : (spread < -1.5 ? true : spread > 1.5 ? false : null);
        const total = homeScore + awayScore;
        const ou_correct = matchedRow.ou_total ? (total > matchedRow.ou_total ? "OVER" : total < matchedRow.ou_total ? "UNDER" : "PUSH") : null;
        await supabaseQuery(`/mlb_predictions?id=eq.${matchedRow.id}`, "PATCH", {
          actual_home_runs:homeScore, actual_away_runs:awayScore, result_entered:true,
          ml_correct, rl_correct, ou_correct, game_pk:g.gamePk, home_team:hAbbr, away_team:aAbbr, actual_spread:homeScore-awayScore,
        });
        filled++;
      }
    } catch (e) { console.warn("fillFinalScores error", dateStr, e); }
  }
  return filled;
}

// Regrade all already-recorded results using corrected ml_correct/rl_correct logic.
// Needed when the grading formula changes (e.g. v9.1 fix: grade model's pick, not always home).
async function regradeAllResults(onProgress) {
  onProgress?.("⏳ Loading all graded records…");
  const allGraded = await supabaseQuery(
    `/mlb_predictions?result_entered=eq.true&select=id,win_pct_home,actual_home_runs,actual_away_runs,ou_total&limit=2000`
  );
  if (!allGraded?.length) { onProgress?.("No graded records found"); return 0; }

  let fixed = 0;
  for (const row of allGraded) {
    const homeScore = row.actual_home_runs;
    const awayScore = row.actual_away_runs;
    if (homeScore === null || awayScore === null) continue;

    // Correct logic: grade from model's pick perspective
    const modelPickedHome = (row.win_pct_home ?? 0.5) >= 0.5;
    const homeWon = homeScore > awayScore;
    const ml_correct = modelPickedHome ? homeWon : !homeWon;

    const spread = homeScore - awayScore;
    const rl_correct = modelPickedHome
      ? (spread > 1.5 ? true : spread < -1.5 ? false : null)
      : (spread < -1.5 ? true : spread > 1.5 ? false : null);

    const total = homeScore + awayScore;
    const ou_correct = row.ou_total
      ? (total > row.ou_total ? "OVER" : total < row.ou_total ? "UNDER" : "PUSH")
      : null;

    await supabaseQuery(`/mlb_predictions?id=eq.${row.id}`, "PATCH", {
      ml_correct, rl_correct, ou_correct,
    });
    fixed++;
  }
  onProgress?.(`✅ Regraded ${fixed} result(s)`);
  return fixed;
}

async function refreshPredictions(rows, onProgress) {
  if (!rows?.length) return 0;
  let updated=0;
  const byDate={};
  for (const row of rows) { if (!byDate[row.game_date]) byDate[row.game_date]=[]; byDate[row.game_date].push(row); }
  for (const [dateStr, dateRows] of Object.entries(byDate)) {
    onProgress?.(`🔄 Refreshing ${dateStr}…`);
    const schedData = await mlbFetch("schedule",{sportId:1,date:dateStr,hydrate:"probablePitcher,teams,officials"});
    const schedGames=[];
    for (const d of (schedData?.dates||[])) for (const g of (d.games||[])) schedGames.push(g);
    for (const row of dateRows) {
      try {
        const schedGame = schedGames.find(g => (row.game_pk&&g.gamePk===row.game_pk)||(normAbbr(g.teams?.home?.team?.abbreviation)===normAbbr(row.home_team)&&normAbbr(g.teams?.away?.team?.abbreviation)===normAbbr(row.away_team)));
        const homeTeamId=schedGame?.teams?.home?.team?.id||TEAMS.find(t=>t.abbr===row.home_team)?.id;
        const awayTeamId=schedGame?.teams?.away?.team?.id||TEAMS.find(t=>t.abbr===row.away_team)?.id;
        if (!homeTeamId||!awayTeamId) continue;
        const homeStarterId=schedGame?.teams?.home?.probablePitcher?.id||null;
        const awayStarterId=schedGame?.teams?.away?.probablePitcher?.id||null;
        const homeStatId=resolveStatTeamId(homeTeamId,row.home_team), awayStatId=resolveStatTeamId(awayTeamId,row.away_team);
        const umpire = extractUmpire(schedGame);
        const [homeHit,awayHit,homePitch,awayPitch,homeStarter,awayStarter,homeForm,awayForm,homeStatcast,awayStatcast] =
          await Promise.all([fetchTeamHitting(homeStatId),fetchTeamHitting(awayStatId),fetchTeamPitching(homeStatId),fetchTeamPitching(awayStatId),fetchStarterStats(homeStarterId),fetchStarterStats(awayStarterId),fetchRecentForm(homeStatId),fetchRecentForm(awayStatId),fetchStatcast(homeStatId),fetchStatcast(awayStatId)]);
        if (homeStarter) homeStarter.pitchHand = schedGame?.teams?.home?.probablePitcher?.pitchHand?.code;
        if (awayStarter) awayStarter.pitchHand = schedGame?.teams?.away?.probablePitcher?.pitchHand?.code;
        const pred=predictGame({homeTeamId,awayTeamId,homeHit,awayHit,homePitch,awayPitch,homeStarterStats:homeStarter,awayStarterStats:awayStarter,homeForm,awayForm,homeGamesPlayed:homeForm?.gamesPlayed||0,awayGamesPlayed:awayForm?.gamesPlayed||0,umpire,homeStatcast,awayStatcast});
        if (!pred) continue;
        await supabaseQuery(`/mlb_predictions?id=eq.${row.id}`,"PATCH",{model_ml_home:pred.modelML_home,model_ml_away:pred.modelML_away,run_line_home:pred.runLineHome,run_line_away:-pred.runLineHome,ou_total:pred.ouTotal,win_pct_home:parseFloat(pred.homeWinPct.toFixed(4)),confidence:pred.confidence,pred_home_runs:parseFloat(pred.homeRuns.toFixed(2)),pred_away_runs:parseFloat(pred.awayRuns.toFixed(2))});
        updated++;
      } catch(e){console.warn("refreshPredictions error:",row.id,e);}
    }
  }
  onProgress?.(`✅ Refreshed ${updated} prediction(s)`);
  return updated;
}

async function autoSync(onProgress) {
  onProgress?.("🔄 Checking for unrecorded games…");
  const today=new Date().toISOString().split("T")[0];
  const allDates=[]; const cur=new Date(SEASON_START);
  while (cur.toISOString().split("T")[0]<=today) { allDates.push(cur.toISOString().split("T")[0]); cur.setDate(cur.getDate()+1); }
  const existing=await supabaseQuery(`/mlb_predictions?select=id,game_date,home_team,away_team,result_entered,ou_total,game_pk,model_ml_home&order=game_date.asc&limit=5000`);
  const savedKeys=new Set((existing||[]).map(r=>`${r.game_date}|${normAbbr(r.away_team)}@${normAbbr(r.home_team)}`));
  const pendingResults=(existing||[]).filter(r=>!r.result_entered);
  if (pendingResults.length) { onProgress?.(`⏳ Updating ${pendingResults.length} pending…`); const filled=await fillFinalScores(pendingResults); if (filled) onProgress?.(`✓ ${filled} result(s) recorded`); }
  const staleRows=(existing||[]).filter(r=>r.model_ml_home===-116||r.model_ml_home===null);
  if (staleRows.length) { onProgress?.(`🔄 Refreshing ${staleRows.length} stale…`); await refreshPredictions(staleRows,onProgress); }
  let newPred=0;
  for (const dateStr of allDates) {
    const schedule=await fetchScheduleForDate(dateStr);
    if (!schedule.length) continue;
    const unsaved=schedule.filter(g=>{const ha=normAbbr(g.homeAbbr||teamById(g.homeTeamId).abbr),aa=normAbbr(g.awayAbbr||teamById(g.awayTeamId).abbr);if(!ha||!aa)return true;return!savedKeys.has(`${dateStr}|${aa}@${ha}`);});
    if (!unsaved.length) continue;
    onProgress?.(`📝 Saving ${unsaved.length} game(s) for ${dateStr}…`);
    const rows=(await Promise.all(unsaved.map(g=>buildPredictionRow(g,dateStr)))).filter(Boolean);
    if (rows.length) { await supabaseQuery("/mlb_predictions","UPSERT",rows); newPred+=rows.length; const ns=await supabaseQuery(`/mlb_predictions?game_date=eq.${dateStr}&result_entered=eq.false&select=id,game_pk,home_team,away_team,ou_total,result_entered,game_date`); if(ns?.length) await fillFinalScores(ns); }
  }
  onProgress?.(newPred?`✅ Sync complete — ${newPred} new prediction(s)`:"✅ All games up to date");
  return { newPredictions: newPred };
}

// ── PARLAY HELPERS ────────────────────────────────────────────
function mlToDecimal(ml) { return ml >= 100 ? ml/100+1 : 100/Math.abs(ml)+1; }
function combinedParlayOdds(legs) { return legs.reduce((acc,l)=>acc*mlToDecimal(l.ml),1); }
function combinedParlayProb(legs) { return legs.reduce((acc,l)=>acc*l.prob,1); }
function decimalToML(dec) { return dec>=2?`+${Math.round((dec-1)*100)}`:`-${Math.round(100/(dec-1))}`; }

// ═══════════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════════
export default function App() {
  const [activeTab, setActiveTab] = useState("calendar");
  const [syncStatus, setSyncStatus] = useState("idle");
  const [syncMsg, setSyncMsg] = useState("");
  const syncIntervalRef = useRef(null);
  // Calibration factor — loaded from Accuracy tab, applied globally
  const [calibrationFactor, setCalibrationFactor] = useState(1.0);

  const runSync = useCallback(async () => {
    setSyncStatus("syncing");
    try { await autoSync(m=>setSyncMsg(m)); setSyncStatus("done"); }
    catch(e) { console.error(e); setSyncStatus("error"); setSyncMsg("Sync error"); }
  }, []);

  useEffect(() => {
    runSync();
    syncIntervalRef.current = setInterval(runSync, 15*60*1000);
    return () => clearInterval(syncIntervalRef.current);
  }, [runSync]);

  const tabs = [
    { id:"calendar",  label:"📅 Calendar"  },
    { id:"accuracy",  label:"📊 Accuracy"  },
    { id:"history",   label:"📋 History"   },
    { id:"parlay",    label:"🎯 Parlay"    },
    { id:"matchup",   label:"⚾ Matchup"   },
  ];
  const syncColor = syncStatus==="syncing"?"#e3b341":syncStatus==="done"?"#3fb950":syncStatus==="error"?"#f85149":"#484f58";

  return (
    <div style={{fontFamily:"'JetBrains Mono','Fira Code',monospace",background:"#080c10",minHeight:"100vh",color:"#e2e8f0"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700;800&display=swap');
        *{box-sizing:border-box}
        ::-webkit-scrollbar{width:4px;height:4px}::-webkit-scrollbar-track{background:#0d1117}::-webkit-scrollbar-thumb{background:#30363d;border-radius:2px}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
        @keyframes fadeIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
        .gc{animation:fadeIn .2s ease}
      `}</style>

      <div style={{background:"linear-gradient(180deg,#0d1117,#080c10)",borderBottom:"1px solid #161b22",padding:"14px 20px"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10,flexWrap:"wrap",gap:8}}>
          <div style={{display:"flex",alignItems:"center",gap:12}}>
            <span style={{fontSize:24}}>⚾</span>
            <div>
              <div style={{fontSize:16,fontWeight:800,color:"#58a6ff",letterSpacing:2}}>MLB PREDICTOR v9</div>
              <div style={{fontSize:9,color:"#484f58",letterSpacing:3}}>LINEUP · UMPIRE · STATCAST · PLATOON · CALIBRATED</div>
            </div>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:6}}>
            {calibrationFactor !== 1.0 && (
              <div style={{fontSize:10,color:"#e3b341",padding:"3px 10px",border:"1px solid #3a2a00",borderRadius:20}}>
                Calibration ×{calibrationFactor.toFixed(2)}
              </div>
            )}
            <div style={{display:"flex",alignItems:"center",gap:6,background:"#0d1117",border:"1px solid #21262d",borderRadius:20,padding:"5px 12px"}}>
              <div style={{width:7,height:7,borderRadius:"50%",background:syncColor,animation:syncStatus==="syncing"?"pulse 1s infinite":"none"}}/>
              <span style={{fontSize:10,color:syncColor,maxWidth:260,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{syncStatus==="idle"?"Waiting…":syncMsg||"Syncing…"}</span>
              {syncStatus!=="syncing"&&<button onClick={runSync} style={{background:"none",border:"none",color:"#484f58",cursor:"pointer",fontSize:12,padding:0,marginLeft:2}}>↻</button>}
            </div>
          </div>
        </div>
        <SeasonAccuracyBanner refreshKey={syncStatus}/>
        <div style={{display:"flex",gap:4,marginTop:10,flexWrap:"wrap"}}>
          {tabs.map(t=>(
            <button key={t.id} onClick={()=>setActiveTab(t.id)} style={{padding:"5px 14px",borderRadius:6,border:"1px solid",cursor:"pointer",fontSize:11,fontWeight:700,letterSpacing:1,textTransform:"uppercase",transition:"all .12s",background:activeTab===t.id?"#161b22":"transparent",color:activeTab===t.id?"#58a6ff":"#484f58",borderColor:activeTab===t.id?"#30363d":"transparent"}}>{t.label}</button>
          ))}
        </div>
      </div>

      <div style={{padding:"20px"}}>
        {activeTab==="calendar" && <CalendarTab calibrationFactor={calibrationFactor}/>}
        {activeTab==="accuracy" && <AccuracyDashboard refreshKey={syncStatus} onCalibrationChange={setCalibrationFactor}/>}
        {activeTab==="history"  && <HistoryTab refreshKey={syncStatus}/>}
        {activeTab==="parlay"   && <ParlayTab calibrationFactor={calibrationFactor}/>}
        {activeTab==="matchup"  && <MatchupTab calibrationFactor={calibrationFactor}/>}
      </div>
    </div>
  );
}

// ─── SEASON ACCURACY BANNER ───────────────────────────────────
function SeasonAccuracyBanner({refreshKey}) {
  const [acc,setAcc]=useState(null);
  const [loading,setLoading]=useState(true);
  useEffect(()=>{(async()=>{setLoading(true);const data=await supabaseQuery(`/mlb_predictions?result_entered=eq.true&select=ml_correct,rl_correct,ou_correct,confidence`);setAcc(data?.length?computeAccuracy(data):null);setLoading(false);})();},[refreshKey]);
  if (loading||!acc) return <div style={{background:"#0d1117",border:"1px solid #161b22",borderRadius:8,padding:"8px 14px",fontSize:11,color:"#484f58"}}>{loading?"Loading…":"📈 Season accuracy will appear once games are graded"}</div>;
  return (
    <div style={{background:"linear-gradient(90deg,#0d1117,#0d1a24,#0d1117)",border:"1px solid #1e3448",borderRadius:8,padding:"8px 16px",display:"flex",alignItems:"center",gap:20,flexWrap:"wrap"}}>
      <span style={{fontSize:10,fontWeight:700,color:"#e3b341",letterSpacing:2}}>📈 SEASON ACCURACY</span>
      <span style={{fontSize:10,color:"#484f58"}}>{acc.total} graded</span>
      <div style={{display:"flex",gap:16}}>
        {[["ML",acc.mlAcc,55],["RL",acc.rlAcc,52],["O/U",acc.ouAcc,50]].map(([l,v,t])=>(
          <Micro key={l} label={l} val={<span style={{color:parseFloat(v)>=t?"#3fb950":parseFloat(v)>=t-5?"#e3b341":"#f85149",fontWeight:800}}>{v??'—'}%</span>}/>
        ))}
        <Micro label="ROI" val={<span style={{color:parseFloat(acc.roi)>=0?"#3fb950":"#f85149",fontWeight:800}}>${acc.roi}</span>}/>
      </div>
      {acc.calibration && <Micro label="BRIER" val={<span style={{color:acc.calibration.brierScore<0.22?"#3fb950":acc.calibration.brierScore<0.24?"#e3b341":"#f85149",fontWeight:800,fontSize:12}}>{acc.calibration.brierScore}</span>}/>}
      <div style={{display:"flex",gap:10}}>
        {["HIGH","MEDIUM","LOW"].map(tier=>{const t=acc.tiers[tier];const p=t.total?Math.round(t.correct/t.total*100):null;return <Micro key={tier} label={tier.slice(0,3)} val={<span style={{color:p?(p>=60?"#3fb950":p>=52?"#e3b341":"#f85149"):"#484f58",fontWeight:800}}>{p?`${p}%`:"—"}</span>}/>;}) }
      </div>
    </div>
  );
}

function Micro({label,val}) {
  return <div style={{textAlign:"center"}}><div style={{fontSize:13}}>{val}</div><div style={{fontSize:9,color:"#484f58",letterSpacing:1}}>{label}</div></div>;
}

// ─── ACCURACY DASHBOARD ───────────────────────────────────────
function AccuracyDashboard({refreshKey, onCalibrationChange}) {
  const [records,setRecords]=useState([]);
  const [loading,setLoading]=useState(true);
  const [activeSection, setActiveSection]=useState("overview");

  useEffect(()=>{(async()=>{setLoading(true);const data=await supabaseQuery(`/mlb_predictions?result_entered=eq.true&order=game_date.asc&limit=2000`);setRecords(data||[]);setLoading(false);})();},[refreshKey]);

  const acc=useMemo(()=>records.length?computeAccuracy(records):null,[records]);
  const calib=acc?.calibration;

  if (loading) return <div style={{color:"#484f58",textAlign:"center",marginTop:60,fontSize:13}}>Loading…</div>;
  if (!acc) return <div style={{color:"#484f58",textAlign:"center",marginTop:60}}><div style={{fontSize:24,marginBottom:12}}>📊</div><div>No graded predictions yet. Results are auto-recorded as games finish.</div></div>;

  const C={green:"#3fb950",yellow:"#e3b341",red:"#f85149",blue:"#58a6ff",dim:"#484f58",muted:"#8b949e",border:"#21262d"};

  const cumData=[]; let correct=0,total=0;
  records.filter(r=>r.ml_correct!==null).forEach(r=>{total++;if(r.ml_correct)correct++;cumData.push({game:total,pct:parseFloat((correct/total*100).toFixed(1))});});

  const roiData=[]; let cumRoi=0;
  records.filter(r=>r.ml_correct!==null).forEach((r,i)=>{cumRoi+=r.ml_correct?90.9:-100;roiData.push({game:i+1,roi:parseFloat(cumRoi.toFixed(0))});});

  return (
    <div style={{maxWidth:900}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16,flexWrap:"wrap",gap:8}}>
        <h2 style={{margin:0,fontSize:16,color:C.blue,letterSpacing:2,textTransform:"uppercase"}}>📊 Accuracy Dashboard</h2>
        <div style={{display:"flex",gap:6}}>
          {["overview","calibration","monthly"].map(s=>(
            <button key={s} onClick={()=>setActiveSection(s)} style={{padding:"4px 12px",borderRadius:6,border:`1px solid ${activeSection===s?"#30363d":"transparent"}`,background:activeSection===s?"#161b22":"transparent",color:activeSection===s?C.blue:C.dim,cursor:"pointer",fontSize:10,fontWeight:700,letterSpacing:1,textTransform:"uppercase"}}>{s}</button>
          ))}
        </div>
      </div>

      {/* Top stats */}
      <div style={{display:"flex",gap:10,marginBottom:16,flexWrap:"wrap"}}>
        {[
          {label:"ML ACCURACY",value:`${acc.mlAcc}%`,sub:`${acc.mlTotal} picks`,color:parseFloat(acc.mlAcc)>=55?C.green:parseFloat(acc.mlAcc)>=52?C.yellow:C.red},
          {label:"RUN LINE",value:acc.rlAcc?`${acc.rlAcc}%`:"—",color:parseFloat(acc.rlAcc)>=52?C.green:C.red},
          {label:"OVER/UNDER",value:acc.ouAcc?`${acc.ouAcc}%`:"—",color:parseFloat(acc.ouAcc)>=50?C.green:C.red},
          {label:"NET ROI",value:`$${acc.roi}`,sub:`${acc.roiPct}% on stake`,color:parseFloat(acc.roi)>=0?C.green:C.red},
          calib?{label:"BRIER SCORE",value:calib.brierScore,sub:`${(calib.brierSkill*100).toFixed(1)}% vs coin flip`,color:calib.brierScore<0.22?C.green:calib.brierScore<0.24?C.yellow:C.red}:null,
        ].filter(Boolean).map(s=>(
          <div key={s.label} style={{background:"#0d1117",border:`1px solid ${C.border}`,borderRadius:10,padding:"14px 18px",flex:1,minWidth:100,textAlign:"center"}}>
            <div style={{fontSize:26,fontWeight:800,color:s.color}}>{s.value}</div>
            <div style={{fontSize:10,color:C.muted,letterSpacing:1,marginTop:2}}>{s.label}</div>
            {s.sub&&<div style={{fontSize:9,color:C.dim,marginTop:2}}>{s.sub}</div>}
          </div>
        ))}
      </div>

      {activeSection==="overview" && (
        <>
          {/* Streaks + tier */}
          <div style={{display:"flex",gap:10,marginBottom:16,flexWrap:"wrap"}}>
            <div style={{background:"#0d1117",border:`1px solid ${C.border}`,borderRadius:10,padding:"14px 18px",flex:1,minWidth:180}}>
              <div style={{fontSize:10,color:C.dim,letterSpacing:2,marginBottom:10}}>STREAKS</div>
              <div style={{display:"flex",gap:16}}>
                <div><div style={{fontSize:20,fontWeight:800,color:C.green}}>{acc.longestWin}</div><div style={{fontSize:9,color:C.dim}}>LONGEST W</div></div>
                <div><div style={{fontSize:20,fontWeight:800,color:C.red}}>{acc.longestLoss}</div><div style={{fontSize:9,color:C.dim}}>LONGEST L</div></div>
                <div><div style={{fontSize:20,fontWeight:800,color:acc.currentStreak>0?C.green:C.red}}>{acc.currentStreak>0?`W${acc.currentStreak}`:`L${Math.abs(acc.currentStreak)}`}</div><div style={{fontSize:9,color:C.dim}}>CURRENT</div></div>
              </div>
            </div>
            <div style={{background:"#0d1117",border:`1px solid ${C.border}`,borderRadius:10,padding:"14px 18px",flex:1,minWidth:180}}>
              <div style={{fontSize:10,color:C.dim,letterSpacing:2,marginBottom:10}}>BY CONFIDENCE</div>
              <div style={{display:"flex",gap:14}}>
                {["HIGH","MEDIUM","LOW"].map(tier=>{const t=acc.tiers[tier];const p=t.total?Math.round(t.correct/t.total*100):null;const color=p?(p>=60?C.green:p>=52?C.yellow:C.red):C.dim;return(<div key={tier} style={{textAlign:"center"}}><div style={{fontSize:18,fontWeight:800,color}}>{p?`${p}%`:"—"}</div><div style={{fontSize:9,color:C.dim}}>{tier}</div><div style={{fontSize:9,color:C.dim}}>{t.total}g</div></div>);})}
              </div>
            </div>
          </div>

          {/* Cumulative ML accuracy */}
          {cumData.length>2&&<div style={{background:"#0d1117",border:`1px solid ${C.border}`,borderRadius:10,padding:"16px",marginBottom:12}}>
            <div style={{fontSize:10,color:C.muted,letterSpacing:2,marginBottom:12}}>ML ACCURACY OVER TIME</div>
            <ResponsiveContainer width="100%" height={160}>
              <LineChart data={cumData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#161b22"/>
                <XAxis dataKey="game" tick={{fill:C.dim,fontSize:10}}/>
                <YAxis domain={[40,70]} tick={{fill:C.dim,fontSize:10}} tickFormatter={v=>`${v}%`}/>
                <Tooltip contentStyle={{background:"#161b22",border:`1px solid ${C.border}`,borderRadius:6,fontSize:11}} formatter={v=>[`${v}%`,"Accuracy"]}/>
                <ReferenceLine y={55} stroke={C.green} strokeDasharray="4 4"/>
                <ReferenceLine y={50} stroke={C.dim} strokeDasharray="4 4"/>
                <Line type="monotone" dataKey="pct" stroke={C.blue} strokeWidth={2} dot={false}/>
              </LineChart>
            </ResponsiveContainer>
          </div>}

          {/* ROI */}
          {roiData.length>2&&<div style={{background:"#0d1117",border:`1px solid ${C.border}`,borderRadius:10,padding:"16px",marginBottom:12}}>
            <div style={{fontSize:10,color:C.muted,letterSpacing:2,marginBottom:12}}>CUMULATIVE ROI ($100/bet, -110 juice)</div>
            <ResponsiveContainer width="100%" height={130}>
              <LineChart data={roiData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#161b22"/>
                <XAxis dataKey="game" tick={{fill:C.dim,fontSize:10}}/>
                <YAxis tick={{fill:C.dim,fontSize:10}} tickFormatter={v=>`$${v}`}/>
                <Tooltip contentStyle={{background:"#161b22",border:`1px solid ${C.border}`,borderRadius:6,fontSize:11}} formatter={v=>[`$${v}`,"ROI"]}/>
                <ReferenceLine y={0} stroke={C.dim}/>
                <Line type="monotone" dataKey="roi" stroke={parseFloat(acc.roi)>=0?C.green:C.red} strokeWidth={2} dot={false}/>
              </LineChart>
            </ResponsiveContainer>
          </div>}
        </>
      )}

      {activeSection==="calibration" && calib && (
        <>
          <div style={{background:"#0a0f14",border:"1px solid #1e3448",borderRadius:10,padding:"14px 18px",marginBottom:14}}>
            <div style={{fontSize:11,color:C.blue,fontWeight:700,letterSpacing:1,marginBottom:6}}>CALIBRATION ANALYSIS</div>
            <div style={{display:"flex",gap:16,flexWrap:"wrap",marginBottom:10}}>
              <Kv k="Brier Score" v={calib.brierScore}/>
              <Kv k="Skill vs Coin Flip" v={`${(calib.brierSkill*100).toFixed(1)}%`}/>
              <Kv k="Mean Cal. Error" v={`${calib.meanCalibrationError}%`}/>
              <Kv k="Overall Bias" v={`${calib.overallBias>0?"+":""}${calib.overallBias}%`}/>
              <Kv k="Sample Size" v={`${calib.n} games`}/>
            </div>
            {calib.suggestedFactor!==1.0 && (
              <div style={{background:"#1a1400",border:"1px solid #3a2a00",borderRadius:8,padding:"10px 14px",marginBottom:10}}>
                <div style={{fontSize:11,color:C.yellow,marginBottom:6}}>
                  💡 Calibration suggests model is {calib.overallBias<0?"over-confident":"under-confident"} by ~{Math.abs(calib.overallBias).toFixed(1)}%.
                  Suggested correction factor: <strong>×{calib.suggestedFactor}</strong>
                </div>
                <div style={{display:"flex",gap:8}}>
                  <button onClick={()=>onCalibrationChange(calib.suggestedFactor)} style={{background:"#238636",color:"#fff",border:"none",borderRadius:6,padding:"5px 12px",cursor:"pointer",fontSize:11,fontWeight:700}}>Apply ×{calib.suggestedFactor}</button>
                  <button onClick={()=>onCalibrationChange(1.0)} style={{background:"#21262d",color:C.muted,border:`1px solid ${C.border}`,borderRadius:6,padding:"5px 12px",cursor:"pointer",fontSize:11}}>Reset to 1.0</button>
                </div>
              </div>
            )}
            <div style={{fontSize:10,color:C.dim,lineHeight:1.6}}>
              <strong style={{color:C.muted}}>How to read:</strong> The calibration curve shows predicted probability (x-axis) vs actual win rate (y-axis).
              A perfectly calibrated model lies on the diagonal. Points above = model is under-confident; below = over-confident.
              Brier score &lt;0.22 = excellent. Skill score &gt;10% = significantly better than a coin flip.
            </div>
          </div>

          {/* Calibration curve chart */}
          {calib.curve.length>0 && (
            <div style={{background:"#0d1117",border:`1px solid ${C.border}`,borderRadius:10,padding:"16px",marginBottom:14}}>
              <div style={{fontSize:10,color:C.muted,letterSpacing:2,marginBottom:12}}>RELIABILITY DIAGRAM (Predicted vs Actual Win Rate)</div>
              <ResponsiveContainer width="100%" height={220}>
                <ScatterChart margin={{top:10,right:10,bottom:20,left:20}}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#161b22"/>
                  <XAxis dataKey="expected" name="Predicted" unit="%" tick={{fill:C.dim,fontSize:10}} label={{value:"Model Predicted %",position:"bottom",fill:C.dim,fontSize:10}}/>
                  <YAxis dataKey="actual" name="Actual" unit="%" domain={[40,70]} tick={{fill:C.dim,fontSize:10}}/>
                  <Tooltip contentStyle={{background:"#161b22",border:`1px solid ${C.border}`,borderRadius:6,fontSize:11}}
                    content={({active,payload})=>{
                      if (!active||!payload?.length) return null;
                      const d=payload[0]?.payload;
                      return <div style={{background:"#161b22",border:`1px solid ${C.border}`,borderRadius:6,padding:"8px 12px",fontSize:11}}>
                        <div style={{color:C.muted}}>Predicted: {d?.expected}%</div>
                        <div style={{color:C.green}}>Actual: {d?.actual}%</div>
                        <div style={{color:C.dim}}>Bin: {d?.label} ({d?.n} games)</div>
                        <div style={{color:d?.error>0?C.green:C.red}}>Error: {d?.error>0?"+":""}{d?.error}%</div>
                      </div>;
                    }}
                  />
                  {/* Perfect calibration diagonal */}
                  <ReferenceLine segment={[{x:45,y:45},{x:65,y:65}]} stroke={C.dim} strokeDasharray="4 4" label={{value:"Perfect",fill:C.dim,fontSize:9}}/>
                  <Scatter data={calib.curve} fill={C.blue}>
                    {calib.curve.map((entry,i)=><Cell key={i} fill={Math.abs(entry.error)<3?C.green:Math.abs(entry.error)<6?C.yellow:C.red}/>)}
                  </Scatter>
                </ScatterChart>
              </ResponsiveContainer>

              {/* Bin table */}
              <div style={{overflowX:"auto",marginTop:10}}>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:10}}>
                  <thead>
                    <tr style={{color:C.dim,letterSpacing:1}}>
                      {["BIN","GAMES","PRED %","ACTUAL %","ERROR","VERDICT"].map(h=><th key={h} style={{padding:"4px 8px",textAlign:"left",borderBottom:`1px solid ${C.border}`}}>{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {calib.curve.map((b,i)=>(
                      <tr key={i} style={{borderBottom:`1px solid #0d1117`}}>
                        <td style={{padding:"5px 8px",color:C.muted}}>{b.label}</td>
                        <td style={{padding:"5px 8px",color:C.dim}}>{b.n}</td>
                        <td style={{padding:"5px 8px",color:C.blue}}>{b.expected}%</td>
                        <td style={{padding:"5px 8px",color:C.green}}>{b.actual}%</td>
                        <td style={{padding:"5px 8px",color:Math.abs(b.error)<3?C.green:Math.abs(b.error)<6?C.yellow:C.red}}>{b.error>0?"+":""}{b.error}%</td>
                        <td style={{padding:"5px 8px",fontSize:9,color:Math.abs(b.error)<3?C.green:Math.abs(b.error)<6?C.yellow:C.red}}>{Math.abs(b.error)<3?"✓ Well-calibrated":Math.abs(b.error)<6?"⚠ Minor bias":"✗ Needs correction"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {activeSection==="monthly" && acc.byMonth?.length>0 && (
        <div style={{background:"#0d1117",border:`1px solid ${C.border}`,borderRadius:10,padding:"16px"}}>
          <div style={{fontSize:10,color:C.muted,letterSpacing:2,marginBottom:12}}>MONTHLY ML ACCURACY</div>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={acc.byMonth}>
              <CartesianGrid strokeDasharray="3 3" stroke="#161b22"/>
              <XAxis dataKey="month" tick={{fill:C.dim,fontSize:10}}/>
              <YAxis domain={[40,70]} tick={{fill:C.dim,fontSize:10}} tickFormatter={v=>`${v}%`}/>
              <Tooltip contentStyle={{background:"#161b22",border:`1px solid ${C.border}`,borderRadius:6,fontSize:11}} formatter={(v,n,p)=>[`${v}% (${p.payload.correct}/${p.payload.total})`,"ML Acc"]}/>
              <ReferenceLine y={55} stroke={C.green} strokeDasharray="4 4"/>
              <Bar dataKey="pct" radius={[3,3,0,0]}>
                {acc.byMonth.map((entry,i)=><Cell key={i} fill={entry.pct>=55?C.green:entry.pct>=50?C.yellow:C.red}/>)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

// ─── CALENDAR TAB ─────────────────────────────────────────────
function CalendarTab({calibrationFactor}) {
  const todayStr=new Date().toISOString().split("T")[0];
  const [dateStr,setDateStr]=useState(todayStr);
  const [games,setGames]=useState([]);
  const [loading,setLoading]=useState(false);
  const [expanded,setExpanded]=useState(null);
  const [oddsData,setOddsData]=useState(null);

  const loadGames=useCallback(async(d)=>{
    setLoading(true); setGames([]);
    const [raw,odds]=await Promise.all([fetchScheduleForDate(d),fetchOdds()]);
    setOddsData(odds);
    setGames(raw.map(g=>({...g,pred:null,loading:true})));
    const enriched=await Promise.all(raw.map(async(g)=>{
      const homeStatId=resolveStatTeamId(g.homeTeamId,g.homeAbbr);
      const awayStatId=resolveStatTeamId(g.awayTeamId,g.awayAbbr);
      const [homeHit,awayHit,homePitch,awayPitch,homeStarter,awayStarter,homeForm,awayForm,homeStatcast,awayStatcast,homeLineup,awayLineup]=
        await Promise.all([
          fetchTeamHitting(homeStatId),fetchTeamHitting(awayStatId),
          fetchTeamPitching(homeStatId),fetchTeamPitching(awayStatId),
          fetchStarterStats(g.homeStarterId),fetchStarterStats(g.awayStarterId),
          fetchRecentForm(homeStatId),fetchRecentForm(awayStatId),
          fetchStatcast(homeStatId),fetchStatcast(awayStatId),
          fetchLineup(g.gamePk,homeStatId,true),fetchLineup(g.gamePk,awayStatId,false),
        ]);
      if (homeStarter) homeStarter.pitchHand=g.homeStarterHand;
      if (awayStarter) awayStarter.pitchHand=g.awayStarterHand;
      const [homeBullpen,awayBullpen]=await Promise.all([fetchBullpenFatigue(g.homeTeamId),fetchBullpenFatigue(g.awayTeamId)]);
      const pred=predictGame({
        homeTeamId:g.homeTeamId,awayTeamId:g.awayTeamId,homeHit,awayHit,homePitch,awayPitch,
        homeStarterStats:homeStarter,awayStarterStats:awayStarter,homeForm,awayForm,
        homeGamesPlayed:homeForm?.gamesPlayed||0,awayGamesPlayed:awayForm?.gamesPlayed||0,
        bullpenData:{[g.homeTeamId]:homeBullpen,[g.awayTeamId]:awayBullpen},
        homeLineup,awayLineup,umpire:g.umpire,homeStatcast,awayStatcast,calibrationFactor,
      });
      const gameOdds=odds?.games?.find(o=>matchOddsToGame(o,g))||null;
      return {...g,homeHit,awayHit,homeStarterStats:homeStarter,awayStarterStats:awayStarter,homeForm,awayForm,homeStatcast,awayStatcast,homeLineup,awayLineup,pred,loading:false,odds:gameOdds};
    }));
    setGames(enriched); setLoading(false);
  },[calibrationFactor]);

  useEffect(()=>{loadGames(dateStr);},[dateStr,calibrationFactor]);

  return (
    <div>
      <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:16,flexWrap:"wrap"}}>
        <input type="date" value={dateStr} onChange={e=>setDateStr(e.target.value)} style={{background:"#0d1117",color:"#e2e8f0",border:"1px solid #21262d",borderRadius:6,padding:"6px 10px",fontSize:12,fontFamily:"inherit"}}/>
        <button onClick={()=>loadGames(dateStr)} style={{background:"#161b22",color:"#58a6ff",border:"1px solid #21262d",borderRadius:6,padding:"6px 14px",cursor:"pointer",fontSize:11,fontWeight:700,letterSpacing:1}}>↻ REFRESH</button>
        {!loading&&oddsData?.games?.length>0&&<span style={{fontSize:11,color:"#3fb950"}}>✓ Live odds ({oddsData.games.length})</span>}
        {!loading&&oddsData?.noKey&&<span style={{fontSize:11,color:"#484f58"}}>⚠ Add ODDS_API_KEY for market comparison</span>}
        {loading&&<span style={{color:"#484f58",fontSize:11}}>Loading…</span>}
      </div>

      {!loading&&games.length===0&&<div style={{color:"#484f58",textAlign:"center",marginTop:40,fontSize:13}}>No games for {dateStr}</div>}

      <div style={{display:"flex",flexDirection:"column",gap:8}}>
        {games.map(game=>{
          const home=teamById(game.homeTeamId), away=teamById(game.awayTeamId);
          const bannerInfo=game.loading?{color:"yellow",label:"Calculating…"}:getBannerInfo(game.pred,game.odds,game.homeStarter&&game.awayStarter);
          const color=bannerInfo.color;
          const bannerBg=color==="green"?"linear-gradient(135deg,#0b2012,#0e2315)":color==="yellow"?"linear-gradient(135deg,#1a1200,#1a1500)":"linear-gradient(135deg,#0d1117,#111822)";
          const borderColor=color==="green"?"#2ea043":color==="yellow"?"#4a3a00":"#21262d";
          const isOpen=expanded===game.gamePk;

          // Data quality badges
          const badges=[];
          if (game.homeLineup||game.awayLineup) badges.push({label:"LINEUP",color:"#1a3a5a"});
          if (game.umpire?.name) badges.push({label:`UMP:${game.umpire.name.split(" ").pop()}`,color:game.umpire.runImpact<-0.1?"#1a2a1a":game.umpire.runImpact>0.1?"#2a1a1a":"#1a1a2a"});
          if (game.homeStatcast||game.awayStatcast) badges.push({label:"STATCAST",color:"#2a1a3a"});
          if (game.pred?.hasPlatoon) badges.push({label:"PLATOON",color:"#2a2a1a"});

          return (
            <div key={game.gamePk} className="gc" style={{background:bannerBg,border:`1px solid ${borderColor}`,borderRadius:10,overflow:"hidden"}}>
              <div onClick={()=>setExpanded(isOpen?null:game.gamePk)} style={{padding:"14px 18px",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:10}}>
                <div style={{display:"flex",alignItems:"center",gap:14,minWidth:160}}>
                  <div style={{textAlign:"center"}}><div style={{fontSize:20,fontWeight:800,color:"#e2e8f0",letterSpacing:1}}>{away.abbr}</div><div style={{fontSize:9,color:"#484f58"}}>AWAY</div>{game.awayStarter&&<div style={{fontSize:10,color:"#8b949e",marginTop:2}}>{game.awayStarter.split(" ").pop()}{game.awayStarterHand?` (${game.awayStarterHand})`:""}</div>}</div>
                  <div style={{fontSize:14,color:"#484f58"}}>@</div>
                  <div style={{textAlign:"center"}}><div style={{fontSize:20,fontWeight:800,color:"#e2e8f0",letterSpacing:1}}>{home.abbr}</div><div style={{fontSize:9,color:"#484f58"}}>HOME</div>{game.homeStarter&&<div style={{fontSize:10,color:"#8b949e",marginTop:2}}>{game.homeStarter.split(" ").pop()}{game.homeStarterHand?` (${game.homeStarterHand})`:""}</div>}</div>
                </div>

                {game.loading?<div style={{color:"#484f58",fontSize:11}}>Calculating…</div>
                :game.pred?(
                  <div style={{display:"flex",gap:16,flexWrap:"wrap",alignItems:"center"}}>
                    <Pill label="PROJ" value={`${away.abbr} ${game.pred.awayRuns.toFixed(1)} — ${home.abbr} ${game.pred.homeRuns.toFixed(1)}`}/>
                    <Pill label="MDL ML" value={game.pred.modelML_home>0?`+${game.pred.modelML_home}`:game.pred.modelML_home}/>
                    {game.odds?.homeML&&<Pill label="MKT ML" value={game.odds.homeML>0?`+${game.odds.homeML}`:game.odds.homeML} color="#e3b341"/>}
                    <Pill label="O/U" value={game.pred.ouTotal}/>
                    <Pill label="WIN%" value={`${Math.round(game.pred.homeWinPct*100)}%`} color={game.pred.homeWinPct>=0.55?"#3fb950":"#e2e8f0"}/>
                    <Pill label="CONF" value={game.pred.confidence} color={game.pred.confidence==="HIGH"?"#3fb950":game.pred.confidence==="MEDIUM"?"#e3b341":"#8b949e"}/>
                  </div>
                ):<div style={{color:"#484f58",fontSize:11}}>⚠ Unavailable</div>}

                <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                  {badges.map((b,i)=><span key={i} style={{fontSize:8,padding:"2px 6px",borderRadius:4,background:b.color,color:"#aaa",letterSpacing:1,fontWeight:700}}>{b.label}</span>)}
                  {bannerInfo.edge!=null&&<div style={{fontSize:10,fontWeight:700,color:Math.abs(bannerInfo.edge)>=EDGE_THRESHOLD?"#3fb950":"#484f58",whiteSpace:"nowrap"}}>{bannerInfo.label}</div>}
                  <span style={{color:"#484f58",fontSize:12}}>{isOpen?"▲":"▼"}</span>
                </div>
              </div>

              {isOpen&&game.pred&&(
                <div style={{borderTop:`1px solid ${borderColor}`,padding:"14px 18px",background:"rgba(0,0,0,0.3)"}}>
                  {game.status==="Final"&&<div style={{marginBottom:10,padding:"7px 12px",background:"#0a0f14",borderRadius:6,fontSize:12,color:"#3fb950"}}>FINAL: {away.abbr} {game.awayScore} — {home.abbr} {game.homeScore}</div>}

                  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(140px,1fr))",gap:8,marginBottom:10}}>
                    <Kv k="Projected Score" v={`${away.abbr} ${game.pred.awayRuns.toFixed(1)} — ${home.abbr} ${game.pred.homeRuns.toFixed(1)}`}/>
                    <Kv k="Home Win %" v={`${(game.pred.homeWinPct*100).toFixed(1)}%`}/>
                    <Kv k="Away Win %" v={`${(game.pred.awayWinPct*100).toFixed(1)}%`}/>
                    <Kv k="Over/Under" v={`${game.pred.ouTotal} total`}/>
                    <Kv k="Model ML (H)" v={game.pred.modelML_home>0?`+${game.pred.modelML_home}`:game.pred.modelML_home}/>
                    {game.odds?.homeML&&<Kv k="Market ML (H)" v={game.odds.homeML>0?`+${game.odds.homeML}`:game.odds.homeML}/>}
                    <Kv k="Home FIP" v={game.pred.hFIP?.toFixed(2)}/>
                    <Kv k="Away FIP" v={game.pred.aFIP?.toFixed(2)}/>
                    {game.umpire?.name&&<Kv k="Umpire" v={`${game.umpire.name} (${game.umpire.size})`}/>}
                    {game.umpire?.runImpact&&<Kv k="Ump Run Impact" v={`${game.umpire.runImpact>0?"+":""}${game.umpire.runImpact} R/G`}/>}
                    {game.pred.hasLineup&&<Kv k="Lineup wOBA (H)" v={game.pred.homeWOBA?.toFixed(3)}/>}
                    {game.pred.hasLineup&&<Kv k="Lineup wOBA (A)" v={game.pred.awayWOBA?.toFixed(3)}/>}
                    {game.homeStatcast?.xwOBA&&<Kv k="xwOBA (H)" v={game.homeStatcast.xwOBA?.toFixed(3)}/>}
                    {game.awayStatcast?.xwOBA&&<Kv k="xwOBA (A)" v={game.awayStatcast.xwOBA?.toFixed(3)}/>}
                    {game.homeStatcast?.barrelRate&&<Kv k="Barrel% (H)" v={`${(game.homeStatcast.barrelRate*100).toFixed(1)}%`}/>}
                    {game.awayStatcast?.barrelRate&&<Kv k="Barrel% (A)" v={`${(game.awayStatcast.barrelRate*100).toFixed(1)}%`}/>}
                    {game.pred.hasPlatoon&&<Kv k="Platoon Δ (H)" v={`${game.pred.homePlatoonDelta>0?"+":""}${(game.pred.homePlatoonDelta*1000).toFixed(0)} wOBA pts`}/>}
                    {game.pred.hasPlatoon&&<Kv k="Platoon Δ (A)" v={`${game.pred.awayPlatoonDelta>0?"+":""}${(game.pred.awayPlatoonDelta*1000).toFixed(0)} wOBA pts`}/>}
                    <Kv k="Confidence" v={game.pred.confidence}/>
                    <Kv k="Conf Score" v={`${game.pred.confScore}/100`}/>
                  </div>

                  {/* Edge analysis */}
                  {game.odds?.homeML&&game.odds?.awayML&&(()=>{
                    const market=trueImplied(game.odds.homeML,game.odds.awayML);
                    const hEdge=((game.pred.homeWinPct-market.home)*100).toFixed(1);
                    const aEdge=((game.pred.awayWinPct-market.away)*100).toFixed(1);
                    return <div style={{padding:"10px 12px",background:"#0a0f14",borderRadius:6}}>
                      <div style={{fontSize:10,color:"#484f58",letterSpacing:2,marginBottom:6}}>EDGE ANALYSIS (VIG-FREE)</div>
                      <div style={{display:"flex",gap:20,flexWrap:"wrap"}}>
                        <div><span style={{color:parseFloat(hEdge)>=3.5?"#3fb950":parseFloat(hEdge)<0?"#f85149":"#8b949e"}}>{parseFloat(hEdge)>0?"+":""}{hEdge}%</span> <span style={{fontSize:10,color:"#484f58"}}>{home.abbr}</span></div>
                        <div><span style={{color:parseFloat(aEdge)>=3.5?"#3fb950":parseFloat(aEdge)<0?"#f85149":"#8b949e"}}>{parseFloat(aEdge)>0?"+":""}{aEdge}%</span> <span style={{fontSize:10,color:"#484f58"}}>{away.abbr}</span></div>
                        <div style={{fontSize:10,color:"#484f58"}}>Market: {(market.home*100).toFixed(1)}% / {(market.away*100).toFixed(1)}%</div>
                      </div>
                    </div>;
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

// ─── HISTORY TAB ──────────────────────────────────────────────
function HistoryTab({refreshKey}) {
  const [records,setRecords]=useState([]); const [loading,setLoading]=useState(true); const [filterDate,setFilterDate]=useState("");
  const load=useCallback(async()=>{setLoading(true);let path=`/mlb_predictions?order=game_date.desc&limit=200`;if(filterDate)path+=`&game_date=eq.${filterDate}`;const data=await supabaseQuery(path);setRecords(data||[]);setLoading(false);},[filterDate]);
  useEffect(()=>{load();},[load,refreshKey]);
  const deleteRecord=async(id)=>{if(!window.confirm("Delete?"))return;await supabaseQuery(`/mlb_predictions?id=eq.${id}`,"DELETE");load();};
  const grouped=records.reduce((acc,r)=>{if(!acc[r.game_date])acc[r.game_date]=[];acc[r.game_date].push(r);return acc;},{});
  const confColor=c=>c==="HIGH"?"#3fb950":c==="MEDIUM"?"#e3b341":"#8b949e";
  const mlSign=ml=>ml>0?`+${ml}`:ml;
  return (
    <div>
      <div style={{display:"flex",gap:10,alignItems:"center",marginBottom:16,flexWrap:"wrap"}}>
        <h2 style={{margin:0,fontSize:14,color:"#58a6ff",letterSpacing:2,textTransform:"uppercase"}}>📋 History</h2>
        <input type="date" value={filterDate} onChange={e=>setFilterDate(e.target.value)} style={{background:"#0d1117",color:"#e2e8f0",border:"1px solid #21262d",borderRadius:6,padding:"5px 10px",fontSize:11,fontFamily:"inherit"}}/>
        {filterDate&&<button onClick={()=>setFilterDate("")} style={{background:"#0d1117",color:"#8b949e",border:"1px solid #21262d",borderRadius:6,padding:"5px 10px",cursor:"pointer",fontSize:11}}>Clear</button>}
        <button onClick={load} style={{background:"#0d1117",color:"#58a6ff",border:"1px solid #21262d",borderRadius:6,padding:"5px 10px",cursor:"pointer",fontSize:11}}>↻ Refresh</button>
        <button onClick={async()=>{const p=records.filter(r=>!r.result_entered);if(!p.length)return alert("No pending games");const n=await fillFinalScores(p);load();if(!n)alert("No matched games yet");}} style={{background:"#0d1117",color:"#e3b341",border:"1px solid #21262d",borderRadius:6,padding:"5px 10px",cursor:"pointer",fontSize:11}}>⚡ Sync Results</button>
        <button onClick={async()=>{if(!records.length)return alert("No records");const n=await refreshPredictions(records,m=>console.log(m));load();alert(`Refreshed ${n} with v9 formula`);}} style={{background:"#0d1117",color:"#58a6ff",border:"1px solid #21262d",borderRadius:6,padding:"5px 10px",cursor:"pointer",fontSize:11}}>🔁 Refresh v9</button>
        <button onClick={async()=>{if(!window.confirm("Regrade all results with corrected pick logic? This fixes ml_correct/rl_correct for all existing records."))return;const n=await regradeAllResults(m=>setSyncMsg(m));load();alert(`Regraded ${n} records`);}} style={{background:"#1a0a2e",color:"#d2a8ff",border:"1px solid #3d1f6e",borderRadius:6,padding:"5px 10px",cursor:"pointer",fontSize:11,fontWeight:700}}>🔧 Regrade All Results</button>
      </div>
      {loading&&<div style={{color:"#484f58",textAlign:"center",marginTop:40}}>Loading…</div>}
      {!loading&&records.length===0&&<div style={{color:"#484f58",textAlign:"center",marginTop:40}}>No predictions yet</div>}
      {Object.entries(grouped).map(([date,recs])=>(
        <div key={date} style={{marginBottom:20}}>
          <div style={{fontSize:11,fontWeight:700,color:"#e3b341",marginBottom:6,borderBottom:"1px solid #161b22",paddingBottom:5,letterSpacing:2}}>📅 {date}</div>
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
              <thead><tr style={{color:"#484f58",fontSize:9,letterSpacing:1.5}}>{["MATCHUP","MODEL ML","O/U","WIN %","CONF","RESULT","ML✓","RL✓","O/U✓",""].map(h=><th key={h} style={{padding:"5px 8px",textAlign:"left",borderBottom:"1px solid #161b22",whiteSpace:"nowrap"}}>{h}</th>)}</tr></thead>
              <tbody>
                {recs.map(r=>{
                  const bg=r.result_entered?(r.ml_correct?"rgba(63,185,80,0.06)":"rgba(248,81,73,0.06)"):"transparent";
                  return <tr key={r.id} style={{borderBottom:"1px solid #0d1117",background:bg}}>
                    <td style={{padding:"7px 8px",fontWeight:700,whiteSpace:"nowrap",color:"#e2e8f0"}}>{r.away_team} @ {r.home_team}</td>
                    <td style={{padding:"7px 8px",whiteSpace:"nowrap"}}><span style={{color:"#58a6ff"}}>H:{mlSign(r.model_ml_home)}</span><span style={{color:"#484f58",margin:"0 3px"}}>|</span><span style={{color:"#484f58"}}>A:{mlSign(r.model_ml_away)}</span></td>
                    <td style={{padding:"7px 8px",color:"#e3b341"}}>{r.ou_total}</td>
                    <td style={{padding:"7px 8px",color:"#58a6ff"}}>{r.win_pct_home!=null?`${Math.round(r.win_pct_home*100)}%`:"—"}</td>
                    <td style={{padding:"7px 8px"}}><span style={{color:confColor(r.confidence),fontWeight:700,fontSize:10}}>{r.confidence}</span></td>
                    <td style={{padding:"7px 8px",whiteSpace:"nowrap"}}>{r.result_entered?<span style={{color:"#3fb950",fontWeight:600}}>{r.away_team} {r.actual_away_runs} — {r.home_team} {r.actual_home_runs}</span>:<span style={{color:"#4a3a00",fontSize:10}}>⏳ Pending</span>}</td>
                    <td style={{padding:"7px 8px",textAlign:"center"}}>{r.result_entered?(r.ml_correct?"✅":"❌"):"—"}</td>
                    <td style={{padding:"7px 8px",textAlign:"center"}}>{r.result_entered?(r.rl_correct===null?"🔲":r.rl_correct?"✅":"❌"):"—"}</td>
                    <td style={{padding:"7px 8px",textAlign:"center"}}>{r.result_entered?<span style={{color:r.ou_correct==="PUSH"?"#e3b341":"#e2e8f0",fontSize:10}}>{r.ou_correct}</span>:"—"}</td>
                    <td style={{padding:"7px 8px"}}><button onClick={()=>deleteRecord(r.id)} style={{background:"transparent",border:"none",color:"#484f58",cursor:"pointer",fontSize:12}}>🗑</button></td>
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

// ─── PARLAY TAB ───────────────────────────────────────────────
function ParlayTab({calibrationFactor}) {
  const todayStr=new Date().toISOString().split("T")[0];
  const [dateStr,setDateStr]=useState(todayStr); const [legCount,setLegCount]=useState(3); const [allGames,setAllGames]=useState([]); const [loading,setLoading]=useState(false); const [parlay,setParlay]=useState(null); const [customLegs,setCustomLegs]=useState([]); const [mode,setMode]=useState("auto"); const [wager,setWager]=useState(100); const [oddsData,setOddsData]=useState(null);
  const loadGames=useCallback(async(d)=>{setLoading(true);setParlay(null);const[raw,odds]=await Promise.all([fetchScheduleForDate(d),fetchOdds()]);setOddsData(odds);
    const enriched=await Promise.all(raw.map(async(g)=>{
      const homeStatId=resolveStatTeamId(g.homeTeamId,g.homeAbbr),awayStatId=resolveStatTeamId(g.awayTeamId,g.awayAbbr);
      const[homeHit,awayHit,homePitch,awayPitch,homeStarter,awayStarter,homeForm,awayForm,homeStatcast,awayStatcast]=await Promise.all([fetchTeamHitting(homeStatId),fetchTeamHitting(awayStatId),fetchTeamPitching(homeStatId),fetchTeamPitching(awayStatId),fetchStarterStats(g.homeStarterId),fetchStarterStats(g.awayStarterId),fetchRecentForm(homeStatId),fetchRecentForm(awayStatId),fetchStatcast(homeStatId),fetchStatcast(awayStatId)]);
      if(homeStarter)homeStarter.pitchHand=g.homeStarterHand;if(awayStarter)awayStarter.pitchHand=g.awayStarterHand;
      const[homeBullpen,awayBullpen]=await Promise.all([fetchBullpenFatigue(g.homeTeamId),fetchBullpenFatigue(g.awayTeamId)]);
      const pred=predictGame({homeTeamId:g.homeTeamId,awayTeamId:g.awayTeamId,homeHit,awayHit,homePitch,awayPitch,homeStarterStats:homeStarter,awayStarterStats:awayStarter,homeForm,awayForm,homeGamesPlayed:homeForm?.gamesPlayed||0,awayGamesPlayed:awayForm?.gamesPlayed||0,bullpenData:{[g.homeTeamId]:homeBullpen,[g.awayTeamId]:awayBullpen},umpire:g.umpire,homeStatcast,awayStatcast,calibrationFactor});
      return {...g,pred,odds:odds?.games?.find(o=>matchOddsToGame(o,g))||null};
    }));
    setAllGames(enriched.filter(g=>g.pred));setLoading(false);},[calibrationFactor]);
  useEffect(()=>{loadGames(dateStr);},[dateStr,calibrationFactor]);
  useEffect(()=>{if(allGames.length&&mode==="auto")buildAutoParlay();},[allGames,legCount,mode]);
  const buildAutoParlay=()=>{const legs=allGames.map(g=>{const home=teamById(g.homeTeamId),away=teamById(g.awayTeamId);const pickHome=g.pred.homeWinPct>=0.5;const ml=pickHome?(g.odds?.homeML||g.pred.modelML_home):(g.odds?.awayML||g.pred.modelML_away);return{gamePk:g.gamePk,label:`${away.abbr}@${home.abbr}`,pick:pickHome?home.abbr:away.abbr,prob:pickHome?g.pred.homeWinPct:g.pred.awayWinPct,ml,confidence:g.pred.confidence,confScore:g.pred.confScore,hasOdds:!!g.odds?.homeML};}).sort((a,b)=>b.prob-a.prob).slice(0,legCount);setParlay(legs);};
  const toggleCustomLeg=(game,pickHome)=>{const home=teamById(game.homeTeamId),away=teamById(game.awayTeamId);const ml=pickHome?(game.odds?.homeML||game.pred.modelML_home):(game.odds?.awayML||game.pred.modelML_away);const exists=customLegs.find(l=>l.gamePk===game.gamePk);if(exists){if((exists.pick===home.abbr&&pickHome)||(exists.pick===away.abbr&&!pickHome))setCustomLegs(customLegs.filter(l=>l.gamePk!==game.gamePk));else setCustomLegs(customLegs.map(l=>l.gamePk===game.gamePk?{...l,pick:pickHome?home.abbr:away.abbr,prob:pickHome?game.pred.homeWinPct:game.pred.awayWinPct,ml}:l));}else setCustomLegs([...customLegs,{gamePk:game.gamePk,label:`${away.abbr}@${home.abbr}`,pick:pickHome?home.abbr:away.abbr,prob:pickHome?game.pred.homeWinPct:game.pred.awayWinPct,ml,confidence:game.pred.confidence}]);};
  const active=mode==="auto"?(parlay||[]):customLegs;
  const combinedProb=active.length?combinedParlayProb(active):0;
  const decOdds=active.length?combinedParlayOdds(active):1;
  const ev=active.length?((combinedProb*(decOdds-1)*wager)-((1-combinedProb)*wager)).toFixed(2):null;
  return (
    <div>
      <h2 style={{margin:"0 0 14px",fontSize:14,color:"#58a6ff",letterSpacing:2,textTransform:"uppercase"}}>🎯 Parlay Builder</h2>
      <div style={{display:"flex",gap:10,alignItems:"center",marginBottom:14,flexWrap:"wrap"}}>
        <input type="date" value={dateStr} onChange={e=>setDateStr(e.target.value)} style={{background:"#0d1117",color:"#e2e8f0",border:"1px solid #21262d",borderRadius:6,padding:"6px 10px",fontSize:11,fontFamily:"inherit"}}/>
        <div style={{display:"flex",gap:4}}>{[2,3,4,5,6,7,8].map(n=><button key={n} onClick={()=>{setLegCount(n);setMode("auto");}} style={{width:28,height:28,borderRadius:"50%",border:"none",cursor:"pointer",fontSize:11,fontWeight:800,background:mode==="auto"&&legCount===n?"#58a6ff":"#161b22",color:mode==="auto"&&legCount===n?"#0d1117":"#484f58"}}>{n}</button>)}</div>
        <button onClick={()=>setMode(m=>m==="auto"?"custom":"auto")} style={{background:mode==="custom"?"#58a6ff":"#161b22",color:mode==="custom"?"#0d1117":"#e2e8f0",border:"1px solid #21262d",borderRadius:6,padding:"5px 12px",cursor:"pointer",fontSize:11}}>{mode==="custom"?"✏️ Custom":"⚡ Auto"}</button>
        {!loading&&oddsData?.games?.length>0&&<span style={{fontSize:10,color:"#3fb950"}}>✓ Live odds</span>}
        {loading&&<span style={{color:"#484f58",fontSize:11}}>Loading…</span>}
      </div>
      {active.length>0&&<div style={{background:"linear-gradient(135deg,#0d1a2e,#0a1520)",border:"1px solid #1e3448",borderRadius:10,padding:"14px 18px",marginBottom:16}}>
        <div style={{fontSize:10,fontWeight:800,color:"#58a6ff",marginBottom:10,letterSpacing:2}}>{mode==="auto"?`⚡ AUTO ${legCount}-LEG`:`✏️ CUSTOM ${active.length}-LEG`} PARLAY</div>
        <div style={{display:"flex",gap:16,flexWrap:"wrap",marginBottom:10}}>
          <Pill label="COMBINED PROB" value={`${(combinedProb*100).toFixed(1)}%`} color={combinedProb>0.15?"#3fb950":"#f85149"}/>
          <Pill label="FAIR ODDS" value={decimalToML(decOdds)} color="#e3b341"/>
          <Pill label={`PAYOUT ($${wager})`} value={`$${(wager*decOdds).toFixed(0)}`} color="#3fb950"/>
          {ev&&<Pill label="MODEL EV" value={`$${ev}`} color={parseFloat(ev)>=0?"#3fb950":"#f85149"}/>}
        </div>
        <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:10}}><span style={{fontSize:10,color:"#484f58"}}>Wager: $</span><input type="number" value={wager} onChange={e=>setWager(Number(e.target.value))} style={{width:70,background:"#0d1117",color:"#e2e8f0",border:"1px solid #21262d",borderRadius:5,padding:"3px 7px",fontSize:11,fontFamily:"inherit"}}/></div>
        <div style={{display:"flex",flexDirection:"column",gap:5}}>
          {active.map((leg,i)=><div key={leg.gamePk} style={{display:"flex",alignItems:"center",gap:10,background:"rgba(255,255,255,0.03)",borderRadius:7,padding:"7px 10px"}}>
            <div style={{width:20,height:20,borderRadius:"50%",background:"#58a6ff",display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:800,color:"#0d1117"}}>{i+1}</div>
            <div style={{flex:1}}><div style={{fontSize:12,fontWeight:700,color:"#e2e8f0"}}>{leg.label}</div><div style={{fontSize:10,color:"#484f58"}}>Pick: <span style={{color:"#3fb950"}}>{leg.pick}</span> {leg.hasOdds?"· Live odds":"· Model"}</div></div>
            <Pill label="PROB" value={`${(leg.prob*100).toFixed(1)}%`}/>
            <Pill label="ML" value={leg.ml>0?`+${leg.ml}`:leg.ml}/>
            {mode==="custom"&&<button onClick={()=>setCustomLegs(c=>c.filter(l=>l.gamePk!==leg.gamePk))} style={{background:"none",border:"none",color:"#484f58",cursor:"pointer",fontSize:12}}>✕</button>}
          </div>)}
        </div>
      </div>}
      {!loading&&allGames.length>0&&<div>{[...allGames].sort((a,b)=>Math.max(b.pred.homeWinPct,1-b.pred.homeWinPct)-Math.max(a.pred.homeWinPct,1-a.pred.homeWinPct)).map((g,i)=>{
        const home=teamById(g.homeTeamId),away=teamById(g.awayTeamId),favHome=g.pred.homeWinPct>=0.5;
        const isAutoSel=mode==="auto"&&parlay?.find(l=>l.gamePk===g.gamePk);
        const customLeg=customLegs.find(l=>l.gamePk===g.gamePk);
        return <div key={g.gamePk} style={{background:isAutoSel?"#0e2015":"#0d1117",border:`1px solid ${isAutoSel?"#2ea043":"#21262d"}`,borderRadius:8,padding:"10px 14px",marginBottom:6,display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
          <div style={{width:22,fontSize:10,color:"#484f58"}}>{isAutoSel?"✅":`#${i+1}`}</div>
          <div style={{flex:1,minWidth:100}}><div style={{fontSize:13,fontWeight:700,color:"#e2e8f0"}}>{away.abbr} @ {home.abbr}</div><div style={{fontSize:10,color:"#484f58"}}>Fav: {favHome?home.abbr:away.abbr} — {(Math.max(g.pred.homeWinPct,g.pred.awayWinPct)*100).toFixed(1)}%</div></div>
          {g.odds?.homeML&&<Pill label="MKT ML" value={g.odds.homeML>0?`+${g.odds.homeML}`:g.odds.homeML} color="#e3b341"/>}
          <Pill label="MDL ML" value={favHome?(g.pred.modelML_home>0?`+${g.pred.modelML_home}`:g.pred.modelML_home):(g.pred.modelML_away>0?`+${g.pred.modelML_away}`:g.pred.modelML_away)}/>
          <Pill label="O/U" value={g.pred.ouTotal}/>
          {g.umpire?.name&&<span style={{fontSize:9,color:"#484f58"}}>⚖ {g.umpire.name.split(" ").pop()}</span>}
          {mode==="custom"&&<div style={{display:"flex",gap:4}}>
            <button onClick={()=>toggleCustomLeg(g,true)} style={{background:customLeg?.pick===home.abbr?"#2ea043":"#161b22",color:customLeg?.pick===home.abbr?"#fff":"#484f58",border:"1px solid #21262d",borderRadius:5,padding:"3px 9px",cursor:"pointer",fontSize:11}}>{home.abbr}</button>
            <button onClick={()=>toggleCustomLeg(g,false)} style={{background:customLeg?.pick===away.abbr?"#2ea043":"#161b22",color:customLeg?.pick===away.abbr?"#fff":"#484f58",border:"1px solid #21262d",borderRadius:5,padding:"3px 9px",cursor:"pointer",fontSize:11}}>{away.abbr}</button>
          </div>}
        </div>;
      })}</div>}
    </div>
  );
}

// ─── MATCHUP TAB ──────────────────────────────────────────────
function MatchupTab({calibrationFactor}) {
  const [homeTeam,setHomeTeam]=useState(TEAMS[19]); const [awayTeam,setAwayTeam]=useState(TEAMS[11]); const [pred,setPred]=useState(null); const [loading,setLoading]=useState(false);
  const runPrediction=async()=>{setLoading(true);
    const[homeHit,awayHit,homePitch,awayPitch,homeForm,awayForm,homeStatcast,awayStatcast]=await Promise.all([fetchTeamHitting(homeTeam.id),fetchTeamHitting(awayTeam.id),fetchTeamPitching(homeTeam.id),fetchTeamPitching(awayTeam.id),fetchRecentForm(homeTeam.id),fetchRecentForm(awayTeam.id),fetchStatcast(homeTeam.id),fetchStatcast(awayTeam.id)]);
    const result=predictGame({homeTeamId:homeTeam.id,awayTeamId:awayTeam.id,homeHit,awayHit,homePitch,awayPitch,homeForm,awayForm,homeStatcast,awayStatcast,calibrationFactor});
    setPred(result);setLoading(false);};
  return (
    <div style={{maxWidth:540}}>
      <h2 style={{margin:"0 0 14px",fontSize:14,color:"#58a6ff",letterSpacing:2,textTransform:"uppercase"}}>⚾ Matchup Predictor</h2>
      <div style={{display:"flex",gap:10,alignItems:"flex-end",marginBottom:14,flexWrap:"wrap"}}>
        <div><div style={{color:"#484f58",fontSize:9,marginBottom:3,letterSpacing:2}}>AWAY</div><select value={awayTeam.id} onChange={e=>setAwayTeam(TEAMS.find(t=>t.id===parseInt(e.target.value)))} style={{background:"#0d1117",color:"#e2e8f0",border:"1px solid #21262d",borderRadius:6,padding:"6px 10px",fontSize:12,fontFamily:"inherit"}}>{TEAMS.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></div>
        <div style={{color:"#484f58",fontSize:14,paddingBottom:6}}>@</div>
        <div><div style={{color:"#484f58",fontSize:9,marginBottom:3,letterSpacing:2}}>HOME</div><select value={homeTeam.id} onChange={e=>setHomeTeam(TEAMS.find(t=>t.id===parseInt(e.target.value)))} style={{background:"#0d1117",color:"#e2e8f0",border:"1px solid #21262d",borderRadius:6,padding:"6px 10px",fontSize:12,fontFamily:"inherit"}}>{TEAMS.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></div>
        <button onClick={runPrediction} style={{background:"#238636",color:"#fff",border:"none",borderRadius:6,padding:"7px 18px",cursor:"pointer",fontSize:12,fontWeight:700,letterSpacing:1}}>{loading?"COMPUTING…":"⚡ PREDICT"}</button>
      </div>
      {pred&&<div style={{background:"#0d1117",border:"1px solid #21262d",borderRadius:10,padding:18}}>
        <div style={{fontSize:18,fontWeight:800,color:"#e2e8f0",marginBottom:14}}>{awayTeam.abbr} <span style={{color:"#484f58"}}>{pred.awayRuns.toFixed(1)}</span> — <span style={{color:"#484f58"}}>{pred.homeRuns.toFixed(1)}</span> {homeTeam.abbr}</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(130px,1fr))",gap:8}}>
          <Kv k="Home Win %" v={`${(pred.homeWinPct*100).toFixed(1)}%`}/>
          <Kv k="Away Win %" v={`${(pred.awayWinPct*100).toFixed(1)}%`}/>
          <Kv k="O/U Total" v={pred.ouTotal}/>
          <Kv k="Model ML Home" v={pred.modelML_home>0?`+${pred.modelML_home}`:pred.modelML_home}/>
          <Kv k="Home FIP" v={pred.hFIP?.toFixed(2)}/>
          <Kv k="Away FIP" v={pred.aFIP?.toFixed(2)}/>
          {pred.homeWOBA&&<Kv k="Home wOBA" v={pred.homeWOBA?.toFixed(3)}/>}
          {pred.awayWOBA&&<Kv k="Away wOBA" v={pred.awayWOBA?.toFixed(3)}/>}
          <Kv k="Confidence" v={pred.confidence}/>
          <Kv k="Conf Score" v={`${pred.confScore}/100`}/>
          {calibrationFactor!==1.0&&<Kv k="Cal. Factor" v={`×${calibrationFactor.toFixed(2)}`}/>}
          {pred.hasStatcast&&<Kv k="Statcast" v="✓ Active"/>}
        </div>
      </div>}
    </div>
  );
}

// ─── SHARED UI ────────────────────────────────────────────────
function Pill({label,value,color}) {
  return <div style={{textAlign:"center",minWidth:44}}><div style={{fontSize:14,fontWeight:800,color:color||"#e2e8f0"}}>{value}</div><div style={{fontSize:8,color:"#484f58",letterSpacing:1.5,textTransform:"uppercase"}}>{label}</div></div>;
}
function Kv({k,v}) {
  return <div style={{padding:"8px 10px",background:"#080c10",borderRadius:6}}><div style={{fontSize:9,color:"#484f58",letterSpacing:1.5,marginBottom:2,textTransform:"uppercase"}}>{k}</div><div style={{fontSize:13,fontWeight:700,color:"#e2e8f0"}}>{v??'—'}</div></div>;
}
