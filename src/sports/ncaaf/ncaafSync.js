// src/sports/ncaaf/ncaafSync.js
// Lines 3969–4046 of App.jsx (extracted)

import { supabaseQuery } from "../../utils/supabase.js";
import { fetchOdds, _sleep } from "../../utils/sharedUtils.js";
import {
  fetchNCAAFGamesForDate,
  fetchNCAAFTeamStats,
  ncaafPredictGame,
  matchNCAAFOddsToGame,
  ncaafFillFinalScores,
} from "./ncaafUtils.js";

// ─────────────────────────────────────────────────────────────
// AUTO SYNC
// ─────────────────────────────────────────────────────────────
export async function ncaafAutoSync(onProgress) {
  onProgress?.("🏈 Syncing NCAAF…");
  const today = new Date().toISOString().split("T")[0];
  const yr    = new Date().getFullYear();
  const seasonStart = `${yr}-08-15`; // CFB starts late August

  const existing = await supabaseQuery(
    `/ncaaf_predictions?select=id,game_date,home_team_id,away_team_id,result_entered,game_id&order=game_date.asc&limit=10000`
  );
  const savedKeys = new Set(
    (existing || []).map(r => r.game_id || `${r.game_date}|${r.home_team_id}|${r.away_team_id}`)
  );
  const pending = (existing || []).filter(r => !r.result_entered);
  if (pending.length) {
    const f = await ncaafFillFinalScores(pending);
    if (f) onProgress?.(`🏈 ${f} NCAAF result(s) recorded`);
  }

  // CFB: scan only Saturdays + Thursdays + Fridays + Sundays (bowl games)
  const dates = [];
  const cur = new Date(seasonStart);
  const todayDate = new Date(today);
  while (cur <= todayDate) {
    const day = cur.getDay(); // 0=Sun, 4=Thu, 5=Fri, 6=Sat
    if (day === 6 || day === 4 || day === 5 || day === 0) {
      dates.push(cur.toISOString().split("T")[0]);
    }
    cur.setDate(cur.getDate() + 1);
  }

  const todayOdds = (await fetchOdds("americanfootball_ncaaf"))?.games || [];
  let newPred = 0;

  for (const dateStr of dates) {
    const games = await fetchNCAAFGamesForDate(dateStr);
    if (!games.length) { await _sleep(80); continue; }

    const unsaved = games.filter(g =>
      !savedKeys.has(g.gameId || `${dateStr}|${g.homeTeamId}|${g.awayTeamId}`)
    );
    if (!unsaved.length) { await _sleep(80); continue; }

    const isToday = dateStr === today;
    const rows = (await Promise.all(unsaved.map(async g => {
      const [hs, as_] = await Promise.all([
        fetchNCAAFTeamStats(g.homeTeamId),
        fetchNCAAFTeamStats(g.awayTeamId),
      ]);
      if (!hs || !as_) return null;
      const pred = ncaafPredictGame({
        homeStats: hs, awayStats: as_,
        neutralSite: g.neutralSite,
        weather: g.weather,
        homeTeamName: g.homeTeamName || "",
        awayTeamName: g.awayTeamName || "",
        isConferenceGame: g.conferenceGame || false,
      });
      if (!pred) return null;
      const odds = isToday ? (todayOdds.find(o => matchNCAAFOddsToGame(o, g)) || null) : null;
      return {
        game_date:        dateStr,
        game_id:          g.gameId,
        home_team:        g.homeAbbr || g.homeTeamName,
        away_team:        g.awayAbbr || g.awayTeamName,
        home_team_name:   g.homeTeamName,
        away_team_name:   g.awayTeamName,
        home_team_id:     g.homeTeamId,
        away_team_id:     g.awayTeamId,
        home_rank:        g.homeRank,
        away_rank:        g.awayRank,
        home_conference:  hs.conference,
        away_conference:  as_.conference,
        week:             g.week,
        season:           g.season,
        model_ml_home:    pred.modelML_home,
        model_ml_away:    pred.modelML_away,
        spread_home:      pred.projectedSpread,
        ou_total:         pred.ouTotal,
        win_pct_home:     parseFloat(pred.homeWinPct.toFixed(4)),
        confidence:       pred.confidence,
        pred_home_score:  pred.homeScore,
        pred_away_score:  pred.awayScore,
        home_adj_em:      pred.homeAdjEM,
        away_adj_em:      pred.awayAdjEM,
        neutral_site:     g.neutralSite || false,
        key_factors:      pred.factors,
        ...(odds?.marketSpreadHome != null && { market_spread_home: odds.marketSpreadHome }),
        ...(odds?.marketTotal      != null && { market_ou_total:    odds.marketTotal }),
      };
    }))).filter(Boolean);

    if (rows.length) {
      await supabaseQuery("/ncaaf_predictions", "POST", rows);
      newPred += rows.length;
      const ns = await supabaseQuery(
        `/ncaaf_predictions?game_date=eq.${dateStr}&result_entered=eq.false` +
        `&select=id,game_id,home_team_id,away_team_id,ou_total,market_ou_total,` +
        `market_spread_home,result_entered,game_date,win_pct_home,spread_home,` +
        `pred_home_score,pred_away_score`
      );
      if (ns?.length) await ncaafFillFinalScores(ns);
      rows.forEach(r => savedKeys.add(r.game_id || `${dateStr}|${r.home_team_id}|${r.away_team_id}`));
    }
    await _sleep(200);
  }

  onProgress?.(newPred ? `🏈 NCAAF sync complete — ${newPred} new` : "🏈 NCAAF up to date");
}
