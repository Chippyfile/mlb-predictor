// src/sports/mlb/mlbSync.js
// Lines 808–951 of App.jsx (extracted)
import { supabaseQuery } from "../../utils/supabase.js";
import { getMLBGameType, MLB_SEASON_START } from "../../utils/sharedUtils.js";
import {
  MLB_TEAMS,
  mlbTeamById,
  resolveStatTeamId,
  normAbbr,
  mlbPredictGame,
  fetchTeamHitting,
  fetchTeamPitching,
  fetchStarterStats,
  fetchRecentForm,
  fetchStatcast,
  fetchLineup,
  fetchBullpenFatigue,
  fetchParkWeather,
  fetchMLBScheduleForDate,
  extractUmpire,
  mlbFetch,
} from "./mlb.js";

async function mlbBuildPredictionRow(game, dateStr) {
  const homeStatId = resolveStatTeamId(game.homeTeamId, game.homeAbbr);
  const awayStatId = resolveStatTeamId(game.awayTeamId, game.awayAbbr);
  if (!homeStatId || !awayStatId) return null;

  const [
    homeHit, awayHit, homePitch, awayPitch,
    homeStarter, awayStarter,
    homeForm, awayForm,
    homeStatcast, awayStatcast,
    homeLineup, awayLineup,
  ] = await Promise.all([
    fetchTeamHitting(homeStatId), fetchTeamHitting(awayStatId),
    fetchTeamPitching(homeStatId), fetchTeamPitching(awayStatId),
    fetchStarterStats(game.homeStarterId), fetchStarterStats(game.awayStarterId),
    fetchRecentForm(homeStatId), fetchRecentForm(awayStatId),
    fetchStatcast(homeStatId), fetchStatcast(awayStatId),
    fetchLineup(game.gamePk, homeStatId, true), fetchLineup(game.gamePk, awayStatId, false),
  ]);

  if (homeStarter) homeStarter.pitchHand = game.homeStarterHand;
  if (awayStarter) awayStarter.pitchHand = game.awayStarterHand;

  const [homeBullpen, awayBullpen, parkWeather] = await Promise.all([
    fetchBullpenFatigue(game.homeTeamId),
    fetchBullpenFatigue(game.awayTeamId),
    fetchParkWeather(game.homeTeamId).catch(() => null),
  ]);

  const pred = mlbPredictGame({
    homeTeamId: game.homeTeamId, awayTeamId: game.awayTeamId,
    homeHit, awayHit, homePitch, awayPitch,
    homeStarterStats: homeStarter, awayStarterStats: awayStarter,
    homeForm, awayForm,
    homeGamesPlayed: homeForm?.gamesPlayed || 0,
    awayGamesPlayed: awayForm?.gamesPlayed || 0,
    bullpenData: { [game.homeTeamId]: homeBullpen, [game.awayTeamId]: awayBullpen },
    homeLineup, awayLineup,
    umpire: game.umpire,
    homeStatcast, awayStatcast,
    parkWeather,
  });
  if (!pred) return null;

  const home = mlbTeamById(game.homeTeamId), away = mlbTeamById(game.awayTeamId);
  return {
    game_date: dateStr,
    home_team: game.homeAbbr || (home?.abbr || String(game.homeTeamId)).replace(/\d+$/, ""),
    away_team: game.awayAbbr || (away?.abbr || String(game.awayTeamId)).replace(/\d+$/, ""),
    game_pk: game.gamePk,
    game_type: getMLBGameType(dateStr),
    model_ml_home: pred.modelML_home,
    model_ml_away: pred.modelML_away,
    run_line_home: pred.runLineHome,
    run_line_away: -pred.runLineHome,
    ou_total: pred.ouTotal,
    win_pct_home: parseFloat(pred.homeWinPct.toFixed(4)),
    confidence: pred.confidence,
    pred_home_runs: parseFloat(pred.homeRuns.toFixed(2)),
    pred_away_runs: parseFloat(pred.awayRuns.toFixed(2)),
  };
}

export async function mlbFillFinalScores(pendingRows) {
  if (!pendingRows.length) return 0;
  let filled = 0;
  const byDate = {};
  for (const row of pendingRows) {
    if (!byDate[row.game_date]) byDate[row.game_date] = [];
    byDate[row.game_date].push(row);
  }
  const teamIdToAbbr = {};
  MLB_TEAMS.forEach(t => { teamIdToAbbr[t.id] = t.abbr; });

  for (const [dateStr, rows] of Object.entries(byDate)) {
    try {
      const data = await mlbFetch("schedule", { sportId: 1, date: dateStr, hydrate: "probablePitcher,teams,venue,linescore" });
      if (!data) continue;
      for (const dt of (data?.dates || [])) {
        for (const g of (dt.games || [])) {
          const state = g.status?.abstractGameState || "";
          const detail = g.status?.detailedState || "";
          const coded = g.status?.codedGameState || "";
          if (!(state === "Final" || detail === "Game Over" || detail.startsWith("Final") || coded === "F" || coded === "O")) continue;
          const homeScore = g.teams?.home?.score ?? null, awayScore = g.teams?.away?.score ?? null;
          if (homeScore === null || awayScore === null) continue;
          const rawHomeId = g.teams?.home?.team?.id, rawAwayId = g.teams?.away?.team?.id;
          const homeId = resolveStatTeamId(rawHomeId, "") || rawHomeId;
          const awayId = resolveStatTeamId(rawAwayId, "") || rawAwayId;
          const hAbbr = normAbbr(teamIdToAbbr[homeId] || g.teams?.home?.team?.abbreviation || "");
          const aAbbr = normAbbr(teamIdToAbbr[awayId] || g.teams?.away?.team?.abbreviation || "");
          if (!hAbbr || !aAbbr) continue;
          const matchedRow = rows.find(row =>
            (row.game_pk && row.game_pk === g.gamePk) ||
            (normAbbr(row.home_team) === hAbbr && normAbbr(row.away_team) === aAbbr)
          );
          if (!matchedRow) continue;
          const modelPickedHome = (matchedRow.win_pct_home ?? 0.5) >= 0.5;
          const homeWon = homeScore > awayScore;
          const ml_correct = modelPickedHome ? homeWon : !homeWon;
          const spread = homeScore - awayScore;
          const rl_correct = modelPickedHome
            ? (spread > 1.5 ? true : spread < -1.5 ? false : null)
            : (spread < -1.5 ? true : spread > 1.5 ? false : null);
          const total = homeScore + awayScore;
          const ou_correct = matchedRow.ou_total
            ? (total > matchedRow.ou_total ? "OVER" : total < matchedRow.ou_total ? "UNDER" : "PUSH")
            : null;
          await supabaseQuery(`/mlb_predictions?id=eq.${matchedRow.id}`, "PATCH", {
            actual_home_runs: homeScore, actual_away_runs: awayScore,
            result_entered: true, ml_correct, rl_correct, ou_correct,
            game_pk: g.gamePk, home_team: hAbbr, away_team: aAbbr,
          });
          filled++;
        }
      }
    } catch (e) { console.warn("mlbFillFinalScores error", dateStr, e); }
  }
  return filled;
}

export async function mlbRegradeAllResults(onProgress) {
  onProgress?.("⏳ Loading all graded MLB records…");
  const allGraded = await supabaseQuery(
    `/mlb_predictions?result_entered=eq.true&select=id,win_pct_home,pred_home_runs,pred_away_runs,actual_home_runs,actual_away_runs,ou_total&limit=2000`
  );
  if (!allGraded?.length) { onProgress?.("No graded records found"); return 0; }
  let fixed = 0;
  for (const row of allGraded) {
    const homeScore = row.actual_home_runs, awayScore = row.actual_away_runs;
    if (homeScore === null || awayScore === null) continue;
    let winPctHome = row.win_pct_home ?? 0.5;
    if (row.pred_home_runs && row.pred_away_runs) {
      const hr = parseFloat(row.pred_home_runs), ar = parseFloat(row.pred_away_runs);
      if (hr > 0 && ar > 0) {
        const hrE = Math.pow(hr, 1.83), arE = Math.pow(ar, 1.83);
        winPctHome = Math.min(0.88, Math.max(0.12, hrE / (hrE + arE) + 0.038));
      }
    }
    const modelPickedHome = winPctHome >= 0.5, homeWon = homeScore > awayScore;
    const ml_correct = modelPickedHome ? homeWon : !homeWon;
    const spread = homeScore - awayScore;
    const rl_correct = modelPickedHome
      ? (spread > 1.5 ? true : spread < -1.5 ? false : null)
      : (spread < -1.5 ? true : spread > 1.5 ? false : null);
    const total = homeScore + awayScore;
    let ouTotal = row.ou_total;
    if (row.pred_home_runs && row.pred_away_runs) {
      ouTotal = parseFloat((parseFloat(row.pred_home_runs) + parseFloat(row.pred_away_runs)).toFixed(1));
    }
    const ou_correct = ouTotal ? (total > ouTotal ? "OVER" : total < ouTotal ? "UNDER" : "PUSH") : null;
    await supabaseQuery(`/mlb_predictions?id=eq.${row.id}`, "PATCH", {
      ml_correct, rl_correct, ou_correct,
      win_pct_home: parseFloat(winPctHome.toFixed(4)),
      ou_total: ouTotal,
    });
    fixed++;
  }
  onProgress?.(`✅ Regraded ${fixed} MLB result(s)`);
  return fixed;
}

export async function mlbRefreshPredictions(rows, onProgress) {
  if (!rows?.length) return 0;
  let updated = 0;
  const byDate = {};
  for (const row of rows) {
    if (!byDate[row.game_date]) byDate[row.game_date] = [];
    byDate[row.game_date].push(row);
  }
  for (const [dateStr, dateRows] of Object.entries(byDate)) {
    onProgress?.(`🔄 Refreshing ${dateStr}…`);
    const schedData = await mlbFetch("schedule", { sportId: 1, date: dateStr, hydrate: "probablePitcher,teams,officials" });
    const schedGames = [];
    for (const d of (schedData?.dates || [])) for (const g of (d.games || [])) schedGames.push(g);
    for (const row of dateRows) {
      try {
        const schedGame = schedGames.find(g =>
          (row.game_pk && g.gamePk === row.game_pk) ||
          (normAbbr(g.teams?.home?.team?.abbreviation) === normAbbr(row.home_team) &&
           normAbbr(g.teams?.away?.team?.abbreviation) === normAbbr(row.away_team))
        );
        const homeTeamId = schedGame?.teams?.home?.team?.id || MLB_TEAMS.find(t => t.abbr === row.home_team)?.id;
        const awayTeamId = schedGame?.teams?.away?.team?.id || MLB_TEAMS.find(t => t.abbr === row.away_team)?.id;
        if (!homeTeamId || !awayTeamId) continue;
        const homeStatId = resolveStatTeamId(homeTeamId, row.home_team);
        const awayStatId = resolveStatTeamId(awayTeamId, row.away_team);
        const umpire = extractUmpire(schedGame);
        const [homeHit, awayHit, homePitch, awayPitch, homeStarter, awayStarter, homeForm, awayForm] = await Promise.all([
          fetchTeamHitting(homeStatId), fetchTeamHitting(awayStatId),
          fetchTeamPitching(homeStatId), fetchTeamPitching(awayStatId),
          fetchStarterStats(schedGame?.teams?.home?.probablePitcher?.id),
          fetchStarterStats(schedGame?.teams?.away?.probablePitcher?.id),
          fetchRecentForm(homeStatId), fetchRecentForm(awayStatId),
        ]);
        if (homeStarter) homeStarter.pitchHand = schedGame?.teams?.home?.probablePitcher?.pitchHand?.code;
        if (awayStarter) awayStarter.pitchHand = schedGame?.teams?.away?.probablePitcher?.pitchHand?.code;
        const pred = mlbPredictGame({
          homeTeamId, awayTeamId, homeHit, awayHit, homePitch, awayPitch,
          homeStarterStats: homeStarter, awayStarterStats: awayStarter,
          homeForm, awayForm,
          homeGamesPlayed: homeForm?.gamesPlayed || 0,
          awayGamesPlayed: awayForm?.gamesPlayed || 0,
          umpire,
        });
        if (!pred) continue;
        await supabaseQuery(`/mlb_predictions?id=eq.${row.id}`, "PATCH", {
          model_ml_home: pred.modelML_home, model_ml_away: pred.modelML_away,
          ou_total: pred.ouTotal,
          win_pct_home: parseFloat(pred.homeWinPct.toFixed(4)),
          confidence: pred.confidence,
          pred_home_runs: parseFloat(pred.homeRuns.toFixed(2)),
          pred_away_runs: parseFloat(pred.awayRuns.toFixed(2)),
        });
        updated++;
      } catch (e) { console.warn("mlbRefreshPredictions error:", row.id, e); }
    }
  }
  onProgress?.(`✅ Refreshed ${updated} MLB prediction(s)`);
  return updated;
}

export async function mlbAutoSync(onProgress) {
  onProgress?.("⚾ Syncing MLB…");
  try {
    const missing = await supabaseQuery("/mlb_predictions?game_type=is.null&select=id,game_date&limit=500");
    if (missing?.length) {
      for (const row of missing) {
        await supabaseQuery(`/mlb_predictions?id=eq.${row.id}`, "PATCH", { game_type: getMLBGameType(row.game_date) });
      }
    }
  } catch (e) { console.warn("MLB game_type migration:", e); }

  const today = new Date().toISOString().split("T")[0];
  const allDates = [];
  const cur = new Date(MLB_SEASON_START);
  while (cur.toISOString().split("T")[0] <= today) {
    allDates.push(cur.toISOString().split("T")[0]);
    cur.setDate(cur.getDate() + 1);
  }

  const existing = await supabaseQuery(
    `/mlb_predictions?select=id,game_date,home_team,away_team,result_entered,ou_total,game_pk,model_ml_home&order=game_date.asc&limit=5000`
  );
  const savedKeys = new Set((existing || []).map(r => `${r.game_date}|${normAbbr(r.away_team)}@${normAbbr(r.home_team)}`));
  const pendingResults = (existing || []).filter(r => !r.result_entered);
  if (pendingResults.length) {
    const filled = await mlbFillFinalScores(pendingResults);
    if (filled) onProgress?.(`⚾ ${filled} MLB result(s) recorded`);
  }

  let newPred = 0;
  for (const dateStr of allDates) {
    const schedule = await fetchMLBScheduleForDate(dateStr);
    if (!schedule.length) continue;
    const unsaved = schedule.filter(g => {
      const ha = normAbbr(g.homeAbbr || mlbTeamById(g.homeTeamId)?.abbr);
      const aa = normAbbr(g.awayAbbr || mlbTeamById(g.awayTeamId)?.abbr);
      return !savedKeys.has(`${dateStr}|${aa}@${ha}`);
    });
    if (!unsaved.length) continue;
    const rows = [];
    for (const g of unsaved) {
      const row = await mlbBuildPredictionRow(g, dateStr).catch(() => null);
      if (row) rows.push(row);
    }
    if (rows.length) {
      await supabaseQuery("/mlb_predictions", "POST", rows);
      newPred += rows.length;
      const ns = await supabaseQuery(
        `/mlb_predictions?game_date=eq.${dateStr}&result_entered=eq.false&select=id,game_pk,home_team,away_team,ou_total,result_entered,game_date`
      );
      if (ns?.length) await mlbFillFinalScores(ns);
    }
  }
  onProgress?.(newPred ? `⚾ MLB sync complete — ${newPred} new` : "⚾ MLB up to date");
}
