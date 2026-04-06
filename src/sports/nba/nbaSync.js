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
  const allDates = [];
  const cur = new Date(_nbaSeason);
  while (cur.toISOString().split("T")[0] <= today) {
    allDates.push(cur.toISOString().split("T")[0]);
    cur.setDate(cur.getDate() + 1);
  }
  const todayOdds = (await fetchOdds("basketball_nba"))?.games || [];
  let newPred = 0;
  for (const dateStr of allDates) {
    const games = await fetchNBAGamesForDate(dateStr);
    if (!games.length) { await _sleep(50); continue; }
    const unsaved = games.filter(g => !savedKeys.has(g.gameId || `${dateStr}|${g.homeAbbr}|${g.awayAbbr}`));
    if (!unsaved.length) { await _sleep(50); continue; }
    const isToday = dateStr === today;
    const rows = (await Promise.all(unsaved.map(async g => {
      const [hs, as_] = await Promise.all([fetchNBATeamStats(g.homeAbbr), fetchNBATeamStats(g.awayAbbr)]);
      if (!hs || !as_) return null;
      // AUDIT: Use team stats directly for pace/ratings (fetchNBARealPace was redundant wrapper)
      const nbaRealH = { pace: hs.pace, offRtg: hs.adjOE, defRtg: hs.adjDE, netRtg: hs.netRtg };
      const nbaRealA = { pace: as_.pace, offRtg: as_.adjOE, defRtg: as_.adjDE, netRtg: as_.netRtg };

      // NBA-10: Compute real days of rest
      const homeDaysRest = computeDaysRest(hs, dateStr);
      const awayDaysRest = computeDaysRest(as_, dateStr);
      // NBA-11: Get previous city for travel distance
      const awayPrevCityAbbr = as_.lastGameCity || null;

      // ═══ v18: ML-FIRST PREDICTION (single source of truth) ═══
      // Backend (/predict/nba/full) fetches all data server-side and returns
      // margin, win prob, scores — exactly what we store, display, and backtest.
      const odds = isToday ? (todayOdds.find(o => matchNBAOddsToGame(o, g)) || null) : null;

      // AUDIT-v3: VIG removed — model outputs fair probability, not juiced
      const VIG = 0;
      const ML_CAP = 900;

      // Start with raw stats row (always persisted for training)
      const row = {
        game_date: dateStr, game_id: g.gameId,
        home_team: g.homeAbbr, away_team: g.awayAbbr,
        home_team_name: g.homeTeamName, away_team_name: g.awayTeamName,
        home_net_rtg: nbaRealH.netRtg, away_net_rtg: nbaRealA.netRtg,
        ...(odds?.marketSpreadHome != null && { market_spread_home: odds.marketSpreadHome }),
        ...(odds?.marketTotal != null && { market_ou_total: odds.marketTotal }),
        ...(odds?.homeML != null && { opening_home_ml: odds.homeML }),
        ...(odds?.awayML != null && { opening_away_ml: odds.awayML }),
        // Raw stats for ML training
        home_ppg: hs.ppg, away_ppg: as_.ppg,
        home_opp_ppg: hs.oppPpg, away_opp_ppg: as_.oppPpg,
        home_fgpct: hs.fgPct, away_fgpct: as_.fgPct,
        home_threepct: hs.threePct, away_threepct: as_.threePct,
        home_ftpct: hs.ftPct, away_ftpct: as_.ftPct,
        home_assists: hs.assists, away_assists: as_.assists,
        home_turnovers: hs.turnovers, away_turnovers: as_.turnovers,
        home_tempo: hs.pace, away_tempo: as_.pace,
        home_orb_pct: hs.orbPct, away_orb_pct: as_.orbPct,
        home_fta_rate: hs.ftaRate, away_fta_rate: as_.ftaRate,
        home_ato_ratio: hs.atoRatio, away_ato_ratio: as_.atoRatio,
        home_opp_fgpct: hs.oppFgPct, away_opp_fgpct: as_.oppFgPct,
        home_opp_threepct: hs.oppThreePct, away_opp_threepct: as_.oppThreePct,
        home_steals: hs.steals, away_steals: as_.steals,
        home_blocks: hs.blocks, away_blocks: as_.blocks,
        home_wins: hs.wins, away_wins: as_.wins,
        home_losses: hs.losses, away_losses: as_.losses,
        home_form: hs.formScore, away_form: as_.formScore,
        home_days_rest: homeDaysRest, away_days_rest: awayDaysRest,
        away_travel_dist: awayPrevCityAbbr && g.homeAbbr
          ? Math.round(haversineDistance(awayPrevCityAbbr, g.homeAbbr))
          : null,
      };

      // ── PRIMARY: ML API prediction ──
      let mlUsed = false;
      try {
        const mlResult = await mlPredictNBAFull(g.gameId, { gameDate: dateStr });
        if (mlResult && mlResult.ml_margin != null && !mlResult.error) {
          mlUsed = true;
          const mlWinHome = parseFloat((mlResult.ml_win_prob_home ?? 0.5).toFixed(4));
          const mlWinAway = parseFloat((1 - mlWinHome).toFixed(4));
          row.spread_home = parseFloat(mlResult.ml_margin.toFixed(1));
          row.win_pct_home = mlWinHome;
          row.ml_win_prob_home = mlWinHome;
          row.pred_home_score = mlResult.pred_home_score ? parseFloat(mlResult.pred_home_score.toFixed(1)) : parseFloat((hs.ppg + mlResult.ml_margin / 2).toFixed(1));
          row.pred_away_score = mlResult.pred_away_score ? parseFloat(mlResult.pred_away_score.toFixed(1)) : parseFloat((as_.ppg - mlResult.ml_margin / 2).toFixed(1));
          row.ou_total = mlResult.ou_predicted_total ? parseFloat(mlResult.ou_predicted_total.toFixed(1)) : parseFloat((row.pred_home_score + row.pred_away_score).toFixed(1));
          row.confidence = mlResult.model_meta?.confidence || (Math.abs(mlResult.ml_margin) >= 7 ? "HIGH" : Math.abs(mlResult.ml_margin) >= 3 ? "MEDIUM" : "LOW");
          row.ml_feature_coverage = mlResult.feature_coverage || null;
          row.ml_model_type = mlResult.model_meta?.model_type || null;

          // FIX HIGH-4: Compute moneylines from ML win probability (not stale heuristic)
          const hProb = mlWinHome + VIG, aProb = mlWinAway + VIG;
          row.model_ml_home = mlWinHome >= 0.5
            ? -Math.min(ML_CAP, Math.round((hProb / (1 - hProb)) * 100))
            : +Math.min(ML_CAP, Math.round(((1 - hProb) / hProb) * 100));
          row.model_ml_away = mlWinAway >= 0.5
            ? -Math.min(ML_CAP, Math.round((aProb / (1 - aProb)) * 100))
            : +Math.min(ML_CAP, Math.round(((1 - aProb) / aProb) * 100));

          console.log(`[NBA ML] ${g.homeAbbr} vs ${g.awayAbbr}: margin=${mlResult.ml_margin?.toFixed(1)}, wp=${mlWinHome.toFixed(3)}, ml=${row.model_ml_home}/${row.model_ml_away}, coverage=${mlResult.feature_coverage}`);
        }
      } catch (e) {
        console.warn(`[NBA ML] predict failed for ${g.gameId}:`, e.message);
      }

      // ── FALLBACK: Heuristic prediction (only if ML failed) ──
      if (!mlUsed) {
        const pred = nbaPredictGame({
          homeStats: hs, awayStats: as_,
          neutralSite: g.neutralSite,
          homeRealStats: nbaRealH, awayRealStats: nbaRealA,
          homeAbbr: g.homeAbbr, awayAbbr: g.awayAbbr,
          homeDaysRest, awayDaysRest,
          awayPrevCityAbbr,
        });
        if (!pred) return null;
        row.model_ml_home = pred.modelML_home;
        row.model_ml_away = pred.modelML_away;
        row.spread_home = pred.projectedSpread;
        row.ou_total = pred.ouTotal;
        row.win_pct_home = parseFloat(pred.homeWinPct.toFixed(4));
        row.confidence = pred.confidence;
        row.pred_home_score = pred.homeScore;
        row.pred_away_score = pred.awayScore;
        console.log(`[NBA HEURISTIC] ${g.homeAbbr} vs ${g.awayAbbr}: margin=${pred.projectedSpread?.toFixed(1)} (ML unavailable)`);
      }

      // ═══ v27: ATS PICK — computed from spread disagreement ═══
      // Walk-forward validated: 72.1% ATS at 7+ edge, profitable at every threshold 0-12
      if (row.spread_home != null && row.market_spread_home != null) {
        const modelMargin = row.spread_home;           // positive = home wins by X
        const mktImplied = -row.market_spread_home;    // market implied home margin
        const disagree = Math.abs(modelMargin - mktImplied);
        row.ats_disagree = parseFloat(disagree.toFixed(2));

        if (disagree >= 2) {
          const side = modelMargin > mktImplied ? "HOME" : "AWAY";
          row.ats_side = side;
          row.ats_pick_spread = row.market_spread_home;
          // Unit sizing: 7+ edge = 3u, 4-7 = 2u, 2-4 = 1u
          row.ats_units = disagree >= 7 ? 3 : disagree >= 4 ? 2 : 1;
        }
      }

      return row;
    }))).filter(Boolean);
    if (rows.length) {
      // Normalize keys across all rows (Supabase batch POST requires identical keys)
      const allKeys = new Set();
      rows.forEach(r => Object.keys(r).forEach(k => allKeys.add(k)));
      const normalizedRows = rows.map(r => {
        const normalized = {};
        for (const k of allKeys) normalized[k] = r[k] !== undefined ? r[k] : null;
        return normalized;
      });
      await supabaseQuery("/nba_predictions", "UPSERT", normalizedRows, "game_id");
      newPred += rows.length;
      const ns = await supabaseQuery(
        `/nba_predictions?game_date=eq.${dateStr}&result_entered=eq.false&select=id,game_id,home_team,away_team,ou_total,market_ou_total,market_spread_home,result_entered,game_date,win_pct_home,spread_home,pred_home_score,pred_away_score`
      );
      if (ns?.length) await nbaFillFinalScores(ns);
      rows.forEach(r => savedKeys.add(r.game_id || `${dateStr}|${r.home_team}|${r.away_team}`));
    }
    await _sleep(150);
  }
  onProgress?.(newPred ? `🏀 NBA sync complete — ${newPred} new` : "🏀 NBA up to date");
}
