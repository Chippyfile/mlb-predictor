// src/sports/nba/nbaSync.js
// NBA v18 — ML-first prediction (single source of truth)
//
// v18 changes:
//   ML API (/predict/nba/full) is now the PRIMARY prediction source.
//   Heuristic nbaPredictGame is FALLBACK only if ML API fails.
//   What gets stored = what gets displayed = what we backtest on.
//   FIX HIGH-4: Moneylines computed from ML win probability
//   FIX MED-1:  O/U total from ML model when available
//
// Retained: raw stat columns for training, rest/travel, CLV, ATS picks

import { supabaseQuery } from "../../utils/supabase.js";
import { fetchOdds } from "../../utils/sharedUtils.js";
import { calcCLV } from "../../utils/betUtils.js";
import { mlPredictNBAFull } from "../../utils/mlApi.js";
import {
  fetchNBATeamStats,
  fetchNBAGamesForDate,
  nbaPredictGame,
  matchNBAOddsToGame,
  haversineDistance,
} from "./nbaUtils.js";

// PST/PDT date helper — all date logic uses Pacific time, not UTC
const _pstToday = () => new Date(new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
const _pstTodayStr = () => {
  const d = _pstToday();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const _nbaSeason = (() => {
  const n = _pstToday();
  return `${n.getMonth() < 7 ? n.getFullYear() - 1 : n.getFullYear()}-10-01`;
})();

const _sleep = ms => new Promise(r => setTimeout(r, ms));

// ─────────────────────────────────────────────────────────────
// NBA-10 FIX: Compute real days of rest from schedule data
// NBA-H3 FIX (v16): Now exported so CalendarTab can use it too
// ─────────────────────────────────────────────────────────────
export function computeDaysRest(teamStats, gameDateStr) {
  if (!teamStats?.lastGameDate || !gameDateStr) return 2; // safe default
  try {
    const lastDate = new Date(teamStats.lastGameDate);
    const gameDate = new Date(gameDateStr);
    const diffMs = gameDate.getTime() - lastDate.getTime();
    const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
    // Clamp to reasonable range: 0 (B2B) to 7+
    return Math.max(0, Math.min(14, diffDays - 1)); // -1 because day-of counts as 0 rest
  } catch {
    return 2;
  }
}

// ─────────────────────────────────────────────────────────────
// RESULT GRADING
// ─────────────────────────────────────────────────────────────
export async function nbaFillFinalScores(pendingRows) {
  if (!pendingRows.length) return 0;
  let filled = 0;
  const byDate = {};
  for (const r of pendingRows) {
    if (!byDate[r.game_date]) byDate[r.game_date] = [];
    byDate[r.game_date].push(r);
  }
  for (const [dateStr, rows] of Object.entries(byDate)) {
    try {
      // ── CLV: Fetch closing odds for today's games ──────────
      let closingOdds = null;
      const todayStr = _pstTodayStr();
      if (dateStr === todayStr) {
        try { closingOdds = (await fetchOdds("basketball_nba"))?.games || []; }
        catch (e) { console.warn("NBA CLV: Could not fetch closing odds:", e.message); }
      }

      const games = await fetchNBAGamesForDate(dateStr);
      for (const g of games) {
        if (g.status !== "Final" || g.homeScore === null) continue;
        const row = rows.find(r =>
          (r.game_id && r.game_id === g.gameId) ||
          (r.home_team === g.homeAbbr && r.away_team === g.awayAbbr)
        );
        if (!row) continue;
        const hW = g.homeScore > g.awayScore;
        const mH = (row.win_pct_home ?? 0.5) >= 0.5;
        const ml = mH ? hW : !hW;
        const margin = g.homeScore - g.awayScore;
        const mktSpr = row.market_spread_home ?? null;
        let rl = null;
        if (mktSpr !== null) {
          if (margin > mktSpr) rl = true;
          else if (margin < mktSpr) rl = false;
        } else {
          const ps = row.spread_home || 0;
          if (margin === 0) rl = null;
          else if (margin > 0 && ps > 0) rl = true;
          else if (margin < 0 && ps < 0) rl = true;
          else rl = false;
        }
        const total = g.homeScore + g.awayScore;
        const ouL = row.market_ou_total ?? row.ou_total ?? null;
        const predT = (row.pred_home_score ?? 0) + (row.pred_away_score ?? 0);
        let ou = null;
        if (ouL !== null && total !== ouL) ou = ((total > ouL) === (predT > ouL)) ? "OVER" : "UNDER";
        else if (ouL !== null && total === ouL) ou = "PUSH";

        const updateObj = {
          actual_home_score: g.homeScore, actual_away_score: g.awayScore,
          result_entered: true, ml_correct: ml, rl_correct: rl, ou_correct: ou,
        };

        // ── CLV: Capture closing lines and compute CLV ───────
        if (closingOdds?.length) {
          const match = closingOdds.find(o => matchNBAOddsToGame(o, g));
          if (match) {
            // FIX: odds.js returns homeML/awayML, not homeOdds/awayOdds
            if (match.homeML) updateObj.closing_home_ml = match.homeML;
            if (match.awayML) updateObj.closing_away_ml = match.awayML;
            if (match.marketTotal != null) updateObj.closing_ou_total = match.marketTotal;
            // CLV computation
            const betSide = (row.win_pct_home ?? 0.5) >= 0.5 ? "home" : "away";
            const betML = betSide === "home"
              ? (row.opening_home_ml ?? null)
              : (row.opening_away_ml ?? null);
            const closeML = betSide === "home" ? match.homeML : match.awayML;
            if (betML && closeML) {
              const clvResult = calcCLV(betML, closeML);
              if (clvResult) {
                updateObj.bet_ml = betML;
                updateObj.clv_pct = clvResult.clvPct;
              }
            }
          }
        }

        await supabaseQuery(`/nba_predictions?id=eq.${row.id}`, "PATCH", updateObj);
        filled++;
      }
    } catch (e) { console.warn("nbaFillFinalScores:", dateStr, e); }
  }
  return filled;
}

// ─────────────────────────────────────────────────────────────
// MAIN SYNC — now saves 30+ raw stat columns per game
// ─────────────────────────────────────────────────────────────
export async function nbaAutoSync(onProgress) {
  onProgress?.("🏀 Syncing NBA…");
  const today = _pstTodayStr();
  const existing = await supabaseQuery(
    `/nba_predictions?select=id,game_date,home_team,away_team,result_entered,game_id&order=game_date.asc&limit=10000`
  );
  const savedKeys = new Set((existing || []).map(r => r.game_id || `${r.game_date}|${r.home_team}|${r.away_team}`));
  const pending = (existing || []).filter(r => !r.result_entered);
  if (pending.length) {
    const f = await nbaFillFinalScores(pending);
    if (f) onProgress?.(`🏀 ${f} NBA result(s) recorded`);
  }
  // ── New predictions are created by the server-side cron only ──
  // Frontend refresh (CalendarTab) PATCHes existing rows with updated data.
  // This prevents dual-write issues and ensures v28 ATS pipeline always runs.
  onProgress?.("🏀 NBA sync complete");
}

