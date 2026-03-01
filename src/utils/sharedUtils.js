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

// ─────────────────────────────────────────────────────────────
// BET SIGNALS
// Returns individual bet signals for ML, O/U, spread, confidence
// Used to highlight pills and populate the BET SIGNALS panel
// ─────────────────────────────────────────────────────────────
export function getBetSignals({ pred, odds, sport = "ncaa" }) {
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
    const winPct = Math.max(homeWin, awayWin);
    if (winPct >= 0.65) {
      mlSignal = {
        verdict: "LEAN",
        side: homeWin >= 0.65 ? "HOME" : "AWAY",
        edgePct: ((winPct - 0.5) * 100).toFixed(1),
        reason: `Strong model win probability (${(winPct * 100).toFixed(1)}%) — no market to compare`,
      };
    } else {
      mlSignal = { verdict: "SKIP", reason: "No market odds and model win% < 65%" };
    }
  }

  // ── O/U SIGNAL ─────────────────────────────────────────────
  let ouSignal = null;
  const projTotal = sport === "mlb"
    ? (pred.homeRuns + pred.awayRuns)
    : (pred.homeScore + pred.awayScore);
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

  // ── SPREAD SIGNAL ──────────────────────────────────────────
  let spreadSignal = null;
  const projSpread = sport === "mlb" ? pred.runLineHome : pred.projectedSpread;
  const mktSpread  = odds?.homeSpread ?? odds?.marketSpreadHome ?? null;
  if (mktSpread !== null && mktSpread !== undefined) {
    const spreadDiff = projSpread - mktSpread;
    if (Math.abs(spreadDiff) >= (sport === "mlb" ? 0.5 : 3.0)) {
      spreadSignal = {
        verdict: "LEAN",
        side:    spreadDiff > 0 ? "HOME -" : "AWAY +",
        diff:    Math.abs(spreadDiff).toFixed(1),
        reason:  `Model spread ${projSpread > 0 ? "-" : "+"}${Math.abs(projSpread).toFixed(1)} vs market ${mktSpread > 0 ? "-" : "+"}${Math.abs(mktSpread).toFixed(1)}`,
      };
    } else {
      spreadSignal = {
        verdict: "SKIP",
        reason:  `Spread difference (${Math.abs(spreadDiff).toFixed(1)} pts) too small`,
      };
    }
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
    spreadSignal?.verdict === "LEAN";

  // ── BET SIZING (Quarter-Kelly) ─────────────────────────────
  // Calculates suggested bet size as % of bankroll using Kelly Criterion.
  // Only computed when there's an actionable ML signal with market odds.
  let betSizing = null;
  if (mlSignal && mlSignal.verdict !== "SKIP" && odds?.homeML && odds?.awayML) {
    const KELLY_FRACTION = 0.25; // Quarter Kelly — conservative
    const pickedHome = mlSignal.side === "HOME";
    const winPct = pickedHome ? homeWin : awayWin;
    const marketML = pickedHome ? odds.homeML : odds.awayML;
    const decOdds = marketML > 0 ? (marketML / 100) + 1 : (100 / Math.abs(marketML)) + 1;
    const b = decOdds - 1;
    const fullKelly = b > 0 ? (b * winPct - (1 - winPct)) / b : 0;
    const fraction = fullKelly > 0 ? Math.min(0.10, fullKelly * KELLY_FRACTION) : 0;
    if (fraction > 0) {
      const units = fraction >= 0.04 ? 3 : fraction >= 0.02 ? 2 : 1;
      const label = units === 3 ? "MAX (3u)" : units === 2 ? "STRONG (2u)" : "LEAN (1u)";
      const color = units === 3 ? "green" : units === 2 ? "yellow" : "muted";
      betSizing = {
        fraction: parseFloat(fraction.toFixed(4)),
        pct: parseFloat((fraction * 100).toFixed(2)),
        units,
        label,
        color,
        side: mlSignal.side,
        marketML,
        winPct: parseFloat((winPct * 100).toFixed(1)),
        edge: parseFloat(mlSignal.edgePct),
        ev: parseFloat(((winPct * (decOdds - 1) - (1 - winPct)) * 100).toFixed(1)),
      };
    }
  }

  return { ml: mlSignal, ou: ouSignal, spread: spreadSignal, conf: confSignal, dec: decSignal, anyEdge, betSizing };
}

// ─────────────────────────────────────────────────────────────
// ODDS FETCH (cached, 10-min TTL)
// ─────────────────────────────────────────────────────────────
let _oddsCache = {}, _oddsCacheTime = {};

export async function fetchOdds(sport = "baseball_mlb") {
  const key = sport;
  if (_oddsCache[key] && Date.now() - (_oddsCacheTime[key] || 0) < 10 * 60 * 1000)
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
    HIGH:   { total: 0, correct: 0 },
    MEDIUM: { total: 0, correct: 0 },
    LOW:    { total: 0, correct: 0 },
  };
  withResults.forEach(r => {
    if (r.confidence && tiers[r.confidence]) {
      tiers[r.confidence].total++;
      if (r.ml_correct) tiers[r.confidence].correct++;
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
      ? (ou.filter(r => r.ou_correct === "OVER").length / ou.filter(r => r.ou_correct !== "PUSH").length * 100).toFixed(1)
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
  const valid = records.filter(r => r.win_pct_home != null && r.ml_correct !== null && r.result_entered);
  if (valid.length < 20) return null;

  const bins = Array.from({ length: 10 }, (_, i) => ({
    binMin: i * 0.1, binMax: (i + 1) * 0.1,
    label: `${i * 10}-${(i + 1) * 10}%`,
    midpoint: (i + 0.05) * 10,
    predictions: [],
  }));

  valid.forEach(r => {
    const p      = parseFloat(r.win_pct_home);
    const binIdx = Math.min(9, Math.floor(p * 10));
    bins[binIdx].predictions.push({ p, actual: r.ml_correct ? 1 : 0 });
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

  const brierScore  = valid.reduce((sum, r) =>
    sum + Math.pow(parseFloat(r.win_pct_home) - (r.ml_correct ? 1 : 0), 2), 0
  ) / valid.length;

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
