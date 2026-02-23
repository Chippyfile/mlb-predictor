import { useState, useEffect, useCallback, useRef } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, RadarChart, Radar, PolarGrid, PolarAngleAxis, ReferenceLine
} from "recharts";

// ============================================================
// MLB PREDICTOR v6 — HISTORY + PARLAY + SEASON ACCURACY
// New in v6:
//   • History tab  — saves every prediction to Supabase
//   • Season Accuracy banner — ML, ATS, O/U, by confidence tier
//   • Parlay tab   — pick leg count, auto-suggests highest-prob games
//   • Result entry — mark actual outcomes to drive accuracy tracking
// ============================================================

// ── SUPABASE CONFIG ──────────────────────────────────────────
const SUPABASE_URL = "https://lxaaqtqvlwjvyuedyauo.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx4YWFxdHF2bHdqdnl1ZWR5YXVvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE4MDYzNTUsImV4cCI6MjA4NzM4MjM1NX0.UItPw2j2oo5F2_zJZmf43gmZnNHVQ5FViQgbd4QEii0";

// method: GET | POST | PATCH | DELETE | UPSERT
async function supabaseQuery(path, method = "GET", body = null) {
  try {
    const isUpsert = method === "UPSERT";
    const opts = {
      method: isUpsert ? "POST" : method,
      headers: {
        "Content-Type": "application/json",
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
        "Prefer": isUpsert
          ? "resolution=merge-duplicates,return=representation"
          : method === "POST" ? "return=representation" : "",
      },
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, opts);
    if (!res.ok) {
      const err = await res.text();
      console.error("Supabase error:", err);
      return null;
    }
    const text = await res.text();
    return text ? JSON.parse(text) : [];
  } catch (e) {
    console.error("Supabase fetch failed:", e);
    return null;
  }
}

// ── AUTO-SYNC ENGINE ──────────────────────────────────────────
// On login + every 15 min:
//   1. Scans all season dates → saves predictions for any unrecorded games
//   2. Checks all pending rows → fills final scores when games finish
const SEASON_START = `${new Date().getFullYear()}-02-01`;

// Resolve split-squad team ID (e.g. 4864 "NYY1") to the real MLB team ID (147 "NYY")
// Split-squad IDs have no stats — must use parent team for all stat lookups
// MLB spring training split-squad teams use IDs like 4864 (not in TEAMS array).
// Resolution priority:
//   1. ID is a known real team → use it directly
//   2. abbr like "NYY1" → strip digits → "NYY" → find real team
//   3. abbr is purely numeric or empty (old saved rows) → use numeric ID prefix heuristic
//   4. Nothing matched → cache a lookup via MLB API teams endpoint
const _resolvedIdCache = {};

function resolveStatTeamId(teamId, abbr) {
  if (!teamId) return null;
  // 1. Known real team
  if (TEAMS.find(t => t.id === teamId)) return teamId;
  // Check cache
  if (_resolvedIdCache[teamId]) return _resolvedIdCache[teamId];
  // 2. abbr with letters (e.g. "NYY1", "BOS2")
  const baseAbbr = (abbr || "").replace(/\d+$/, "").toUpperCase();
  if (baseAbbr.length >= 2) {
    const parent = TEAMS.find(t => t.abbr === baseAbbr);
    if (parent) { _resolvedIdCache[teamId] = parent.id; return parent.id; }
  }
  // 3. Purely numeric abbr or no abbr — unresolvable split-squad or bad ID
  // Return null so callers skip the fetch rather than hitting a 404
  if (process.env.NODE_ENV !== "production") {
    console.warn(`resolveStatTeamId: unknown teamId=${teamId} abbr=${abbr} — skipping stat fetch`);
  }
  _resolvedIdCache[teamId] = null;
  return null;
}

async function buildPredictionRow(game, dateStr) {
  // Use resolved IDs for stat fetches — split-squad IDs (4000s) have no stats
  const homeStatId = resolveStatTeamId(game.homeTeamId, game.homeAbbr);
  const awayStatId = resolveStatTeamId(game.awayTeamId, game.awayAbbr);
  // Skip prediction entirely if either team can't be resolved (unrecognized split-squad)
  if (!homeStatId || !awayStatId) return null;

  const [homeHit, awayHit, homePitch, awayPitch, homeStarter, awayStarter, homeForm, awayForm] =
    await Promise.all([
      fetchTeamHitting(homeStatId), fetchTeamHitting(awayStatId),
      fetchTeamPitching(homeStatId), fetchTeamPitching(awayStatId),
      fetchStarterStats(game.homeStarterId), fetchStarterStats(game.awayStarterId),
      fetchRecentForm(homeStatId), fetchRecentForm(awayStatId),
    ]);
  const homeGamesPlayed = homeForm?.gamesPlayed || 0;
  const awayGamesPlayed = awayForm?.gamesPlayed || 0;
  const [homeBullpen, awayBullpen] = await Promise.all([
    fetchBullpenFatigue(game.homeTeamId),
    fetchBullpenFatigue(game.awayTeamId),
  ]);
  const pred = predictGame({
    homeTeamId: game.homeTeamId, awayTeamId: game.awayTeamId,
    homeHit, awayHit, homePitch, awayPitch,
    homeStarterStats: homeStarter, awayStarterStats: awayStarter,
    homeForm, awayForm, homeGamesPlayed, awayGamesPlayed,
    bullpenData: { [game.homeTeamId]: homeBullpen, [game.awayTeamId]: awayBullpen },
  });
  if (!pred) return null;
  const home = teamById(game.homeTeamId);
  const away = teamById(game.awayTeamId);
  return {
    game_date: dateStr,
    // Use abbreviation from schedule API response (already stripped of split-squad digits)
    // Fall back to TEAMS lookup, then numeric ID as last resort
    home_team: game.homeAbbr || (home?.abbr || String(game.homeTeamId)).replace(/\d+$/, ''),
    away_team: game.awayAbbr || (away?.abbr || String(game.awayTeamId)).replace(/\d+$/, ''),
    game_pk:   game.gamePk,
    model_ml_home: pred.modelML_home,
    model_ml_away: pred.modelML_away,
    run_line_home: pred.runLineHome,
    run_line_away: -pred.runLineHome,
    ou_total: pred.ouTotal,
    win_pct_home: parseFloat(pred.homeWinPct.toFixed(4)),
    confidence: pred.confidence,
    pred_home_runs: parseFloat(pred.homeRuns.toFixed(2)),
    pred_away_runs: parseFloat(pred.awayRuns.toFixed(2)),
    result_entered: false,
  };
}

async function fillFinalScores(pendingRows) {
  if (!pendingRows.length) return 0;
  let filled = 0;

  const byDate = {};
  for (const row of pendingRows) {
    if (!byDate[row.game_date]) byDate[row.game_date] = [];
    byDate[row.game_date].push(row);
  }

  const normAbbr = s => (s || "").replace(/\d+$/, "").toUpperCase();

  for (const [dateStr, rows] of Object.entries(byDate)) {
    try {
      const params = new URLSearchParams({
        path: "schedule",
        sportId: 1,
        date: dateStr,
        hydrate: "linescore,teams",
      });
      const r = await fetch(`/api/mlb?${params}`);
      console.log(`[fillFinalScores] ${dateStr} — HTTP ${r.status}`);
      if (!r.ok) { console.warn(`[fillFinalScores] bad response for ${dateStr}`); continue; }
      const data = await r.json();

      const dates = data?.dates || [];
      console.log(`[fillFinalScores] ${dateStr} — ${dates.length} date(s), ${dates.reduce((n,d)=>n+d.games.length,0)} game(s) total`);

      // Log what our pending rows expect
      console.log(`[fillFinalScores] pending rows for ${dateStr}:`,
        rows.map(r => `${r.away_team}@${r.home_team} pk=${r.game_pk}`)
      );

      for (const dt of dates) {
        for (const g of (dt.games || [])) {
          const state  = g.status?.abstractGameState || "";
          const detail = g.status?.detailedState || "";
          const coded  = g.status?.codedGameState || "";
          const isFinal = state === "Final"
            || detail === "Game Over"
            || detail.startsWith("Final")
            || coded === "F";

          const hAbbr = normAbbr(g.teams?.home?.team?.abbreviation);
          const aAbbr = normAbbr(g.teams?.away?.team?.abbreviation);
          const gamePk = g.gamePk;
          const homeScore = g.teams?.home?.score ?? null;
          const awayScore = g.teams?.away?.score ?? null;

          console.log(`[fillFinalScores]   API game: ${aAbbr}@${hAbbr} pk=${gamePk} state="${state}"/"${detail}" score=${awayScore}-${homeScore} final=${isFinal}`);

          if (!isFinal) continue;
          if (homeScore === null || awayScore === null) { console.log(`    → no score`); continue; }

          const matchedRow = rows.find(row => {
            const pkMatch = row.game_pk && row.game_pk === gamePk;
            const abbrMatch = normAbbr(row.home_team) === hAbbr && normAbbr(row.away_team) === aAbbr;
            const fuzzyMatch = hAbbr.startsWith(normAbbr(row.home_team)) && aAbbr.startsWith(normAbbr(row.away_team));
            console.log(`    → vs row ${row.away_team}@${row.home_team} pk=${row.game_pk}: pkMatch=${pkMatch} abbrMatch=${abbrMatch} fuzzy=${fuzzyMatch}`);
            return pkMatch || abbrMatch || fuzzyMatch;
          });

          if (!matchedRow) { console.log(`    → NO MATCH`); continue; }
          console.log(`    → MATCHED row id=${matchedRow.id}`);

          const ml_correct = homeScore > awayScore;
          const rl_correct = (homeScore - awayScore) > 1.5 ? true
                           : (awayScore - homeScore) > 1.5 ? false : null;
          const ou_correct = (homeScore + awayScore) > matchedRow.ou_total ? "OVER"
                           : (homeScore + awayScore) < matchedRow.ou_total ? "UNDER" : "PUSH";

          await supabaseQuery(`/mlb_predictions?id=eq.${matchedRow.id}`, "PATCH", {
            actual_home_runs: homeScore,
            actual_away_runs: awayScore,
            result_entered: true,
            ml_correct, rl_correct, ou_correct,
          });
          filled++;
        }
      }
    } catch (e) { console.warn("fillFinalScores error for date", dateStr, e); }
  }
  return filled;
}

async function autoSync(onProgress) {
  onProgress?.("🔄 Checking for unrecorded games…");
  const today = new Date().toISOString().split("T")[0];

  // Build list of all dates from season start to today
  const allDates = [];
  const cur = new Date(SEASON_START);
  while (cur.toISOString().split("T")[0] <= today) {
    allDates.push(cur.toISOString().split("T")[0]);
    cur.setDate(cur.getDate() + 1);
  }

  // Fetch existing Supabase rows (keys + pending)
  const existing = await supabaseQuery(
    `/mlb_predictions?select=id,game_date,home_team,away_team,result_entered,ou_total,game_pk&order=game_date.asc&limit=5000`
  );
  const normA = s => (s || "").replace(/\d+$/, "").toUpperCase();
  const savedKeys = new Set((existing || []).map(r => `${r.game_date}|${normA(r.away_team)}@${normA(r.home_team)}`));
  const pendingResults = (existing || []).filter(r => !r.result_entered);

  // Step 1: fill any pending scores
  if (pendingResults.length) {
    onProgress?.(`⏳ Updating results for ${pendingResults.length} pending game(s)…`);
    const filled = await fillFinalScores(pendingResults);
    if (filled) onProgress?.(`✓ ${filled} result(s) recorded`);
  }

  // Step 1b: refresh predictions on rows from the last 7 days that have stale model values
  // Detects stale rows by checking if model_ml_home is exactly -116 (the old default)
  const staleRows = (existing || []).filter(r =>
    r.model_ml_home === -116 || r.model_ml_home === null
  );
  if (staleRows.length) {
    onProgress?.(`🔄 Refreshing ${staleRows.length} stale prediction(s)…`);
    await refreshPredictions(staleRows, onProgress);
  }

  // Step 2: save predictions for any unrecorded dates
  let newPredictions = 0;
  for (const dateStr of allDates) {
    const schedule = await fetchScheduleForDate(dateStr);
    if (!schedule.length) continue;
    const unsaved = schedule.filter(g => {
      const ha = normA(g.homeAbbr || teamById(g.homeTeamId).abbr);
      const aa = normA(g.awayAbbr || teamById(g.awayTeamId).abbr);
      // Only skip if both teams resolved to something meaningful
      if (!ha || !aa) return true;
      return !savedKeys.has(`${dateStr}|${aa}@${ha}`);
    });
    if (!unsaved.length) continue;
    onProgress?.(`📝 Saving ${unsaved.length} game(s) for ${dateStr}…`);
    const rows = (await Promise.all(unsaved.map(g => buildPredictionRow(g, dateStr)))).filter(Boolean);
    if (rows.length) {
      await supabaseQuery("/mlb_predictions", "UPSERT", rows);
      newPredictions += rows.length;
      // Immediately fill scores for any of these that already finished
      const newlySaved = await supabaseQuery(
        `/mlb_predictions?game_date=eq.${dateStr}&result_entered=eq.false&select=id,game_pk,home_team,away_team,ou_total,result_entered,game_date`
      );
      if (newlySaved?.length) await fillFinalScores(newlySaved);
    }
  }

  const msg = newPredictions
    ? `✅ Sync complete — ${newPredictions} new prediction(s) saved`
    : "✅ All games up to date";
  onProgress?.(msg);
  return { newPredictions };
}

// ── REFRESH STALE PREDICTIONS ─────────────────────────────────
// Re-runs the prediction model on saved rows that haven't had results entered yet.
// Also re-runs on ALL rows for a given date range when called manually (full refresh).
async function refreshPredictions(rows, onProgress) {
  if (!rows?.length) return 0;
  let updated = 0;

  // Group by date to batch schedule fetches
  const byDate = {};
  for (const row of rows) {
    if (!byDate[row.game_date]) byDate[row.game_date] = [];
    byDate[row.game_date].push(row);
  }

  for (const [dateStr, dateRows] of Object.entries(byDate)) {
    onProgress?.(`🔄 Refreshing predictions for ${dateStr}…`);
    // Fetch the schedule to get team IDs and starter IDs for this date
    const schedData = await mlbFetch("schedule", {
      sportId: 1, date: dateStr, hydrate: "probablePitcher,teams",
    });
    const schedGames = [];
    for (const d of (schedData?.dates || [])) {
      for (const g of (d.games || [])) {
        schedGames.push(g);
      }
    }

    for (const row of dateRows) {
      try {
        // Find matching schedule game by team name/abbr
        const normAbbr = s => (s || "").replace(/\d+$/, "").toUpperCase();
        const schedGame = schedGames.find(g => {
          const hA = normAbbr(g.teams?.home?.team?.abbreviation);
          const aA = normAbbr(g.teams?.away?.team?.abbreviation);
          return (row.game_pk && g.gamePk === row.game_pk)
            || (normAbbr(row.home_team) === hA && normAbbr(row.away_team) === aA);
        });

        const homeTeamId = schedGame?.teams?.home?.team?.id
          || TEAMS.find(t => t.abbr === row.home_team)?.id;
        const awayTeamId = schedGame?.teams?.away?.team?.id
          || TEAMS.find(t => t.abbr === row.away_team)?.id;
        if (!homeTeamId || !awayTeamId) continue;

        const homeStarterId = schedGame?.teams?.home?.probablePitcher?.id || null;
        const awayStarterId = schedGame?.teams?.away?.probablePitcher?.id || null;

        const homeStatId = resolveStatTeamId(homeTeamId, row.home_team);
        const awayStatId = resolveStatTeamId(awayTeamId, row.away_team);
        const [homeHit, awayHit, homePitch, awayPitch, homeStarter, awayStarter, homeForm, awayForm] =
          await Promise.all([
            fetchTeamHitting(homeStatId), fetchTeamHitting(awayStatId),
            fetchTeamPitching(homeStatId), fetchTeamPitching(awayStatId),
            fetchStarterStats(homeStarterId), fetchStarterStats(awayStarterId),
            fetchRecentForm(homeStatId), fetchRecentForm(awayStatId),
          ]);

        const homeGamesPlayed = homeForm?.gamesPlayed || 0;
        const awayGamesPlayed = awayForm?.gamesPlayed || 0;
        const pred = predictGame({
          homeTeamId, awayTeamId,
          homeHit, awayHit, homePitch, awayPitch,
          homeStarterStats: homeStarter, awayStarterStats: awayStarter,
          homeForm, awayForm, homeGamesPlayed, awayGamesPlayed,
        });
        if (!pred) continue;

        await supabaseQuery(`/mlb_predictions?id=eq.${row.id}`, "PATCH", {
          model_ml_home:   pred.modelML_home,
          model_ml_away:   pred.modelML_away,
          run_line_home:   pred.runLineHome,
          run_line_away:   -pred.runLineHome,
          ou_total:        pred.ouTotal,
          win_pct_home:    parseFloat(pred.homeWinPct.toFixed(4)),
          confidence:      pred.confidence,
          pred_home_runs:  parseFloat(pred.homeRuns.toFixed(2)),
          pred_away_runs:  parseFloat(pred.awayRuns.toFixed(2)),
        });
        updated++;
      } catch (e) { console.warn("refreshPredictions error:", row.id, e); }
    }
  }
  onProgress?.(`✅ Refreshed ${updated} prediction(s)`);
  return updated;
}

// Supabase SQL to create the table (run once in Supabase SQL editor):
// CREATE TABLE mlb_predictions (
//   id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
//   game_date date NOT NULL,
//   home_team text NOT NULL,
//   away_team text NOT NULL,
//   model_ml_home integer,
//   model_ml_away integer,
//   run_line_home numeric,
//   run_line_away numeric,
//   ou_total numeric,
//   win_pct_home numeric,
//   confidence text,
//   pred_home_runs numeric,
//   pred_away_runs numeric,
//   actual_home_runs integer,
//   actual_away_runs integer,
//   result_entered boolean DEFAULT false,
//   ml_correct boolean,
//   rl_correct boolean,
//   ou_correct text,
//   created_at timestamptz DEFAULT now()
// );

// ── MLB API ───────────────────────────────────────────────────
const SEASON = new Date().getFullYear();
// Before ~April 1, the current season has no stats yet.
// STAT_SEASON is the most recent season that actually has data.
const _now = new Date();
const STAT_SEASON = (_now.getMonth() < 3) ? SEASON - 1 : SEASON; // month is 0-indexed

// ── TEAMS ─────────────────────────────────────────────────────
const TEAMS = [
  { id: 108, name: "Angels",      abbr: "LAA", league: "AL" },
  { id: 109, name: "D-backs",     abbr: "ARI", league: "NL" },
  { id: 110, name: "Orioles",     abbr: "BAL", league: "AL" },
  { id: 111, name: "Red Sox",     abbr: "BOS", league: "AL" },
  { id: 112, name: "Cubs",        abbr: "CHC", league: "NL" },
  { id: 113, name: "Reds",        abbr: "CIN", league: "NL" },
  { id: 114, name: "Guardians",   abbr: "CLE", league: "AL" },
  { id: 115, name: "Rockies",     abbr: "COL", league: "NL" },
  { id: 116, name: "Tigers",      abbr: "DET", league: "AL" },
  { id: 117, name: "Astros",      abbr: "HOU", league: "AL" },
  { id: 118, name: "Royals",      abbr: "KC",  league: "AL" },
  { id: 119, name: "Dodgers",     abbr: "LAD", league: "NL" },
  { id: 120, name: "Nationals",   abbr: "WSH", league: "NL" },
  { id: 121, name: "Mets",        abbr: "NYM", league: "NL" },
  { id: 133, name: "Athletics",   abbr: "OAK", league: "AL" },
  { id: 134, name: "Pirates",     abbr: "PIT", league: "NL" },
  { id: 135, name: "Padres",      abbr: "SD",  league: "NL" },
  { id: 136, name: "Mariners",    abbr: "SEA", league: "AL" },
  { id: 137, name: "Giants",      abbr: "SF",  league: "NL" },
  { id: 138, name: "Cardinals",   abbr: "STL", league: "NL" },
  { id: 139, name: "Rays",        abbr: "TB",  league: "AL" },
  { id: 140, name: "Rangers",     abbr: "TEX", league: "AL" },
  { id: 141, name: "Blue Jays",   abbr: "TOR", league: "AL" },
  { id: 142, name: "Twins",       abbr: "MIN", league: "AL" },
  { id: 143, name: "Phillies",    abbr: "PHI", league: "NL" },
  { id: 144, name: "Braves",      abbr: "ATL", league: "NL" },
  { id: 145, name: "White Sox",   abbr: "CWS", league: "AL" },
  { id: 146, name: "Marlins",     abbr: "MIA", league: "NL" },
  { id: 147, name: "Yankees",     abbr: "NYY", league: "AL" },
  { id: 158, name: "Brewers",     abbr: "MIL", league: "NL" },
];

// teamById: local lookup first, then returns a placeholder with numeric ID
// Spring training split squads use the same MLB team IDs — "UNK" means the 
// schedule returned a team ID not in this list (rare for real teams)
const teamById = (id) => {
  const found = TEAMS.find(t => t.id === id);
  if (found) return found;
  // Try to match by numeric ID to a known team (handles edge cases)
  return { name: String(id), abbr: String(id), id, league: "?" };
};

// Async version: resolves unknown team IDs via MLB API
async function resolveTeam(id) {
  const local = TEAMS.find(t => t.id === id);
  if (local) return local;
  try {
    const data = await mlbFetch(`teams/${id}`, { sportId: 1 });
    const t = data?.teams?.[0];
    if (t) return { id: t.id, name: t.name, abbr: (t.abbreviation || t.name.slice(0,3)).replace(/\d+$/, ""), league: t.league?.name?.includes("National") ? "NL" : "AL" };
  } catch {}
  return { id, name: String(id), abbr: String(id), league: "?" };
}

// ── PARK FACTORS ──────────────────────────────────────────────
const PARK_FACTORS = {
  108: { runFactor: 1.02, hrFactor: 1.05, name: "Angel Stadium" },
  109: { runFactor: 1.03, hrFactor: 1.02, name: "Chase Field" },
  110: { runFactor: 0.95, hrFactor: 0.91, name: "Camden Yards" },
  111: { runFactor: 1.04, hrFactor: 1.08, name: "Fenway Park" },
  112: { runFactor: 1.04, hrFactor: 1.07, name: "Wrigley Field" },
  113: { runFactor: 1.00, hrFactor: 1.01, name: "Great American" },
  114: { runFactor: 0.97, hrFactor: 0.95, name: "Progressive Field" },
  115: { runFactor: 1.16, hrFactor: 1.19, name: "Coors Field" },
  116: { runFactor: 0.98, hrFactor: 0.96, name: "Comerica Park" },
  117: { runFactor: 0.99, hrFactor: 0.97, name: "Minute Maid" },
  118: { runFactor: 1.01, hrFactor: 1.00, name: "Kauffman Stadium" },
  119: { runFactor: 1.00, hrFactor: 1.01, name: "Dodger Stadium" },
  120: { runFactor: 1.01, hrFactor: 1.02, name: "Nationals Park" },
  121: { runFactor: 1.03, hrFactor: 1.06, name: "Citi Field" },
  133: { runFactor: 0.99, hrFactor: 0.98, name: "Oakland Coliseum" },
  134: { runFactor: 0.96, hrFactor: 0.93, name: "PNC Park" },
  135: { runFactor: 0.95, hrFactor: 0.92, name: "Petco Park" },
  136: { runFactor: 0.94, hrFactor: 0.90, name: "T-Mobile Park" },
  137: { runFactor: 0.91, hrFactor: 0.88, name: "Oracle Park" },
  138: { runFactor: 0.97, hrFactor: 0.95, name: "Busch Stadium" },
  139: { runFactor: 0.96, hrFactor: 0.94, name: "Tropicana Field" },
  140: { runFactor: 1.05, hrFactor: 1.08, name: "Globe Life Field" },
  141: { runFactor: 1.03, hrFactor: 1.04, name: "Rogers Centre" },
  142: { runFactor: 1.00, hrFactor: 0.99, name: "Target Field" },
  143: { runFactor: 1.06, hrFactor: 1.09, name: "Citizens Bank" },
  144: { runFactor: 1.02, hrFactor: 1.04, name: "Truist Park" },
  145: { runFactor: 1.00, hrFactor: 1.00, name: "Guaranteed Rate" },
  146: { runFactor: 0.97, hrFactor: 0.96, name: "loanDepot Park" },
  147: { runFactor: 1.05, hrFactor: 1.10, name: "Yankee Stadium" },
  158: { runFactor: 0.97, hrFactor: 0.95, name: "American Family Field" },
};

// ── PREDICTION ENGINE ─────────────────────────────────────────
function predictGame({ homeTeamId, awayTeamId, homeHit, awayHit, homePitch, awayPitch,
                        homeStarterStats, awayStarterStats, homeForm, awayForm, bullpenData,
                        homeGamesPlayed = 0, awayGamesPlayed = 0 }) {
  const park = PARK_FACTORS[homeTeamId] || { runFactor: 1.0, hrFactor: 1.0 };
  const wOBA = (h) => {
    if (!h) return 0.320;
    const { obp = 0.320, slg = 0.420, avg = 0.250 } = h;
    return Math.max(0.25, Math.min(0.42, 0.69 * (obp - avg) + 0.89 * avg + 1.27 * (slg - avg) * 0.9 + 0.05));
  };

  let hr = 4.5, ar = 4.5;
  hr += (wOBA(homeHit) - 0.320) * 14;
  ar += (wOBA(awayHit) - 0.320) * 14;

  const hFIP = homeStarterStats?.fip || (homePitch ? homePitch.era * 0.82 + homePitch.whip * 0.4 : 4.25);
  const aFIP = awayStarterStats?.fip  || (awayPitch  ? awayPitch.era  * 0.82 + awayPitch.whip  * 0.4 : 4.25);
  ar += (hFIP - 4.25) * 0.35;
  hr += (aFIP - 4.25) * 0.35;

  hr *= park.runFactor;
  ar *= park.runFactor;

  if (homeForm?.formScore) hr += homeForm.formScore * 0.3;
  if (awayForm?.formScore) ar += awayForm.formScore * 0.3;
  if (homeForm?.luckFactor) hr -= homeForm.luckFactor * 0.2;
  if (awayForm?.luckFactor) ar -= awayForm.luckFactor * 0.2;

  const bpHome = bullpenData?.[homeTeamId];
  const bpAway = bullpenData?.[awayTeamId];
  if (bpHome?.fatigued) ar += 0.3;
  if (bpAway?.fatigued) hr += 0.3;

  hr = Math.max(1.5, Math.min(10, hr));
  ar = Math.max(1.5, Math.min(10, ar));

  const homeAdv = 0.038;
  const lambda = hr / ar;
  const hwp = Math.min(0.85, Math.max(0.15, 0.5 + (Math.log(lambda) * 0.6) + homeAdv));

  // Confidence: base data availability score + blending weight factor
  // When games played is low, data is blended with priors → confidence penalized slightly
  const avgGP = (homeGamesPlayed + awayGamesPlayed) / 2;
  const blendWeight = Math.min(1.0, avgGP / FULL_SEASON_THRESHOLD);
  const dataScore = [homeHit, awayHit, homeStarterStats, awayStarterStats, homeForm, awayForm]
    .filter(Boolean).length / 6;

  // confScore: 0-100. Blend weight pushes it up as season matures.
  // Early season (0 GP): data is reliable but based on priors → MEDIUM at best
  // Mid season (50 GP): real current data coming in → HIGH possible
  // Full season (100+ GP): maximum confidence from current season data
  const confScore = Math.round(40 + (dataScore * 35) + (blendWeight * 25));
  const confidence = confScore >= 80 ? "HIGH" : confScore >= 60 ? "MEDIUM" : "LOW";

  const modelML_home = hwp >= 0.5
    ? -Math.round((hwp / (1 - hwp)) * 100)
    : Math.round(((1 - hwp) / hwp) * 100);
  const modelML_away = hwp >= 0.5
    ? Math.round(((1 - hwp) / hwp) * 100)
    : -Math.round((hwp / (1 - hwp)) * 100);

  return { homeRuns: hr, awayRuns: ar, homeWinPct: hwp, awayWinPct: 1 - hwp,
           confidence, confScore, blendWeight, avgGP,
           modelML_home, modelML_away,
           ouTotal: parseFloat((hr + ar).toFixed(1)),
           runLineHome: -1.5, runLinePct: hwp > 0.65 ? hwp - 0.12 : hwp - 0.18 };
}

// ── MLB API HELPERS ───────────────────────────────────────────
// Single proxy helper — all calls route through /api/mlb (Vercel serverless)
// which proxies to statsapi.mlb.com server-side, bypassing browser CORS entirely
function mlbFetch(path, params = {}) {
  const p = new URLSearchParams({ path, ...params });
  return fetch(`/api/mlb?${p}`).then(r => r.ok ? r.json() : null).catch(() => null);
}

// ── SEASON BLENDING ───────────────────────────────────────────
// Ramps from 100% prior-season data (0 GP) to 100% current-season (100+ GP)
// Mirrors how ZiPS/Steamer projection systems handle small sample sizes
const FULL_SEASON_THRESHOLD = 100;

function blendStats(current, prior1, prior2, gamesPlayed) {
  const w = Math.min(1.0, gamesPlayed / FULL_SEASON_THRESHOLD);
  const priors = [prior1, prior2].filter(Boolean);
  if (!priors.length || w >= 1.0) return current;
  if (!current) {
    return priors.reduce((acc, p) => {
      Object.keys(p).forEach(k => { acc[k] = (acc[k] || 0) + p[k] / priors.length; });
      return acc;
    }, {});
  }
  const priorAvg = priors.reduce((acc, p) => {
    Object.keys(p).forEach(k => { acc[k] = (acc[k] || 0) + p[k] / priors.length; });
    return acc;
  }, {});
  const result = {};
  Object.keys(current).forEach(k => {
    const c = current[k] ?? priorAvg[k];
    const p = priorAvg[k] ?? current[k];
    result[k] = (typeof c === "number" && typeof p === "number") ? c * w + p * (1 - w) : current[k];
  });
  return result;
}

// ── SCHEDULE ──────────────────────────────────────────────────
async function fetchScheduleForDate(dateStr) {
  // Omit gameType — API returns all types (S/R/P) for the date without it
  const data = await mlbFetch("schedule", {
    sportId: 1, date: dateStr, hydrate: "probablePitcher,teams,venue,linescore",
  });
  const games = [];
  for (const d of (data?.dates || [])) {
    for (const g of (d.games || [])) {
      const norm = s => (s || "").replace(/\d+$/, ""); // strip split-squad suffix
      const homeId = g.teams?.home?.team?.id;
      const awayId = g.teams?.away?.team?.id;
      // Use API abbreviation directly — strip split-squad suffix (e.g. "NYY1" → "NYY")
      const rawHomeAbbr = g.teams?.home?.team?.abbreviation || "";
      const rawAwayAbbr = g.teams?.away?.team?.abbreviation || "";
      const homeAbbr = rawHomeAbbr.replace(/\d+$/, "") || teamById(homeId).abbr;
      const awayAbbr = rawAwayAbbr.replace(/\d+$/, "") || teamById(awayId).abbr;
      games.push({
        gamePk:       g.gamePk,
        gameDate:     g.gameDate,
        status:       (g.status?.abstractGameState === "Final" || g.status?.detailedState === "Game Over") ? "Final"
                      : g.status?.abstractGameState === "Live" ? "Live" : "Preview",
        detailedState: g.status?.detailedState || "",
        homeTeamId:   homeId,
        awayTeamId:   awayId,
        homeAbbr,
        awayAbbr,
        homeTeamName: g.teams?.home?.team?.name || homeAbbr,
        awayTeamName: g.teams?.away?.team?.name || awayAbbr,
        homeScore:    g.teams?.home?.score ?? null,
        awayScore:    g.teams?.away?.score ?? null,
        homeStarter:  g.teams?.home?.probablePitcher?.fullName || null,
        awayStarter:  g.teams?.away?.probablePitcher?.fullName || null,
        homeStarterId: g.teams?.home?.probablePitcher?.id || null,
        awayStarterId: g.teams?.away?.probablePitcher?.id || null,
        venue:        g.venue?.name,
        inning:       g.linescore?.currentInning || null,
        inningHalf:   g.linescore?.inningHalf || null,
      });
    }
  }
  return games;
}

// ── HITTING (blended 3-season) ────────────────────────────────
async function fetchOneSeasonHitting(teamId, season) {
  if (!teamId) return null;
  const data = await mlbFetch(`teams/${teamId}/stats`, { stats: "season", group: "hitting", season, sportId: 1 });
  // mlbFetch returns null on non-200 (404 when season not started yet)
  if (!data) return null;
  const s = data?.stats?.[0]?.splits?.[0]?.stat;
  if (!s) return null;
  return {
    avg: parseFloat(s.avg) || 0.250,
    obp: parseFloat(s.obp) || 0.320,
    slg: parseFloat(s.slg) || 0.420,
    ops: parseFloat(s.ops) || 0.740,
    gamesPlayed: parseInt(s.gamesPlayed) || 0,
  };
}

async function fetchTeamHitting(teamId) {
  if (!teamId) return null;
  const [cur, p1, p2] = await Promise.all([
    fetchOneSeasonHitting(teamId, STAT_SEASON),
    fetchOneSeasonHitting(teamId, STAT_SEASON - 1),
    fetchOneSeasonHitting(teamId, STAT_SEASON - 2),
  ]);
  return blendStats(cur, p1, p2, cur?.gamesPlayed || 0);
}

// ── PITCHING (blended 3-season) ───────────────────────────────
async function fetchOneSeasonPitching(teamId, season) {
  if (!teamId) return null;
  const data = await mlbFetch(`teams/${teamId}/stats`, { stats: "season", group: "pitching", season, sportId: 1 });
  if (!data) return null;
  const s = data?.stats?.[0]?.splits?.[0]?.stat;
  if (!s) return null;
  return {
    era:  parseFloat(s.era)  || 4.00,
    whip: parseFloat(s.whip) || 1.30,
    k9:   parseFloat(s.strikeoutsPer9Inn) || 8.5,
    bb9:  parseFloat(s.walksPer9Inn)      || 3.0,
  };
}

async function fetchTeamPitching(teamId) {
  if (!teamId) return null;
  const [cur, p1, p2, gpData] = await Promise.all([
    fetchOneSeasonPitching(teamId, STAT_SEASON),
    fetchOneSeasonPitching(teamId, STAT_SEASON - 1),
    fetchOneSeasonPitching(teamId, STAT_SEASON - 2),
    fetchOneSeasonHitting(teamId, STAT_SEASON), // gamesPlayed lives on hitting endpoint
  ]);
  return blendStats(cur, p1, p2, gpData?.gamesPlayed || 0);
}

// ── STARTER STATS (blended 3-season) ─────────────────────────
async function fetchOneSeasonStarterStats(pitcherId, season) {
  if (!pitcherId) return null;
  const data = await mlbFetch(`people/${pitcherId}/stats`, { stats: "season", group: "pitching", season, sportId: 1 });
  if (!data) return null;
  const s = data?.stats?.[0]?.splits?.[0]?.stat;
  if (!s) return null;
  const era  = parseFloat(s.era)  || 4.50;
  const whip = parseFloat(s.whip) || 1.35;
  const k9   = parseFloat(s.strikeoutsPer9Inn) || 8.0;
  const bb9  = parseFloat(s.walksPer9Inn)      || 3.2;
  const fip  = era * 0.82 + whip * 0.4 + (bb9 - k9) * 0.15;
  const xfip = fip * 0.85 + 4.25 * 0.15;
  const ip   = parseFloat(s.inningsPitched) || 0;
  return { era, whip, k9, bb9, fip, xfip, ip };
}

async function fetchStarterStats(pitcherId) {
  if (!pitcherId) return null;
  const [cur, p1, p2] = await Promise.all([
    fetchOneSeasonStarterStats(pitcherId, STAT_SEASON),
    fetchOneSeasonStarterStats(pitcherId, STAT_SEASON - 1),
    fetchOneSeasonStarterStats(pitcherId, STAT_SEASON - 2),
  ]);
  const ip = cur?.ip || 0;
  const w  = Math.min(1.0, ip / 120);
  return blendStats(cur, p1, p2, Math.round(w * FULL_SEASON_THRESHOLD));
}

// ── RECENT FORM ───────────────────────────────────────────────
async function fetchRecentForm(teamId, numGames = 15) {
  if (!teamId) return null;
  const today = new Date().toISOString().split("T")[0];
  const data = await mlbFetch("schedule", {
    teamId, season: SEASON, startDate: `${SEASON}-01-01`, endDate: today,
    hydrate: "linescore", sportId: 1,
  });
  const games = [];
  for (const d of (data?.dates || [])) {
    for (const g of (d.games || [])) {
      const state = g.status?.abstractGameState;
      if (state === "Final" || g.status?.detailedState === "Game Over") {
        const isHome = g.teams?.home?.team?.id === teamId;
        const my = isHome ? g.teams?.home : g.teams?.away;
        const op = isHome ? g.teams?.away : g.teams?.home;
        games.push({ win: my?.isWinner || false, rs: my?.score || 0, ra: op?.score || 0 });
      }
    }
  }
  const recent = games.slice(-numGames);
  if (!recent.length) return null;
  const rf = recent.reduce((s, g) => s + g.rs, 0);
  const ra = recent.reduce((s, g) => s + g.ra, 0);
  const wins = recent.filter(g => g.win).length;
  const pyth = Math.pow(rf, 1.83) / (Math.pow(rf, 1.83) + Math.pow(ra, 1.83));
  const actualWP = wins / recent.length;
  const formScore = recent.slice(-5).reduce((s, g, i) => s + (g.win ? 1 : -0.6) * (i + 1), 0) / 15;
  return { gamesPlayed: games.length, winPct: actualWP, pythWinPct: pyth, luckFactor: actualWP - pyth, formScore };
}

// ── BULLPEN FATIGUE (from src/api/mlb.js) ─────────────────────
async function fetchBullpenFatigue(teamId) {
  const today = new Date();
  const y = new Date(today); y.setDate(today.getDate() - 1);
  const t = new Date(today); t.setDate(today.getDate() - 2);
  const fmt = d => d.toISOString().split("T")[0];
  const data = await mlbFetch("schedule", { teamId, season: SEASON, startDate: fmt(t), endDate: fmt(y), sportId: 1 });
  let py = 0, pt = 0;
  for (const date of (data?.dates || [])) {
    for (const g of (date.games || [])) {
      const isHome = g.teams?.home?.team?.id === teamId;
      const bp = isHome ? g.teams?.home?.pitchers?.length || 0 : g.teams?.away?.pitchers?.length || 0;
      const days = Math.round((today - new Date(date.date)) / 86400000);
      if (days === 1) py = bp;
      if (days === 2) pt = bp;
    }
  }
  return { fatigue: Math.min(1, py * 0.15 + pt * 0.07), pitchersUsedYesterday: py, closerAvailable: py < 3 };
}

// ── BANNER COLOR ──────────────────────────────────────────────
function getBannerColor(pred, hasStarter) {
  if (!pred || !hasStarter) return "yellow";
  if (pred.homeWinPct >= 0.60) return "green";
  if (pred.homeWinPct <= 0.40) return "green";
  return "neutral";
}

// ── PARLAY ODDS CALCULATOR ────────────────────────────────────
function mlToDecimal(ml) {
  if (ml >= 100) return ml / 100 + 1;
  return 100 / Math.abs(ml) + 1;
}
function combinedParlayOdds(legs) {
  return legs.reduce((acc, leg) => acc * mlToDecimal(leg.ml), 1);
}
function combinedParlayProbability(legs) {
  return legs.reduce((acc, leg) => acc * leg.prob, 1);
}
function decimalToML(dec) {
  if (dec >= 2) return `+${Math.round((dec - 1) * 100)}`;
  return `-${Math.round(100 / (dec - 1))}`;
}

// ── ACCURACY HELPERS ──────────────────────────────────────────
function computeAccuracy(records) {
  const withResults = records.filter(r => r.result_entered);
  if (!withResults.length) return null;
  const ml = withResults.filter(r => r.ml_correct !== null);
  const rl = withResults.filter(r => r.rl_correct !== null);
  const ou = withResults.filter(r => r.ou_correct !== null);
  const tiers = { HIGH: { total: 0, correct: 0 }, MEDIUM: { total: 0, correct: 0 }, LOW: { total: 0, correct: 0 } };
  withResults.forEach(r => {
    if (r.confidence && tiers[r.confidence]) {
      tiers[r.confidence].total++;
      if (r.ml_correct) tiers[r.confidence].correct++;
    }
  });
  return {
    total: withResults.length,
    mlAcc: ml.length ? (ml.filter(r => r.ml_correct).length / ml.length * 100).toFixed(1) : null,
    rlAcc: rl.length ? (rl.filter(r => r.rl_correct).length / rl.length * 100).toFixed(1) : null,
    ouAcc: ou.length ? (ou.filter(r => r.ou_correct === "OVER" || r.ou_correct === "UNDER").length / ou.length * 100).toFixed(1) : null,
    tiers,
  };
}

// ═══════════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════════
export default function App() {
  const [activeTab, setActiveTab]   = useState("calendar");
  const [syncStatus, setSyncStatus] = useState("idle"); // idle | syncing | done | error
  const [syncMsg, setSyncMsg]       = useState("");
  const syncIntervalRef = useRef(null);

  const runSync = useCallback(async () => {
    setSyncStatus("syncing");
    try {
      await autoSync((msg) => setSyncMsg(msg));
      setSyncStatus("done");
    } catch (e) {
      console.error("autoSync error:", e);
      setSyncStatus("error");
      setSyncMsg("Sync error — check console");
    }
  }, []);

  // On mount: run sync immediately, then every 15 minutes
  useEffect(() => {
    runSync();
    syncIntervalRef.current = setInterval(runSync, 15 * 60 * 1000);
    return () => clearInterval(syncIntervalRef.current);
  }, [runSync]);

  const tabs = [
    { id: "calendar", label: "📅 Calendar" },
    { id: "history",  label: "📊 History"  },
    { id: "parlay",   label: "🎯 Parlay"   },
    { id: "matchup",  label: "⚾ Matchup"  },
  ];

  const syncDotColor = syncStatus === "syncing" ? "#e3b341"
    : syncStatus === "done"    ? "#3fb950"
    : syncStatus === "error"   ? "#f85149" : "#8b949e";

  return (
    <div style={{ fontFamily: "'Inter', sans-serif", background: "#0d1117", minHeight: "100vh", color: "#e6edf3" }}>
      {/* Header */}
      <div style={{ background: "linear-gradient(135deg, #161b22 0%, #1a2332 100%)", borderBottom: "1px solid #30363d", padding: "16px 24px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 28 }}>⚾</span>
            <div>
              <div style={{ fontSize: 20, fontWeight: 700, color: "#58a6ff", letterSpacing: 1 }}>MLB PREDICTOR v7</div>
              <div style={{ fontSize: 11, color: "#8b949e", letterSpacing: 2 }}>AUTO-SYNC · HISTORY · PARLAY · ACCURACY</div>
            </div>
          </div>
          {/* Sync status pill */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#161b22", border: "1px solid #30363d", borderRadius: 20, padding: "6px 14px" }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: syncDotColor,
              boxShadow: syncStatus === "syncing" ? `0 0 6px ${syncDotColor}` : "none",
              animation: syncStatus === "syncing" ? "pulse 1s infinite" : "none" }} />
            <span style={{ fontSize: 11, color: syncDotColor, maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {syncStatus === "idle" ? "Waiting…" : syncMsg || "Syncing…"}
            </span>
            {syncStatus !== "syncing" && (
              <button onClick={runSync} title="Force sync now"
                style={{ background: "none", border: "none", color: "#8b949e", cursor: "pointer", fontSize: 13, padding: 0, marginLeft: 4 }}>↻</button>
            )}
          </div>
        </div>
        <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }`}</style>

        {/* Season Accuracy Banner */}
        <SeasonAccuracyBanner refreshKey={syncStatus} />

        {/* Tabs */}
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => setActiveTab(t.id)}
              style={{
                padding: "6px 16px", borderRadius: 20, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 500,
                background: activeTab === t.id ? "#58a6ff" : "#21262d",
                color: activeTab === t.id ? "#0d1117" : "#8b949e",
                transition: "all 0.15s",
              }}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ padding: "20px 24px" }}>
        {activeTab === "calendar" && <CalendarTab />}
        {activeTab === "history"  && <HistoryTab refreshKey={syncStatus} />}
        {activeTab === "parlay"   && <ParlayTab />}
        {activeTab === "matchup"  && <MatchupTab />}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// SEASON ACCURACY BANNER
// ═══════════════════════════════════════════════════════════════
function SeasonAccuracyBanner({ refreshKey }) {
  const [acc, setAcc] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const data = await supabaseQuery(`/mlb_predictions?result_entered=eq.true&select=ml_correct,rl_correct,ou_correct,confidence`);
      if (data && data.length) setAcc(computeAccuracy(data));
      else setAcc(null);
      setLoading(false);
    })();
  }, [refreshKey]);

  if (loading) return (
    <div style={{ background: "#21262d", borderRadius: 8, padding: "10px 16px", fontSize: 12, color: "#8b949e" }}>
      Loading season accuracy...
    </div>
  );
  if (!acc) return (
    <div style={{ background: "#21262d", borderRadius: 8, padding: "10px 16px", fontSize: 12, color: "#8b949e" }}>
      📈 Season accuracy will appear once results are logged — enter outcomes in the History tab.
    </div>
  );

  const statBox = (label, val, color) => (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontSize: 20, fontWeight: 700, color: color || "#58a6ff" }}>{val ?? "—"}%</div>
      <div style={{ fontSize: 10, color: "#8b949e", letterSpacing: 1 }}>{label}</div>
    </div>
  );

  const tierColor = (t) => {
    if (!t.total) return "#8b949e";
    const pct = t.correct / t.total;
    return pct >= 0.60 ? "#3fb950" : pct >= 0.50 ? "#e3b341" : "#f85149";
  };

  return (
    <div style={{ background: "linear-gradient(90deg, #1a2332, #162032)", border: "1px solid #30363d", borderRadius: 10, padding: "12px 20px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: "#e3b341" }}>📈 SEASON ACCURACY</span>
          <span style={{ fontSize: 11, color: "#8b949e" }}>({acc.total} games graded)</span>
        </div>
        <div style={{ display: "flex", gap: 24 }}>
          {statBox("MONEYLINE", acc.mlAcc, acc.mlAcc >= 55 ? "#3fb950" : "#f85149")}
          {statBox("RUN LINE", acc.rlAcc, acc.rlAcc >= 52 ? "#3fb950" : "#f85149")}
          {statBox("O/U", acc.ouAcc, acc.ouAcc >= 50 ? "#3fb950" : "#f85149")}
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          {["HIGH", "MEDIUM", "LOW"].map(tier => (
            <div key={tier} style={{ textAlign: "center" }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: tierColor(acc.tiers[tier]) }}>
                {acc.tiers[tier].total ? `${Math.round(acc.tiers[tier].correct / acc.tiers[tier].total * 100)}%` : "—"}
              </div>
              <div style={{ fontSize: 9, color: "#8b949e", letterSpacing: 1 }}>{tier}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// CALENDAR TAB
// ═══════════════════════════════════════════════════════════════
function CalendarTab() {
  const todayStr = new Date().toISOString().split("T")[0];
  const [dateStr, setDateStr] = useState(todayStr);
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const loadGames = useCallback(async (d) => {
    setLoading(true);
    setGames([]);
    const raw = await fetchScheduleForDate(d);
    setGames(raw.map(g => ({ ...g, pred: null, loading: true })));

    // Enrich each game
    const enriched = await Promise.all(raw.map(async (g) => {
      const homeStatId = resolveStatTeamId(g.homeTeamId, g.homeAbbr);
      const awayStatId = resolveStatTeamId(g.awayTeamId, g.awayAbbr);
      const [homeHit, awayHit, homePitch, awayPitch, homeStarter, awayStarter, homeForm, awayForm] =
        await Promise.all([
          fetchTeamHitting(homeStatId),
          fetchTeamHitting(awayStatId),
          fetchTeamPitching(homeStatId),
          fetchTeamPitching(awayStatId),
          fetchStarterStats(g.homeStarterId),
          fetchStarterStats(g.awayStarterId),
          fetchRecentForm(homeStatId),
          fetchRecentForm(awayStatId),
        ]);
      const homeGamesPlayed = homeForm?.gamesPlayed || 0;
      const awayGamesPlayed = awayForm?.gamesPlayed || 0;
      const [homeBullpen, awayBullpen] = await Promise.all([
        fetchBullpenFatigue(g.homeTeamId),
        fetchBullpenFatigue(g.awayTeamId),
      ]);
      const pred = predictGame({
        homeTeamId: g.homeTeamId, awayTeamId: g.awayTeamId,
        homeHit, awayHit, homePitch, awayPitch,
        homeStarterStats: homeStarter, awayStarterStats: awayStarter,
        homeForm, awayForm, homeGamesPlayed, awayGamesPlayed,
        bullpenData: { [g.homeTeamId]: homeBullpen, [g.awayTeamId]: awayBullpen },
      });
      return { ...g, homeHit, awayHit, homePitch, awayPitch, homeStarterStats: homeStarter,
               awayStarterStats: awayStarter, homeForm, awayForm, pred, loading: false };
    }));
    setGames(enriched);
    setLoading(false);
  }, []);

  useEffect(() => { loadGames(dateStr); }, [dateStr]);

  // Predictions auto-save via autoSync on login — no manual save needed

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 16, flexWrap: "wrap" }}>
        <input type="date" value={dateStr} onChange={e => setDateStr(e.target.value)}
          style={{ background: "#21262d", color: "#e6edf3", border: "1px solid #30363d", borderRadius: 8, padding: "6px 12px", fontSize: 14 }} />
        <button onClick={() => loadGames(dateStr)}
          style={{ background: "#238636", color: "#fff", border: "none", borderRadius: 8, padding: "6px 16px", cursor: "pointer", fontSize: 13 }}>
          🔄 Refresh
        </button>

        {loading && <span style={{ color: "#8b949e", fontSize: 13 }}>Loading games...</span>}
      </div>

      {!loading && games.length === 0 && (
        <div style={{ color: "#8b949e", textAlign: "center", marginTop: 40, fontSize: 14 }}>
          No games scheduled for {dateStr}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {games.map((game) => {
          const home = teamById(game.homeTeamId);
          const away = teamById(game.awayTeamId);
          const key = `${away.abbr}@${home.abbr}`;
          const color = game.loading ? "yellow" : getBannerColor(game.pred, game.homeStarter && game.awayStarter);
          const bannerBg = color === "green" ? "linear-gradient(135deg, #0d2818, #162d1a)"
            : color === "yellow" ? "linear-gradient(135deg, #2d2500, #2a2200)"
            : color === "neutral" ? "linear-gradient(135deg, #161b22, #1c2128)"
            : "linear-gradient(135deg, #2d0e0e, #2a1010)";
          const borderColor = color === "green" ? "#2ea043"
            : color === "yellow" ? "#e3b341"
            : color === "neutral" ? "#30363d"
            : "#f85149";
          const isOpen = expanded === game.gamePk;

          return (
            <div key={game.gamePk} style={{ background: bannerBg, border: `1px solid ${borderColor}`, borderRadius: 12, overflow: "hidden" }}>
              <div onClick={() => setExpanded(isOpen ? null : game.gamePk)}
                style={{ padding: "16px 20px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
                {/* Teams */}
                <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 22, fontWeight: 800, color: "#e6edf3" }}>{away.abbr}</div>
                    <div style={{ fontSize: 10, color: "#8b949e" }}>AWAY</div>
                    {game.awayStarter && <div style={{ fontSize: 11, color: "#8b949e", marginTop: 2 }}>{game.awayStarter.split(" ").pop()}</div>}
                  </div>
                  <div style={{ fontSize: 18, color: "#8b949e" }}>@</div>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 22, fontWeight: 800, color: "#e6edf3" }}>{home.abbr}</div>
                    <div style={{ fontSize: 10, color: "#8b949e" }}>HOME</div>
                    {game.homeStarter && <div style={{ fontSize: 11, color: "#8b949e", marginTop: 2 }}>{game.homeStarter.split(" ").pop()}</div>}
                  </div>
                </div>

                {/* Prediction stats */}
                {game.loading ? (
                  <div style={{ color: "#8b949e", fontSize: 12 }}>Calculating...</div>
                ) : game.pred ? (
                  <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
                    <StatPill label="MODEL ML" value={game.pred.modelML_home > 0 ? `+${game.pred.modelML_home}` : game.pred.modelML_home} />
                    <StatPill label="RUN LINE" value={`${home.abbr} -1.5`} />
                    <StatPill label="O/U" value={game.pred.ouTotal} />
                    <StatPill label="WIN %" value={`${Math.round(game.pred.homeWinPct * 100)}%`} color={game.pred.homeWinPct >= 0.55 ? "#3fb950" : "#e6edf3"} />
                    <StatPill label="CONF" value={game.pred.confidence}
                      color={game.pred.confidence === "HIGH" ? "#3fb950" : game.pred.confidence === "MEDIUM" ? "#e3b341" : "#8b949e"} />
                  </div>
                ) : (
                  <div style={{ color: "#8b949e", fontSize: 12 }}>⚠ Prediction unavailable</div>
                )}

                {/* Auto-saved indicator */}
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 10, color: "#3fb950" }}>● AUTO</span>
                  <span style={{ color: "#8b949e", fontSize: 16 }}>{isOpen ? "▲" : "▼"}</span>
                </div>
              </div>

              {/* Expanded details */}
              {isOpen && game.pred && (
                <div style={{ borderTop: `1px solid ${borderColor}`, padding: "16px 20px", background: "rgba(0,0,0,0.3)" }}>
                  <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
                    <Detail label="Proj Score" value={`${away.abbr} ${game.pred.awayRuns.toFixed(1)} — ${home.abbr} ${game.pred.homeRuns.toFixed(1)}`} />
                    <Detail label="Home Win %" value={`${(game.pred.homeWinPct * 100).toFixed(1)}%`} />
                    <Detail label="Away Win %" value={`${(game.pred.awayWinPct * 100).toFixed(1)}%`} />
                    <Detail label="Over/Under" value={`${game.pred.ouTotal} total`} />
                    <Detail label="Model ML (H)" value={game.pred.modelML_home > 0 ? `+${game.pred.modelML_home}` : game.pred.modelML_home} />
                    <Detail label="Model ML (A)" value={game.pred.modelML_away > 0 ? `+${game.pred.modelML_away}` : game.pred.modelML_away} />
                    <Detail label="Confidence" value={game.pred.confidence} />
                    <Detail label="Conf Score" value={`${game.pred.confScore}/100`} />
                    <Detail label="Season Data" value={`${Math.round((game.pred.blendWeight || 0) * 100)}% current / ${Math.round((1-(game.pred.blendWeight||0))*100)}% prior`} />
                    <Detail label="Avg GP" value={game.pred.avgGP ? `${Math.round(game.pred.avgGP)} games` : "pre-season"} />
                  </div>
                  {(game.homeStarter || game.awayStarter) && (
                    <div style={{ marginTop: 12, display: "flex", gap: 16 }}>
                      {game.awayStarter && <Detail label={`${away.abbr} SP`} value={game.awayStarter} />}
                      {game.homeStarter && <Detail label={`${home.abbr} SP`} value={game.homeStarter} />}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// HISTORY TAB
// ═══════════════════════════════════════════════════════════════
function HistoryTab({ refreshKey }) {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterDate, setFilterDate] = useState("");


  const load = useCallback(async () => {
    setLoading(true);
    let path = "/mlb_predictions?order=game_date.desc&limit=200";
    if (filterDate) path += `&game_date=eq.${filterDate}`;
    const data = await supabaseQuery(path);
    setRecords(data || []);
    setLoading(false);
  }, [filterDate]);

  // Refresh when sync completes or filter changes
  useEffect(() => { load(); }, [load, refreshKey]);



  const deleteRecord = async (id) => {
    if (!window.confirm("Delete this prediction?")) return;
    await supabaseQuery(`/mlb_predictions?id=eq.${id}`, "DELETE");
    load();
  };

  const grouped = records.reduce((acc, r) => {
    if (!acc[r.game_date]) acc[r.game_date] = [];
    acc[r.game_date].push(r);
    return acc;
  }, {});

  const confColor = (c) => c === "HIGH" ? "#3fb950" : c === "MEDIUM" ? "#e3b341" : "#8b949e";
  const mlSign = (ml) => ml > 0 ? `+${ml}` : ml;

  return (
    <div>
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontSize: 18, color: "#58a6ff" }}>📊 Prediction History</h2>
        <input type="date" value={filterDate} onChange={e => setFilterDate(e.target.value)}
          style={{ background: "#21262d", color: "#e6edf3", border: "1px solid #30363d", borderRadius: 8, padding: "5px 10px", fontSize: 13 }} />
        {filterDate && <button onClick={() => setFilterDate("")}
          style={{ background: "#21262d", color: "#8b949e", border: "1px solid #30363d", borderRadius: 8, padding: "5px 10px", cursor: "pointer", fontSize: 12 }}>
          Clear Filter
        </button>}
        <button onClick={load} style={{ background: "#21262d", color: "#58a6ff", border: "1px solid #30363d", borderRadius: 8, padding: "5px 10px", cursor: "pointer", fontSize: 12 }}>
          🔄 Refresh
        </button>
        <button onClick={async () => {
          // Sync final scores for all pending rows visible in current filter
          const pending = records.filter(r => !r.result_entered);
          if (!pending.length) return alert("No pending games to update");
          const n = await fillFinalScores(pending);
          load();
          if (!n) alert("No finished games matched — check that game_pk values are saved (re-save from Calendar if needed)");
        }} style={{ background: "#21262d", color: "#e3b341", border: "1px solid #30363d", borderRadius: 8, padding: "5px 10px", cursor: "pointer", fontSize: 12 }}>
          ⚡ Sync Results
        </button>
        <button onClick={async () => {
          // Re-run prediction model on all visible rows and overwrite stale model values
          if (!records.length) return alert("No records to refresh");
          const msg = document.createElement("div");
          const n = await refreshPredictions(records, (m) => console.log(m));
          load();
          alert(`Refreshed ${n} prediction(s) with current model`);
        }} style={{ background: "#21262d", color: "#58a6ff", border: "1px solid #30363d", borderRadius: 8, padding: "5px 10px", cursor: "pointer", fontSize: 12 }}>
          🔁 Refresh Predictions
        </button>
      </div>

      {loading && <div style={{ color: "#8b949e", textAlign: "center", marginTop: 40 }}>Loading history...</div>}

      {!loading && records.length === 0 && (
        <div style={{ color: "#8b949e", textAlign: "center", marginTop: 40 }}>
          No predictions saved yet. Use the Calendar tab to generate and save predictions.
        </div>
      )}

      {Object.entries(grouped).map(([date, recs]) => (
        <div key={date} style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#e3b341", marginBottom: 8, borderBottom: "1px solid #30363d", paddingBottom: 6 }}>
            📅 {date}
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ color: "#8b949e", fontSize: 11, letterSpacing: 1 }}>
                  {["MATCHUP", "MODEL ML", "RUN LINE", "O/U", "WIN %", "CONF", "RESULT", "ML✓", "RL✓", "O/U✓", "ACTIONS"].map(h => (
                    <th key={h} style={{ padding: "6px 10px", textAlign: "left", borderBottom: "1px solid #21262d", whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recs.map(r => {
                  const resultBg = r.result_entered
                    ? (r.ml_correct ? "rgba(63,185,80,0.08)" : "rgba(248,81,73,0.08)")
                    : "transparent";
                  return (
                    <tr key={r.id} style={{ borderBottom: "1px solid #161b22", background: resultBg }}>
                      <td style={{ padding: "8px 10px", fontWeight: 600, whiteSpace: "nowrap" }}>
                        {r.away_team} @ {r.home_team}
                      </td>
                      <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>
                        <span style={{ color: "#58a6ff" }}>H: {mlSign(r.model_ml_home)}</span>
                        <span style={{ color: "#8b949e", margin: "0 4px" }}>|</span>
                        <span style={{ color: "#8b949e" }}>A: {mlSign(r.model_ml_away)}</span>
                      </td>
                      <td style={{ padding: "8px 10px", color: "#8b949e", whiteSpace: "nowrap" }}>
                        {r.home_team} {r.run_line_home > 0 ? "+" : ""}{r.run_line_home}
                      </td>
                      <td style={{ padding: "8px 10px", color: "#e3b341" }}>{r.ou_total}</td>
                      <td style={{ padding: "8px 10px", color: "#58a6ff" }}>
                        {r.win_pct_home != null ? `${Math.round(r.win_pct_home * 100)}%` : "—"}
                      </td>
                      <td style={{ padding: "8px 10px" }}>
                        <span style={{ color: confColor(r.confidence), fontWeight: 600, fontSize: 11 }}>{r.confidence}</span>
                      </td>
                      <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>
                        {r.result_entered
                          ? <span style={{ color: "#3fb950", fontWeight: 600 }}>
                              {r.away_team} {r.actual_away_runs} — {r.home_team} {r.actual_home_runs}
                            </span>
                          : <span style={{ color: "#e3b341", fontSize: 11 }}>⏳ Awaiting result</span>
                        }
                      </td>
                      <td style={{ padding: "8px 10px", textAlign: "center" }}>
                        {r.result_entered ? (r.ml_correct ? "✅" : "❌") : "—"}
                      </td>
                      <td style={{ padding: "8px 10px", textAlign: "center" }}>
                        {r.result_entered ? (r.rl_correct === null ? "🔲" : r.rl_correct ? "✅" : "❌") : "—"}
                      </td>
                      <td style={{ padding: "8px 10px", textAlign: "center" }}>
                        {r.result_entered
                          ? <span style={{ color: r.ou_correct === "PUSH" ? "#e3b341" : "#e6edf3", fontSize: 11 }}>{r.ou_correct}</span>
                          : "—"
                        }
                      </td>
                      <td style={{ padding: "8px 10px" }}>
                        <button onClick={() => deleteRecord(r.id)}
                          style={{ background: "transparent", border: "none", color: "#8b949e", cursor: "pointer", fontSize: 13 }}>🗑</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// PARLAY TAB
// ═══════════════════════════════════════════════════════════════
function ParlayTab() {
  const todayStr = new Date().toISOString().split("T")[0];
  const [dateStr, setDateStr] = useState(todayStr);
  const [legCount, setLegCount] = useState(3);
  const [allGames, setAllGames] = useState([]);
  const [loading, setLoading] = useState(false);
  const [parlay, setParlay] = useState(null);
  const [customLegs, setCustomLegs] = useState([]); // manually toggled legs
  const [mode, setMode] = useState("auto"); // "auto" or "custom"
  const [wager, setWager] = useState(100);

  const loadGames = useCallback(async (d) => {
    setLoading(true);
    setParlay(null);
    const raw = await fetchScheduleForDate(d);
    const enriched = await Promise.all(raw.map(async (g) => {
      const homeStatId = resolveStatTeamId(g.homeTeamId, g.homeAbbr);
      const awayStatId = resolveStatTeamId(g.awayTeamId, g.awayAbbr);
      const [homeHit, awayHit, homePitch, awayPitch, homeStarter, awayStarter, homeForm, awayForm] =
        await Promise.all([
          fetchTeamHitting(homeStatId), fetchTeamHitting(awayStatId),
          fetchTeamPitching(homeStatId), fetchTeamPitching(awayStatId),
          fetchStarterStats(g.homeStarterId), fetchStarterStats(g.awayStarterId),
          fetchRecentForm(homeStatId), fetchRecentForm(awayStatId),
        ]);
      const homeGamesPlayed = homeForm?.gamesPlayed || 0;
      const awayGamesPlayed = awayForm?.gamesPlayed || 0;
      const [homeBullpen, awayBullpen] = await Promise.all([
        fetchBullpenFatigue(g.homeTeamId),
        fetchBullpenFatigue(g.awayTeamId),
      ]);
      const pred = predictGame({
        homeTeamId: g.homeTeamId, awayTeamId: g.awayTeamId,
        homeHit, awayHit, homePitch, awayPitch,
        homeStarterStats: homeStarter, awayStarterStats: awayStarter,
        homeForm, awayForm, homeGamesPlayed, awayGamesPlayed,
        bullpenData: { [g.homeTeamId]: homeBullpen, [g.awayTeamId]: awayBullpen },
      });
      return { ...g, pred };
    }));
    const withPreds = enriched.filter(g => g.pred);
    setAllGames(withPreds);
    setLoading(false);
  }, []);

  useEffect(() => { loadGames(dateStr); }, [dateStr]);

  // Build auto parlay from top confidence games
  useEffect(() => {
    if (!allGames.length || mode !== "auto") return;
    buildAutoParlay();
  }, [allGames, legCount, mode]);

  const buildAutoParlay = () => {
    // Score each game: favorite side by highest win prob
    const legs = allGames.map(g => {
      const home = teamById(g.homeTeamId);
      const away = teamById(g.awayTeamId);
      const pickHome = g.pred.homeWinPct >= 0.5;
      return {
        gamePk: g.gamePk,
        label: `${away.abbr} @ ${home.abbr}`,
        pick: pickHome ? home.abbr : away.abbr,
        prob: pickHome ? g.pred.homeWinPct : g.pred.awayWinPct,
        ml: pickHome ? g.pred.modelML_home : g.pred.modelML_away,
        confidence: g.pred.confidence,
        confScore: g.pred.confScore,
      };
    })
    .sort((a, b) => b.prob - a.prob)
    .slice(0, legCount);

    setParlay(legs);
  };

  const toggleCustomLeg = (game, pickHome) => {
    const home = teamById(game.homeTeamId);
    const away = teamById(game.awayTeamId);
    const legId = `${game.gamePk}-${pickHome ? "H" : "A"}`;
    const exists = customLegs.find(l => l.gamePk === game.gamePk);
    if (exists) {
      if ((exists.pick === home.abbr && pickHome) || (exists.pick === away.abbr && !pickHome)) {
        setCustomLegs(customLegs.filter(l => l.gamePk !== game.gamePk));
      } else {
        setCustomLegs(customLegs.map(l => l.gamePk === game.gamePk ? {
          ...l,
          pick: pickHome ? home.abbr : away.abbr,
          prob: pickHome ? game.pred.homeWinPct : game.pred.awayWinPct,
          ml: pickHome ? game.pred.modelML_home : game.pred.modelML_away,
        } : l));
      }
    } else {
      setCustomLegs([...customLegs, {
        gamePk: game.gamePk,
        label: `${away.abbr} @ ${home.abbr}`,
        pick: pickHome ? home.abbr : away.abbr,
        prob: pickHome ? game.pred.homeWinPct : game.pred.awayWinPct,
        ml: pickHome ? game.pred.modelML_home : game.pred.modelML_away,
        confidence: game.pred.confidence,
        confScore: game.pred.confScore,
      }]);
    }
  };

  const activeLegList = mode === "auto" ? (parlay || []) : customLegs;
  const combinedProb = activeLegList.length ? combinedParlayProbability(activeLegList) : 0;
  const decOdds = activeLegList.length ? combinedParlayOdds(activeLegList) : 1;
  const fairML = activeLegList.length ? decimalToML(decOdds) : null;
  const payout = (wager * decOdds).toFixed(2);
  const ev = activeLegList.length ? ((combinedProb * (decOdds - 1) * wager) - ((1 - combinedProb) * wager)).toFixed(2) : null;

  return (
    <div>
      <h2 style={{ margin: "0 0 16px", fontSize: 18, color: "#58a6ff" }}>🎯 Parlay Builder</h2>

      {/* Controls */}
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
        <input type="date" value={dateStr} onChange={e => setDateStr(e.target.value)}
          style={{ background: "#21262d", color: "#e6edf3", border: "1px solid #30363d", borderRadius: 8, padding: "6px 12px", fontSize: 13 }} />

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ color: "#8b949e", fontSize: 13 }}>Legs:</span>
          {[2, 3, 4, 5, 6, 7, 8].map(n => (
            <button key={n} onClick={() => { setLegCount(n); setMode("auto"); }}
              style={{
                width: 32, height: 32, borderRadius: "50%", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 700,
                background: mode === "auto" && legCount === n ? "#58a6ff" : "#21262d",
                color: mode === "auto" && legCount === n ? "#0d1117" : "#8b949e",
              }}>{n}</button>
          ))}
        </div>

        <button onClick={() => setMode(mode === "auto" ? "custom" : "auto")}
          style={{ background: mode === "custom" ? "#58a6ff" : "#21262d", color: mode === "custom" ? "#0d1117" : "#e6edf3",
            border: "1px solid #30363d", borderRadius: 8, padding: "6px 14px", cursor: "pointer", fontSize: 12 }}>
          {mode === "custom" ? "✏️ Custom Mode" : "⚡ Auto Mode"}
        </button>

        {loading && <span style={{ color: "#8b949e", fontSize: 13 }}>Loading games...</span>}
      </div>

      {/* Parlay Summary Card */}
      {activeLegList.length > 0 && (
        <div style={{ background: "linear-gradient(135deg, #1a2332, #162032)", border: "1px solid #58a6ff", borderRadius: 12, padding: "16px 20px", marginBottom: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#58a6ff", marginBottom: 12, letterSpacing: 1 }}>
            {mode === "auto" ? `⚡ AUTO ${legCount}-LEG PARLAY` : `✏️ CUSTOM ${activeLegList.length}-LEG PARLAY`}
          </div>
          <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 12 }}>
            <StatPill label="COMBINED PROB" value={`${(combinedProb * 100).toFixed(1)}%`} color={combinedProb > 0.15 ? "#3fb950" : "#f85149"} />
            <StatPill label="FAIR ODDS" value={fairML} color="#e3b341" />
            <StatPill label="PAYOUT (${wager})" value={`$${payout}`} color="#3fb950" />
            <StatPill label="MODEL EV" value={`$${ev}`} color={parseFloat(ev) >= 0 ? "#3fb950" : "#f85149"} />
          </div>
          {/* Wager input */}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ color: "#8b949e", fontSize: 12 }}>Wager: $</span>
            <input type="number" value={wager} onChange={e => setWager(Number(e.target.value))}
              style={{ width: 80, background: "#21262d", color: "#e6edf3", border: "1px solid #30363d", borderRadius: 6, padding: "4px 8px", fontSize: 13 }} />
          </div>

          {/* Legs list */}
          <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 6 }}>
            {activeLegList.map((leg, i) => (
              <div key={leg.gamePk} style={{ display: "flex", alignItems: "center", gap: 12, background: "rgba(255,255,255,0.04)", borderRadius: 8, padding: "8px 12px" }}>
                <div style={{ width: 22, height: 22, borderRadius: "50%", background: "#58a6ff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: "#0d1117" }}>{i + 1}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#e6edf3" }}>{leg.label}</div>
                  <div style={{ fontSize: 11, color: "#8b949e" }}>Pick: <span style={{ color: "#3fb950" }}>{leg.pick}</span></div>
                </div>
                <StatPill label="PROB" value={`${(leg.prob * 100).toFixed(1)}%`} />
                <StatPill label="ML" value={leg.ml > 0 ? `+${leg.ml}` : leg.ml} />
                <span style={{ color: leg.confidence === "HIGH" ? "#3fb950" : leg.confidence === "MEDIUM" ? "#e3b341" : "#8b949e", fontSize: 10, fontWeight: 700 }}>{leg.confidence}</span>
                {mode === "custom" && (
                  <button onClick={() => setCustomLegs(customLegs.filter(l => l.gamePk !== leg.gamePk))}
                    style={{ background: "none", border: "none", color: "#f85149", cursor: "pointer", fontSize: 14 }}>✕</button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* All games with pick buttons (custom mode) or ranked list (auto mode) */}
      {!loading && allGames.length > 0 && (
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#8b949e", marginBottom: 8, letterSpacing: 1 }}>
            {mode === "auto" ? "ALL GAMES (sorted by model confidence)" : "SELECT YOUR LEGS"}
          </div>
          {[...allGames]
            .sort((a, b) => Math.max(b.pred.homeWinPct, 1 - b.pred.homeWinPct) - Math.max(a.pred.homeWinPct, 1 - a.pred.homeWinPct))
            .map((g, i) => {
              const home = teamById(g.homeTeamId);
              const away = teamById(g.awayTeamId);
              const favHome = g.pred.homeWinPct >= 0.5;
              const customLeg = customLegs.find(l => l.gamePk === g.gamePk);
              const isAutoSelected = mode === "auto" && parlay && parlay.find(l => l.gamePk === g.gamePk);

              return (
                <div key={g.gamePk} style={{
                  background: isAutoSelected ? "linear-gradient(135deg, #1a2d1a, #162d16)" : "#161b22",
                  border: `1px solid ${isAutoSelected ? "#2ea043" : "#30363d"}`,
                  borderRadius: 10, padding: "12px 16px", marginBottom: 8,
                  display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap"
                }}>
                  <div style={{ width: 24, fontSize: 12, color: "#8b949e", textAlign: "center" }}>
                    {isAutoSelected ? "✅" : `#${i + 1}`}
                  </div>
                  <div style={{ flex: 1, minWidth: 120 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "#e6edf3" }}>{away.abbr} @ {home.abbr}</div>
                    <div style={{ fontSize: 11, color: "#8b949e" }}>
                      Fav: {favHome ? home.abbr : away.abbr} — {(Math.max(g.pred.homeWinPct, g.pred.awayWinPct) * 100).toFixed(1)}%
                    </div>
                  </div>
                  <StatPill label="WIN% H" value={`${(g.pred.homeWinPct * 100).toFixed(0)}%`} />
                  <StatPill label="O/U" value={g.pred.ouTotal} />
                  <span style={{ color: g.pred.confidence === "HIGH" ? "#3fb950" : g.pred.confidence === "MEDIUM" ? "#e3b341" : "#8b949e", fontSize: 10, fontWeight: 700 }}>{g.pred.confidence}</span>
                  {mode === "custom" && (
                    <div style={{ display: "flex", gap: 6 }}>
                      <button
                        onClick={() => toggleCustomLeg(g, true)}
                        style={{
                          background: customLeg?.pick === home.abbr ? "#3fb950" : "#21262d",
                          color: customLeg?.pick === home.abbr ? "#0d1117" : "#e6edf3",
                          border: "1px solid #30363d", borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontSize: 12
                        }}>
                        {home.abbr}
                      </button>
                      <button
                        onClick={() => toggleCustomLeg(g, false)}
                        style={{
                          background: customLeg?.pick === away.abbr ? "#3fb950" : "#21262d",
                          color: customLeg?.pick === away.abbr ? "#0d1117" : "#e6edf3",
                          border: "1px solid #30363d", borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontSize: 12
                        }}>
                        {away.abbr}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
        </div>
      )}

      {!loading && allGames.length === 0 && (
        <div style={{ color: "#8b949e", textAlign: "center", marginTop: 40 }}>No games found for {dateStr}</div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// MATCHUP TAB (simplified standalone version)
// ═══════════════════════════════════════════════════════════════
function MatchupTab() {
  const [homeTeam, setHomeTeam] = useState(TEAMS[19]);
  const [awayTeam, setAwayTeam] = useState(TEAMS[11]);
  const [pred, setPred] = useState(null);
  const [loading, setLoading] = useState(false);

  const runPrediction = async () => {
    setLoading(true);
    const [homeHit, awayHit, homePitch, awayPitch, homeForm, awayForm] = await Promise.all([
      fetchTeamHitting(homeTeam.id), fetchTeamHitting(awayTeam.id),
      fetchTeamPitching(homeTeam.id), fetchTeamPitching(awayTeam.id),
      fetchRecentForm(homeTeam.id), fetchRecentForm(awayTeam.id),
    ]);
    const result = predictGame({ homeTeamId: homeTeam.id, awayTeamId: awayTeam.id, homeHit, awayHit, homePitch, awayPitch, homeForm, awayForm });
    setPred(result);
    setLoading(false);
  };

  return (
    <div>
      <h2 style={{ margin: "0 0 16px", fontSize: 18, color: "#58a6ff" }}>⚾ Matchup Predictor</h2>
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
        <div>
          <div style={{ color: "#8b949e", fontSize: 11, marginBottom: 4 }}>AWAY</div>
          <select value={awayTeam.id} onChange={e => setAwayTeam(TEAMS.find(t => t.id === parseInt(e.target.value)))}
            style={{ background: "#21262d", color: "#e6edf3", border: "1px solid #30363d", borderRadius: 8, padding: "6px 12px", fontSize: 13 }}>
            {TEAMS.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div style={{ color: "#8b949e", fontSize: 18, marginTop: 16 }}>@</div>
        <div>
          <div style={{ color: "#8b949e", fontSize: 11, marginBottom: 4 }}>HOME</div>
          <select value={homeTeam.id} onChange={e => setHomeTeam(TEAMS.find(t => t.id === parseInt(e.target.value)))}
            style={{ background: "#21262d", color: "#21262d", border: "1px solid #30363d", borderRadius: 8, padding: "6px 12px", fontSize: 13, color: "#e6edf3" }}>
            {TEAMS.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <button onClick={runPrediction}
          style={{ marginTop: 16, background: "#238636", color: "#fff", border: "none", borderRadius: 8, padding: "8px 20px", cursor: "pointer", fontSize: 14, fontWeight: 600 }}>
          {loading ? "Computing..." : "⚡ Predict"}
        </button>
      </div>

      {pred && (
        <div style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 12, padding: 20, maxWidth: 560 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#e6edf3", marginBottom: 12 }}>
            {awayTeam.abbr} {pred.awayRuns.toFixed(1)} — {homeTeam.abbr} {pred.homeRuns.toFixed(1)}
          </div>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <Detail label="Home Win %" value={`${(pred.homeWinPct * 100).toFixed(1)}%`} />
            <Detail label="Away Win %" value={`${(pred.awayWinPct * 100).toFixed(1)}%`} />
            <Detail label="O/U Total" value={pred.ouTotal} />
            <Detail label="Model ML (H)" value={pred.modelML_home > 0 ? `+${pred.modelML_home}` : pred.modelML_home} />
            <Detail label="Run Line" value={`${homeTeam.abbr} -1.5`} />
            <Detail label="Confidence" value={pred.confidence} />
            <Detail label="Conf Score" value={`${pred.confScore}/100`} />
          </div>
        </div>
      )}
    </div>
  );
}

// ── SHARED UI COMPONENTS ──────────────────────────────────────
function StatPill({ label, value, color }) {
  return (
    <div style={{ textAlign: "center", minWidth: 48 }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: color || "#e6edf3" }}>{value}</div>
      <div style={{ fontSize: 9, color: "#8b949e", letterSpacing: 1.5 }}>{label}</div>
    </div>
  );
}

function Detail({ label, value }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: "#8b949e", letterSpacing: 1, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 600, color: "#e6edf3" }}>{value}</div>
    </div>
  );
}