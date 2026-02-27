// src/sports/nfl/nflSync.js
// Lines 2178–2267 of App.jsx (extracted)

import { supabaseQuery } from "../../utils/supabase.js";
import { fetchOdds, _sleep } from "../../utils/sharedUtils.js";
import { fetchNFLGamesForDate, fetchNFLTeamStats, nflPredictGame } from "./nflUtils.js";

// fetchNFLRealEPA is defined in nflUtils or betUtils depending on your build;
// import it from wherever you place the nflverse EPA fetch function.
import { fetchNFLRealEPA } from "../../utils/betUtils.js";

// ─────────────────────────────────────────────────────────────
// ODDS MATCHING
// ─────────────────────────────────────────────────────────────
function matchNFLOddsToGame(o, g) {
  if (!o || !g) return false;
  const n = s => (s || "").toLowerCase().replace(/[\s\W]/g, "");
  return (
    (n(o.homeTeam).includes(n(g.homeTeamName || "").slice(0, 5)) ||
     n(g.homeTeamName || "").includes(n(o.homeTeam).slice(0, 5))) &&
    (n(o.awayTeam).includes(n(g.awayTeamName || "").slice(0, 5)) ||
     n(g.awayTeamName || "").includes(n(o.awayTeam).slice(0, 5)))
  );
}

// ─────────────────────────────────────────────────────────────
// FILL FINAL SCORES
// ─────────────────────────────────────────────────────────────
export async function nflFillFinalScores(pendingRows) {
  if (!pendingRows.length) return 0;
  let filled = 0;
  const byDate = {};
  for (const r of pendingRows) {
    if (!byDate[r.game_date]) byDate[r.game_date] = [];
    byDate[r.game_date].push(r);
  }
  for (const [dateStr, rows] of Object.entries(byDate)) {
    try {
      const games = await fetchNFLGamesForDate(dateStr);
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
        await supabaseQuery(
          `/nfl_predictions?id=eq.${row.id}`, "PATCH",
          { actual_home_score: g.homeScore, actual_away_score: g.awayScore,
            result_entered: true, ml_correct: ml, rl_correct: rl, ou_correct: ou }
        );
        filled++;
      }
    } catch(e) { console.warn("nflFillFinalScores:", dateStr, e); }
  }
  return filled;
}

// ─────────────────────────────────────────────────────────────
// AUTO SYNC
// ─────────────────────────────────────────────────────────────
export async function nflAutoSync(onProgress) {
  onProgress?.("🏈 Syncing NFL…");
  const today = new Date().toISOString().split("T")[0];
  const existing = await supabaseQuery(
    `/nfl_predictions?select=id,game_date,home_team,away_team,result_entered,game_id&order=game_date.asc&limit=5000`
  );
  const savedKeys = new Set(
    (existing || []).map(r => r.game_id || `${r.game_date}|${r.home_team}|${r.away_team}`)
  );
  const pending = (existing || []).filter(r => !r.result_entered);
  if (pending.length) {
    const f = await nflFillFinalScores(pending);
    if (f) onProgress?.(`🏈 ${f} NFL result(s) recorded`);
  }

  // NFL season: weekly scans Aug–Feb
  const yr = new Date().getFullYear();
  const seasonStart = `${yr}-08-01`;
  const dates = [];
  const cur = new Date(seasonStart);
  while (cur.toISOString().split("T")[0] <= today) {
    dates.push(cur.toISOString().split("T")[0]);
    cur.setDate(cur.getDate() + 1);
  }

  const todayOdds = (await fetchOdds("americanfootball_nfl"))?.games || [];
  let newPred = 0;

  for (const dateStr of dates) {
    const games = await fetchNFLGamesForDate(dateStr);
    if (!games.length) { await _sleep(50); continue; }
    const unsaved = games.filter(g =>
      !savedKeys.has(g.gameId || `${dateStr}|${g.homeAbbr}|${g.awayAbbr}`)
    );
    if (!unsaved.length) { await _sleep(50); continue; }

    const isToday = dateStr === today;
    const rows = (await Promise.all(unsaved.map(async g => {
      const [hs, as_] = await Promise.all([
        fetchNFLTeamStats(g.homeAbbr),
        fetchNFLTeamStats(g.awayAbbr),
      ]);
      if (!hs || !as_) return null;
      let nflRealH = null, nflRealA = null;
      try {
        [nflRealH, nflRealA] = await Promise.all([
          fetchNFLRealEPA(hs.abbr),
          fetchNFLRealEPA(as_.abbr),
        ]);
      } catch {}
      const pred = nflPredictGame({
        homeStats: hs, awayStats: as_,
        neutralSite: g.neutralSite, weather: g.weather,
        homeRealEpa: nflRealH, awayRealEpa: nflRealA,
      });
      if (!pred) return null;
      const odds = isToday ? (todayOdds.find(o => matchNFLOddsToGame(o, g)) || null) : null;
      return {
        game_date: dateStr, game_id: g.gameId,
        home_team: g.homeAbbr, away_team: g.awayAbbr,
        home_team_name: g.homeTeamName, away_team_name: g.awayTeamName,
        week: g.week, season: g.season,
        model_ml_home: pred.modelML_home, model_ml_away: pred.modelML_away,
        spread_home: pred.projectedSpread, ou_total: pred.ouTotal,
        win_pct_home: parseFloat(pred.homeWinPct.toFixed(4)),
        confidence: pred.confidence,
        pred_home_score: pred.homeScore, pred_away_score: pred.awayScore,
        home_epa: pred.homeEPA, away_epa: pred.awayEPA,
        key_factors: pred.factors,
        ...(odds?.marketSpreadHome != null && { market_spread_home: odds.marketSpreadHome }),
        ...(odds?.marketTotal      != null && { market_ou_total:    odds.marketTotal }),
      };
    }))).filter(Boolean);

    if (rows.length) {
      await supabaseQuery("/nfl_predictions", "POST", rows);
      newPred += rows.length;
      const ns = await supabaseQuery(
        `/nfl_predictions?game_date=eq.${dateStr}&result_entered=eq.false` +
        `&select=id,game_id,home_team,away_team,ou_total,market_ou_total,` +
        `market_spread_home,result_entered,game_date,win_pct_home,spread_home,` +
        `pred_home_score,pred_away_score`
      );
      if (ns?.length) await nflFillFinalScores(ns);
      rows.forEach(r => savedKeys.add(r.game_id || `${dateStr}|${r.home_team}|${r.away_team}`));
    }
    await _sleep(100);
  }

  onProgress?.(newPred ? `🏈 NFL sync complete — ${newPred} new` : "🏈 NFL up to date");
}
