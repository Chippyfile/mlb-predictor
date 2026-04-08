// src/components/DailyBets.jsx — Daily Bets page with self-contained sync
import React, { useState, useMemo, useCallback, useEffect } from "react";
import { C } from "./Shared.jsx";
// Supabase is the sole source of truth — no frontend recomputation
import { supabaseQuery } from "../utils/supabase.js";

const PARLAY_ML_FLOOR = -325, PARLAY_ML_CEIL = 325, PARLAY_CONF_GATE = 68, PARLAY_BET = 100, MIN_LEGS = 4, MAX_LEGS = 5, MIN_BET_UNITS = 2;
const getToday = () => { const d = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" })); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };

function getStrategyMode() { return "active"; }
const STRAT = {
  active: { label: "🎯 ML PARLAY — $100 on 4-5 Flex (±325 cap, 68% conf)", color: "#2ea043", sub: "Walk-forward: 72.0% ROI, 39.2% hit rate, $600 max drawdown over 3.5 seasons." },
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
  };
}); }

// ── Colors ──
function unitColor(u) { return u >= 3 ? "#2ea043" : u >= 2 ? "#58a6ff" : "#6e7681"; }
function confColor(c) { return c >= 80 ? "#2ea043" : c >= 70 ? "#58a6ff" : c >= 60 ? "#d29922" : "#8b949e"; }

export default function DailyBets({ setNcaaGames, setNbaGames, setMlbGames }) {
  const today = getToday(), mode = getStrategyMode(), strat = STRAT[mode];
  const [games, setGames] = useState({ ncaa: [], nba: [], mlb: [] });
  const [syncing, setSyncing] = useState({});
  const [lastSync, setLastSync] = useState(null);
  const [parlayHistory, setParlayHistory] = useState([]);
  const [todayLocked, setTodayLocked] = useState(false);
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

  // ── Parlay History: load from Supabase ──
  const loadHistory = useCallback(async () => {
    try {
      const rows = await supabaseQuery("/parlay_bets?order=bet_date.desc&limit=60");
      setParlayHistory(rows || []);
      const todayRow = (rows || []).find(r => r.bet_date === today);
      setTodayLocked(!!todayRow);
    } catch(e) { console.error("[DailyBets] parlay history:", e); }
  }, [today]);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  // ── Lock in today's parlay ──
  const lockInParlay = useCallback(async (picks) => {
    if (!picks.length || todayLocked) return;
    const odds = parlayOdds(picks);
    const row = {
      bet_date: today,
      legs: picks.map(p => ({ team: p.team, ml: p.ml, conf: p.conf, sport: p.sport, gameId: p.gameId, side: p.side || "ML" })),
      num_legs: picks.length,
      combined_odds: parseFloat(odds.toFixed(4)),
      bet_amount: PARLAY_BET,
      potential_payout: parseFloat((PARLAY_BET * odds).toFixed(2)),
      result: "PENDING",
      legs_won: 0,
      ml_cap: PARLAY_ML_CEIL,
      conf_gate: PARLAY_CONF_GATE,
    };
    try {
      await supabaseQuery("/parlay_bets", "POST", row);
      setTodayLocked(true);
      await loadHistory();
    } catch(e) { console.error("[DailyBets] lock-in:", e); }
  }, [today, todayLocked, loadHistory]);

  // ── Grade pending parlays ──
  const gradeParlays = useCallback(async () => {
    setGrading(true);
    try {
      const pending = parlayHistory.filter(p => p.result === "PENDING");
      for (const bet of pending) {
        const legs = bet.legs || [];
        let won = 0, decided = 0, anyLoss = false;
        for (const leg of legs) {
          // Check each leg against the appropriate prediction table
          const gid = leg.gameId;
          if (!gid) continue;
          let row = null;
          // Try all prediction tables
          for (const table of ["mlb_predictions", "ncaa_predictions", "nba_predictions"]) {
            try {
              const res = await supabaseQuery(`/${table}?game_id=eq.${gid}&select=ml_correct,result_entered&limit=1`);
              if (res?.length) { row = res[0]; break; }
            } catch { /* try next table */ }
            // MLB uses game_pk
            if (table === "mlb_predictions") {
              try {
                const res = await supabaseQuery(`/${table}?game_pk=eq.${gid}&select=ml_correct,result_entered&limit=1`);
                if (res?.length) { row = res[0]; break; }
              } catch { /* continue */ }
            }
          }
          if (row?.result_entered) {
            decided++;
            if (row.ml_correct) won++;
            else anyLoss = true;
          }
        }
        // Only grade if all legs have results
        if (decided === legs.length) {
          const result = anyLoss ? "LOSS" : "WIN";
          const payout = result === "WIN" ? bet.potential_payout : 0;
          await supabaseQuery(`/parlay_bets?id=eq.${bet.id}`, "PATCH", {
            result, legs_won: won, actual_payout: payout, graded_at: new Date().toISOString(),
          });
        }
      }
      await loadHistory();
    } catch(e) { console.error("[DailyBets] grading:", e); }
    setGrading(false);
  }, [parlayHistory, loadHistory]);

  // ── Multi-Sport Parlay Picks (top ML picks across all sports) ──
  const parlayPicks = useMemo(() => {
    if (mode === "skip") return [];
    const allPicks = [];

    // NCAA picks
    for (const g of (games.ncaa || [])) {
      if (!g.pred || !g.odds) continue;
      const wp = parseFloat(g.pred.homeWinPct) || 0.5;
      const conf = Math.max(wp, 1 - wp);
      const spread = g.odds.homeSpread ?? 0;
      const pickHome = wp > 0.5;
      const ml = spreadToML(pickHome ? spread : -spread);
      allPicks.push({ team: pickHome ? g.homeTeam : g.awayTeam, ml, conf: conf*100, margin: Math.abs(spread), sport: "🏀", gameId: g.gameId });
    }

    // NBA picks
    for (const g of (games.nba || [])) {
      if (!g.pred || !g.odds) continue;
      const wp = parseFloat(g.pred.homeWinPct) || 0.5;
      const conf = Math.max(wp, 1 - wp);
      const spread = g.odds.homeSpread ?? 0;
      const pickHome = wp > 0.5;
      const ml = spreadToML(pickHome ? spread : -spread);
      allPicks.push({ team: pickHome ? g.homeTeam : g.awayTeam, ml, conf: conf*100, margin: Math.abs(spread), sport: "🏀", gameId: g.gameId });
    }

    // MLB picks — use stored market moneylines when available
    for (const g of (games.mlb || [])) {
      if (!g.pred) continue;
      const wp = parseFloat(g.pred.homeWinPct) || 0.5;
      const conf = Math.max(wp, 1 - wp);
      const pickHome = wp > 0.5;
      // Prefer real market ML, fall back to spread conversion
      let ml;
      if (pickHome && g.odds?.homeML) ml = g.odds.homeML;
      else if (!pickHome && g.odds?.awayML) ml = g.odds.awayML;
      else ml = spreadToML(pickHome ? (g.odds?.homeSpread ?? 0) : -(g.odds?.homeSpread ?? 0));
      allPicks.push({ team: pickHome ? g.homeTeam : g.awayTeam, ml, conf: conf*100, margin: Math.abs(g.pred.projectedSpread || 0), sport: "⚾", gameId: g.gameId });
    }

    return allPicks
      .filter(p => p.conf >= PARLAY_CONF_GATE && p.ml >= PARLAY_ML_FLOOR && p.ml <= PARLAY_ML_CEIL)
      .sort((a,b) => b.conf - a.conf)
      .slice(0, MAX_LEGS);
  }, [games.ncaa, games.nba, games.mlb, mode]);

  const parlayActive = parlayPicks.length >= MIN_LEGS;

  // ── Sport picks ──
  function buildPicks(gameList, sport) {
    const ats = [], ou = [];
    for (const g of gameList) {
      if (!g.pred) continue;
      const h = g.homeTeam || "Home", a = g.awayTeam || "Away";

      // Use pre-computed ATS from cron (Supabase is sole source of truth)
      if (g._ats && g._ats.units) {
        const side = g._ats.side;
        const team = side === "HOME" ? h : a;
        const sp = g._ats.spread || (side === "HOME" ? g.odds?.homeSpread : -(g.odds?.homeSpread || 0));
        ats.push({ team, spread: sp ? parseFloat(sp) : null, units: g._ats.units, edge: parseFloat(g._ats.disagree || 0), side });
      }

      // O/U from cron (Supabase is sole source of truth)
      if (g.pred._ouPick) {
        const side = g.pred._ouPick;
        const edge = Math.abs(parseFloat(g.pred._ouEdge) || 0);
        const units = g.pred._ouTier || 1;
        const predTotal = parseFloat(g.pred._ouPredictedTotal) || 0;
        if (!ou.find(o => o.team === `${h} / ${a}`)) {
          ou.push({ team: `${h} / ${a}`, side, edge, units, modelTotal: predTotal });
        }
      }
    }
    return { 
      ats: ats.filter(p => p.units >= MIN_BET_UNITS), 
      ou: ou.filter(p => p.units >= 1)  // O/U model thresholds are already selective (66%+) 
    };
  }

  const sports = [
    { key: "ncaa", name: "NCAA", icon: "🏀", color: C.orange, ...buildPicks(games.ncaa, "ncaa"), count: games.ncaa.length },
    { key: "nba",  name: "NBA",  icon: "🏀", color: "#58a6ff", ...buildPicks(games.nba, "nba"),   count: games.nba.length },
    { key: "mlb",  name: "MLB",  icon: "⚾", color: C.blue,   ...buildPicks(games.mlb, "mlb"),   count: games.mlb.length },
  ];
  const totalPicks = sports.reduce((s,sp) => s + sp.ats.length + sp.ou.length, 0);
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
      </div>

      {/* Strategy card */}
      <div style={{ background: `linear-gradient(135deg, ${strat.color}12, ${strat.color}06)`,
        border: `1px solid ${strat.color}55`, borderRadius: 12, padding: "16px 20px", marginBottom: 20 }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: strat.color, marginBottom: 4 }}>{strat.label}</div>
        <div style={{ fontSize: 11, color: C.dim }}>{strat.sub}</div>
      </div>

      {/* ── PARLAY ── */}
      {parlayActive && (
        <div style={{ background: "linear-gradient(135deg, #0d1117, #161b22)",
          border: "1px solid #30363d", borderRadius: 10, padding: "14px 18px", marginBottom: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <span style={{ fontSize: 14, fontWeight: 800, color: "#e6edf3" }}>🎯 {parlayPicks.length}-Leg ML Parlay</span>
            <span style={{ fontSize: 10, fontWeight: 800, color: "#fff", background: "#2ea043",
              borderRadius: 5, padding: "3px 10px", letterSpacing: 1 }}>${PARLAY_BET}</span>
          </div>
          {parlayPicks.map((p, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "8px 0", borderBottom: i === parlayPicks.length-1 ? "none" : "1px solid #21262d" }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#e6edf3", flex: 1 }}>{p.sport} {p.team} ML</span>
              <span style={{ fontSize: 12, color: C.muted, width: 60, textAlign: "right" }}>{p.ml > 0 ? `+${p.ml}` : p.ml}</span>
              <span style={{ fontSize: 11, width: 50, textAlign: "right", color: confColor(p.conf) }}>{p.conf.toFixed(0)}%</span>
            </div>
          ))}
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 10, color: C.dim }}>
            <span>Odds: {parlayOdds(parlayPicks).toFixed(2)}x · {parlayPicks.length} legs</span>
            <span>Potential: ${(PARLAY_BET * parlayOdds(parlayPicks)).toFixed(0)}</span>
          </div>
          <div style={{ fontSize: 9, color: "#484f58", marginTop: 4 }}>
            Filter: ±325 ML cap · ≥68% conf · 4-5 flex legs · WF: 72.0% ROI
          </div>
          <button onClick={() => lockInParlay(parlayPicks)} disabled={todayLocked}
            style={{ marginTop: 10, width: "100%", padding: "10px 0", borderRadius: 8,
              border: todayLocked ? "1px solid #30363d" : "1px solid #2ea043",
              background: todayLocked ? "#161b22" : "linear-gradient(135deg, #2ea04322, #2ea04311)",
              color: todayLocked ? "#484f58" : "#2ea043", fontSize: 13, fontWeight: 800,
              cursor: todayLocked ? "default" : "pointer", letterSpacing: 1,
            }}>{todayLocked ? "✅ LOCKED IN" : "🔒 LOCK IN TODAY'S PARLAY"}</button>
        </div>
      )}

      {!parlayActive && (games.ncaa.length + games.nba.length + games.mlb.length) > 0 && (
        <div style={{ fontSize: 12, color: C.dim, fontStyle: "italic", padding: "10px 0", textAlign: "center" }}>
          {parlayPicks.length > 0
            ? `Only ${parlayPicks.length} qualifying picks (need ${MIN_LEGS}) — no parlay today`
            : `No picks pass ±325 ML cap + 68% confidence filter — sit today out`}
        </div>
      )}

      {/* ── SPORT SECTIONS ── */}
      {sports.map(sp => {
        const has = sp.ats.length > 0 || sp.ou.length > 0;
        return (
          <div key={sp.key} style={{ marginTop: 28 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, paddingBottom: 8, borderBottom: "1px solid #21262d" }}>
              <span style={{ fontSize: 20 }}>{sp.icon}</span>
              <span style={{ fontSize: 18, fontWeight: 900, color: "#e6edf3", letterSpacing: -0.5 }}>{sp.name}</span>
              <span style={{ fontSize: 11, color: C.dim, marginLeft: "auto" }}>
                {has ? `${sp.ats.length} ATS · ${sp.ou.length} O/U` : sp.count > 0 ? `${sp.count} games · no signals` : "not synced"}
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
          </div>
        );
      })}

      {totalPicks === 0 && !anySyncing && sports.every(s => s.count === 0) && (
        <div style={{ textAlign: "center", padding: 40, color: C.dim }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>📊</div>
          <div style={{ fontSize: 14 }}>Hit "Sync All" to load today's picks</div>
        </div>
      )}

      {/* ── PARLAY HISTORY ── */}
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
        // Current streak
        let streak = 0, streakType = "";
        for (const p of graded) {
          if (!streakType) { streakType = p.result; streak = 1; }
          else if (p.result === streakType) streak++;
          else break;
        }

        return (
          <div style={{ marginTop: 32 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, paddingBottom: 8, borderBottom: "1px solid #21262d" }}>
              <span style={{ fontSize: 18, fontWeight: 900, color: "#e6edf3" }}>📊 Parlay Tracker</span>
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
                  { label: "Record", value: `${wins}W - ${losses}L`, color: wins > losses ? "#2ea043" : "#f85149" },
                  { label: "Win %", value: `${winRate.toFixed(1)}%`, color: winRate >= 35 ? "#2ea043" : "#d29922" },
                  { label: "P&L", value: `${profit >= 0 ? "+" : ""}$${profit.toFixed(0)}`, color: profit >= 0 ? "#2ea043" : "#f85149" },
                  { label: "ROI", value: `${roi >= 0 ? "+" : ""}${roi.toFixed(1)}%`, color: roi >= 0 ? "#2ea043" : "#f85149" },
                  { label: "Streak", value: `${streak}${streakType === "WIN" ? "W" : "L"}`, color: streakType === "WIN" ? "#2ea043" : "#f85149" },
                ].map(s => (
                  <div key={s.label} style={{ background: "#0d1117", border: "1px solid #21262d", borderRadius: 8,
                    padding: "8px 14px", minWidth: 70, textAlign: "center" }}>
                    <div style={{ fontSize: 9, color: C.dim, letterSpacing: 1, marginBottom: 2 }}>{s.label}</div>
                    <div style={{ fontSize: 16, fontWeight: 900, color: s.color }}>{s.value}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Recent bets */}
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {parlayHistory.slice(0, 20).map(bet => {
                const isWin = bet.result === "WIN";
                const isLoss = bet.result === "LOSS";
                const isPending = bet.result === "PENDING";
                const legs = bet.legs || [];
                return (
                  <div key={bet.id} style={{ display: "flex", alignItems: "center", gap: 8,
                    padding: "8px 12px", background: "#0d1117", borderRadius: 8,
                    border: `1px solid ${isWin ? "#2ea04333" : isLoss ? "#f8514933" : "#21262d"}` }}>
                    <span style={{ fontSize: 16, width: 24, textAlign: "center" }}>
                      {isWin ? "✅" : isLoss ? "❌" : "⏳"}
                    </span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: "#c9d1d9" }}>
                        {bet.bet_date} · {bet.num_legs}-leg · {bet.combined_odds?.toFixed(2)}x
                      </div>
                      <div style={{ fontSize: 10, color: C.dim, marginTop: 2 }}>
                        {legs.map(l => l.team).join(" · ")}
                      </div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 13, fontWeight: 800,
                        color: isWin ? "#2ea043" : isLoss ? "#f85149" : "#8b949e" }}>
                        {isWin ? `+$${(bet.actual_payout - bet.bet_amount).toFixed(0)}` : isLoss ? `-$${bet.bet_amount}` : "PENDING"}
                      </div>
                      {!isPending && <div style={{ fontSize: 9, color: C.dim }}>{bet.legs_won}/{bet.num_legs} legs</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      <div style={{ fontSize: 10, color: "#484f58", textAlign: "center", marginTop: 20 }}>
        {lastSync ? `Synced ${lastSync}` : "Not synced"} · ±325 cap · ≥68% conf
      </div>
    </div>
  );
}
