/**
 * ncaafSync.js — NCAAF read layer
 * ================================
 * Supabase is the sole source of truth. This module reads it and computes
 * nothing.
 *
 * Column names confirmed against a live row (54 columns). The alias table this
 * file briefly carried is gone — these are the real names:
 *   win_probability · market_total · ats_correct · ats_pick
 *
 * Names used elsewhere in the app that DO NOT exist on this table:
 *   rl_correct · win_pct_home · ml_win_prob_home · market_ou_total · ou_total
 *   spread_home · ats_side · home_team_name · away_team_name · elo_diff_pre
 * Anything selecting or writing those gets a 400 from PostgREST.
 */

import { supabaseQuery } from "../../utils/supabase.js";

const RAILWAY_API =
  import.meta.env.VITE_API_URL ||
  "https://sports-predictor-api-production.up.railway.app";

// ═══════════════════════════════════════════════════════════
// READ
// ═══════════════════════════════════════════════════════════

async function readRows(query) {
  const rows = await supabaseQuery(query);
  if (!Array.isArray(rows)) {
    // PostgREST returns an object on error. Treating that as "no games" is how
    // a 400 disguises itself as an offseason.
    throw new Error(
      `ncaaf_predictions read failed: ${JSON.stringify(rows)?.slice(0, 200)}`
    );
  }
  return rows;
}

/**
 * No `order=` clause anywhere in this module. Ordering by a column that does
 * not exist 400s the entire request; sorting client-side turns that same
 * mistake into a wrong sort instead of an empty page.
 */
export async function loadNCAAFPredictions({ season, week, gameDate } = {}) {
  let query = "/ncaaf_predictions?select=*";
  if (season && week != null) query += `&season=eq.${season}&week=eq.${week}`;
  else if (gameDate) query += `&game_date=eq.${gameDate}`;
  else if (season) query += `&season=eq.${season}`;

  return (await readRows(query)).map(mapNCAAFPrediction).sort(byKickoff);
}

export async function loadNCAAFToday() {
  const back = new Date(Date.now() - 3 * 86400000).toISOString().split("T")[0];
  const fwd = new Date(Date.now() + 4 * 86400000).toISOString().split("T")[0];
  const rows = await readRows(
    `/ncaaf_predictions?select=*&game_date=gte.${back}&game_date=lte.${fwd}`
  );
  return rows.map(mapNCAAFPrediction).sort(byKickoff);
}

const byKickoff = (a, b) =>
  String(a.gameDate ?? "").localeCompare(String(b.gameDate ?? "")) ||
  (b.atsUnits ?? 0) - (a.atsUnits ?? 0) ||
  (b.winProbability ?? 0) - (a.winProbability ?? 0);

// ═══════════════════════════════════════════════════════════
// MAP SUPABASE ROW → DISPLAY FORMAT
// ═══════════════════════════════════════════════════════════

function mapNCAAFPrediction(r) {
  return {
    // Identity
    id: r.id,
    gameId: r.game_id,
    gameDate: r.game_date,
    season: r.season,
    week: r.week,
    homeTeam: r.home_team,
    awayTeam: r.away_team,
    conferenceGame: r.conference_game,
    neutralSite: r.neutral_site,

    // Market
    spread: r.market_spread_home,
    total: r.market_total,
    numProviders: r.num_providers,

    // Projection
    predictedWinner: r.predicted_winner,
    winProbability: r.win_probability,
    predMargin: r.pred_margin,
    predTotal: r.pred_total,
    predHomeScore: r.pred_home_score,
    predAwayScore: r.pred_away_score,
    predHomeRaw: r.pred_home_raw,
    predAwayRaw: r.pred_away_raw,

    // ATS gate
    atsEdge: r.ats_edge,
    atsAvgEdge: r.ats_avg_edge,
    atsConsensus: r.ats_consensus,
    atsContrarian: r.ats_contrarian,
    atsPick: r.ats_pick,
    atsUnits: r.ats_units || 0,
    atsGateBlock: r.ats_gate_block,
    atsNHome: r.ats_n_home,
    atsNAway: r.ats_n_away,
    atsNZero: r.ats_n_zero,
    atsEdgesByModel: r.ats_edges_by_model,

    // O/U
    ouEdge: r.ou_edge,
    ouPick: r.ou_pick,
    ouUnits: r.ou_units || 0,

    // O/U shadow branch — expected all-null until the branch is reachable
    ouShadowPick: r.ou_shadow_pick,
    ouShadowUnits: r.ou_shadow_units,
    ouShadowCorrect: r.ou_shadow_correct,

    // Provenance / health
    modelVersion: r.model_version,
    predictedAt: r.predicted_at,
    gradedAt: r.graded_at,
    featureCoverage: r.feature_coverage,
    nMissing: r.n_missing,
    suppressReason: r.suppress_reason,

    // Parlay
    parlayEligible: r.parlay_eligible,
    parlayConfidence: r.parlay_confidence,

    // Results
    resultEntered: r.result_entered,
    actualHomeScore: r.actual_home_score,
    actualAwayScore: r.actual_away_score,
    actualMargin: r.actual_margin,
    actualTotal: r.actual_total,
    mlCorrect: r.ml_correct,
    atsCorrect: r.ats_correct,
    ouCorrect: r.ou_correct,
    atsProfit: r.ats_profit,
    ouProfit: r.ou_profit,
  };
}

// ═══════════════════════════════════════════════════════════
// REFRESH (trigger backend, then re-read)
// ═══════════════════════════════════════════════════════════

export async function refreshNCAAFWeek(season, week) {
  const res = await fetch(`${RAILWAY_API}/predict/ncaaf`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ season, week }),
  });
  if (!res.ok) throw new Error(`Backend predict failed (${res.status}). Rows unchanged.`);
  return loadNCAAFPredictions({ season, week });
}

// ═══════════════════════════════════════════════════════════
// DERIVED VIEWS
// ═══════════════════════════════════════════════════════════

export async function getNCAAFATSPicks(season, week) {
  return (await loadNCAAFPredictions({ season, week })).filter((r) => r.atsUnits > 0);
}

export async function getNCAAFParlayPicks(season, week) {
  return (await loadNCAAFPredictions({ season, week })).filter((r) => r.parlayEligible);
}

/**
 * ou_correct's encoding is unsettled. The frontend grader wrote the string
 * "OVER" for a correct pick and "UNDER" for an incorrect one — but it also
 * wrote rl_correct, a column that does not exist, so PostgREST rejected the
 * whole PATCH and it never populated this column at all. Whatever writes
 * graded_at is the real grader; whether it stores a boolean or that string is
 * unknown until a graded row exists. Both are accepted here. Drop the one that
 * isn't real once you see a graded row.
 */
const ouIsCorrect = (v) => v === true || v === "OVER";

export async function loadNCAAFSeasonSummary(season) {
  const rows = (await loadNCAAFPredictions({ season })).filter((r) => r.resultEntered);
  if (!rows.length) return null;

  const rate = (subset, test) => {
    const graded = rows.filter(subset);
    if (!graded.length) return { pct: null, n: 0 };
    return { pct: graded.filter(test).length / graded.length, n: graded.length };
  };

  return {
    totalGames: rows.length,
    ml: rate((r) => r.mlCorrect !== null, (r) => r.mlCorrect === true),
    ats: rate((r) => r.atsUnits > 0 && r.atsCorrect !== null, (r) => r.atsCorrect === true),
    ou: rate((r) => r.ouCorrect != null, (r) => ouIsCorrect(r.ouCorrect)),
    atsProfit: rows.reduce((s, r) => s + (r.atsProfit || 0), 0),
    ouProfit: rows.reduce((s, r) => s + (r.ouProfit || 0), 0),
  };
}

export async function ncaafAutoSync(onProgress) {
  onProgress?.("🏈 Loading NCAAF from Supabase…");
  try {
    const preds = await loadNCAAFToday();
    onProgress?.(preds.length ? `🏈 ${preds.length} NCAAF games` : "🏈 No rows in window");
    return preds;
  } catch (e) {
    onProgress?.(`⚠ NCAAF read failed: ${e.message}`);
    throw e;
  }
}
