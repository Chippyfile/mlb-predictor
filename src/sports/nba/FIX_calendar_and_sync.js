// ══════════════════════════════════════════════════════════════
// FIX 1: NBACalendarTab.jsx — away_travel_dist always zero
//
// Line 224 currently sends:
//   away_travel_dist: 0,
//
// This means the ML API prediction ignores travel distance.
// The heuristic correctly computes it, but the ML API call doesn't get it.
//
// REPLACE line 224 with:
// ══════════════════════════════════════════════════════════════

// In the mlPredict("nba", { ... }) call around line 198-225:
// CHANGE:
//   away_travel_dist: 0,
// TO:
//   away_travel_dist: (awayPrevCityAbbr && g.homeAbbr)
//     ? Math.round(haversineDistance(awayPrevCityAbbr, g.homeAbbr))
//     : 0,

// NOTE: haversineDistance is already imported from nbaUtils.js at top of file.
// You also need to import it — add to the import at line 14:
//   import { ..., haversineDistance } from "./nbaUtils.js";


// ══════════════════════════════════════════════════════════════
// FIX 2: nbaSync.js — add missing columns for ML training
//
// The backfill heuristic (_nba_backfill_heuristic in nba.py) tries to read
// these columns but they're never persisted by nbaSync.js.
// This means current-season games have NULLs where the model expects data.
//
// In the nbaSync.js rows object (around line 161), ADD after away_travel_dist:
// ══════════════════════════════════════════════════════════════

/*
// ADD these to the row object in nbaSync.js nbaAutoSync():
home_fga: hs.fga, away_fga: as_.fga,
home_fta: hs.fta, away_fta: as_.fta,
home_three_att: hs.threeAtt, away_three_att: as_.threeAtt,
home_fouls_per_game: hs.foulsPerGame, away_fouls_per_game: as_.foulsPerGame,
home_three_att_rate: hs.threeAttRate, away_three_att_rate: as_.threeAttRate,
home_off_reb: hs.offReb, away_off_reb: as_.offReb,
home_def_reb: hs.defReb, away_def_reb: as_.defReb,

// These fields already exist on the team stats object from fetchNBATeamStats()
// (lines 218-226 and 296-306 of nbaUtils.js).
// They just weren't being saved to Supabase.
*/


// ══════════════════════════════════════════════════════════════
// FIX 3: NBACalendarTab.jsx — import haversineDistance
//
// Line 14 currently imports from nbaUtils.js.
// ADD haversineDistance to the import list:
// ══════════════════════════════════════════════════════════════

// BEFORE:
// import {
//   fetchNBAGamesForDate,
//   fetchNBATeamStats,
//   nbaPredictGame,
//   matchNBAOddsToGame,
//   NBA_TEAM_COLORS,
//   computeLeagueAverages,
// } from "./nbaUtils.js";

// AFTER:
// import {
//   fetchNBAGamesForDate,
//   fetchNBATeamStats,
//   nbaPredictGame,
//   matchNBAOddsToGame,
//   NBA_TEAM_COLORS,
//   computeLeagueAverages,
//   haversineDistance,        // ← ADD THIS
// } from "./nbaUtils.js";
