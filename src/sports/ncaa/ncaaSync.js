// src/sports/ncaa/ncaaSync.js
// Lines 1166–1530 of App.jsx (extracted)
import { supabaseQuery } from "../../utils/supabase.js";
import { fetchOdds } from "../../utils/sharedUtils.js";
import { fetchNCAATeamStats, fetchNCAAGamesForDate, ncaaPredictGame, matchNCAAOddsToGame } from "./ncaaUtils.js";

// NCAA season starts Nov 1 of the prior calendar year
const _ncaaSeasonStart = (() => {
  const now = new Date();
  const seasonYear = now.getMonth() < 7 ? now.getFullYear() - 1 : now.getFullYear();
  return `${seasonYear}-11-01`;
})();

const _sleep = ms => new Promise(r => setTimeout(r, ms));

// Fetch SOS and home/away splits in a SINGLE API call (Finding 25: was 2 separate calls)
async function fetchNCAATeamRecord(teamId) {
  try {
    const data = await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/teams/${teamId}/record`)
      .then(r => r.ok ? r.json() : null).catch(() => null);
    const items = data?.items || [];

    // SOS
    const sos = items.find(i => i.type === "sos")?.stats?.find(s => s.name === "opponentWinPercent")?.value ?? null;

    // Home/Away splits
    const home = items.find(i => i.type === "home");
    const away = items.find(i => i.type === "away");
    const getStat = (item, name) => item?.stats?.find(s => s.name === name)?.value ?? null;
    const splits = (home || away) ? {
      homeAvgMargin: getStat(home, "avgPointDifferential"),
      awayAvgMargin: getStat(away, "avgPointDifferential"),
    } : null;

    return { sos, splits };
  } catch { return { sos: null, splits: null }; }
}

async function ncaaBuildPredictionRow(game, dateStr, marketOdds = null) {
  const [homeStats, awayStats] = await Promise.all([
    fetchNCAATeamStats(game.homeTeamId),
    fetchNCAATeamStats(game.awayTeamId),
  ]);
  if (!homeStats || !awayStats) return null;

  let homeSOSFactor = null, awaySOSFactor = null, homeSplits = null, awaySplits = null;
  try {
    const [homeRecord, awayRecord] = await Promise.all([
      fetchNCAATeamRecord(game.homeTeamId),
      fetchNCAATeamRecord(game.awayTeamId),
    ]);
    homeSOSFactor = homeRecord.sos;
    awaySOSFactor = awayRecord.sos;
    homeSplits = homeRecord.splits;
    awaySplits = awayRecord.splits;
  } catch {}

  const pred = ncaaPredictGame({ homeStats, awayStats, neutralSite: game.neutralSite, homeSOSFactor, awaySOSFactor, homeSplits, awaySplits });
  if (!pred) return null;

  const market_spread_home = marketOdds?.marketSpreadHome ?? null;
  const market_ou_total = marketOdds?.marketTotal ?? null;

  return {
    game_date: dateStr,
    home_team: game.homeAbbr || game.homeTeamName,
    away_team: game.awayAbbr || game.awayTeamName,
    home_team_name: game.homeTeamName,
    away_team_name: game.awayTeamName,
    game_id: game.gameId,
    home_team_id: game.homeTeamId,
    away_team_id: game.awayTeamId,
    model_ml_home: pred.modelML_home, model_ml_away: pred.modelML_away,
    spread_home: pred.projectedSpread,
    ou_total: pred.ouTotal,
    win_pct_home: parseFloat(pred.homeWinPct.toFixed(4)),
    confidence: pred.confidence,
    pred_home_score: parseFloat(pred.homeScore.toFixed(1)),
    pred_away_score: parseFloat(pred.awayScore.toFixed(1)),
    home_adj_em: pred.homeAdjEM, away_adj_em: pred.awayAdjEM,
    neutral_site: game.neutralSite || false,
    // Raw stats for ML training (Finding 24)
    home_ppg: homeStats.ppg, away_ppg: awayStats.ppg,
    home_opp_ppg: homeStats.oppPpg, away_opp_ppg: awayStats.oppPpg,
    home_fgpct: homeStats.fgPct, away_fgpct: awayStats.fgPct,
    home_threepct: homeStats.threePct, away_threepct: awayStats.threePct,
    home_ftpct: homeStats.ftPct, away_ftpct: awayStats.ftPct,
    home_assists: homeStats.assists, away_assists: awayStats.assists,
    home_turnovers: homeStats.turnovers, away_turnovers: awayStats.turnovers,
    home_tempo: homeStats.tempo, away_tempo: awayStats.tempo,
    home_orb_pct: homeStats.orbPct, away_orb_pct: awayStats.orbPct,
    home_fta_rate: homeStats.ftaRate, away_fta_rate: awayStats.ftaRate,
    home_ato_ratio: homeStats.atoRatio, away_ato_ratio: awayStats.atoRatio,
    home_opp_fgpct: homeStats.oppFGpct, away_opp_fgpct: awayStats.oppFGpct,
    home_opp_threepct: homeStats.oppThreePct, away_opp_threepct: awayStats.oppThreePct,
    home_steals: homeStats.steals, away_steals: awayStats.steals,
    home_blocks: homeStats.blocks, away_blocks: awayStats.blocks,
    home_wins: homeStats.wins, away_wins: awayStats.wins,
    home_losses: homeStats.losses, away_losses: awayStats.losses,
    home_form: homeStats.formScore, away_form: awayStats.formScore,
    home_sos: homeSOSFactor, away_sos: awaySOSFactor,
    home_rank: game.homeRank, away_rank: game.awayRank,
    home_conference: homeStats.conferenceName, away_conference: awayStats.conferenceName,
    ...(market_spread_home !== null && { market_spread_home }),
    ...(market_ou_total !== null && { market_ou_total }),
  };
}

export async function ncaaFillFinalScores(pendingRows) {
  if (!pendingRows.length) return 0;
  let filled = 0;
  const byDate = {};
  for (const row of pendingRows) {
    if (!byDate[row.game_date]) byDate[row.game_date] = [];
    byDate[row.game_date].push(row);
  }
  for (const [dateStr, rows] of Object.entries(byDate)) {
    try {
      const games = await fetchNCAAGamesForDate(dateStr);
      for (const g of games) {
        if (g.status !== "Final" || g.homeScore === null || g.awayScore === null) continue;
        const matchedRow = rows.find(row =>
          (row.game_id && row.game_id === g.gameId) ||
          (row.home_team_id && row.home_team_id === g.homeTeamId && row.away_team_id === g.awayTeamId)
        );
        if (!matchedRow) continue;
        const homeScore = g.homeScore, awayScore = g.awayScore;
        const modelPickedHome = (matchedRow.win_pct_home ?? 0.5) >= 0.5;
        const homeWon = homeScore > awayScore;
        const ml_correct = modelPickedHome ? homeWon : !homeWon;
        const actualMargin = homeScore - awayScore;
        const mktSpread = matchedRow.market_spread_home ?? null;
        let rl_correct = null;
        if (mktSpread !== null) {
          if (actualMargin > mktSpread) rl_correct = true;
          else if (actualMargin < mktSpread) rl_correct = false;
          else rl_correct = null;
        } else {
          const projSpread = matchedRow.spread_home || 0;
          const modelPickedHomeBySpread = projSpread > 0;
          if (actualMargin > 0 && modelPickedHomeBySpread) rl_correct = true;
          else if (actualMargin < 0 && !modelPickedHomeBySpread) rl_correct = true;
          else if (actualMargin === 0) rl_correct = null;
          else rl_correct = false;
        }
        const total = homeScore + awayScore;
        const ouLine = matchedRow.market_ou_total ?? matchedRow.ou_total ?? null;
        const predTotal = (matchedRow.pred_home_score ?? 0) + (matchedRow.pred_away_score ?? 0);
        let ou_correct = null;
        if (ouLine !== null && total !== ouLine) {
          const actualOver = total > ouLine;
          const modelPredictedOver = predTotal > ouLine;
          ou_correct = (actualOver === modelPredictedOver) ? "OVER" : "UNDER";
        } else if (ouLine !== null && total === ouLine) {
          ou_correct = "PUSH";
        }
        await supabaseQuery(`/ncaa_predictions?id=eq.${matchedRow.id}`, "PATCH", {
          actual_home_score: homeScore, actual_away_score: awayScore,
          result_entered: true, ml_correct, rl_correct, ou_correct,
        });
        filled++;
      }
    } catch (e) { console.warn("ncaaFillFinalScores error", dateStr, e); }
  }
  return filled;
}

export async function ncaaRegradeAllResults(onProgress) {
  onProgress?.("⏳ Loading all graded NCAA records…");
  const allGraded = await supabaseQuery(
    `/ncaa_predictions?result_entered=eq.true&select=id,win_pct_home,spread_home,market_spread_home,market_ou_total,actual_home_score,actual_away_score,ou_total,pred_home_score,pred_away_score,home_team_id,away_team_id,home_adj_em,away_adj_em&limit=5000`
  );
  if (!allGraded?.length) { onProgress?.("No graded records found"); return 0; }
  onProgress?.(`⏳ Regrading ${allGraded.length} records…`);
  let fixed = 0;
  for (const row of allGraded) {
    const homeScore = row.actual_home_score, awayScore = row.actual_away_score;
    if (homeScore === null || awayScore === null) continue;
    const winPctHome = row.win_pct_home ?? 0.5;
    const modelPickedHome = winPctHome >= 0.5;
    const homeWon = homeScore > awayScore;
    const ml_correct = modelPickedHome ? homeWon : !homeWon;
    const actualMargin = homeScore - awayScore;
    const mktSpread = row.market_spread_home ?? null;
    let rl_correct = null;
    if (mktSpread !== null) {
      if (actualMargin > mktSpread) rl_correct = true;
      else if (actualMargin < mktSpread) rl_correct = false;
      else rl_correct = null;
    } else {
      const projSpread = row.spread_home || 0;
      const modelPickedHomeBySpread = projSpread > 0;
      if (actualMargin === 0) rl_correct = null;
      else if (actualMargin > 0 && modelPickedHomeBySpread) rl_correct = true;
      else if (actualMargin < 0 && !modelPickedHomeBySpread) rl_correct = true;
      else rl_correct = false;
    }
    const total = homeScore + awayScore;
    const ouLine = row.market_ou_total ?? row.ou_total ?? null;
    const predTotal = (row.pred_home_score ?? 0) + (row.pred_away_score ?? 0);
    let ou_correct = null;
    if (ouLine !== null && total !== ouLine) {
      const actualOver = total > ouLine;
      const modelPredictedOver = predTotal > ouLine;
      ou_correct = (actualOver === modelPredictedOver) ? "OVER" : "UNDER";
    } else if (ouLine !== null && total === ouLine) {
      ou_correct = "PUSH";
    }
    let confidence = "MEDIUM";
    if (row.home_adj_em != null && row.away_adj_em != null) {
      const emGap = Math.abs(row.home_adj_em - row.away_adj_em);
      const winPctStrength = Math.abs(winPctHome - 0.5) * 2;
      const confScore = Math.round((Math.min(emGap, 10) / 10) * 40 + winPctStrength * 35 + 20 + 5);
      confidence = confScore >= 62 ? "HIGH" : confScore >= 35 ? "MEDIUM" : "LOW";
    }
    await supabaseQuery(`/ncaa_predictions?id=eq.${row.id}`, "PATCH", { ml_correct, rl_correct, ou_correct, confidence });
    fixed++;
    if (fixed % 100 === 0) onProgress?.(`⏳ Regraded ${fixed}/${allGraded.length}…`);
  }
  onProgress?.(`✅ Regraded ${fixed} NCAA records`);
  return fixed;
}

export async function ncaaAutoSync(onProgress) {
  onProgress?.("🏀 Syncing NCAA…");
  const today = new Date().toISOString().split("T")[0];
  const existing = await supabaseQuery(
    `/ncaa_predictions?select=id,game_date,home_team_id,away_team_id,result_entered,game_id&order=game_date.asc&limit=10000`
  );
  const savedKeys = new Set((existing || []).map(r => r.game_id || `${r.game_date}|${r.home_team_id}|${r.away_team_id}`));
  const pendingResults = (existing || []).filter(r => !r.result_entered);
  if (pendingResults.length) {
    const filled = await ncaaFillFinalScores(pendingResults);
    if (filled) onProgress?.(`🏀 ${filled} NCAA result(s) recorded`);
  }
  const allDates = [];
  const cur = new Date(_ncaaSeasonStart);
  const todayDate = new Date(today);
  while (cur <= todayDate) { allDates.push(cur.toISOString().split("T")[0]); cur.setDate(cur.getDate() + 1); }
  const todayOdds = await fetchOdds("basketball_ncaab");
  const todayOddsGames = todayOdds?.games || [];
  let newPred = 0, datesChecked = 0;
  for (const dateStr of allDates) {
    const games = await fetchNCAAGamesForDate(dateStr);
    datesChecked++;
    if (datesChecked % 14 === 0) onProgress?.(`🏀 Scanning ${dateStr} (${datesChecked}/${allDates.length})… ${newPred} new`);
    if (!games.length) { await _sleep(80); continue; }
    const unsaved = games.filter(g => !savedKeys.has(g.gameId || `${dateStr}|${g.homeTeamId}|${g.awayTeamId}`));
    if (!unsaved.length) { await _sleep(80); continue; }
    const isToday = dateStr === today;
    const rows = (await Promise.all(unsaved.map(g => {
      const gameOdds = isToday ? (todayOddsGames.find(o => matchNCAAOddsToGame(o, g)) || null) : null;
      return ncaaBuildPredictionRow(g, dateStr, gameOdds);
    }))).filter(Boolean);
    if (rows.length) {
      await supabaseQuery("/ncaa_predictions", "POST", rows);
      newPred += rows.length;
      const ns = await supabaseQuery(
        `/ncaa_predictions?game_date=eq.${dateStr}&result_entered=eq.false&select=id,game_id,home_team_id,away_team_id,ou_total,market_ou_total,market_spread_home,result_entered,game_date,win_pct_home,spread_home,pred_home_score,pred_away_score`
      );
      if (ns?.length) await ncaaFillFinalScores(ns);
      rows.forEach(r => savedKeys.add(r.game_id || `${dateStr}|${r.home_team_id}|${r.away_team_id}`));
    }
    await _sleep(250);
  }
  onProgress?.(newPred ? `🏀 NCAA sync complete — ${newPred} new predictions` : "🏀 NCAA up to date");
}

export async function ncaaFullBackfill(onProgress, signal) {
  onProgress?.("🏀 Starting full NCAA season backfill…");
  const today = new Date().toISOString().split("T")[0];
  const existing = await supabaseQuery(
    `/ncaa_predictions?select=id,game_date,home_team_id,away_team_id,result_entered,game_id&order=game_date.asc&limit=10000`
  );
  const savedKeys = new Set((existing || []).map(r => r.game_id || `${r.game_date}|${r.home_team_id}|${r.away_team_id}`));
  const backfillTodayOdds = (await fetchOdds("basketball_ncaab"))?.games || [];
  const pendingResults = (existing || []).filter(r => !r.result_entered);
  if (pendingResults.length) {
    onProgress?.(`🏀 Grading ${pendingResults.length} pending result(s)…`);
    const filled = await ncaaFillFinalScores(pendingResults);
    if (filled) onProgress?.(`🏀 ${filled} result(s) recorded`);
  }
  const allDates = [];
  const cur = new Date(_ncaaSeasonStart);
  while (cur.toISOString().split("T")[0] <= today) { allDates.push(cur.toISOString().split("T")[0]); cur.setDate(cur.getDate() + 1); }
  let newPred = 0, skipped = 0, errors = 0;
  for (let i = 0; i < allDates.length; i++) {
    if (signal?.aborted) { onProgress?.("🏀 Backfill cancelled"); return; }
    const dateStr = allDates[i];
    onProgress?.(`🏀 [${i + 1}/${allDates.length}] ${dateStr} — ${newPred} saved so far`);
    let games;
    try { games = await fetchNCAAGamesForDate(dateStr); } catch (e) { errors++; await _sleep(1000); continue; }
    if (!games.length) { await _sleep(120); continue; }
    const unsaved = games.filter(g => !savedKeys.has(g.gameId || `${dateStr}|${g.homeTeamId}|${g.awayTeamId}`));
    skipped += games.length - unsaved.length;
    if (!unsaved.length) { await _sleep(120); continue; }
    let rows;
    try {
      rows = (await Promise.all(unsaved.map(g => {
        const gameOdds = (dateStr === today && backfillTodayOdds) ? (backfillTodayOdds.find(o => matchNCAAOddsToGame(o, g)) || null) : null;
        return ncaaBuildPredictionRow(g, dateStr, gameOdds);
      }))).filter(Boolean);
    } catch (e) { errors++; await _sleep(500); continue; }
    if (rows.length) {
      await supabaseQuery("/ncaa_predictions", "POST", rows);
      newPred += rows.length;
      const ns = await supabaseQuery(
        `/ncaa_predictions?game_date=eq.${dateStr}&result_entered=eq.false&select=id,game_id,home_team_id,away_team_id,ou_total,market_ou_total,market_spread_home,result_entered,game_date,win_pct_home,spread_home,pred_home_score,pred_away_score`
      );
      if (ns?.length) await ncaaFillFinalScores(ns);
      rows.forEach(r => savedKeys.add(r.game_id || `${dateStr}|${r.home_team_id}|${r.away_team_id}`));
    }
    await _sleep(400);
  }
  onProgress?.(`✅ NCAA backfill complete — ${newPred} new, ${skipped} already saved, ${errors} errors`);
}
