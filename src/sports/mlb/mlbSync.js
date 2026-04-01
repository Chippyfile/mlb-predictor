// src/sports/mlb/mlbSync.js
// Step 5: Persist raw features + Step 6: Closing line tracking
import { supabaseQuery } from "../../utils/supabase.js";
import { getMLBGameType, MLB_SEASON_START, fetchOdds } from "../../utils/sharedUtils.js";
import { calcCLV } from "../../utils/betUtils.js";
import { mlPredict } from "../../utils/mlApi.js";
import {
  MLB_TEAMS,
  mlbTeamById,
  resolveStatTeamId,
  normAbbr,
  mlbPredictGame,
  matchMLBOddsToGame,
  fetchTeamHitting,
  fetchTeamPitching,
  fetchStarterStats,
  fetchRecentForm,
  fetchStatcast,
  fetchLineup,
  fetchBullpenFatigue,
  fetchParkWeather,
  fetchMLBScheduleForDate,
  pythagenpat,
  PARK_FACTORS,
  extractUmpire,
  mlbFetch,
} from "./mlb.js";

// ─────────────────────────────────────────────────────────────
// HELPER: Extract raw features from prediction + fetched data
// ─────────────────────────────────────────────────────────────
function extractRawFeatures(pred, { homeBullpen, awayBullpen, parkWeather, game, homeTeamId, homePitch, awayPitch, homeStarterStats, awayStarterStats }) {
  // ── AUDIT FIX F4: Park-rotated wind direction (matches mlb.js heuristic) ──
  // The heuristic engine rotates wind by park's CF heading before checking out/in.
  // Without this, non-south-facing parks (Wrigley, Fenway, Oracle, etc.) get wrong flags.
  let wind_out_flag = null;
  if (parkWeather && parkWeather.windDir != null) {
    const parkData = PARK_FACTORS[homeTeamId] || {};
    if (parkData.dome) {
      wind_out_flag = 0; // dome parks: wind irrelevant
    } else {
      const parkWindBase = parkData.windBaseDir || 180;
      const adjustedDir = ((parkWeather.windDir - parkWindBase + 360) % 360);
      wind_out_flag = (adjustedDir >= 135 && adjustedDir <= 225) ? 1 : 0;
    }
  }

  return {
    // M-6 FIX: Fallback was 0.314 but engine uses LG_WOBA (currently 0.315 for 2025+).
    home_woba: parseFloat((pred.homeWOBA || 0.315).toFixed(3)),
    away_woba: parseFloat((pred.awayWOBA || 0.315).toFixed(3)),
    home_sp_fip: parseFloat((pred.hFIP || 4.25).toFixed(2)),
    away_sp_fip: parseFloat((pred.aFIP || 4.25).toFixed(2)),
    home_bullpen_era: parseFloat((homeBullpen?.era || 4.10).toFixed(2)),
    away_bullpen_era: parseFloat((awayBullpen?.era || 4.10).toFixed(2)),
    park_factor: pred.parkFactor || 1.00,
    temp_f: parkWeather?.tempF ?? null,
    wind_mph: parkWeather?.windMph ?? null,
    wind_out_flag,
    home_starter_name: game?.homeStarterName || null,
    away_starter_name: game?.awayStarterName || null,
    umpire_name: game?.umpire?.name || null,
    // F-05: SP average innings pitched (for bullpen exposure ML feature)
    home_sp_ip: pred.homeSpAvgIP ?? null,
    away_sp_ip: pred.awaySpAvgIP ?? null,
    // ── AUDIT FIX F10: K/9 and BB/9 (were never sent — k_bb_diff was always 0 in production) ──
    home_k9: parseFloat((homeStarterStats?.k9 ?? homePitch?.k9 ?? 8.5).toFixed(2)),
    away_k9: parseFloat((awayStarterStats?.k9 ?? awayPitch?.k9 ?? 8.5).toFixed(2)),
    home_bb9: parseFloat((homeStarterStats?.bb9 ?? homePitch?.bb9 ?? 3.2).toFixed(2)),
    away_bb9: parseFloat((awayStarterStats?.bb9 ?? awayPitch?.bb9 ?? 3.2).toFixed(2)),
    // Enhancement 1: Platoon splits (wOBA delta from L/R matchup advantage)
    home_platoon_delta: pred.homePlatoonDelta != null
      ? parseFloat(pred.homePlatoonDelta.toFixed(4)) : null,
    away_platoon_delta: pred.awayPlatoonDelta != null
      ? parseFloat(pred.awayPlatoonDelta.toFixed(4)) : null,
    // Enhancement 2: Lineup confirmation flags (real lineup vs defaults)
    home_lineup_confirmed: pred.homeLineupConfirmed ? 1 : 0,
    away_lineup_confirmed: pred.awayLineupConfirmed ? 1 : 0,
    // AUDIT v4 Finding 10: Team aggregate ERA as proxy for team FIP
    // Used by backend for sp_relative_fip_diff = (starter - team) differential
    home_team_era: parseFloat((homePitch?.era ?? 4.25).toFixed(2)),
    away_team_era: parseFloat((awayPitch?.era ?? 4.25).toFixed(2)),
  };
}

// ─────────────────────────────────────────────────────────────
// HELPER: Extract market odds snapshot (opening or current)
// ─────────────────────────────────────────────────────────────
function extractOpeningOdds(gameOdds) {
  if (!gameOdds) return {};
  // MLB standard run line is ALWAYS ±1.5. The Odds API returns live/alternate
  // spreads (±2.5, ±5.5) for in-progress games — reject those.
  const spread = gameOdds.marketSpreadHome;
  const isStandardRL = spread != null && Math.abs(Math.abs(spread) - 1.5) < 0.01;
  return {
    ...(gameOdds.homeML != null && { opening_home_ml: gameOdds.homeML }),
    ...(gameOdds.awayML != null && { opening_away_ml: gameOdds.awayML }),
    ...(isStandardRL && { market_spread_home: spread }),
    ...(gameOdds.marketTotal != null && { market_ou_total: gameOdds.marketTotal }),
  };
}

function extractClosingOdds(gameOdds) {
  if (!gameOdds) return {};
  const spread = gameOdds.marketSpreadHome;
  const isStandardRL = spread != null && Math.abs(Math.abs(spread) - 1.5) < 0.01;
  return {
    ...(gameOdds.homeML != null && { closing_home_ml: gameOdds.homeML }),
    ...(gameOdds.awayML != null && { closing_away_ml: gameOdds.awayML }),
    ...(isStandardRL && { closing_spread_home: spread }),
    ...(gameOdds.marketTotal != null && { closing_ou_total: gameOdds.marketTotal }),
  };
}

// ─────────────────────────────────────────────────────────────
// BUILD PREDICTION ROW (new games)
// Persists raw features + opening market odds
// ─────────────────────────────────────────────────────────────
async function mlbBuildPredictionRow(game, dateStr, oddsData) {
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
  const raw = extractRawFeatures(pred, {
    homeBullpen, awayBullpen, parkWeather,
    homeTeamId: game.homeTeamId,
    homePitch, awayPitch,
    homeStarterStats: homeStarter, awayStarterStats: awayStarter,
    game,
  });

  // Step 6: Capture opening odds at prediction creation time
  const gameOdds = oddsData?.games?.find(o => matchMLBOddsToGame(o, game)) || null;
  const openingFields = extractOpeningOdds(gameOdds);

  const row = {
    // ── Existing fields ──
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
    spread_home: parseFloat((pred.homeRuns - pred.awayRuns).toFixed(2)),
    confidence: pred.confidence,
    pred_home_runs: parseFloat(pred.homeRuns.toFixed(2)),
    pred_away_runs: parseFloat(pred.awayRuns.toFixed(2)),

    // ── Step 5: Raw features ──
    ...raw,

    // ── Step 6: Opening market odds ──
    ...openingFields,
  };

  // ═══ ML Override: CatBoost v5 (29 features, MAE 3.41) ═══
  // Calls /predict/mlb with raw features — backend computes differentials
  try {
    const mlResult = await mlPredict("mlb", {
      pred_home_runs: row.pred_home_runs,
      pred_away_runs: row.pred_away_runs,
      win_pct_home: row.win_pct_home,
      ou_total: row.ou_total,
      model_ml_home: row.model_ml_home,
      home_woba: raw.home_woba,
      away_woba: raw.away_woba,
      // AUDIT v4 FIX: home_fip/away_fip = TEAM aggregate FIP (not starter)
      home_fip: raw.home_team_era ?? 4.25,
      away_fip: raw.away_team_era ?? 4.25,
      home_sp_fip: raw.home_sp_fip,
      away_sp_fip: raw.away_sp_fip,
      home_bullpen_era: raw.home_bullpen_era,
      away_bullpen_era: raw.away_bullpen_era,
      park_factor: raw.park_factor,
      temp_f: raw.temp_f ?? 70,
      wind_mph: raw.wind_mph ?? 5,
      wind_out_flag: raw.wind_out_flag ?? 0,
      home_sp_ip: raw.home_sp_ip ?? 5.5,
      away_sp_ip: raw.away_sp_ip ?? 5.5,
      // AUDIT FIX F10: K/9 and BB/9 — critical for k_bb_diff feature
      home_k9: raw.home_k9 ?? 8.5,
      away_k9: raw.away_k9 ?? 8.5,
      home_bb9: raw.home_bb9 ?? 3.2,
      away_bb9: raw.away_bb9 ?? 3.2,
      home_rest_days: 4,
      away_rest_days: 4,
      // AUDIT v4: team/date/ump for travel, series, rolling stats
      home_team: row.home_team,
      away_team: row.away_team,
      game_date: dateStr,
      ump_name: raw.umpire_name ?? null,
      // Platoon
      home_platoon_delta: raw.home_platoon_delta ?? 0,
      away_platoon_delta: raw.away_platoon_delta ?? 0,
      // Market
      market_spread_home: openingFields.market_spread_home ?? 0,
      market_ou_total: openingFields.market_ou_total ?? 0,
    });
    if (mlResult && mlResult.ml_win_prob_home != null && !mlResult.error) {
      row.win_pct_home = parseFloat(mlResult.ml_win_prob_home.toFixed(4));
      row.ml_win_prob_home = parseFloat(mlResult.ml_win_prob_home.toFixed(4));
      if (mlResult.ml_margin != null) {
        // FIX: save original total BEFORE mutating pred_home_runs
        const origTotal = row.pred_home_runs + row.pred_away_runs;
        row.pred_home_runs = parseFloat((origTotal / 2 + mlResult.ml_margin / 2).toFixed(2));
        row.pred_away_runs = parseFloat((origTotal / 2 - mlResult.ml_margin / 2).toFixed(2));
      }
      console.log(`[MLB ML] ${row.home_team} vs ${row.away_team}: wp=${mlResult.ml_win_prob_home?.toFixed(3)}, margin=${mlResult.ml_margin?.toFixed(1)}`);
    }
  } catch (e) {
    console.warn(`[MLB ML] predict failed for ${row.home_team} vs ${row.away_team}:`, e.message);
  }

  // AUDIT v4 Finding 5: Call O/U model and store predicted total
  try {
    const ouResult = await mlPredict("mlb/ou", {
      home_team: row.home_team, away_team: row.away_team, game_date: dateStr,
      pred_home_runs: row.pred_home_runs, pred_away_runs: row.pred_away_runs,
      home_woba: raw.home_woba, away_woba: raw.away_woba,
      home_sp_fip: raw.home_sp_fip, away_sp_fip: raw.away_sp_fip,
      home_fip: raw.home_team_era ?? 4.25, away_fip: raw.away_team_era ?? 4.25,
      home_bullpen_era: raw.home_bullpen_era, away_bullpen_era: raw.away_bullpen_era,
      park_factor: raw.park_factor, temp_f: raw.temp_f ?? 70,
      wind_mph: raw.wind_mph ?? 5, wind_out_flag: raw.wind_out_flag ?? 0,
      home_k9: raw.home_k9 ?? 8.5, away_k9: raw.away_k9 ?? 8.5,
      home_bb9: raw.home_bb9 ?? 3.2, away_bb9: raw.away_bb9 ?? 3.2,
      home_sp_ip: raw.home_sp_ip ?? 5.5, away_sp_ip: raw.away_sp_ip ?? 5.5,
      market_ou_total: openingFields.market_ou_total ?? 0,
      ump_name: raw.umpire_name ?? null,
    });
    if (ouResult?.pred_total != null && !ouResult.error) {
      row.ml_ou_pred_total = parseFloat(ouResult.pred_total.toFixed(2));
    }
  } catch (e) {
    console.warn(`[MLB O/U] predict failed for ${row.home_team} vs ${row.away_team}:`, e.message);
  }

  return row;
}

// ─────────────────────────────────────────────────────────────
// FILL FINAL SCORES — now captures closing lines (Step 6)
// ─────────────────────────────────────────────────────────────
export async function mlbFillFinalScores(pendingRows, oddsData) {
  if (!pendingRows.length) return 0;
  let filled = 0;
  const byDate = {};
  for (const row of pendingRows) {
    if (!byDate[row.game_date]) byDate[row.game_date] = [];
    byDate[row.game_date].push(row);
  }
  const teamIdToAbbr = {};
  MLB_TEAMS.forEach(t => { teamIdToAbbr[t.id] = t.abbr; });

  // Step 6: Fetch current odds if not passed in (these become closing lines)
  const todayStr = new Date().toISOString().split("T")[0];
  let closingOdds = oddsData || null;
  if (!closingOdds && Object.keys(byDate).some(d => d === todayStr)) {
    try { closingOdds = await fetchOdds("baseball_mlb"); } catch { /* no odds */ }
  }

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
          // FIX: O/U grading now checks if MODEL's prediction matched actual direction
          // AUDIT v4: Prefer ML O/U model total, fall back to heuristic total
          const ouLine = matchedRow.market_ou_total ?? matchedRow.ou_total ?? null;
          const predTotal = matchedRow.ml_ou_pred_total
            ?? ((matchedRow.pred_home_runs ?? 0) + (matchedRow.pred_away_runs ?? 0));
          let ou_correct = null;
          if (ouLine && total !== ouLine && predTotal) {
            const actualOver = total > ouLine;
            const modelOver = predTotal > ouLine;
            ou_correct = actualOver === modelOver ? (actualOver ? "OVER" : "UNDER") : null;
          } else if (ouLine && total === ouLine) {
            ou_correct = "PUSH";
          }

          // Step 6: Capture closing lines for today's finished games
          let closingFields = {};
          if (dateStr === todayStr && closingOdds?.games?.length) {
            const homeN = (mlbTeamById(homeId)?.name || hAbbr).toLowerCase().replace(/\s+/g, "");
            const awayN = (mlbTeamById(awayId)?.name || aAbbr).toLowerCase().replace(/\s+/g, "");
            const closingMatch = closingOdds.games.find(o => {
              const oH = (o.homeTeam || "").toLowerCase().replace(/\s+/g, "");
              const oA = (o.awayTeam || "").toLowerCase().replace(/\s+/g, "");
              return oH.includes(homeN.slice(0, 5)) && oA.includes(awayN.slice(0, 5));
            });
            if (closingMatch) {
              closingFields = extractClosingOdds(closingMatch);
              // ── CLV: Compare opening line (bet time) vs closing line ──
              const betSide = (matchedRow.win_pct_home ?? 0.5) >= 0.5 ? "home" : "away";
              const betML = betSide === "home"
                ? (matchedRow.opening_home_ml ?? matchedRow.market_home_ml ?? null)
                : (matchedRow.opening_away_ml ?? matchedRow.market_away_ml ?? null);
              const closeML = betSide === "home"
                ? closingMatch.homeML
                : closingMatch.awayML;
              if (betML && closeML) {
                const clvResult = calcCLV(betML, closeML);
                if (clvResult) {
                  closingFields.bet_ml = betML;
                  closingFields.clv_pct = clvResult.clvPct;
                }
              }
            }
          }

          await supabaseQuery(`/mlb_predictions?id=eq.${matchedRow.id}`, "PATCH", {
            actual_home_runs: homeScore, actual_away_runs: awayScore,
            result_entered: true, ml_correct, rl_correct, ou_correct,
            game_pk: g.gamePk, home_team: hAbbr, away_team: aAbbr,
            ...closingFields,
          });
          filled++;
        }
      }
    } catch (e) { console.warn("mlbFillFinalScores error", dateStr, e); }
  }
  return filled;
}

// ─────────────────────────────────────────────────────────────
// REGRADE ALL RESULTS (unchanged)
// ─────────────────────────────────────────────────────────────
export async function mlbRegradeAllResults(onProgress) {
  onProgress?.("⏳ Loading all graded MLB records…");
  const allGraded = await supabaseQuery(
    `/mlb_predictions?result_entered=eq.true&select=id,home_team,win_pct_home,pred_home_runs,pred_away_runs,actual_home_runs,actual_away_runs,ou_total,ml_ou_pred_total&limit=2000`
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
        // Use Pythagenpat with per-park HFA (was: fixed 1.83 exponent + flat 0.038)
        const teamObj = MLB_TEAMS.find(t => t.abbr === row.home_team);
        const parkHFA = teamObj ? (PARK_FACTORS[teamObj.id]?.hfa || 0.035) : 0.035;
        winPctHome = pythagenpat(hr, ar, parkHFA);
      }
    }
    const modelPickedHome = winPctHome >= 0.5, homeWon = homeScore > awayScore;
    const ml_correct = modelPickedHome ? homeWon : !homeWon;
    const spread = homeScore - awayScore;
    const rl_correct = modelPickedHome
      ? (spread > 1.5 ? true : spread < -1.5 ? false : null)
      : (spread < -1.5 ? true : spread > 1.5 ? false : null);
    const total = homeScore + awayScore;
    const ouLine = row.market_ou_total ?? row.ou_total ?? null;
    // AUDIT v4: prefer ML O/U total for grading when available
    const predTotal = row.ml_ou_pred_total
      ?? (row.pred_home_runs && row.pred_away_runs
        ? parseFloat(row.pred_home_runs) + parseFloat(row.pred_away_runs)
        : null);
    let ou_correct = null;
    if (ouLine && total !== ouLine && predTotal) {
      const actualOver = total > ouLine;
      const modelOver = predTotal > ouLine;
      ou_correct = actualOver === modelOver ? (actualOver ? "OVER" : "UNDER") : null;
    } else if (ouLine && total === ouLine) {
      ou_correct = "PUSH";
    }
    await supabaseQuery(`/mlb_predictions?id=eq.${row.id}`, "PATCH", {
      ml_correct, rl_correct, ou_correct,
      win_pct_home: parseFloat(winPctHome.toFixed(4)),
      ou_total: predTotal ?? ouLine,
    });
    fixed++;
  }
  onProgress?.(`✅ Regraded ${fixed} MLB result(s)`);
  return fixed;
}

// ─────────────────────────────────────────────────────────────
// REFRESH PREDICTIONS (full data + raw features + latest odds)
// ─────────────────────────────────────────────────────────────
export async function mlbRefreshPredictions(rows, onProgress) {
  if (!rows?.length) return 0;
  let updated = 0;
  const byDate = {};
  for (const row of rows) {
    if (!byDate[row.game_date]) byDate[row.game_date] = [];
    byDate[row.game_date].push(row);
  }

  let oddsData = null;
  try { oddsData = await fetchOdds("baseball_mlb"); } catch { /* no odds */ }

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

        const [
          homeHit, awayHit, homePitch, awayPitch,
          homeStarter, awayStarter,
          homeForm, awayForm,
          homeStatcast, awayStatcast,
          homeLineup, awayLineup,
        ] = await Promise.all([
          fetchTeamHitting(homeStatId), fetchTeamHitting(awayStatId),
          fetchTeamPitching(homeStatId), fetchTeamPitching(awayStatId),
          fetchStarterStats(schedGame?.teams?.home?.probablePitcher?.id),
          fetchStarterStats(schedGame?.teams?.away?.probablePitcher?.id),
          fetchRecentForm(homeStatId), fetchRecentForm(awayStatId),
          fetchStatcast(homeStatId), fetchStatcast(awayStatId),
          fetchLineup(row.game_pk || schedGame?.gamePk, homeStatId, true),
          fetchLineup(row.game_pk || schedGame?.gamePk, awayStatId, false),
        ]);

        if (homeStarter) homeStarter.pitchHand = schedGame?.teams?.home?.probablePitcher?.pitchHand?.code;
        if (awayStarter) awayStarter.pitchHand = schedGame?.teams?.away?.probablePitcher?.pitchHand?.code;

        const [homeBullpen, awayBullpen, parkWeather] = await Promise.all([
          fetchBullpenFatigue(homeTeamId),
          fetchBullpenFatigue(awayTeamId),
          fetchParkWeather(homeTeamId).catch(() => null),
        ]);

        const pred = mlbPredictGame({
          homeTeamId, awayTeamId, homeHit, awayHit, homePitch, awayPitch,
          homeStarterStats: homeStarter, awayStarterStats: awayStarter,
          homeForm, awayForm,
          homeGamesPlayed: homeForm?.gamesPlayed || 0,
          awayGamesPlayed: awayForm?.gamesPlayed || 0,
          bullpenData: { [homeTeamId]: homeBullpen, [awayTeamId]: awayBullpen },
          homeLineup, awayLineup,
          umpire,
          homeStatcast, awayStatcast,
          parkWeather,
        });
        if (!pred) continue;

        const raw = extractRawFeatures(pred, {
          homeBullpen, awayBullpen, parkWeather,
          homeTeamId,
          homePitch, awayPitch,
          homeStarterStats: homeStarter, awayStarterStats: awayStarter,
          game: {
            homeStarterName: schedGame?.teams?.home?.probablePitcher?.fullName,
            awayStarterName: schedGame?.teams?.away?.probablePitcher?.fullName,
            umpire,
          },
        });

        // Update market odds on refresh (latest snapshot)
        const gameForMatch = { homeTeamId, awayTeamId, homeAbbr: row.home_team, awayAbbr: row.away_team };
        const gameOdds = oddsData?.games?.find(o => matchMLBOddsToGame(o, gameForMatch)) || null;
        const marketFields = extractOpeningOdds(gameOdds);

        await supabaseQuery(`/mlb_predictions?id=eq.${row.id}`, "PATCH", {
          model_ml_home: pred.modelML_home,
          model_ml_away: pred.modelML_away,
          ou_total: pred.ouTotal,
          win_pct_home: parseFloat(pred.homeWinPct.toFixed(4)),
    spread_home: parseFloat((pred.homeRuns - pred.awayRuns).toFixed(2)),
          confidence: pred.confidence,
          pred_home_runs: parseFloat(pred.homeRuns.toFixed(2)),
          pred_away_runs: parseFloat(pred.awayRuns.toFixed(2)),
          ...raw,
          ...marketFields,
        });
        updated++;
      } catch (e) { console.warn("mlbRefreshPredictions error:", row.id, e); }
    }
  }
  onProgress?.(`✅ Refreshed ${updated} MLB prediction(s)`);
  return updated;
}

// ─────────────────────────────────────────────────────────────
// AUTO SYNC (fetches odds once, passes through everywhere)
// ─────────────────────────────────────────────────────────────
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

  // Fetch odds once for the entire sync cycle
  let oddsData = null;
  try { oddsData = await fetchOdds("baseball_mlb"); } catch { /* no odds */ }

  if (pendingResults.length) {
    const filled = await mlbFillFinalScores(pendingResults, oddsData);
    if (filled) onProgress?.(`⚾ ${filled} MLB result(s) recorded`);
  }

  let newPred = 0;
  for (const dateStr of allDates) {
    const schedule = await fetchMLBScheduleForDate(dateStr);
    if (!schedule.length) continue;
    const unsaved = schedule.filter(g => {
      const ha = normAbbr(g.homeAbbr || mlbTeamById(g.homeTeamId)?.abbr);
      const aa = normAbbr(g.awayAbbr || mlbTeamById(g.awayTeamId)?.abbr);
      // Only predict games that haven't started — predictions for Final/Live
      // games use post-game stats and produce misleading results
      const isPreGame = g.status !== "Final" && g.status !== "Live";
      return isPreGame && !savedKeys.has(`${dateStr}|${aa}@${ha}`);
    });
    if (!unsaved.length) continue;
    const rows = [];
    for (const g of unsaved) {
      const row = await mlbBuildPredictionRow(g, dateStr, oddsData).catch(() => null);
      if (row) rows.push(row);
    }
    if (rows.length) {
      // Normalize keys across all rows (Supabase batch POST requires identical keys)
      const allKeys = new Set();
      rows.forEach(r => Object.keys(r).forEach(k => allKeys.add(k)));
      const normalizedRows = rows.map(r => {
        const normalized = {};
        for (const k of allKeys) normalized[k] = r[k] !== undefined ? r[k] : null;
        return normalized;
      });
      await supabaseQuery("/mlb_predictions", "POST", normalizedRows);
      newPred += rows.length;
      const ns = await supabaseQuery(
        `/mlb_predictions?game_date=eq.${dateStr}&result_entered=eq.false&select=id,game_pk,home_team,away_team,ou_total,result_entered,game_date`
      );
      if (ns?.length) await mlbFillFinalScores(ns, oddsData);
    }
  }
  onProgress?.(newPred ? `⚾ MLB sync complete — ${newPred} new` : "⚾ MLB up to date");
}
