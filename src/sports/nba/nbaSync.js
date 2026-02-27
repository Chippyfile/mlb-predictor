// src/sports/nba/nbaSync.js
// Lines 1764–1845 of App.jsx (extracted)
import { supabaseQuery } from "../../utils/supabase.js";
import { fetchOdds } from "../../utils/sharedUtils.js";
import { fetchNBATeamStats, fetchNBAGamesForDate, nbaPredictGame, matchNBAOddsToGame } from "./nbaUtils.js";

const _nbaSeason = (() => {
  const n = new Date();
  return `${n.getMonth() < 7 ? n.getFullYear() - 1 : n.getFullYear()}-10-01`;
})();

const _sleep = ms => new Promise(r => setTimeout(r, ms));

// Fetch real NBA pace/ratings from NBA Stats API (optional enhancement)
async function fetchNBARealPace(abbr) {
  try {
    // NBA Stats API proxy — requires backend relay due to CORS
    const res = await fetch(`/api/nba-stats?team=${abbr}`);
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

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
        await supabaseQuery(`/nba_predictions?id=eq.${row.id}`, "PATCH", {
          actual_home_score: g.homeScore, actual_away_score: g.awayScore,
          result_entered: true, ml_correct: ml, rl_correct: rl, ou_correct: ou,
        });
        filled++;
      }
    } catch (e) { console.warn("nbaFillFinalScores:", dateStr, e); }
  }
  return filled;
}

export async function nbaAutoSync(onProgress) {
  onProgress?.("🏀 Syncing NBA…");
  const today = new Date().toISOString().split("T")[0];
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
      let nbaRealH = null, nbaRealA = null;
      try { [nbaRealH, nbaRealA] = await Promise.all([fetchNBARealPace(g.homeAbbr), fetchNBARealPace(g.awayAbbr)]); } catch {}
      const pred = nbaPredictGame({ homeStats: hs, awayStats: as_, neutralSite: g.neutralSite, homeRealStats: nbaRealH, awayRealStats: nbaRealA, homeAbbr: g.homeAbbr, awayAbbr: g.awayAbbr });
      if (!pred) return null;
      const odds = isToday ? (todayOdds.find(o => matchNBAOddsToGame(o, g)) || null) : null;
      return {
        game_date: dateStr, game_id: g.gameId,
        home_team: g.homeAbbr, away_team: g.awayAbbr,
        home_team_name: g.homeTeamName, away_team_name: g.awayTeamName,
        model_ml_home: pred.modelML_home, model_ml_away: pred.modelML_away,
        spread_home: pred.projectedSpread, ou_total: pred.ouTotal,
        win_pct_home: parseFloat(pred.homeWinPct.toFixed(4)),
        confidence: pred.confidence,
        pred_home_score: pred.homeScore, pred_away_score: pred.awayScore,
        home_net_rtg: pred.homeNetRtg, away_net_rtg: pred.awayNetRtg,
        ...(odds?.marketSpreadHome != null && { market_spread_home: odds.marketSpreadHome }),
        ...(odds?.marketTotal != null && { market_ou_total: odds.marketTotal }),
      };
    }))).filter(Boolean);
    if (rows.length) {
      await supabaseQuery("/nba_predictions", "POST", rows);
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
