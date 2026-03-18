// src/utils/sharedUtils.js
// Lines 191–328 of App.jsx (extracted) + computeAccuracy/computeCalibration from lines 330–388

// ─────────────────────────────────────────────────────────────
// SEASON CONSTANTS
// ─────────────────────────────────────────────────────────────
export const SEASON = new Date().getFullYear();
const _now = new Date();
export const STAT_SEASON = (_now.getMonth() < 3) ? SEASON - 1 : SEASON;
export const FULL_SEASON_THRESHOLD = 100;
export const MLB_SEASON_START = `${SEASON}-02-01`;
export const MLB_REG_SEASON_START = `${SEASON}-03-27`;

// ─────────────────────────────────────────────────────────────
// MLB SEASON-AWARE CONSTANTS (FanGraphs Guts! — mirrors Python SEASON_CONSTANTS)
// C-2 FIX: JS was hardcoding 2024 values. Now keyed by STAT_SEASON so
// frontend and backend use identical league environment baselines.
// Update annually from fangraphs.com/guts when new season data available.
// ─────────────────────────────────────────────────────────────
export const MLB_SEASON_CONSTANTS = {
  2015: { lg_woba: 0.313, woba_scale: 1.24, lg_rpg: 4.25, lg_fip: 3.97, pa_pg: 38.0 },
  2016: { lg_woba: 0.318, woba_scale: 1.21, lg_rpg: 4.48, lg_fip: 4.19, pa_pg: 38.0 },
  2017: { lg_woba: 0.321, woba_scale: 1.21, lg_rpg: 4.65, lg_fip: 4.36, pa_pg: 38.1 },
  2018: { lg_woba: 0.315, woba_scale: 1.23, lg_rpg: 4.45, lg_fip: 4.15, pa_pg: 37.9 },
  2019: { lg_woba: 0.320, woba_scale: 1.17, lg_rpg: 4.83, lg_fip: 4.51, pa_pg: 38.2 },
  2021: { lg_woba: 0.313, woba_scale: 1.22, lg_rpg: 4.53, lg_fip: 4.26, pa_pg: 37.9 },
  2022: { lg_woba: 0.310, woba_scale: 1.24, lg_rpg: 4.28, lg_fip: 4.01, pa_pg: 37.6 },
  2023: { lg_woba: 0.318, woba_scale: 1.21, lg_rpg: 4.62, lg_fip: 4.33, pa_pg: 37.8 },
  2024: { lg_woba: 0.317, woba_scale: 1.25, lg_rpg: 4.38, lg_fip: 4.17, pa_pg: 37.8 },
  2025: { lg_woba: 0.315, woba_scale: 1.24, lg_rpg: 4.30, lg_fip: 4.10, pa_pg: 37.8 },
  2026: { lg_woba: 0.315, woba_scale: 1.24, lg_rpg: 4.30, lg_fip: 4.10, pa_pg: 37.8 },
};
const MLB_DEFAULT_CONSTANTS = { lg_woba: 0.315, woba_scale: 1.24, lg_rpg: 4.30, lg_fip: 4.10, pa_pg: 37.8 };
export const MLB_CONSTANTS = MLB_SEASON_CONSTANTS[STAT_SEASON] || MLB_DEFAULT_CONSTANTS;

export function getMLBGameType(dateStr) {
  if (!dateStr) return "R";
  return dateStr < MLB_REG_SEASON_START ? "S" : "R";
}

// ─────────────────────────────────────────────────────────────
// ODDS MATH
// ─────────────────────────────────────────────────────────────
export function mlToImplied(ml) {
  if (!ml) return 0.5;
  return ml > 0 ? 100 / (ml + 100) : Math.abs(ml) / (Math.abs(ml) + 100);
}

export function trueImplied(homeML, awayML) {
  const rawHome = mlToImplied(homeML), rawAway = mlToImplied(awayML);
  const total = rawHome + rawAway;
  return { home: rawHome / total, away: rawAway / total };
}

export function mlToDecimal(ml) {
  return ml >= 100 ? ml / 100 + 1 : 100 / Math.abs(ml) + 1;
}

export function decimalToML(dec) {
  return dec >= 2 ? `+${Math.round((dec - 1) * 100)}` : `-${Math.round(100 / (dec - 1))}`;
}

export function combinedParlayOdds(legs) {
  return legs.reduce((acc, l) => acc * mlToDecimal(l.ml), 1);
}

export function combinedParlayProb(legs) {
  return legs.reduce((acc, l) => acc * l.prob, 1);
}

// ─────────────────────────────────────────────────────────────
// BET SIGNAL THRESHOLDS
// ─────────────────────────────────────────────────────────────
export const EDGE_THRESHOLD    = 0.035;
export const OU_EDGE_THRESHOLD = 0.04;   // model total must differ from market by 4%+
export const CONF_BET_THRESHOLD = "HIGH";

// ── DECISIVENESS GATE (calibration-backed) ──────────────────
// Minimum decisiveness (|winPct - 0.5| × 100) to trigger green banner + Kelly sizing.
// Derived from walk-forward backtesting confidence calibration data.
// NCAA: ≥25 → 83.7% accuracy on 65% of games (cumulative ≥0.25 margin)
// NBA:  ≥15 → ~78% accuracy (tighter spreads, more parity)
// MLB:  ≥10 → ~72% accuracy (highest variance sport, 60% edge is strong)
export const DECISIVENESS_GATE = { mlb: 10, nba: 15, ncaa: 25, nfl: 15, ncaaf: 20 };

// ─────────────────────────────────────────────────────────────
// BET SIGNALS
// Returns individual bet signals for ML, O/U, spread, confidence
// Used to highlight pills and populate the BET SIGNALS panel
// ─────────────────────────────────────────────────────────────
export function getBetSignals({ pred, odds, sport = "ncaa", homeName = "Home", awayName = "Away" }) {
  if (!pred) return { ml: null, ou: null, spread: null, conf: null, anyEdge: false };

  const homeWin = pred.homeWinPct;
  const awayWin = 1 - homeWin;

  // ── ML SIGNAL ──────────────────────────────────────────────
  let mlSignal = null;
  if (odds?.homeML && odds?.awayML) {
    const market   = trueImplied(odds.homeML, odds.awayML);
    const homeEdge = homeWin - market.home;
    const awayEdge = awayWin - market.away;
    const bestEdge = Math.abs(homeEdge) >= Math.abs(awayEdge) ? homeEdge : -awayEdge;
    const side     = homeEdge >= 0 ? "HOME" : "AWAY";
    const edgePct  = Math.abs(bestEdge) * 100;
    if (Math.abs(bestEdge) >= EDGE_THRESHOLD) {
      mlSignal = {
        verdict: edgePct >= 7 ? "GO" : "LEAN",
        side, edgePct: edgePct.toFixed(1),
        ml: homeEdge >= 0
          ? (odds.homeML > 0 ? `+${odds.homeML}` : odds.homeML)
          : (odds.awayML > 0 ? `+${odds.awayML}` : odds.awayML),
        reason: `Model gives ${side === "HOME" ? "home" : "away"} ${edgePct.toFixed(1)}% more chance than market`,
      };
    } else {
      mlSignal = {
        verdict: "SKIP",
        edgePct: edgePct.toFixed(1),
        reason: `Only ${edgePct.toFixed(1)}% edge — below ${(EDGE_THRESHOLD * 100).toFixed(1)}% threshold`,
      };
    }
  } else {
    // No market odds — model conviction is the edge
    const winPct = Math.max(homeWin, awayWin);
    const side = homeWin >= awayWin ? "HOME" : "AWAY";
    if (winPct >= 0.80) {
      mlSignal = {
        verdict: "GO",
        side,
        edgePct: ((winPct - 0.5) * 100).toFixed(1),
        reason: `Model gives ${(winPct * 100).toFixed(1)}% win probability — high conviction bet`,
      };
    } else if (winPct >= 0.65) {
      mlSignal = {
        verdict: "LEAN",
        side,
        edgePct: ((winPct - 0.5) * 100).toFixed(1),
        reason: `Model gives ${(winPct * 100).toFixed(1)}% win probability — no market to compare`,
      };
    } else {
      mlSignal = { verdict: "SKIP", reason: "No market odds and model win% < 65%" };
    }
  }

  // ── O/U SIGNAL ─────────────────────────────────────────────
  let ouSignal = null;
  // BUGFIX: Use pred.ouTotal (PPG-based, ~164 for NCAAB) NOT homeScore+awayScore
  // (spread-optimized scores inflate totals by ~13 pts, causing false OVER signals)
  const projTotal = sport === "mlb"
    ? (pred.homeRuns + pred.awayRuns)
    : (pred.ouTotal ?? (pred.homeScore + pred.awayScore));
  const mktTotal = odds?.ouLine ?? odds?.marketTotal ?? null;
  if (mktTotal) {
    const diff    = projTotal - mktTotal;
    const diffPct = Math.abs(diff) / mktTotal;
    if (diffPct >= OU_EDGE_THRESHOLD) {
      ouSignal = {
        verdict: diffPct >= 0.08 ? "GO" : "LEAN",
        side:    diff > 0 ? "OVER" : "UNDER",
        diff:    Math.abs(diff).toFixed(1),
        reason:  `Model projects ${projTotal.toFixed(1)} vs market ${mktTotal} — ${Math.abs(diff).toFixed(1)} pt gap`,
      };
    } else {
      ouSignal = {
        verdict: "SKIP",
        reason:  `Model total (${projTotal.toFixed(1)}) within ${(OU_EDGE_THRESHOLD * 100).toFixed(0)}% of market (${mktTotal})`,
      };
    }
  } else {
    ouSignal = { verdict: "NO LINE", reason: "No market O/U line available" };
  }

  // ── ATS SPREAD SIGNAL (disagreement-based) ──────────────────
  // Walk-forward validated on 26,160 true out-of-sample games:
  //   0-2 pts disagree: 50.6% ATS → NO BET (dead zone)
  //   2-3 pts disagree: 55.9% ATS → 1u (+6.7u per 100 bets)
  //   3-4 pts disagree: 60.3% ATS → 2u (+15.0u per 100 bets)
  //   4+  pts disagree: 68.4% ATS → 3u (+22.5u+ per 100 bets)
  // Symmetrical home/away (59.1% vs 59.4% at 2+ pts), no directional bias.
  // Shuffle test confirms: random margins → 50.2% ATS (model edge is real).
  let spreadSignal = null;
  let betSizing = null;
  const projSpread = sport === "mlb" ? pred.runLineHome : pred.projectedSpread;
  const mktSpread  = odds?.homeSpread ?? odds?.marketSpreadHome ?? null;

  if (mktSpread !== null && mktSpread !== undefined) {
    // Disagreement = |model_margin - market_implied_margin|
    // model: projSpread (+ = home wins by X)
    // market: mktSpread (- = home favored by X, Vegas convention)
    // market implied margin = -mktSpread
    const disagree = Math.abs(projSpread - (-mktSpread));
    const spreadDiff = projSpread + mktSpread; // directional: + = model more bullish on home
    const side = spreadDiff > 0 ? "HOME" : "AWAY";
    const sideLabel = side === "HOME" ? homeName || "Home" : awayName || "Away";

    // Format display strings
    const fmtModel = projSpread >= 0 ? `−${projSpread.toFixed(1)}` : `+${Math.abs(projSpread).toFixed(1)}`;
    const fmtMarket = mktSpread >= 0 ? `+${mktSpread.toFixed(1)}` : `−${Math.abs(mktSpread).toFixed(1)}`;

    if (disagree >= 4) {
      spreadSignal = {
        verdict: "GO",
        side,
        diff: disagree.toFixed(1),
        atsExpected: "65%+",
        reason: `Model ${fmtModel} vs market ${fmtMarket} — ${disagree.toFixed(1)} pt gap (65%+ ATS on 900+ games)`,
      };
      betSizing = {
        units: 3, label: "MAX (3u)", color: "green", side, sideLabel,
        disagree: parseFloat(disagree.toFixed(1)),
        atsHistorical: "65%+",
        reason: `${disagree.toFixed(1)} pts disagreement → 3u (validated 68.4% ATS on 1,242 out-of-sample games)`,
      };
    } else if (disagree >= 3) {
      spreadSignal = {
        verdict: "GO",
        side,
        diff: disagree.toFixed(1),
        atsExpected: "~60%",
        reason: `Model ${fmtModel} vs market ${fmtMarket} — ${disagree.toFixed(1)} pt gap (60% ATS on 1,600+ games)`,
      };
      betSizing = {
        units: 2, label: "STRONG (2u)", color: "yellow", side, sideLabel,
        disagree: parseFloat(disagree.toFixed(1)),
        atsHistorical: "~60%",
        reason: `${disagree.toFixed(1)} pts disagreement → 2u (validated 60.3% ATS on 1,590 out-of-sample games)`,
      };
    } else if (disagree >= 2) {
      spreadSignal = {
        verdict: "LEAN",
        side,
        diff: disagree.toFixed(1),
        atsExpected: "~56%",
        reason: `Model ${fmtModel} vs market ${fmtMarket} — ${disagree.toFixed(1)} pt gap (56% ATS on 3,900+ games)`,
      };
      betSizing = {
        units: 1, label: "LEAN (1u)", color: "muted", side, sideLabel,
        disagree: parseFloat(disagree.toFixed(1)),
        atsHistorical: "~56%",
        reason: `${disagree.toFixed(1)} pts disagreement → 1u (validated 55.9% ATS on 3,879 out-of-sample games)`,
      };
    } else {
      spreadSignal = {
        verdict: "SKIP",
        diff: disagree.toFixed(1),
        reason: `Model agrees with market within ${disagree.toFixed(1)} pts — no ATS edge (50.6% ATS in dead zone)`,
      };
    }
  } else {
    spreadSignal = { verdict: "NO LINE", reason: "No market spread available" };
  }

  // ── CONFIDENCE SIGNAL (data quality — how reliable is this prediction?) ──
  const confSignal = {
    verdict: pred.confidence === "HIGH" ? "GO" : pred.confidence === "MEDIUM" ? "LEAN" : "SKIP",
    score: pred.confScore,
    reason: pred.confidence === "HIGH"
      ? "High data quality — complete stats, mature season, extra sources"
      : pred.confidence === "MEDIUM"
      ? "Moderate data quality — some inputs missing or early season"
      : "Low data quality — limited sample size or missing key inputs",
  };

  // ── DECISIVENESS SIGNAL (prediction strength — how far from 50%?) ──
  const decLabel = pred.decisivenessLabel || (
    pred.decisiveness >= 15 ? "STRONG" : pred.decisiveness >= 7 ? "MODERATE" : "LEAN"
  );
  const decSignal = {
    verdict: decLabel === "STRONG" ? "GO" : decLabel === "MODERATE" ? "LEAN" : "SKIP",
    value: pred.decisiveness ? pred.decisiveness.toFixed(1) : Math.abs((pred.homeWinPct - 0.5) * 100).toFixed(1),
    reason: decLabel === "STRONG"
      ? `Clear separation (${Math.abs((pred.homeWinPct - 0.5) * 100).toFixed(1)}% from coin flip)`
      : decLabel === "MODERATE"
      ? `Moderate lean (${Math.abs((pred.homeWinPct - 0.5) * 100).toFixed(1)}% edge)`
      : `Close matchup — thin margin`,
  };

  const anyEdge =
    mlSignal?.verdict === "GO"   || mlSignal?.verdict === "LEAN" ||
    ouSignal?.verdict === "GO"   || ouSignal?.verdict === "LEAN" ||
    spreadSignal?.verdict === "GO" || spreadSignal?.verdict === "LEAN";

  return { ml: mlSignal, ou: ouSignal, spread: spreadSignal, conf: confSignal, dec: decSignal, anyEdge, betSizing };
}

// ─────────────────────────────────────────────────────────────
// ODDS FETCH (cached, 6-hour TTL to conserve API quota)
// Free tier = 500 req/month. At 3 sports × ~2 fetches/day = ~180/month.
// Sync functions can pass forceRefresh=true when grading closing lines.
// ─────────────────────────────────────────────────────────────
const ODDS_CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours
let _oddsCache = {}, _oddsCacheTime = {};

export async function fetchOdds(sport = "baseball_mlb", forceRefresh = false) {
  const key = sport;
  if (!forceRefresh && _oddsCache[key] && Date.now() - (_oddsCacheTime[key] || 0) < ODDS_CACHE_TTL)
    return _oddsCache[key];
  try {
    const res  = await fetch(`/api/odds?sport=${sport}`);
    if (!res.ok) return null;
    const data = await res.json();
    if (data?.error === "NO_API_KEY") return { games: [], noKey: true };
    _oddsCache[key] = data;
    _oddsCacheTime[key] = Date.now();
    return data;
  } catch { return null; }
}

// ─────────────────────────────────────────────────────────────
// SLEEP UTILITY
// ─────────────────────────────────────────────────────────────
export const _sleep = ms => new Promise(r => setTimeout(r, ms));

// ─────────────────────────────────────────────────────────────
// ACCURACY & CALIBRATION
// Lines 330–388 of App.jsx
// ─────────────────────────────────────────────────────────────
export function computeAccuracy(records) {
  const withResults = records.filter(r => r.result_entered);
  if (!withResults.length) return null;

  const ml = withResults.filter(r => r.ml_correct !== null);
  const rl = withResults.filter(r => r.rl_correct !== null);
  const ou = withResults.filter(r => r.ou_correct !== null);

  const tiers = {
    HIGH:   { total: 0, correct: 0, atsTotal: 0, atsCovered: 0, ouTotal: 0, ouCorrect: 0 },
    MEDIUM: { total: 0, correct: 0, atsTotal: 0, atsCovered: 0, ouTotal: 0, ouCorrect: 0 },
    LOW:    { total: 0, correct: 0, atsTotal: 0, atsCovered: 0, ouTotal: 0, ouCorrect: 0 },
  };
  withResults.forEach(r => {
    if (r.confidence && tiers[r.confidence]) {
      const t = tiers[r.confidence];
      t.total++;
      if (r.ml_correct) t.correct++;
      // ATS: rl_correct is bool true/false or null (push/no line)
      if (r.rl_correct === true || r.rl_correct === false) {
        t.atsTotal++;
        if (r.rl_correct === true) t.atsCovered++;
      }
      // O/U: "OVER" = model correctly predicted direction, "UNDER" = wrong, "PUSH" = excluded
      if (r.ou_correct != null && r.ou_correct !== "PUSH") {
        t.ouTotal++;
        if (r.ou_correct === "OVER" || r.ou_correct === true) t.ouCorrect++;
      }
    }
  });

  let roi = 0;
  ml.forEach(r => { roi += r.ml_correct ? 90.9 : -100; });

  let win = 0, loss = 0, longestWin = 0, longestLoss = 0;
  ml.forEach(r => {
    if (r.ml_correct) { win++; loss = 0; longestWin  = Math.max(longestWin,  win);  }
    else              { loss++; win = 0;  longestLoss = Math.max(longestLoss, loss); }
  });
  const currentStreak = ml.length > 0 ? (ml[ml.length - 1].ml_correct ? win : -loss) : 0;

  const byMonth = {};
  withResults.forEach(r => {
    const m = r.game_date?.slice(0, 7);
    if (!m) return;
    if (!byMonth[m]) byMonth[m] = { month: m, total: 0, correct: 0 };
    if (r.ml_correct !== null) { byMonth[m].total++; if (r.ml_correct) byMonth[m].correct++; }
  });

  const calibration = computeCalibration(withResults);
  const hasMarketSpreads = rl.some(r => r.market_spread_home != null);

  return {
    total: withResults.length, mlTotal: ml.length,
    mlAcc: ml.length ? (ml.filter(r => r.ml_correct).length / ml.length * 100).toFixed(1) : null,
    rlAcc: rl.length ? (rl.filter(r => r.rl_correct).length / rl.length * 100).toFixed(1) : null,
    rlGames: rl.length, hasMarketSpreads,
    ouAcc: ou.length
      ? (ou.filter(r => r.ou_correct === "OVER" || r.ou_correct === true).length / ou.filter(r => r.ou_correct !== "PUSH").length * 100).toFixed(1)
      : null,
    ouGames: ou.filter(r => r.ou_correct !== "PUSH").length,
    tiers,
    roi: roi.toFixed(0),
    roiPct: ml.length ? (roi / (ml.length * 100) * 100).toFixed(1) : null,
    longestWin, longestLoss, currentStreak,
    byMonth: Object.values(byMonth)
      .sort((a, b) => a.month.localeCompare(b.month))
      .map(m => ({ ...m, pct: m.total ? parseFloat((m.correct / m.total * 100).toFixed(1)) : 0 })),
    calibration,
  };
}

export function computeCalibration(records) {
  // Filter to records where we have home win probability AND actual scores to determine home win
  const valid = records.filter(r => r.win_pct_home != null && r.result_entered && (
    // Need actual scores to determine home_won (not ml_correct, which tracks picked-side accuracy)
    (r.actual_home_score != null && r.actual_away_score != null) ||
    (r.actual_home_runs != null && r.actual_away_runs != null)
  ));
  if (valid.length < 20) return null;

  const bins = Array.from({ length: 10 }, (_, i) => ({
    binMin: i * 0.1, binMax: (i + 1) * 0.1,
    label: `${i * 10}-${(i + 1) * 10}%`,
    midpoint: (i + 0.05) * 10,
    predictions: [],
  }));

  valid.forEach(r => {
    const p = parseFloat(r.win_pct_home);
    const binIdx = Math.min(9, Math.floor(p * 10));
    // Determine if HOME actually won (to match win_pct_home, which is home probability)
    const homeScore = r.actual_home_score ?? r.actual_home_runs;
    const awayScore = r.actual_away_score ?? r.actual_away_runs;
    const homeWon = homeScore > awayScore ? 1 : 0;
    bins[binIdx].predictions.push({ p, actual: homeWon });
  });

  const calibrationCurve = bins
    .filter(b => b.predictions.length >= 3)
    .map(b => {
      const n           = b.predictions.length;
      const actualRate  = b.predictions.reduce((s, p) => s + p.actual, 0) / n;
      const expectedRate = b.predictions.reduce((s, p) => s + p.p, 0) / n;
      return {
        label: b.label, midpoint: b.midpoint,
        expected: parseFloat((expectedRate * 100).toFixed(1)),
        actual:   parseFloat((actualRate   * 100).toFixed(1)),
        n,
        error: parseFloat(((actualRate - expectedRate) * 100).toFixed(1)),
      };
    });

  // Brier score: (predicted_home_win_pct - home_actually_won)^2
  const brierScore = valid.reduce((sum, r) => {
    const homeScore = r.actual_home_score ?? r.actual_home_runs;
    const awayScore = r.actual_away_score ?? r.actual_away_runs;
    const homeWon = homeScore > awayScore ? 1 : 0;
    return sum + Math.pow(parseFloat(r.win_pct_home) - homeWon, 2);
  }, 0) / valid.length;

  const overallBias = calibrationCurve.reduce((s, b) => s + (b.actual - b.expected) * b.n, 0) /
    (calibrationCurve.reduce((s, b) => s + b.n, 0) || 1);

  return {
    curve: calibrationCurve,
    brierScore:           parseFloat(brierScore.toFixed(4)),
    brierSkill:           parseFloat((1 - brierScore / 0.25).toFixed(3)),
    meanCalibrationError: parseFloat(
      (calibrationCurve.reduce((s, b) => s + Math.abs(b.error), 0) / (calibrationCurve.length || 1)).toFixed(1)
    ),
    overallBias:    parseFloat(overallBias.toFixed(1)),
    suggestedFactor: Math.abs(overallBias) > 2 && valid.length >= 50
      ? (overallBias < 0 ? 0.85 : 1.15)
      : 1.0,
    n: valid.length,
  };
}
