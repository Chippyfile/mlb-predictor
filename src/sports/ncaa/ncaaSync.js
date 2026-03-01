// src/sports/ncaa/ncaaSync.js
// NCAAB v18 — Phase 1: Injury detection, tournament context, dynamic sigma
import { supabaseQuery } from "../../utils/supabase.js";
import { fetchOdds } from "../../utils/sharedUtils.js";
import {
  fetchNCAATeamStats, fetchNCAAGamesForDate, ncaaPredictGame, matchNCAAOddsToGame,
  detectMissingStarters, getGameContext, calculateDynamicSigma,
  batchProcess, createTTLCache,
} from "./ncaaUtils.js";

// NCAA season starts Nov 1 of the prior calendar year
const _ncaaSeasonStart = (() => {
  const now = new Date();
  const seasonYear = now.getMonth() < 7 ? now.getFullYear() - 1 : now.getFullYear();
  return `${seasonYear}-11-01`;
})();

const _sleep = ms => new Promise(r => setTimeout(r, ms));

// v18: TTL-based stats cache — prevents redundant ESPN API calls
const _teamStatsCache = createTTLCache(4 * 60 * 60 * 1000); // 4-hour TTL
async function _cachedTeamStats(teamId) {
  const cached = _teamStatsCache.get(teamId);
  if (cached) return cached;
  const stats = await fetchNCAATeamStats(teamId);
  if (stats) _teamStatsCache.set(teamId, stats);
  return stats;
}

// R5: Compute rest days from team schedule
// Returns the number of days since the team's last completed game
async function _computeRestDays(teamId, gameDateStr) {
  try {
    const data = await fetch(
      `https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/teams/${teamId}/schedule`
    ).then(r => r.ok ? r.json() : null).catch(() => null);
    if (!data?.events) return 3; // default
    const gameDate = new Date(gameDateStr + "T00:00:00");
    // Find the most recent completed game BEFORE this game date
    let lastGameDate = null;
    for (const ev of data.events) {
      const evDate = new Date(ev.date);
      const completed = ev.competitions?.[0]?.status?.type?.completed;
      if (completed && evDate < gameDate) {
        if (!lastGameDate || evDate > lastGameDate) lastGameDate = evDate;
      }
    }
    if (!lastGameDate) return 7; // no prior games found (season opener)
    const diffMs = gameDate - lastGameDate;
    return Math.max(0, Math.round(diffMs / (1000 * 60 * 60 * 24)));
  } catch { return 3; }
}

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
  // v18: Use TTL-cached stats to avoid redundant API calls
  const [homeStats, awayStats] = await Promise.all([
    _cachedTeamStats(game.homeTeamId),
    _cachedTeamStats(game.awayTeamId),
  ]);
  if (!homeStats || !awayStats) return null;

  let homeSOSFactor = null, awaySOSFactor = null, homeSplits = null, awaySplits = null;
  let homeRestDays = 3, awayRestDays = 3;
  let injuryData = null;

  // v18: Fetch SOS + rest days + injury detection in parallel
  try {
    const [homeRecord, awayRecord, homeRest, awayRest, injuries] = await Promise.all([
      fetchNCAATeamRecord(game.homeTeamId),
      fetchNCAATeamRecord(game.awayTeamId),
      _computeRestDays(game.homeTeamId, dateStr),
      _computeRestDays(game.awayTeamId, dateStr),
      detectMissingStarters(game.gameId, game.homeTeamId, game.awayTeamId),
    ]);
    homeSOSFactor = homeRecord.sos;
    awaySOSFactor = awayRecord.sos;
    homeSplits = homeRecord.splits;
    awaySplits = awayRecord.splits;
    homeRestDays = homeRest;
    awayRestDays = awayRest;
    injuryData = injuries;
  } catch {}

  // v18 P1-CTX: Detect game context (conference tournament, NCAA tournament, etc.)
  const gameContext = getGameContext(dateStr, game.neutralSite);

  // v18 P1-SIG: Calculate dynamic sigma
  const dynamicSigma = calculateDynamicSigma(homeStats, awayStats, dateStr);

  // Override neutral site for NCAA tournament games
  const effectiveNeutral = gameContext.override_neutral || game.neutralSite;

  const pred = ncaaPredictGame({
    homeStats, awayStats,
    neutralSite: effectiveNeutral,
    homeSOSFactor, awaySOSFactor,
    homeSplits, awaySplits,
    sigma: dynamicSigma,
  });
  if (!pred) return null;

  // v18 P1-INJ: Apply injury adjustments to spread and win probability
  let adjSpread = pred.projectedSpread;
  let adjWinPct = pred.homeWinPct;
  if (injuryData && (injuryData.home_injury_penalty > 0 || injuryData.away_injury_penalty > 0)) {
    adjSpread = pred.projectedSpread - injuryData.home_injury_penalty + injuryData.away_injury_penalty;
    adjWinPct = Math.min(0.97, Math.max(0.03,
      1 / (1 + Math.pow(10, -adjSpread / dynamicSigma))
    ));
  }

  // v18 P1-CTX: Apply tournament context importance multiplier to form differential
  if (gameContext.importance_multiplier > 1.0) {
    const formDiff = (homeStats.formScore || 0) - (awayStats.formScore || 0);
    const contextBoost = formDiff * (gameContext.importance_multiplier - 1.0) * 0.5;
    adjSpread += contextBoost;
  }

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
    spread_home: parseFloat(adjSpread.toFixed(1)),
    ou_total: pred.ouTotal,
    win_pct_home: parseFloat(adjWinPct.toFixed(4)),
    confidence: pred.confidence,
    pred_home_score: parseFloat(pred.homeScore.toFixed(1)),
    pred_away_score: parseFloat(pred.awayScore.toFixed(1)),
    home_adj_em: pred.homeAdjEM, away_adj_em: pred.awayAdjEM,
    neutral_site: effectiveNeutral,
    // Raw stats for ML training (unchanged from v17)
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
    // R5: Rest days for ML training
    home_rest_days: homeRestDays, away_rest_days: awayRestDays,
    // ── v18 NEW COLUMNS ──
    // P1-INJ: Injury data for ML training
    home_injury_penalty: injuryData?.home_injury_penalty ?? 0,
    away_injury_penalty: injuryData?.away_injury_penalty ?? 0,
    injury_diff: injuryData?.injury_diff ?? 0,
    home_missing_starters: injuryData?.home_missing_starters ?? 0,
    away_missing_starters: injuryData?.away_missing_starters ?? 0,
    // P1-CTX: Tournament context flags for ML training
    is_conference_tournament: gameContext.is_conference_tournament,
    is_ncaa_tournament: gameContext.is_ncaa_tournament,
    is_bubble_game: gameContext.is_bubble_game,
    is_early_season: gameContext.is_early_season,
    importance_multiplier: gameContext.importance_multiplier,
    // P1-SIG: Dynamic sigma used (for auditing)
    sigma_used: dynamicSigma,
    // Market odds
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
    // v18: Use batchProcess for parallel game processing
    const rows = await batchProcess(unsaved, (g) => {
      const gameOdds = isToday ? (todayOddsGames.find(o => matchNCAAOddsToGame(o, g)) || null) : null;
      return ncaaBuildPredictionRow(g, dateStr, gameOdds);
    }, 5, 100);
    if (rows.length) {
      // Normalize keys across all rows for batch insert
      const allKeys = new Set();
      rows.forEach(r => Object.keys(r).forEach(k => allKeys.add(k)));
      const normalizedRows = rows.map(r => {
        const normalized = {};
        for (const k of allKeys) normalized[k] = r[k] !== undefined ? r[k] : null;
        return normalized;
      });
      await supabaseQuery("/ncaa_predictions", "UPSERT", normalizedRows, "game_id");
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
      // v18: Use batchProcess for parallel game processing
      rows = await batchProcess(unsaved, (g) => {
        const gameOdds = (dateStr === today && backfillTodayOdds) ? (backfillTodayOdds.find(o => matchNCAAOddsToGame(o, g)) || null) : null;
        return ncaaBuildPredictionRow(g, dateStr, gameOdds);
      }, 5, 100);
    } catch (e) { errors++; await _sleep(500); continue; }
    if (rows.length) {
      // Ensure all rows have identical keys (Supabase batch insert requires this)
      const allKeys = new Set();
      rows.forEach(r => Object.keys(r).forEach(k => allKeys.add(k)));
      rows = rows.map(r => {
        const normalized = {};
        for (const k of allKeys) normalized[k] = r[k] !== undefined ? r[k] : null;
        return normalized;
      });
      await supabaseQuery("/ncaa_predictions", "UPSERT", rows, "game_id");
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
