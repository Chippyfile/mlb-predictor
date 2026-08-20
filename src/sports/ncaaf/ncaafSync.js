/**
 * ncaafSync.js — NCAAF read layer
 * ================================
 * Supabase is the sole source of truth. This module reads it. Nothing here
 * computes a prediction; the only write path in the app is the grader in
 * ncaafUtils.js, which is a separate decision (see NOTE at the bottom).
 *
 * Changes from the previous version:
 *   - No `order=` in any query. Ordering by a column that doesn't exist 400s
 *     the whole request, and the old code ordered every query by
 *     `win_probability.desc` — a name no other file in the app uses. Sorting
 *     happens client-side now, where a wrong field name is a wrong sort
 *     instead of an empty page.
 *   - Reads fail loudly. supabaseQuery returning a non-array now throws
 *     instead of yielding [] that renders as "no games".
 *   - The mapper carries ats_gate_block, ats_n_zero, ou_shadow_*, elo_diff_pre.
 *   - Contested column names are read through ALIASES until a live row settles
 *     them. describeSchema() reports which name actually won.
 */

import { supabaseQuery } from "../../utils/supabase.js";

const RAILWAY_API =
  import.meta.env.VITE_API_URL ||
  "https://sports-predictor-api-production.up.railway.app";

// ═══════════════════════════════════════════════════════════
// CONTESTED COLUMN NAMES
// ═══════════════════════════════════════════════════════════
// Three files in this app disagree about what these columns are called.
// Each list is tried in order. describeSchema() prints the winner so this
// table can be collapsed to a single name once a real row confirms it.

const ALIASES = {
  winProb: ["win_probability", "win_pct_home", "ml_win_prob_home"],
  marketTotal: ["market_total", "market_ou_total", "ou_total"],
  atsCorrect: ["ats_correct", "rl_correct"],
  atsSide: ["ats_pick", "ats_side"],
};

function pick(row, names) {
  for (const n of names) {
    if (row[n] !== undefined && row[n] !== null) return { value: row[n], key: n };
  }
  return { value: null, key: null };
}

/**
 * Which alias actually appeared in the data, and which never resolved on any
 * row. Render this somewhere visible — an unresolved alias means the display
 * is showing a blank where a real value exists under a name we didn't try.
 */
export function describeSchema(rows) {
  const out = {};
  for (const [field, names] of Object.entries(ALIASES)) {
    const seen = new Set();
    rows.forEach((r) => {
      const raw = r._raw || r;
      names.forEach((n) => {
        if (raw[n] !== undefined && raw[n] !== null) seen.add(n);
      });
    });
    out[field] = {
      resolved: [...seen],
      unresolved: seen.size === 0,
      ambiguous: seen.size > 1, // two names both populated — one is stale
    };
  }
  return out;
}

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
 * @param {Object} opts - { season, week, gameDate }
 */
export async function loadNCAAFPredictions({ season, week, gameDate } = {}) {
  let query = "/ncaaf_predictions?select=*";
  if (season && week != null) query += `&season=eq.${season}&week=eq.${week}`;
  else if (gameDate) query += `&game_date=eq.${gameDate}`;
  else if (season) query += `&season=eq.${season}`;

  const rows = await readRows(query);
  return rows.map(mapNCAAFPrediction).sort(byKickoff);
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
  const winProb = pick(r, ALIASES.winProb);
  const marketTotal = pick(r, ALIASES.marketTotal);
  const atsCorrect = pick(r, ALIASES.atsCorrect);
  const atsSide = pick(r, ALIASES.atsSide);

  return {
    // Identity
    id: r.id,
    gameId: r.game_id,
    gameDate: r.game_date,
    season: r.season,
    week: r.week,
    homeTeam: r.home_team,
    awayTeam: r.away_team,
    homeTeamName: r.home_team_name || r.home_team,
    awayTeamName: r.away_team_name || r.away_team,
    conferenceGame: r.conference_game,
    neutralSite: r.neutral_site,

    // Market
    spread: r.market_spread_home,
    total: marketTotal.value,

    // Winner
    predictedWinner: r.predicted_winner,
    winProbability: winProb.value,
    predMargin: r.pred_margin,
    predHomeScore: r.pred_home_score,
    predAwayScore: r.pred_away_score,
    predTotal: r.pred_total,

    // ATS gate
    atsEdge: r.ats_edge,
    atsContrarian: r.ats_contrarian,
    atsConsensus: r.ats_consensus,
    atsAvgEdge: r.ats_avg_edge,
    atsPick: atsSide.value,
    atsUnits: r.ats_units || 0,
    atsGateBlock: r.ats_gate_block ?? null,
    atsNZero: r.ats_n_zero ?? null,

    // O/U
    ouEdge: r.ou_edge,
    ouPick: r.ou_pick,
    ouUnits: r.ou_units || 0,

    // O/U shadow branch (expected all-null until reachable)
    ouShadowPick: r.ou_shadow_pick ?? null,
    ouShadowUnits: r.ou_shadow_units ?? null,
    ouShadowCorrect: r.ou_shadow_correct ?? null,

    // Diagnostics
    eloDiffPre: r.elo_diff_pre ?? null,
    featureCoverage: r.feature_coverage ?? null,

    // Parlay
    parlayEligible: r.parlay_eligible,
    parlayConfidence: r.parlay_confidence,

    // Results
    actualHomeScore: r.actual_home_score,
    actualAwayScore: r.actual_away_score,
    resultEntered: r.result_entered,
    mlCorrect: r.ml_correct,
    atsCorrect: atsCorrect.value,
    ouCorrect: r.ou_correct,
    atsProfit: r.ats_profit,
    ouProfit: r.ou_profit,

    // Which alias each contested field resolved to, for describeSchema()
    _resolved: {
      winProb: winProb.key,
      marketTotal: marketTotal.key,
      atsCorrect: atsCorrect.key,
      atsSide: atsSide.key,
    },
    _raw: r,
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
  if (!res.ok) {
    throw new Error(`Backend predict failed (${res.status}). Rows unchanged.`);
  }
  return loadNCAAFPredictions({ season, week });
}

// ═══════════════════════════════════════════════════════════
// DERIVED VIEWS
// ═══════════════════════════════════════════════════════════

export async function getNCAAFATSPicks(season, week) {
  const rows = await loadNCAAFPredictions({ season, week });
  return rows.filter((r) => r.atsUnits > 0);
}

export async function getNCAAFParlayPicks(season, week) {
  const rows = await loadNCAAFPredictions({ season, week });
  return rows.filter((r) => r.parlayEligible);
}

/**
 * Season summary. Note ml_correct and atsCorrect are booleans; ou_correct is
 * NOT — the grader writes the string "OVER" for a correct pick and "UNDER"
 * for an incorrect one, so a truthiness test scores every graded game as a
 * win. Compared against "OVER" explicitly here, but the column is badly named
 * and worth renaming on the backend.
 */
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
    ats: rate(
      (r) => r.atsUnits > 0 && r.atsCorrect !== null,
      (r) => r.atsCorrect === true
    ),
    ou: rate((r) => r.ouCorrect != null, (r) => r.ouCorrect === "OVER"),
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

// NOTE — grading still happens in the browser (ncaafUtils.js:522 PATCHes
// ncaaf_predictions with actual scores, correctness flags and CLV). That is a
// write from the frontend and contradicts sole-source-of-truth, but removing it
// before a backend grader exists means Week 0 never grades at all. Move it,
// don't delete it.
