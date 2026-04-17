/**
 * ncaafSync.js — NCAAF Frontend Sync Module
 * ============================================
 * Architecture: Supabase is sole source of truth.
 * Page load: read from Supabase.
 * Refresh: trigger backend cron → re-read from Supabase.
 * 
 * No frontend computation of predictions — everything comes from backend.
 */

import { supabaseQuery } from "../../utils/supabaseClient";

const RAILWAY_API = import.meta.env.VITE_API_URL || "https://sports-predictor-api-production.up.railway.app";

// ═══════════════════════════════════════════════════════════
// LOAD PREDICTIONS FROM SUPABASE
// ═══════════════════════════════════════════════════════════

/**
 * Load NCAAF predictions for a specific date range or week.
 * @param {Object} opts - { season, week, gameDate }
 * @returns {Array} predictions from Supabase
 */
export async function loadNCAAFPredictions({ season, week, gameDate } = {}) {
  let query = "/ncaaf_predictions?select=*&order=game_date.asc,win_probability.desc";

  if (season && week) {
    query += `&season=eq.${season}&week=eq.${week}`;
  } else if (gameDate) {
    query += `&game_date=eq.${gameDate}`;
  } else if (season) {
    query += `&season=eq.${season}`;
  }

  const rows = await supabaseQuery(query);
  if (!rows?.length) return [];

  return rows.map(mapNCAAFPrediction);
}

/**
 * Load all NCAAF predictions for today / this week.
 */
export async function loadNCAAFToday() {
  const today = new Date().toISOString().split("T")[0];
  // CFB games are usually Saturday, but load the whole week
  const weekAgo = new Date(Date.now() - 3 * 86400000).toISOString().split("T")[0];
  const weekAhead = new Date(Date.now() + 4 * 86400000).toISOString().split("T")[0];

  const query = `/ncaaf_predictions?select=*&game_date=gte.${weekAgo}&game_date=lte.${weekAhead}&order=game_date.asc,win_probability.desc`;
  const rows = await supabaseQuery(query);
  return (rows || []).map(mapNCAAFPrediction);
}

// ═══════════════════════════════════════════════════════════
// MAP SUPABASE ROW → DISPLAY FORMAT
// ═══════════════════════════════════════════════════════════

function mapNCAAFPrediction(r) {
  return {
    // Identity
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

    // Winner
    predictedWinner: r.predicted_winner,
    winProbability: r.win_probability,
    predMargin: r.pred_margin,

    // Scores
    predHomeScore: r.pred_home_score,
    predAwayScore: r.pred_away_score,
    predTotal: r.pred_total,

    // ATS
    atsEdge: r.ats_edge,
    atsContrarian: r.ats_contrarian,
    atsConsensus: r.ats_consensus,
    atsAvgEdge: r.ats_avg_edge,
    atsPick: r.ats_pick,
    atsUnits: r.ats_units || 0,

    // O/U
    ouEdge: r.ou_edge,
    ouPick: r.ou_pick,
    ouUnits: r.ou_units || 0,

    // Parlay
    parlayEligible: r.parlay_eligible,
    parlayConfidence: r.parlay_confidence,

    // Results (filled after grading)
    actualHomeScore: r.actual_home_score,
    actualAwayScore: r.actual_away_score,
    actualMargin: r.actual_margin,
    resultEntered: r.result_entered,
    mlCorrect: r.ml_correct,
    atsCorrect: r.ats_correct,
    ouCorrect: r.ou_correct,
    atsProfit: r.ats_profit,
    ouProfit: r.ou_profit,

    // Derived display values
    _displayWinner: r.predicted_winner === "HOME" ? r.home_team : r.away_team,
    _displayScore: `${r.pred_away_score || "?"}-${r.pred_home_score || "?"}`,
    _atsDisplay: r.ats_pick
      ? `${r.ats_pick === "HOME" ? r.home_team : r.away_team} ${r.ats_units}u`
      : null,
    _ouDisplay: r.ou_pick ? `${r.ou_pick} ${r.ou_units}u` : null,
    _confidenceTier: r.win_probability >= 0.95 ? "LOCK"
      : r.win_probability >= 0.90 ? "STRONG"
      : r.win_probability >= 0.80 ? "SOLID"
      : r.win_probability >= 0.70 ? "LEAN"
      : "TOSS-UP",
  };
}

// ═══════════════════════════════════════════════════════════
// REFRESH (trigger backend, then re-read)
// ═══════════════════════════════════════════════════════════

/**
 * Trigger backend prediction for a specific week, then reload.
 */
export async function refreshNCAAFWeek(season, week) {
  try {
    await fetch(`${RAILWAY_API}/predict/ncaaf`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ season, week }),
    });
  } catch (e) {
    console.warn("NCAAF refresh failed:", e);
  }

  // Re-read from Supabase (source of truth)
  return loadNCAAFPredictions({ season, week });
}

// ═══════════════════════════════════════════════════════════
// SEASON SUMMARY
// ═══════════════════════════════════════════════════════════

/**
 * Load season-level performance summary.
 */
export async function loadNCAAFSeasonSummary(season) {
  const rows = await supabaseQuery(
    `/ncaaf_predictions?season=eq.${season}&result_entered=eq.true&select=ml_correct,ats_correct,ou_correct,ats_profit,ou_profit,ats_units,ou_units`
  );
  if (!rows?.length) return null;

  const mlGames = rows.filter((r) => r.ml_correct !== null);
  const atsGames = rows.filter((r) => r.ats_correct !== null);
  const ouGames = rows.filter((r) => r.ou_correct !== null);

  return {
    totalGames: rows.length,
    mlAccuracy: mlGames.length ? mlGames.filter((r) => r.ml_correct).length / mlGames.length : 0,
    mlGames: mlGames.length,
    atsAccuracy: atsGames.length ? atsGames.filter((r) => r.ats_correct).length / atsGames.length : 0,
    atsGames: atsGames.length,
    atsProfit: atsGames.reduce((s, r) => s + (r.ats_profit || 0), 0),
    ouAccuracy: ouGames.length ? ouGames.filter((r) => r.ou_correct).length / ouGames.length : 0,
    ouGames: ouGames.length,
    ouProfit: ouGames.reduce((s, r) => s + (r.ou_profit || 0), 0),
  };
}

// ═══════════════════════════════════════════════════════════
// PARLAY PICKS (for DailyBets integration)
// ═══════════════════════════════════════════════════════════

/**
 * Get this week's parlay-eligible picks (ML 90%+ confidence).
 */
export async function getNCAAFParlayPicks(season, week) {
  const rows = await supabaseQuery(
    `/ncaaf_predictions?season=eq.${season}&week=eq.${week}&parlay_eligible=eq.true&select=*&order=win_probability.desc`
  );
  return (rows || []).map(mapNCAAFPrediction);
}

/**
 * Get this week's ATS picks (units > 0).
 */
export async function getNCAAFATSPicks(season, week) {
  const rows = await supabaseQuery(
    `/ncaaf_predictions?season=eq.${season}&week=eq.${week}&ats_units=gt.0&select=*&order=ats_avg_edge.desc`
  );
  return (rows || []).map(mapNCAAFPrediction);
}
