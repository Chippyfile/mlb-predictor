// src/components/DailyBets.jsx — Daily Bets page with self-contained sync
import React, { useState, useMemo, useCallback, useEffect } from "react";
import { C } from "./Shared.jsx";
// Supabase is the sole source of truth — no frontend recomputation
import { supabaseQuery } from "../utils/supabase.js";

const PARLAY_BET = 100, MIN_LEGS = 2, MAX_LEGS = 3, MIN_BET_UNITS = 1;
const ATS_PARLAY_PAY = 1.909; // -110 per leg
const getToday = () => { const d = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" })); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };

function getStrategyMode() { return "active"; }
const STRAT = {
  active: { label: "🎯 BEST PICKS PARLAY — $100", color: "#2ea043", sub: "Top 2-3 picks by confidence across ML, ATS, O/U. 1+ anchor at 75%+. No duplicate games." },
};

function spreadToML(sp) {
  const s = Math.abs(sp); if (s < 0.5) return -110;
  for (const [l,f] of [[1,-120],[2,-140],[3,-160],[4,-185],[5,-210],[6,-245],[7,-280],[8,-320],[9,-370],[10,-420],[12,-550],[14,-700],[16,-900],[18,-1200],[20,-1500]])
    if (s <= l) return sp < 0 ? f : -f;
  return sp < 0 ? -2000 : 2000;
}
function mlDec(ml) { return ml > 0 ? ml/100+1 : 100/Math.abs(ml)+1; }
function parlayOdds(picks) { return picks.reduce((a,p) => a * mlDec(p.ml), 1); }

// ── Supabase fetchers — only today's games ──
async function fetchSport(table, date) {
  try {
    const rows = await supabaseQuery(`/${table}?game_date=eq.${date}&select=*`);
    return rows || [];
  } catch(e) { console.error(`[DailyBets] ${table}:`, e); return []; }
}

function mapNCAA(rows) { return rows.filter(r => r.win_pct_home != null).map(r => {
  const predH = parseFloat(r.pred_home_score) || 0, predA = parseFloat(r.pred_away_score) || 0;
  let margin = predH - predA;
  // If pred scores are null, use stored spread_home from Supabase (single source of truth)
  // Previously used inverse sigmoid with wrong σ=10 (should be 6.5) — eliminated entirely
  if (margin === 0 && r.spread_home != null) {
    margin = parseFloat(r.spread_home) || 0;
  }
  return {
    gameId: r.game_id, homeTeam: r.home_team || r.home_team_name, awayTeam: r.away_team || r.away_team_name,
    neutralSite: !!r.neutral_site,
    pred: { projectedSpread: -margin, homeWinPct: parseFloat(r.win_pct_home) || 0.5, mlMargin: -margin,
            _ouPick: r.ou_pick, _ouEdge: r.ou_edge, _ouPredictedTotal: parseFloat(r.ou_predicted_total || r.ou_total) || null },
    odds: { homeSpread: parseFloat(r.market_spread_home || r.espn_spread) || null,
            homeML: r.closing_home_ml || r.model_ml_home, awayML: r.closing_away_ml || r.model_ml_away,
            ouLine: parseFloat(r.market_ou_total || r.closing_ou_total) || null },
    _ats: r.ats_units > 0 ? { side: r.ats_side, units: r.ats_units, disagree: r.ats_disagree, spread: r.ats_pick_spread } : null,
    _atsComputed: r.ats_units != null,  // cron already evaluated — don't recompute
  };
}); }

function mapNBA(rows) { return rows.filter(r => r.pred_home_score != null).map(r => {
  const margin = (parseFloat(r.pred_home_score)||0) - (parseFloat(r.pred_away_score)||0);
  return {
    gameId: r.game_id, homeTeam: r.home_team || r.home_team_name, awayTeam: r.away_team || r.away_team_name,
    pred: { projectedSpread: -margin, homeWinPct: parseFloat(r.win_pct_home || r.ml_win_prob_home) || 0.5,
            _ouPick: r.ou_pick || null, _ouEdge: r.ou_edge || null, _ouTier: r.ou_tier || 0,
            _ouPredictedTotal: parseFloat(r.ou_total) || null },
    odds: { homeSpread: parseFloat(r.market_spread_home) || null,
            homeML: r.market_home_ml || r.opening_home_ml || r.model_ml_home,
            awayML: r.market_away_ml || r.opening_away_ml || r.model_ml_away,
            ouLine: parseFloat(r.market_ou_total) || null },
    _ats: r.ats_units > 0 ? { side: r.ats_side, units: r.ats_units, disagree: r.ats_disagree, spread: r.ats_pick_spread } : null,
    _atsComputed: r.ats_units != null,
    _modelsAgree: r.ats_models_agree,
  };
}); }

// MLB abbreviation → display name (Supabase only stores abbreviations)
const MLB_NAMES = {
  ARI:"D-backs",ATL:"Braves",BAL:"Orioles",BOS:"Red Sox",CHC:"Cubs",CWS:"White Sox",CIN:"Reds",CLE:"Guardians",
  COL:"Rockies",DET:"Tigers",HOU:"Astros",KC:"Royals",LAA:"Angels",LAD:"Dodgers",MIA:"Marlins",MIL:"Brewers",
  MIN:"Twins",NYM:"Mets",NYY:"Yankees",OAK:"Athletics",PHI:"Phillies",PIT:"Pirates",SD:"Padres",SF:"Giants",
  SEA:"Mariners",STL:"Cardinals",TB:"Rays",TEX:"Rangers",TOR:"Blue Jays",WSH:"Nationals",
};
const mlbName = (abbr) => MLB_NAMES[abbr] || abbr || "TBD";

function mapMLB(rows) { return rows.filter(r => r.pred_home_runs != null || r.spread_home != null).map(r => {
  const hr = parseFloat(r.pred_home_runs) || 0, ar = parseFloat(r.pred_away_runs) || 0;
  return {
    gameId: r.game_pk, homeTeam: mlbName(r.home_team), awayTeam: mlbName(r.away_team),
    pred: { projectedSpread: -(hr - ar), homeWinPct: parseFloat(r.win_pct_home || r.ml_win_prob_home) || 0.5,
            homeRuns: hr, awayRuns: ar,
            _ouPick: r.ou_pick || null, _ouEdge: r.ou_edge || null,
            _ouTier: r.ou_tier || 0,
            _ouPredictedTotal: parseFloat(r.pred_total || r.ou_total || r.ml_ou_pred_total) || null },
    odds: { homeSpread: parseFloat(r.market_spread_home) || parseFloat(r.run_line_home) || -1.5,
            homeML: r.market_home_ml || r.opening_home_ml || r.model_ml_home,
            awayML: r.market_away_ml || r.opening_away_ml || r.model_ml_away,
            ouLine: parseFloat(r.market_ou_total) || null },
    _ats: r.ats_units > 0 ? { side: r.ats_side, units: r.ats_units, disagree: r.ats_disagree, spread: r.market_spread_home } : null,
    _atsComputed: r.ats_units != null,
    _mlBet: r.ml_bet_units > 0 ? { side: r.ml_bet_side, units: r.ml_bet_units } : null,
    _modelsAgree: r.ats_models_agree,
  };
}); }

// ── Colors ──
function unitColor(u) { return u >= 3 ? "#2ea043" : u >= 2 ? "#58a6ff" : "#6e7681"; }
function confColor(c) { return c >= 80 ? "#2ea043" : c >= 70 ? "#58a6ff" : c >= 60 ? "#d29922" : "#8b949e"; }

export default function DailyBets({ setNcaaGames, setNbaGames, setMlbGames, refreshKey }) {
  const today = getToday(), mode = getStrategyMode(), strat = STRAT[mode];
  const [games, setGames] = useState({ ncaa: [], nba: [], mlb: [] });
  const [syncing, setSyncing] = useState({});
  const [lastSync, setLastSync] = useState(null);
  const [parlayHistory, setParlayHistory] = useState([]);
  const [todaySavedId, setTodaySavedId] = useState(null); // Supabase row id if saved
  const [todayLocked, setTodayLocked] = useState(false);   // true once any game starts
  const [grading, setGrading] = useState(false);

  const syncSport = useCallback(async (sport) => {
    setSyncing(s => ({ ...s, [sport]: true }));
    const table = { ncaa: "ncaa_predictions", nba: "nba_predictions", mlb: "mlb_predictions" }[sport];
    const mapper = { ncaa: mapNCAA, nba: mapNBA, mlb: mapMLB }[sport];
    const rows = await fetchSport(table, today);
    const mapped = mapper(rows);
    setGames(g => ({ ...g, [sport]: mapped }));
    // Also push up to App state if setters provided
    const setter = { ncaa: setNcaaGames, nba: setNbaGames, mlb: setMlbGames }[sport];
    if (setter && mapped.length) setter(mapped);
    setSyncing(s => ({ ...s, [sport]: false }));
  }, [today, setNcaaGames, setNbaGames, setMlbGames]);

  const syncAll = useCallback(async () => {
    await Promise.all(["ncaa","nba","mlb"].map(s => syncSport(s)));
    setLastSync(new Date().toLocaleTimeString());
  }, [syncSport]);

  useEffect(() => { syncAll(); }, []);
  // Re-fetch from Supabase when CalendarTab refreshes a game (bumps refreshKey)
  useEffect(() => { if (refreshKey) syncAll(); }, [refreshKey]);

  // ── Parlay History: load from Supabase ──
  const loadHistory = useCallback(async () => {
    try {
      const rows = await supabaseQuery("/parlay_bets?order=bet_date.desc&limit=60");
      setParlayHistory(rows || []);
      const todayRow = (rows || []).find(r => r.bet_date === today);
      setTodaySavedId(todayRow?.id || null);
      // Auto-lock: check if any of today's games have started (result_entered in any prediction table)
      if (todayRow && todayRow.result === "PENDING") {
        const legs = todayRow.legs || [];
        let anyStarted = false;
        for (const leg of legs.slice(0, 2)) { // check first 2 legs (earliest games)
          if (!leg.gameId) continue;
          for (const table of ["mlb_predictions", "ncaa_predictions", "nba_predictions"]) {
            try {
              const key = table === "mlb_predictions" ? "game_pk" : "game_id";
              const res = await supabaseQuery(`/${table}?${key}=eq.${leg.gameId}&select=result_entered&limit=1`);
              if (res?.[0]?.result_entered) { anyStarted = true; break; }
            } catch { /* continue */ }
          }
          if (anyStarted) break;
        }
        setTodayLocked(anyStarted);
      } else if (todayRow && todayRow.result !== "PENDING") {
        setTodayLocked(true); // already graded
      } else {
        setTodayLocked(false);
      }
    } catch(e) { console.error("[DailyBets] parlay history:", e); }
  }, [today]);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  const [saving, setSaving] = useState(false);

  // ── Save/update today's picks (allowed until first game starts) ──
  const saveParlay = useCallback(async (picks, allSports) => {
    if (todayLocked || saving) return;
    setSaving(true);
    const odds = picks.length ? Math.pow(ATS_PARLAY_PAY, picks.length) : 0;
    // Collect all ATS and O/U signals across sports
    const allAts = [], allOu = [];
    for (const sp of (allSports || [])) {
      for (const a of (sp.ats || [])) allAts.push({ ...a, sport: sp.key });
      for (const o of (sp.ou || []))  allOu.push({ ...o, sport: sp.key });
    }
    const data = {
      bet_date: today,
      legs: picks.map(p => ({ team: p.team, spread: p.spread, side: p.side, units: p.units, edge: p.edge, sport: p.sport, sportKey: p.sportKey, gameId: p.gameId, ml: -110 })),
      num_legs: picks.length,
      combined_odds: picks.length ? parseFloat(odds.toFixed(4)) : 0,
      bet_amount: picks.length >= MIN_LEGS ? PARLAY_BET : 0,
      potential_payout: picks.length >= MIN_LEGS ? parseFloat((PARLAY_BET * odds).toFixed(2)) : 0,
      result: "PENDING",
      ml_cap: 0,
      conf_gate: 0,
      ats_picks: allAts,
      ou_picks: allOu,
    };
    try {
      if (todaySavedId) {
        await supabaseQuery(`/parlay_bets?id=eq.${todaySavedId}`, "PATCH", data);
      } else {
        data.legs_won = 0;
        data.actual_payout = 0;
        data.ats_record = {};
        data.ou_record = {};
        await supabaseQuery("/parlay_bets", "POST", data);
      }
      await loadHistory();
    } catch(e) { console.error("[DailyBets] save:", e); }
    setSaving(false);
  }, [today, todayLocked, todaySavedId, loadHistory, saving]);

  // ── Grade pending parlays ──
  const gradeParlays = useCallback(async () => {
    setGrading(true);
    try {
      // Grade pending + re-grade already-graded that are missing per-leg results
      const needsGrading = parlayHistory.filter(p => 
        p.result === "PENDING" || 
        (p.legs || []).some(l => l.correct === undefined || l.correct === null) ||
        (p.ats_picks || []).some(a => a.correct === undefined || a.correct === null) ||
        (p.ou_picks || []).some(o => o.correct === undefined || o.correct === null)
      );
      for (const bet of needsGrading) {
        const legs = bet.legs || [];
        const ats = bet.ats_picks || [];
        const ou = bet.ou_picks || [];
        let won = 0, decided = 0, anyLoss = false;
        const updatedLegs = [...legs];

        // Grade parlay legs
        for (let li = 0; li < updatedLegs.length; li++) {
          const leg = updatedLegs[li];
          const gid = leg.gameId;
          if (!gid) continue;
          let row = null;
          // MLB uses game_pk, NBA/NCAA use game_id
          const sportKey = (leg.sportKey || (leg.sport === "⚾" ? "mlb" : "")).toLowerCase();
          if (sportKey === "mlb") {
            try {
              const res = await supabaseQuery(`/mlb_predictions?game_pk=eq.${gid}&select=ats_correct,result_entered&limit=1`);
              if (res?.length) row = { ...res[0], _atsCorrect: res[0].ats_correct };
            } catch {}
          } else {
            for (const table of ["ncaa_predictions", "nba_predictions"]) {
              try {
                const res = await supabaseQuery(`/${table}?game_id=eq.${gid}&select=ats_correct,result_entered&limit=1`);
                if (res?.length) { row = { ...res[0], _atsCorrect: res[0].ats_correct }; break; }
              } catch {}
            }
          }
          if (row?.result_entered) {
            decided++;
            const correct = !!row._atsCorrect;
            updatedLegs[li] = { ...leg, correct };
            if (correct) won++;
            else anyLoss = true;
          }
        }

        // Grade ATS picks
        // Helper: find prediction by team name when gameId is missing
        const betDate = bet.bet_date;
        const _teamMatchCache = {};
        const _MLB_NAME_TO_ABBR = {
          "angels":"LAA","diamondbacks":"ARI","d-backs":"ARI","orioles":"BAL","red sox":"BOS",
          "cubs":"CHC","reds":"CIN","guardians":"CLE","indians":"CLE","rockies":"COL",
          "tigers":"DET","astros":"HOU","royals":"KC","dodgers":"LAD","nationals":"WSH",
          "mets":"NYM","athletics":"OAK","pirates":"PIT","padres":"SD","mariners":"SEA",
          "giants":"SF","cardinals":"STL","rays":"TB","rangers":"TEX","blue jays":"TOR",
          "twins":"MIN","phillies":"PHI","braves":"ATL","white sox":"CWS","marlins":"MIA",
          "yankees":"NYY","brewers":"MIL",
        };
        function mlbNameToAbbr(name) {
          const n = (name || "").toLowerCase();
          return _MLB_NAME_TO_ABBR[n] || Object.entries(_MLB_NAME_TO_ABBR).find(([k]) => n.includes(k) || k.includes(n))?.[1] || n;
        }
        async function findByTeamName(teamName, sport) {
          const cacheKey = `${sport}|${teamName}`;
          if (cacheKey in _teamMatchCache) return _teamMatchCache[cacheKey];
          const tn = (teamName || "").toLowerCase();
          let row = null;
          if (sport === "mlb") {
            const abbr = mlbNameToAbbr(tn).toUpperCase();
            try {
              const all = await supabaseQuery(`/mlb_predictions?game_date=eq.${betDate}&result_entered=eq.true&select=game_pk,home_team,away_team,ats_correct,ou_correct`);
              for (const r of (all || [])) {
                const h = (r.home_team||"").toUpperCase(), a = (r.away_team||"").toUpperCase();
                if (h === abbr || a === abbr) { row = r; break; }
              }
            } catch {}
          } else {
            for (const table of ["nba_predictions", "ncaa_predictions"]) {
              try {
                const all = await supabaseQuery(`/${table}?game_date=eq.${betDate}&result_entered=eq.true&select=game_id,home_team,away_team,ats_correct,ou_correct`);
                for (const r of (all || [])) {
                  if ((r.home_team||"").toLowerCase().includes(tn) || (r.away_team||"").toLowerCase().includes(tn) || tn.includes((r.home_team||"").toLowerCase()) || tn.includes((r.away_team||"").toLowerCase())) {
                    row = r; break;
                  }
                }
                if (row) break;
              } catch {}
            }
          }
          _teamMatchCache[cacheKey] = row;
          return row;
        }

        let atsW = 0, atsL = 0;
        const updatedAts = [...ats];
        for (let ai = 0; ai < updatedAts.length; ai++) {
          const pick = updatedAts[ai];
          const gid = pick.gameId;
          let row = null;
          const sportKey = (pick.sportKey || (pick.sport === "⚾" ? "mlb" : (pick.sport === "mlb" ? "mlb" : ""))).toLowerCase();

          if (gid) {
            // Direct lookup by gameId
            if (sportKey === "mlb") {
              try {
                const res = await supabaseQuery(`/mlb_predictions?game_pk=eq.${gid}&select=ats_correct,result_entered&limit=1`);
                if (res?.length) row = { ...res[0], _atsCorrect: res[0].ats_correct };
              } catch {}
            } else {
              for (const table of ["ncaa_predictions", "nba_predictions"]) {
                try {
                  const res = await supabaseQuery(`/${table}?game_id=eq.${gid}&select=ats_correct,result_entered&limit=1`);
                  if (res?.length) { row = { ...res[0], _atsCorrect: res[0].ats_correct }; break; }
                } catch {}
              }
            }
          }

          // Fallback: match by team name + date
          if (!row && pick.team) {
            const fallback = await findByTeamName(pick.team, sportKey || (pick.sport === "nba" ? "nba" : pick.sport === "ncaa" ? "ncaa" : "mlb"));
            if (fallback) {
              row = { result_entered: true, _atsCorrect: fallback.ats_correct };
            }
          }

          if (row?.result_entered) {
            const correct = !!row._atsCorrect;
            updatedAts[ai] = { ...pick, correct };
            if (correct) atsW++; else atsL++;
          }
        }

        // Grade O/U picks
        let ouW = 0, ouL = 0;
        const updatedOu = [...ou];
        for (let oi = 0; oi < updatedOu.length; oi++) {
          const pick = updatedOu[oi];
          const gid = pick.gameId;
          let row = null;
          const sportKey = (pick.sportKey || (pick.sport === "⚾" ? "mlb" : (pick.sport === "mlb" ? "mlb" : ""))).toLowerCase();

          if (gid) {
            if (sportKey === "mlb") {
              try {
                const res = await supabaseQuery(`/mlb_predictions?game_pk=eq.${gid}&select=ou_correct,result_entered&limit=1`);
                if (res?.length) row = res[0];
              } catch {}
            } else {
              for (const table of ["ncaa_predictions", "nba_predictions"]) {
                try {
                  const res = await supabaseQuery(`/${table}?game_id=eq.${gid}&select=ou_correct,result_entered&limit=1`);
                  if (res?.length) { row = res[0]; break; }
                } catch {}
              }
            }
          }

          // Fallback: match by team name + date (team is "Home / Away")
          if (!row && pick.team) {
            const firstTeam = pick.team.split("/")[0].trim().toLowerCase();
            const sp = sportKey || (pick.sport === "nba" ? "nba" : pick.sport === "ncaa" ? "ncaa" : "mlb");
            const fallback = await findByTeamName(firstTeam, sp);
            if (fallback) row = { result_entered: true, ou_correct: fallback.ou_correct };
          }
          if (row?.result_entered && row.ou_correct) {
            const pickSide = pick.side?.toUpperCase();
            const correct = row.ou_correct === pickSide;
            updatedOu[oi] = { ...pick, correct };
            if (correct) ouW++; else ouL++;
          }
        }

        // Save results
        const alreadyGraded = bet.result !== "PENDING";
        const patchData = {
          legs: updatedLegs, ats_picks: updatedAts, ou_picks: updatedOu,
          ats_record: { wins: atsW, losses: atsL },
          ou_record: { wins: ouW, losses: ouL },
        };

        if (!alreadyGraded && decided === legs.length) {
          // All legs decided — set overall parlay result
          const result = anyLoss ? "LOSS" : "WIN";
          patchData.result = result;
          patchData.legs_won = won;
          patchData.actual_payout = result === "WIN" ? bet.potential_payout : 0;
          patchData.graded_at = new Date().toISOString();
        } else if (!alreadyGraded) {
          // Partial — just save legs_won so far
          patchData.legs_won = won;
        }

        // Always save if any leg has been graded
        const anyGraded = updatedLegs.some(l => l.correct !== undefined) ||
                          updatedAts.some(a => a.correct !== undefined) ||
                          updatedOu.some(o => o.correct !== undefined);
        if (anyGraded || decided === legs.length) {
          await supabaseQuery(`/parlay_bets?id=eq.${bet.id}`, "PATCH", patchData);
        }
      }
      await loadHistory();
    } catch(e) { console.error("[DailyBets] grading:", e); }
    setGrading(false);
  }, [parlayHistory, loadHistory]);

  // ── Best Picks Parlay — rank ALL bet types by confidence ──
  const { parlayPicks, mlDogPicks, mlSignals } = useMemo(() => {
    const allPicks = [];
    const dogs = [];
    const mlSignals = [];

    // Confidence thresholds for parlay inclusion
    const ANCHOR_CONF = 0.75;  // Must have 1+ pick at this level
    const MIN_CONF = 0.65;     // Minimum for any leg

    for (const [sport, icon, list] of [["mlb", "⚾", games.mlb], ["nba", "🏀", games.nba], ["ncaa", "🏀", games.ncaa]]) {
      for (const g of (list || [])) {
        const h = g.homeTeam || "Home", a = g.awayTeam || "Away";
        const wp = parseFloat(g.pred?.homeWinPct) || 0.5;
        const bestConf = Math.max(wp, 1 - wp);
        const pickHome = wp >= 0.5;
        const mlTeam = pickHome ? h : a;
        const pickedML = pickHome ? (g.odds?.homeML || null) : (g.odds?.awayML || null);
        const mlVal = pickedML ? parseInt(pickedML) : null;
        const isDog = mlVal && mlVal > 0;
        const modelsAgree = g._modelsAgree;
        const matchup = `${a} @ ${h}`;

        // ── ML Signal detection (any 65%+) ──
        if (mlVal && bestConf >= 0.65) {
          const tier = bestConf >= 0.75 ? "⭐⭐⭐" : bestConf >= 0.70 ? "⭐⭐" : "⭐";
          mlSignals.push({
            team: mlTeam, ml: mlVal, conf: (bestConf * 100).toFixed(0),
            payout: mlDec(mlVal), isDog,
            sport: icon, sportKey: sport, gameId: g.gameId, matchup, tier,
          });
        }

        // ── ML parlay candidate ──
        if (modelsAgree && bestConf >= MIN_CONF && mlVal) {
          allPicks.push({
            type: "ML", team: mlTeam, conf: bestConf,
            confLabel: (bestConf * 100).toFixed(0) + "%",
            betLabel: `${mlTeam} ML`,
            odds: mlVal, payout: mlDec(mlVal),
            sport: icon, sportKey: sport, gameId: g.gameId, matchup,
          });
        }

        // ── ATS parlay candidate ──
        if (g._ats && g._ats.units >= 1) {
          const atsSide = g._ats.side;
          const atsTeam = atsSide === "HOME" ? h : a;
          const atsConf = g._ats.units >= 2 ? 0.80 : 0.75;
          const rawSp = g.odds?.homeSpread ?? g._ats.spread ?? null;
          const sp = rawSp != null ? (atsSide === "HOME" ? parseFloat(rawSp) : -parseFloat(rawSp)) : null;
          const spLabel = sp != null ? (sp > 0 ? `+${sp.toFixed(1)}` : sp.toFixed(1)) : "";

          allPicks.push({
            type: "ATS", team: atsTeam, conf: atsConf,
            confLabel: `${(atsConf * 100).toFixed(0)}%`,
            betLabel: `${atsTeam} ${spLabel}`,
            odds: -110, payout: 1.909,
            sport: icon, sportKey: sport, gameId: g.gameId, matchup,
            units: g._ats.units,
          });
        }

        // ── O/U parlay candidate ──
        const ouPick = g.pred?._ouPick;
        const ouTier = g.pred?._ouTier || 0;
        if (ouPick && ouTier >= 2) {
          const ouLine = g.odds?.ouLine || g.pred?._ouPredictedTotal;
          const ouConf = ouTier >= 3 ? 0.70 : 0.62;

          allPicks.push({
            type: "O/U", team: ouPick, conf: ouConf,
            confLabel: `${(ouConf * 100).toFixed(0)}%`,
            betLabel: `${ouPick} ${ouLine || ""}`,
            odds: -110, payout: 1.909,
            sport: icon, sportKey: sport, gameId: g.gameId, matchup,
            units: ouTier,
          });
        }

        // ── Dog bonus ──
        const edge = parseFloat(g._ats?.disagree || 0);
        if (isDog && bestConf >= 0.65 && edge >= 2.5) {
          dogs.push({
            team: mlTeam, ml: mlVal, edge, units: g._ats?.units || 1,
            side: pickHome ? "HOME" : "AWAY",
            sport: icon, sportKey: sport, gameId: g.gameId, matchup,
            payout: mlDec(mlVal), conf: (bestConf * 100).toFixed(0),
            tier: bestConf >= 0.70 ? "⭐⭐⭐ 73%" : "⭐⭐ 67%",
          });
        }
      }
    }

    // Sort all picks by confidence (highest first)
    allPicks.sort((a, b) => b.conf - a.conf);

    // Build parlay: need 1+ anchor (>= 75%), fill with best remaining, no duplicate games
    const anchors = allPicks.filter(p => p.conf >= ANCHOR_CONF);
    let parlayLegs = [];

    if (anchors.length >= 1) {
      parlayLegs = [anchors[0]];
      const usedGames = new Set([anchors[0].gameId]);

      for (const p of allPicks) {
        if (parlayLegs.length >= MAX_LEGS) break;
        if (usedGames.has(p.gameId)) continue;
        if (p.conf < MIN_CONF) continue;
        parlayLegs.push(p);
        usedGames.add(p.gameId);
      }
    }

    return {
      parlayPicks: parlayLegs,
      mlDogPicks: dogs,
      mlSignals: mlSignals.sort((a, b) => parseFloat(b.conf) - parseFloat(a.conf)),
    };
  }, [games.ncaa, games.nba, games.mlb]);

  const parlayActive = parlayPicks.length >= MIN_LEGS;
  const parlayPayout = parlayPicks.reduce((acc, p) => acc * p.payout, 1);

  // ── Sport picks ──
  function buildPicks(gameList, sport) {
    const ats = [], ou = [], ml = [];
    for (const g of gameList) {
      if (!g.pred) continue;
      const h = g.homeTeam || "Home", a = g.awayTeam || "Away";

      // Use pre-computed ATS from cron (Supabase is sole source of truth)
      if (g._ats && g._ats.units) {
        const side = g._ats.side;
        const team = side === "HOME" ? h : a;
        // Spread from the bet team's perspective — prefer CURRENT market over stored pick spread
        const rawSp = g.odds?.homeSpread ?? g._ats.spread ?? null;
        const sp = rawSp != null ? (side === "HOME" ? parseFloat(rawSp) : -parseFloat(rawSp)) : null;
        ats.push({ team, spread: sp, units: g._ats.units, edge: parseFloat(g._ats.disagree || 0), side, gameId: g.gameId });
      }

      // O/U from cron (Supabase is sole source of truth)
      if (g.pred._ouPick) {
        const side = g.pred._ouPick;
        const edge = Math.abs(parseFloat(g.pred._ouEdge) || 0);
        const units = g.pred._ouTier || 1;
        const predTotal = parseFloat(g.pred._ouPredictedTotal) || 0;
        if (!ou.find(o => o.team === `${h} / ${a}`)) {
          ou.push({ team: `${h} / ${a}`, side, edge, units, modelTotal: predTotal, gameId: g.gameId });
        }
      }

      // ML bets from cron (margin + ATS agreement — 80-81% walk-forward)
      if (g._mlBet && g._mlBet.units > 0) {
        const side = g._mlBet.side;
        const team = side === "HOME" ? h : a;
        const opp = side === "HOME" ? a : h;
        const mlOdds = side === "HOME" ? (g.odds?.homeML || null) : (g.odds?.awayML || null);
        const margin = Math.abs(parseFloat(g.pred?.projectedSpread) || 0);
        ml.push({ team, opp, units: g._mlBet.units, side, mlOdds, margin, gameId: g.gameId });
      }
    }
    return { 
      ats: ats.filter(p => p.units >= MIN_BET_UNITS), 
      ou: ou.filter(p => p.units >= 1),
      ml: ml,
    };
  }

  const sports = [
    { key: "ncaa", name: "NCAA", icon: "🏀", color: C.orange, ...buildPicks(games.ncaa, "ncaa"), count: games.ncaa.length },
    { key: "nba",  name: "NBA",  icon: "🏀", color: "#58a6ff", ...buildPicks(games.nba, "nba"),   count: games.nba.length },
    { key: "mlb",  name: "MLB",  icon: "⚾", color: C.blue,   ...buildPicks(games.mlb, "mlb"),   count: games.mlb.length },
  ];
  const totalPicks = sports.reduce((s,sp) => s + sp.ats.length + sp.ou.length + sp.ml.length, 0);
  const anySyncing = Object.values(syncing).some(Boolean);

  // ── Render ──
  return (
    <div style={{ maxWidth: 800, margin: "0 auto", padding: "16px 12px" }}>
      {/* Header */}
      <div style={{ textAlign: "center", marginBottom: 16 }}>
        <h1 style={{ fontSize: 28, fontWeight: 900, letterSpacing: -1, color: "#e6edf3", margin: 0 }}>Daily Bets</h1>
        <div style={{ fontSize: 12, color: C.dim, marginTop: 4 }}>{today} · {totalPicks} active signals</div>
      </div>

      {/* Sync bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 20, flexWrap: "wrap", justifyContent: "center" }}>
        <button onClick={syncAll} disabled={anySyncing} style={{
          padding: "6px 18px", borderRadius: 6, border: "1px solid #2ea04377",
          background: anySyncing ? "#0d281822" : "#2ea04322", color: anySyncing ? C.dim : "#2ea043",
          fontSize: 12, fontWeight: 800, cursor: anySyncing ? "wait" : "pointer", letterSpacing: 1,
        }}>{anySyncing ? "⏳ SYNCING..." : "🔄 SYNC ALL"}</button>
        {sports.map(sp => (
          <button key={sp.key} onClick={() => syncSport(sp.key)} disabled={syncing[sp.key]} style={{
            padding: "5px 12px", borderRadius: 6, border: `1px solid ${sp.color}55`,
            background: syncing[sp.key] ? `${sp.color}22` : `${sp.color}11`,
            color: syncing[sp.key] ? C.dim : sp.color, fontSize: 11, fontWeight: 700, cursor: syncing[sp.key] ? "wait" : "pointer",
          }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", display: "inline-block",
              background: sp.count > 0 ? "#2ea043" : "#484f58", marginRight: 4 }} />
            {sp.icon} {sp.name}{sp.count > 0 && ` (${sp.count})`}{syncing[sp.key] && " ⏳"}
          </button>
        ))}
        {lastSync && <span style={{ fontSize: 9, color: "#484f58" }}>Last: {lastSync}</span>}
        <button onClick={syncAll} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14, padding: "2px 6px" }} title="Refresh all">🔄</button>
      </div>

      {/* Strategy card */}
      <div style={{ background: `linear-gradient(135deg, ${strat.color}12, ${strat.color}06)`,
        border: `1px solid ${strat.color}55`, borderRadius: 12, padding: "16px 20px", marginBottom: 20 }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: strat.color, marginBottom: 4 }}>{strat.label}</div>
        <div style={{ fontSize: 11, color: C.dim }}>{strat.sub}</div>
      </div>

      {/* ── BEST PICKS PARLAY ── */}
      {parlayActive && (
        <div style={{ background: "linear-gradient(135deg, #0d1117, #161b22)",
          border: "1px solid #30363d", borderRadius: 10, padding: "14px 18px", marginBottom: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <span style={{ fontSize: 14, fontWeight: 800, color: "#e6edf3" }}>🎯 {parlayPicks.length}-Leg Parlay</span>
            <span style={{ fontSize: 10, fontWeight: 800, color: "#fff", background: "#2ea043",
              borderRadius: 5, padding: "3px 10px", letterSpacing: 1 }}>${PARLAY_BET}</span>
          </div>
          {parlayPicks.map((p, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "8px 0", borderBottom: i === parlayPicks.length-1 ? "none" : "1px solid #21262d" }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#e6edf3", flex: 1 }}>
                {p.sport} {p.betLabel}
              </span>
              <span style={{ fontSize: 9, fontWeight: 700, color: p.type === "ML" ? "#58a6ff" : p.type === "ATS" ? "#d29922" : "#2ea043",
                width: 30, textAlign: "center", background: "#21262d", borderRadius: 3, padding: "1px 4px", marginRight: 6 }}>
                {p.type}
              </span>
              <span style={{ fontSize: 11, color: p.odds > 0 ? "#2ea043" : "#8b949e", width: 50, textAlign: "right" }}>
                {p.odds > 0 ? `+${p.odds}` : p.odds}
              </span>
              <span style={{ fontSize: 10, fontWeight: 900, color: "#fff", width: 40, textAlign: "center",
                background: confColor(parseFloat(p.confLabel)), borderRadius: 4, padding: "1px 4px" }}>
                {p.confLabel}
              </span>
            </div>
          ))}
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 10, color: C.dim }}>
            <span>Odds: {parlayPayout.toFixed(2)}x · {parlayPicks.length} legs</span>
            <span>Potential: ${(PARLAY_BET * parlayPayout).toFixed(0)}</span>
          </div>
          <div style={{ fontSize: 9, color: "#484f58", marginTop: 4 }}>
            Best picks by confidence · 1+ anchor at 75%+ · ML/ATS/O/U mixed
          </div>
          <button onClick={() => saveParlay(parlayPicks, sports)} disabled={todayLocked || saving}
            style={{ marginTop: 10, width: "100%", padding: "10px 0", borderRadius: 8,
              border: todayLocked ? "1px solid #30363d" : "1px solid #2ea043",
              background: todayLocked ? "#161b22" : "linear-gradient(135deg, #2ea04322, #2ea04311)",
              color: todayLocked ? "#484f58" : "#2ea043", fontSize: 13, fontWeight: 800,
              cursor: (todayLocked || saving) ? "default" : "pointer", letterSpacing: 1,
            }}>{todayLocked ? "🔒 LOCKED — games started" : saving ? "⏳ SAVING..." : todaySavedId ? "💾 UPDATE PICKS" : "💾 SAVE TODAY'S PICKS"}</button>
        </div>
      )}

      {/* ── ML SIGNALS (65%+ confidence) ── */}
      {mlSignals.length > 0 && (
        <div style={{ background: "linear-gradient(135deg, #58a6ff11, #58a6ff06)",
          border: "1px solid #58a6ff55", borderRadius: 10, padding: "14px 18px", marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: "#58a6ff", marginBottom: 8, letterSpacing: 1 }}>
            💰 ML SIGNALS — 65%+ Model Confidence
          </div>
          {mlSignals.map((p, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "6px 0", borderBottom: i === mlSignals.length-1 ? "none" : "1px solid #21262d" }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#e6edf3", flex: 1 }}>
                {p.sport} {p.team} ML {p.isDog ? "🐕" : ""}
              </span>
              <span style={{ fontSize: 11, color: "#8b949e", width: 35, textAlign: "right" }}>{p.conf}%</span>
              <span style={{ fontSize: 12, fontWeight: 800, width: 55, textAlign: "right",
                color: p.isDog ? "#2ea043" : "#e6edf3" }}>
                {p.ml > 0 ? `+${p.ml}` : p.ml}
              </span>
              <span style={{ fontSize: 10, width: 50, textAlign: "right", color: "#d29922" }}>{p.tier}</span>
            </div>
          ))}
          <div style={{ fontSize: 9, color: "#484f58", marginTop: 6 }}>
            65-70%: 66% win ⭐ · 70-75%: 74% win ⭐⭐ · 75%+: 75% win ⭐⭐⭐ · 🐕 = dog (+odds)
          </div>
        </div>
      )}

      {/* ── ML DOG BONUS (65%+ conf, edge ≥ 2.5) ── */}
      {mlDogPicks.length > 0 && (
        <div style={{ background: "linear-gradient(135deg, #d2992211, #d2992206)",
          border: "1px solid #d2992255", borderRadius: 10, padding: "14px 18px", marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: "#d29922", marginBottom: 8, letterSpacing: 1 }}>
            🐕 DOG BONUS — High-edge underdog picks
          </div>
          {mlDogPicks.map((p, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "6px 0", borderBottom: i === mlDogPicks.length-1 ? "none" : "1px solid #21262d" }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#e6edf3", flex: 1 }}>
                {p.sport} {p.team} ML
              </span>
              <span style={{ fontSize: 11, color: "#8b949e", width: 35, textAlign: "right" }}>{p.conf}%</span>
              <span style={{ fontSize: 12, color: "#2ea043", fontWeight: 800, width: 50, textAlign: "right" }}>+{p.ml}</span>
              <span style={{ fontSize: 10, color: "#d29922", width: 55, textAlign: "right" }}>{p.tier}</span>
            </div>
          ))}
          <div style={{ fontSize: 9, color: "#484f58", marginTop: 6 }}>
            65-70%: 67% win ⭐⭐ · 70%+: 73% win ⭐⭐⭐ · Edge ≥ 2.5 + agree · +54-68% ROI at +odds
          </div>
        </div>
      )}

      {!parlayActive && (games.ncaa.length + games.nba.length + games.mlb.length) > 0 && (
        <div style={{ fontSize: 12, color: C.dim, fontStyle: "italic", padding: "10px 0", textAlign: "center" }}>
          {parlayPicks.length > 0
            ? `Only ${parlayPicks.length} qualifying pick (need ${MIN_LEGS}) — no parlay today`
            : `No picks at 75%+ confidence — sit today out`}
        </div>
      )}

      {/* ── SPORT SECTIONS ── */}
      {sports.map(sp => {
        const has = sp.ats.length > 0 || sp.ou.length > 0 || sp.ml.length > 0;
        return (
          <div key={sp.key} style={{ marginTop: 28 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, paddingBottom: 8, borderBottom: "1px solid #21262d" }}>
              <span style={{ fontSize: 20 }}>{sp.icon}</span>
              <span style={{ fontSize: 18, fontWeight: 900, color: "#e6edf3", letterSpacing: -0.5 }}>{sp.name}</span>
              <span style={{ fontSize: 11, color: C.dim, marginLeft: "auto" }}>
                {has ? [sp.ats.length > 0 && `${sp.ats.length} ATS`, sp.ou.length > 0 && `${sp.ou.length} O/U`, sp.ml.length > 0 && `${sp.ml.length} ML`].filter(Boolean).join(" · ") : sp.count > 0 ? `${sp.count} games · no signals` : "not synced"}
              </span>
              <button onClick={() => syncSport(sp.key)} disabled={syncing[sp.key]} style={{
                padding: "3px 10px", borderRadius: 6, border: `1px solid ${sp.color}55`,
                background: `${sp.color}11`, color: sp.color, fontSize: 10, fontWeight: 700, cursor: "pointer",
              }}>{syncing[sp.key] ? "⏳" : "🔄"}</button>
            </div>

            {!has && sp.count === 0 && <div style={{ fontSize: 12, color: C.dim, fontStyle: "italic", padding: "10px 0" }}>Tap 🔄 to load</div>}

            {sp.ats.length > 0 && <>
              <div style={{ fontSize: 10, fontWeight: 800, color: "#8b949e", letterSpacing: 2, marginTop: 14, marginBottom: 6 }}>ATS / SPREAD</div>
              {sp.ats.sort((a,b) => b.units - a.units || b.edge - a.edge).map((p,i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px",
                  background: "#161b22", borderRadius: 8, marginBottom: 6, border: "1px solid #30363d", maxWidth: 480 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#c9d1d9", flex: 1 }}>{p.team}</span>
                  <span style={{ fontSize: 12, color: "#8b949e", width: 60, textAlign: "center" }}>
                    {p.spread != null ? (p.spread > 0 ? `+${p.spread.toFixed(1)}` : p.spread.toFixed(1)) : "—"}
                  </span>
                  <span style={{ fontSize: 11, width: 55, textAlign: "right" }}>{p.edge.toFixed(1)} pts</span>
                  <span style={{ fontSize: 10, fontWeight: 900, color: "#fff", background: unitColor(p.units),
                    borderRadius: 4, padding: "2px 8px", minWidth: 30, textAlign: "center" }}>{p.units}u</span>
                </div>
              ))}
            </>}

            {sp.ou.length > 0 && <>
              <div style={{ fontSize: 10, fontWeight: 800, color: C.dim, letterSpacing: 2, marginTop: 14, marginBottom: 6 }}>OVER / UNDER</div>
              {sp.ou.sort((a,b) => b.units - a.units || b.edge - a.edge).map((p,i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px",
                  background: "#0d1117", borderRadius: 8, marginBottom: 6, border: "1px solid #21262d", maxWidth: 480 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#e6edf3", flex: 1 }}>
                    {p.side === "OVER" ? "▲" : "▼"} {p.side} {p.team}
                  </span>
                  <span style={{ fontSize: 12, color: "#8b949e", width: 60, textAlign: "center" }}>{p.modelTotal?.toFixed?.(1) ?? "—"}</span>
                  <span style={{ fontSize: 11, width: 55, textAlign: "right" }}>{p.edge.toFixed(1)} pts</span>
                  <span style={{ fontSize: 10, fontWeight: 900, color: "#fff",
                    background: unitColor(p.units),
                    borderRadius: 4, padding: "2px 8px", minWidth: 30, textAlign: "center" }}>{p.units}u</span>
                </div>
              ))}
            </>}

            {sp.ml.length > 0 && <>
              <div style={{ fontSize: 10, fontWeight: 800, color: "#d29922", letterSpacing: 2, marginTop: 14, marginBottom: 6 }}>MONEYLINE BETS</div>
              {sp.ml.sort((a,b) => b.units - a.units || b.margin - a.margin).map((p,i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px",
                  background: "linear-gradient(135deg, #d2992208, #d2992204)", borderRadius: 8, marginBottom: 6,
                  border: "1px solid #d2992233", maxWidth: 480 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#e6edf3", flex: 1 }}>
                    💰 {p.team} ML
                  </span>
                  <span style={{ fontSize: 12, color: "#8b949e", width: 60, textAlign: "center" }}>
                    {p.mlOdds ? (parseInt(p.mlOdds) > 0 ? `+${p.mlOdds}` : p.mlOdds) : "—"}
                  </span>
                  <span style={{ fontSize: 11, width: 55, textAlign: "right" }}>{p.margin.toFixed(1)} runs</span>
                  <span style={{ fontSize: 10, fontWeight: 900, color: "#fff",
                    background: p.units >= 2 ? "#d29922" : "#8b949e",
                    borderRadius: 4, padding: "2px 8px", minWidth: 30, textAlign: "center" }}>{p.units}u</span>
                </div>
              ))}
              <div style={{ fontSize: 9, color: "#484f58", marginTop: 4 }}>
                2u: 81% win rate (margin+ATS agree) · 1u: 80% win rate · Walk-forward validated
              </div>
            </>}
          </div>
        );
      })}

      {totalPicks === 0 && !anySyncing && sports.every(s => s.count === 0) && (
        <div style={{ textAlign: "center", padding: 40, color: C.dim }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>📊</div>
          <div style={{ fontSize: 14 }}>Hit "Sync All" to load today's picks</div>
        </div>
      )}

      {/* ── DAILY BET HISTORY ── */}
      {parlayHistory.length > 0 && (() => {
        const graded = parlayHistory.filter(p => p.result !== "PENDING");
        const wins = graded.filter(p => p.result === "WIN").length;
        const losses = graded.filter(p => p.result === "LOSS").length;
        const pending = parlayHistory.filter(p => p.result === "PENDING").length;
        const totalWagered = graded.reduce((s, p) => s + (p.bet_amount || 0), 0);
        const totalReturned = graded.reduce((s, p) => s + (p.actual_payout || 0), 0);
        const profit = totalReturned - totalWagered;
        const roi = totalWagered > 0 ? (profit / totalWagered * 100) : 0;
        const winRate = graded.length > 0 ? (wins / graded.length * 100) : 0;
        let streak = 0, streakType = "";
        for (const p of graded) {
          if (!streakType) { streakType = p.result; streak = 1; }
          else if (p.result === streakType) streak++;
          else break;
        }

        return (
          <div style={{ marginTop: 32 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, paddingBottom: 8, borderBottom: "1px solid #21262d" }}>
              <span style={{ fontSize: 18, fontWeight: 900, color: "#e6edf3" }}>📊 Bet Tracker</span>
              <span style={{ fontSize: 11, color: C.dim, marginLeft: "auto" }}>
                {graded.length} graded · {pending} pending
              </span>
              {pending > 0 && (
                <button onClick={gradeParlays} disabled={grading} style={{
                  padding: "3px 10px", borderRadius: 6, border: "1px solid #58a6ff55",
                  background: "#58a6ff11", color: "#58a6ff", fontSize: 10, fontWeight: 700, cursor: "pointer",
                }}>{grading ? "⏳" : "Grade"}</button>
              )}
            </div>

            {/* Summary stats */}
            {graded.length > 0 && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
                {[
                  { label: "Parlay", value: `${wins}W-${losses}L`, color: wins > losses ? "#2ea043" : "#f85149" },
                  { label: "Win %", value: `${winRate.toFixed(0)}%`, color: winRate >= 35 ? "#2ea043" : "#d29922" },
                  { label: "P&L", value: `${profit >= 0 ? "+" : ""}$${profit.toFixed(0)}`, color: profit >= 0 ? "#2ea043" : "#f85149" },
                  { label: "ROI", value: `${roi >= 0 ? "+" : ""}${roi.toFixed(0)}%`, color: roi >= 0 ? "#2ea043" : "#f85149" },
                  { label: "Streak", value: streakType ? `${streak}${streakType[0]}` : "—", color: streakType === "WIN" ? "#2ea043" : "#f85149" },
                ].map(s => (
                  <div key={s.label} style={{ background: "#0d1117", border: "1px solid #21262d", borderRadius: 8,
                    padding: "8px 14px", minWidth: 60, textAlign: "center", flex: 1 }}>
                    <div style={{ fontSize: 8, color: C.dim, letterSpacing: 1, marginBottom: 2 }}>{s.label}</div>
                    <div style={{ fontSize: 15, fontWeight: 900, color: s.color }}>{s.value}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Date cards */}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {parlayHistory.slice(0, 30).map(day => {
                const isWin = day.result === "WIN";
                const isLoss = day.result === "LOSS";
                const isPending = day.result === "PENDING";
                const legs = day.legs || [];
                const ats = day.ats_picks || [];
                const ou = day.ou_picks || [];
                const borderColor = isWin ? "#2ea04344" : isLoss ? "#f8514944" : "#21262d";
                const pnl = isWin ? (day.actual_payout - day.bet_amount) : isLoss ? -day.bet_amount : 0;

                return (
                  <details key={day.id} style={{ background: "#0d1117", border: `1px solid ${borderColor}`,
                    borderRadius: 10, overflow: "hidden" }}>
                    <summary style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px",
                      cursor: "pointer", listStyle: "none", WebkitAppearance: "none" }}>
                      <span style={{ fontSize: 16, width: 24 }}>{isWin ? "✅" : isLoss ? "❌" : "⏳"}</span>
                      <span style={{ fontSize: 13, fontWeight: 800, color: "#e6edf3", flex: 1 }}>{day.bet_date}</span>
                      <span style={{ fontSize: 10, color: C.dim }}>
                        {legs.length > 0 && `${legs.length}L parlay`}
                        {ats.length > 0 && ` · ${ats.length} ATS`}
                        {ou.length > 0 && ` · ${ou.length} O/U`}
                      </span>
                      {day.bet_amount > 0 && (
                        <span style={{ fontSize: 13, fontWeight: 800,
                          color: isWin ? "#2ea043" : isLoss ? "#f85149" : "#8b949e" }}>
                          {isPending ? "PENDING" : `${pnl >= 0 ? "+" : ""}$${pnl.toFixed(0)}`}
                        </span>
                      )}
                    </summary>

                    <div style={{ padding: "0 14px 12px", borderTop: "1px solid #21262d" }}>
                      {/* Parlay legs */}
                      {legs.length > 0 && (
                        <div style={{ marginTop: 10 }}>
                          <div style={{ fontSize: 9, fontWeight: 800, color: "#58a6ff", letterSpacing: 2, marginBottom: 6 }}>
                            ATS PARLAY · {day.combined_odds?.toFixed(2)}x · ${day.bet_amount}
                            {day.legs_won != null && legs.length > 0 && ` · ${day.legs_won}/${legs.length} legs`}
                          </div>
                          {legs.map((l, i) => {
                            const legWon = l.correct === true;
                            const legLost = l.correct === false;
                            const legPending = l.correct === undefined || l.correct === null;
                            return (
                            <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0",
                              fontSize: 12, color: legLost ? "#484f58" : "#c9d1d9",
                              textDecoration: legLost ? "line-through" : "none",
                              opacity: 1 }}>
                              <span style={{ width: 18, fontSize: 12, fontSize: 12 }}>{legWon ? "✅" : legLost ? "❌" : "⏳"}</span>
                              <span style={{ flex: 1, fontWeight: 600 }}>
                                {l.sport || ""} {l.team} {l.spread != null ? (l.spread > 0 ? `+${parseFloat(l.spread).toFixed(1)}` : parseFloat(l.spread).toFixed(1)) : "ATS"}
                              </span>
                              <span style={{ color: "#8b949e", width: 40, textAlign: "right" }}>-110</span>
                              {l.units && (
                                <span style={{ fontSize: 10, fontWeight: 900, color: "#fff",
                                  background: unitColor(l.units), borderRadius: 4, padding: "1px 4px", width: 26, textAlign: "center" }}>
                                  {l.units}u
                                </span>
                              )}
                            </div>
                            );
                          })}
                        </div>
                      )}

                      {/* ATS picks */}
                      {ats.length > 0 && (() => {
                        const atsW = ats.filter(a => a.correct === true).length;
                        const atsL = ats.filter(a => a.correct === false).length;
                        const atsP = ats.length - atsW - atsL;
                        const atsRecord = (atsW + atsL) > 0 ? ` · ${atsW}-${atsL} ${(atsW/(atsW+atsL)*100).toFixed(0)}%` : "";
                        return (
                        <div style={{ marginTop: 10 }}>
                          <div style={{ fontSize: 9, fontWeight: 800, color: "#8b949e", letterSpacing: 2, marginBottom: 6 }}>
                            ATS PICKS{atsRecord}{atsP > 0 ? ` · ${atsP} pending` : ""}
                          </div>
                          {ats.map((a, i) => {
                            const aWon = a.correct === true;
                            const aLost = a.correct === false;
                            return (
                            <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0",
                              fontSize: 12, color: aLost ? "#484f58" : "#c9d1d9",
                              textDecoration: aLost ? "line-through" : "none",
                              opacity: 1 }}>
                              <span style={{ width: 18, fontSize: 12, fontSize: 12 }}>{aWon ? "✅" : aLost ? "❌" : "⏳"}</span>
                              <span style={{ flex: 1, fontWeight: 600 }}>
                                {a.sport === "mlb" ? "⚾" : a.sport === "nba" ? "🏀" : "🏀"} {a.team}
                              </span>
                              <span style={{ color: "#8b949e", width: 55, textAlign: "center" }}>
                                {a.spread != null ? (a.spread > 0 ? `+${parseFloat(a.spread).toFixed(1)}` : parseFloat(a.spread).toFixed(1)) : "—"}
                              </span>
                              <span style={{ fontSize: 10, fontWeight: 900, color: "#fff",
                                background: unitColor(a.units), borderRadius: 4, padding: "1px 6px" }}>
                                {a.units}u
                              </span>
                            </div>
                            );
                          })}
                        </div>
                        );
                      })()}

                      {/* O/U picks */}
                      {ou.length > 0 && (() => {
                        const ouW = ou.filter(o => o.correct === true).length;
                        const ouL = ou.filter(o => o.correct === false).length;
                        const ouP = ou.length - ouW - ouL;
                        const ouRecord = (ouW + ouL) > 0 ? ` · ${ouW}-${ouL} ${(ouW/(ouW+ouL)*100).toFixed(0)}%` : "";
                        return (
                        <div style={{ marginTop: 10 }}>
                          <div style={{ fontSize: 9, fontWeight: 800, color: "#8b949e", letterSpacing: 2, marginBottom: 6 }}>
                            O/U PICKS{ouRecord}{ouP > 0 ? ` · ${ouP} pending` : ""}
                          </div>
                          {ou.map((o, i) => {
                            const oWon = o.correct === true;
                            const oLost = o.correct === false;
                            return (
                            <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0",
                              fontSize: 12, color: oLost ? "#484f58" : "#c9d1d9",
                              textDecoration: oLost ? "line-through" : "none",
                              opacity: 1 }}>
                              <span style={{ width: 18, fontSize: 12, fontSize: 12 }}>{oWon ? "✅" : oLost ? "❌" : "⏳"}</span>
                              <span style={{ flex: 1, fontWeight: 600 }}>
                                {o.side === "OVER" ? "▲" : "▼"} {o.side} {o.team}
                              </span>
                              <span style={{ color: "#8b949e", width: 55, textAlign: "center" }}>
                                {o.modelTotal?.toFixed?.(1) ?? "—"}
                              </span>
                              <span style={{ fontSize: 10, fontWeight: 900, color: "#fff",
                                background: unitColor(o.units), borderRadius: 4, padding: "1px 6px" }}>
                                {o.units}u
                              </span>
                            </div>
                            );
                          })}
                        </div>
                        );
                      })()}

                      {legs.length === 0 && ats.length === 0 && ou.length === 0 && (
                        <div style={{ fontSize: 11, color: C.dim, padding: "10px 0", fontStyle: "italic" }}>No signals — sat out</div>
                      )}
                    </div>
                  </details>
                );
              })}
            </div>
          </div>
        );
      })()}

      <div style={{ fontSize: 10, color: "#484f58", textAlign: "center", marginTop: 20 }}>
        {lastSync ? `Synced ${lastSync}` : "Not synced"} · ATS parlays @ -110 · ML dogs flagged
      </div>
    </div>
  );
}
