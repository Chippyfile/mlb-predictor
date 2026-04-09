// src/utils/buildStoredSignals.js
// Builds bet signals from stored Supabase prediction data.
// SINGLE SOURCE OF TRUTH: ATS and O/U come from stored cron computation.
// ML edge computed from stored win_prob + live market odds (correct behavior).
// This replaces getBetSignals() in CalendarTabs.

import { trueImplied, EDGE_THRESHOLD } from "./sharedUtils.js";

export function buildStoredSignals({ pred, odds, sport = "nba", homeName = "Home", awayName = "Away" }) {
  if (!pred) return { ml: null, ou: null, spread: null, conf: null, dec: null, anyEdge: false, betSizing: null };

  // ── ML SIGNAL (stored win_prob vs market odds at prediction time) ──
  // Use stored/opening odds first (from cron snapshot), fall back to live odds
  // This ensures the ML edge matches what was calculated at prediction time
  let mlSignal = null;
  const homeWin = pred.homeWinPct ?? 0.5;
  const awayWin = 1 - homeWin;
  const mlHomeOdds = pred._storedHomeML ?? odds?.homeML;
  const mlAwayOdds = pred._storedAwayML ?? odds?.awayML;

  if (mlHomeOdds && mlAwayOdds) {
    const market = trueImplied(mlHomeOdds, mlAwayOdds);
    const homeEdge = homeWin - market.home;
    const awayEdge = awayWin - market.away;
    const bestEdge = Math.abs(homeEdge) >= Math.abs(awayEdge) ? homeEdge : -awayEdge;
    const side = homeEdge >= 0 ? "HOME" : "AWAY";
    const edgePct = Math.abs(bestEdge) * 100;
    if (Math.abs(bestEdge) >= EDGE_THRESHOLD) {
      mlSignal = {
        verdict: edgePct >= 7 ? "GO" : "LEAN",
        side, edgePct: edgePct.toFixed(1),
        ml: homeEdge >= 0
          ? (mlHomeOdds > 0 ? `+${mlHomeOdds}` : mlHomeOdds)
          : (mlAwayOdds > 0 ? `+${mlAwayOdds}` : mlAwayOdds),
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
    const side = homeWin >= awayWin ? "HOME" : "AWAY";
    if (winPct >= 0.80) {
      mlSignal = { verdict: "GO", side, edgePct: ((winPct - 0.5) * 100).toFixed(1), reason: `Model gives ${(winPct * 100).toFixed(1)}% win probability — high conviction` };
    } else if (winPct >= 0.65) {
      mlSignal = { verdict: "LEAN", side, edgePct: ((winPct - 0.5) * 100).toFixed(1), reason: `Model gives ${(winPct * 100).toFixed(1)}% win probability — no market to compare` };
    } else {
      mlSignal = { verdict: "SKIP", reason: "No market odds and model win% < 65%" };
    }
  }

  // ── ATS / SPREAD SIGNAL (from stored Supabase data — cron computed) ──
  let spreadSignal = null;
  let betSizing = null;
  const storedUnits = pred._storedAtsUnits ?? null;
  const storedSide = pred._storedAtsSide ?? null;
  const storedDisagree = pred._storedAtsDisagree ?? null;
  const storedSpread = pred._storedAtsPickSpread ?? null;

  if (storedUnits != null && storedUnits > 0 && storedSide) {
    // Cron says BET
    const isMLB = sport === "mlb";
    const unitLabel = isMLB ? "run" : "pt";
    const sideLabel = storedSide === "HOME" ? homeName : awayName;
    const tierLabels = {
      3: { label: "MAX (3u)", color: "green", verdict: "GO", acc: sport === "ncaa" ? "~97%" : sport === "nba" ? "~75%" : "~79%" },
      2: { label: "STRONG (2u)", color: "yellow", verdict: "GO", acc: sport === "ncaa" ? "~90%" : sport === "nba" ? "~74%" : "~79%" },
      1: { label: "BET (1u)", color: "muted", verdict: "GO", acc: sport === "ncaa" ? "~74%" : sport === "nba" ? "~70%" : "~76%" },
    };
    const tl = tierLabels[storedUnits] || tierLabels[1];
    spreadSignal = {
      verdict: tl.verdict,
      side: storedSide,
      diff: storedDisagree?.toFixed?.(1) ?? "0",
      atsExpected: tl.acc,
      reason: `Model vs market — ${storedDisagree?.toFixed?.(1) ?? "?"} ${unitLabel} edge (${tl.acc} ATS)`,
    };
    betSizing = {
      units: storedUnits,
      label: tl.label,
      color: tl.color,
      side: storedSide,
      sideLabel,
      disagree: storedDisagree ?? 0,
      atsHistorical: tl.acc,
      reason: `${storedDisagree?.toFixed?.(1) ?? "?"} ${unitLabel}s edge → ${storedUnits}u (validated ${tl.acc})`,
    };
  } else if (storedUnits === 0) {
    // Cron says NO BET
    spreadSignal = {
      verdict: "SKIP",
      diff: storedDisagree?.toFixed?.(1) ?? "0",
      reason: `Model agrees with market within ${storedDisagree?.toFixed?.(1) ?? "?"} pts — no ATS edge`,
    };
  } else {
    // No stored ATS data at all (null) — no signal
    spreadSignal = { verdict: "SKIP", reason: "ATS not yet computed — use 🔄 to generate" };
  }

  // ── O/U SIGNAL (from stored Supabase data — cron computed) ──
  let ouSignal = null;
  const ouPick = pred._ouPick ?? null;
  const ouTier = pred._ouTier ?? 0;
  const ouEdge = pred._ouEdge ?? null;
  const ouPredTotal = pred._ouPredictedTotal ?? null;
  const mktTotal = odds?.ouLine ?? null;

  if (ouPick && ouTier > 0) {
    // Backend triple agreement says BET
    const tierLabelsOU = {
      3: { label: "MAX (3u)", verdict: "GO", acc: sport === "nba" ? "~87%" : "~66%" },
      2: { label: "STRONG (2u)", verdict: "GO", acc: sport === "nba" ? "~85%" : "~63%" },
      1: { label: "BET (1u)", verdict: "GO", acc: sport === "nba" ? "~75%" : "~60%" },
    };
    const tl = tierLabelsOU[ouTier] || tierLabelsOU[1];
    ouSignal = {
      verdict: tl.verdict,
      side: ouPick,
      diff: ouEdge != null ? Math.abs(ouEdge).toFixed(1) : "0",
      edge: ouEdge != null ? Math.abs(ouEdge) : 0,
      units: ouTier,
      modelTotal: ouPredTotal,
      marketLine: mktTotal,
      reason: `${ouPick} ${ouTier}u — triple agreement (${tl.acc} validated)`,
    };
  } else if (ouPredTotal && mktTotal) {
    // Backend computed but no triple agreement — show gap info but SKIP
    const diff = Math.abs(ouPredTotal - mktTotal);
    ouSignal = {
      verdict: "SKIP",
      diff: diff.toFixed(1),
      modelTotal: ouPredTotal,
      marketLine: mktTotal,
      reason: `Model total (${ouPredTotal.toFixed?.(1) ?? ouPredTotal}) vs market (${mktTotal}) — no triple agreement`,
    };
  } else if (mktTotal) {
    ouSignal = { verdict: "SKIP", reason: "O/U not yet computed — use 🔄 to generate" };
  } else {
    ouSignal = { verdict: "NO LINE", reason: "No market O/U line available" };
  }

  // ── CONFIDENCE SIGNAL ──
  const confSignal = {
    verdict: pred.confidence === "HIGH" ? "GO" : pred.confidence === "MEDIUM" ? "LEAN" : "SKIP",
    score: pred.confScore,
    reason: pred.confidence === "HIGH"
      ? "High data quality — complete stats, mature season, extra sources"
      : pred.confidence === "MEDIUM"
      ? "Moderate data quality — some inputs missing or early season"
      : "Low data quality — limited sample size or missing key inputs",
  };

  // ── DECISIVENESS SIGNAL ──
  const decValue = pred.decisiveness ?? Math.abs((homeWin - 0.5) * 100);
  const decLabel = decValue >= 15 ? "STRONG" : decValue >= 7 ? "MODERATE" : "LEAN";
  const decSignal = {
    verdict: decLabel === "STRONG" ? "GO" : decLabel === "MODERATE" ? "LEAN" : "SKIP",
    value: decValue.toFixed(1),
    reason: decLabel === "STRONG"
      ? `Clear separation (${decValue.toFixed(1)}% from coin flip)`
      : decLabel === "MODERATE"
      ? `Moderate lean (${decValue.toFixed(1)}% edge)`
      : "Close matchup — thin margin",
  };

  const anyEdge =
    mlSignal?.verdict === "GO" || mlSignal?.verdict === "LEAN" ||
    ouSignal?.verdict === "GO" || ouSignal?.verdict === "LEAN" ||
    spreadSignal?.verdict === "GO" || spreadSignal?.verdict === "LEAN";

  return { ml: mlSignal, ou: ouSignal, spread: spreadSignal, conf: confSignal, dec: decSignal, anyEdge, betSizing };
}
