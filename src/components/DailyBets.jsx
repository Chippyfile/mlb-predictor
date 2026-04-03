// src/components/DailyBets.jsx — Daily Bets page with self-contained sync
import React, { useState, useMemo, useCallback, useEffect } from "react";
import { C } from "./Shared.jsx";
import { getBetSignals } from "../utils/sharedUtils.js";
import { supabaseQuery } from "../utils/supabase.js";

const ML_CAP = -500, CONF_GATE = 0.65, MIN_LEGS = 3;
const getToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };

function getStrategyMode() {
  const m = new Date().getMonth() + 1, d = new Date().getDate();
  if (m === 1 && d <= 7) return "skip";
  if (m === 1 || m === 2) return "3only";
  return "full";
}
const STRAT = {
  skip:   { label: "🚫 NO BETS — Jan W1 (conference chaos)", color: "#f85149", sub: "Historical −23.6% ROI. Skip this week." },
  "3only":{ label: "🛡 SAFE MODE — 3-Leg Only @ $75",        color: "#d29922", sub: "Jan/Feb: 5-leg historically unprofitable. Consolidate to 3-leg." },
  full:   { label: "🎯 FULL — $50 on 3-Leg + $25 on 5-Leg",  color: "#2ea043", sub: "Nov/Dec/Mar: Both legs profitable. 44.6% ROI across 6 seasons." },
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
  // If pred scores are null, derive margin from win_pct and spread
  if (margin === 0 && r.win_pct_home) {
    const wp = parseFloat(r.win_pct_home);
    // Convert probability to approximate margin (inverse sigmoid, σ=10)
    if (wp > 0.01 && wp < 0.99) margin = -10 * Math.log(1/wp - 1);
  }
  return {
    gameId: r.game_id, homeTeam: r.home_team || r.home_team_name, awayTeam: r.away_team || r.away_team_name,
    neutralSite: !!r.neutral_site,
    pred: { projectedSpread: -margin, homeWinPct: parseFloat(r.win_pct_home) || 0.5, mlMargin: -margin,
            _ouPick: r.ou_pick, _ouEdge: r.ou_edge, _ouPredictedTotal: parseFloat(r.ou_predicted_total || r.ou_total) || null },
    odds: { homeSpread: parseFloat(r.market_spread_home || r.espn_spread) || null,
            homeML: r.closing_home_ml || r.model_ml_home, awayML: r.closing_away_ml || r.model_ml_away,
            ouLine: parseFloat(r.market_ou_total || r.closing_ou_total) || null },
    _ats: r.ats_units ? { side: r.ats_side, units: r.ats_units, disagree: r.ats_disagree, spread: r.ats_pick_spread } : null,
  };
}); }

function mapNBA(rows) { return rows.filter(r => r.pred_home_score != null).map(r => {
  const margin = (parseFloat(r.pred_home_score)||0) - (parseFloat(r.pred_away_score)||0);
  return {
    gameId: r.game_id, homeTeam: r.home_team || r.home_team_name, awayTeam: r.away_team || r.away_team_name,
    pred: { projectedSpread: -margin, homeWinPct: parseFloat(r.win_pct_home || r.ml_win_prob_home) || 0.5,
            _ouPick: null, _ouEdge: r.ou_total && r.market_ou_total ? Math.abs(parseFloat(r.ou_total) - parseFloat(r.market_ou_total)) : 0,
            _ouPredictedTotal: parseFloat(r.ou_total) || null },
    odds: { homeSpread: parseFloat(r.market_spread_home) || null,
            homeML: r.opening_home_ml || r.model_ml_home, awayML: r.opening_away_ml || r.model_ml_away,
            ouLine: parseFloat(r.market_ou_total) || null },
    // Pre-computed ATS from cron
    _ats: r.ats_units ? { side: r.ats_side, units: r.ats_units, disagree: r.ats_disagree, spread: r.ats_pick_spread } : null,
  };
}); }

function mapMLB(rows) { return rows.filter(r => r.pred_home_runs != null || r.spread_home != null).map(r => {
  const hr = parseFloat(r.pred_home_runs) || 0, ar = parseFloat(r.pred_away_runs) || 0;
  return {
    gameId: r.game_pk, homeTeam: r.home_team, awayTeam: r.away_team,
    pred: { projectedSpread: -(hr - ar), homeWinPct: parseFloat(r.win_pct_home || r.ml_win_prob_home) || 0.5,
            homeRuns: hr, awayRuns: ar },
    odds: { homeSpread: parseFloat(r.run_line_home) || -1.5,
            homeML: r.opening_home_ml || r.model_ml_home, awayML: r.opening_away_ml || r.model_ml_away,
            ouLine: parseFloat(r.market_ou_total) || null },
    _ats: r.ats_units ? { side: r.ats_side, units: r.ats_units } : null,
  };
}); }

// ── Colors ──
function unitColor(u) { return u >= 4 ? "#2ea043" : u >= 2 ? "#d29922" : "#8b949e"; }
function confColor(c) { return c >= 80 ? "#2ea043" : c >= 70 ? "#58a6ff" : c >= 60 ? "#d29922" : "#8b949e"; }

export default function DailyBets({ setNcaaGames, setNbaGames, setMlbGames }) {
  const today = getToday(), mode = getStrategyMode(), strat = STRAT[mode];
  const [games, setGames] = useState({ ncaa: [], nba: [], mlb: [] });
  const [syncing, setSyncing] = useState({});
  const [lastSync, setLastSync] = useState(null);

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

  // ── NCAA Parlay Picks ──
  const parlayPicks = useMemo(() => {
    if (mode === "skip") return [];
    return games.ncaa
      .filter(g => g.pred && g.odds)
      .map(g => {
        const wp = parseFloat(g.pred.homeWinPct) || 0.5;
        const conf = Math.max(wp, 1 - wp);
        const spread = g.odds.homeSpread ?? 0;
        
        // Model says which team wins. wp > 0.5 = home_team wins. That's the pick.
        const pickHome = wp > 0.5;
        const ml = spreadToML(pickHome ? spread : -spread);
        return { team: pickHome ? g.homeTeam : g.awayTeam, ml, conf: conf*100, margin: Math.abs(spread), gameId: g.gameId };
      })
      .filter(p => p.conf >= CONF_GATE*100 && p.ml > ML_CAP)
      .sort((a,b) => b.conf - a.conf);
  }, [games.ncaa, mode]);

  const p3 = parlayPicks.slice(0, 3), p5 = parlayPicks.slice(0, Math.min(5, parlayPicks.length));

  // ── Sport picks ──
  function buildPicks(gameList, sport) {
    const ats = [], ou = [];
    for (const g of gameList) {
      if (!g.pred) continue;
      const h = g.homeTeam || "Home", a = g.awayTeam || "Away";

      // Use pre-computed ATS from cron if available
      if (g._ats && g._ats.units) {
        const side = g._ats.side;
        const team = side === "HOME" ? h : a;
        const sp = g._ats.spread || (side === "HOME" ? g.odds?.homeSpread : -(g.odds?.homeSpread || 0));
        ats.push({ team, spread: sp ? parseFloat(sp) : null, units: g._ats.units, edge: parseFloat(g._ats.disagree || 0), side });
      } else if (g.odds) {
        // Fall back to computing via getBetSignals
        const sig = getBetSignals({ pred: g.pred, odds: g.odds, sport, homeName: h, awayName: a });
        if (sig.betSizing) {
          const side = sig.betSizing.side, team = side === "HOME" ? h : a;
          const sp = g.odds.homeSpread; const dsp = sp != null ? (side === "HOME" ? sp : -sp) : null;
          ats.push({ team, spread: dsp, units: sig.betSizing.units, edge: parseFloat(sig.betSizing.disagree||0), side });
        }
        if (sig.ou && (sig.ou.verdict === "GO" || sig.ou.verdict === "LEAN") && sig.ou.units) {
          ou.push({ team: `${h} / ${a}`, side: sig.ou.side, edge: parseFloat(sig.ou.diff||sig.ou.edge||0), units: sig.ou.units, modelTotal: sig.ou.modelTotal });
        }
      }

      // O/U from pre-computed data
      if (g.pred._ouPredictedTotal && g.odds?.ouLine) {
        const predTotal = parseFloat(g.pred._ouPredictedTotal);
        const mktTotal = parseFloat(g.odds.ouLine);
        const diff = Math.abs(predTotal - mktTotal);
        const pctEdge = diff / mktTotal;
        if (pctEdge >= 0.04) {
          const side = predTotal > mktTotal ? "OVER" : "UNDER";
          const units = pctEdge >= 0.12 ? 3 : pctEdge >= 0.08 ? 2 : 1;
          // Don't duplicate if already added via getBetSignals
          if (!ou.find(o => o.team === `${h} / ${a}`)) {
            ou.push({ team: `${h} / ${a}`, side, edge: diff, units, modelTotal: predTotal });
          }
        }
      }
    }
    return { ats, ou };
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

      {/* ── PARLAYS ── */}
      {mode !== "skip" && parlayPicks.length >= MIN_LEGS && [
        { picks: p3, legs: 3, bet: mode === "3only" ? 75 : 50, color: "#2ea043", show: p3.length >= 3 },
        { picks: p5, legs: 5, bet: 25, color: "#58a6ff", show: mode === "full" && p5.length >= 5 },
      ].filter(p => p.show).map(({ picks, legs, bet, color }) => (
        <div key={legs} style={{ background: "linear-gradient(135deg, #0d1117, #161b22)",
          border: "1px solid #30363d", borderRadius: 10, padding: "14px 18px", marginBottom: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <span style={{ fontSize: 14, fontWeight: 800, color: "#e6edf3" }}>🏀 {legs}-Leg Parlay</span>
            <span style={{ fontSize: 10, fontWeight: 800, color: "#fff", background: color,
              borderRadius: 5, padding: "3px 10px", letterSpacing: 1 }}>${bet}</span>
          </div>
          {picks.map((p, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "8px 0", borderBottom: i === picks.length-1 ? "none" : "1px solid #21262d" }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#e6edf3", flex: 1 }}>{p.team} ML</span>
              <span style={{ fontSize: 12, color: C.muted, width: 60, textAlign: "right" }}>{p.ml > 0 ? `+${p.ml}` : p.ml}</span>
              <span style={{ fontSize: 11, width: 50, textAlign: "right", color: confColor(p.conf) }}>{p.conf.toFixed(0)}%</span>
            </div>
          ))}
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 10, color: C.dim }}>
            <span>Odds: {parlayOdds(picks).toFixed(2)}x</span>
            <span>Potential: ${(bet * parlayOdds(picks)).toFixed(0)}</span>
          </div>
        </div>
      ))}

      {mode !== "skip" && games.ncaa.length > 0 && parlayPicks.length < MIN_LEGS && (
        <div style={{ fontSize: 12, color: C.dim, fontStyle: "italic", padding: "10px 0" }}>
          {parlayPicks.length > 0
            ? `Only ${parlayPicks.length} qualifying NCAA picks (need ${MIN_LEGS})`
            : `${games.ncaa.length} NCAA games loaded — none pass ≥65% + ML cap -500 filter`}
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
              <div style={{ fontSize: 10, fontWeight: 800, color: C.dim, letterSpacing: 2, marginTop: 14, marginBottom: 6 }}>ATS / SPREAD</div>
              {sp.ats.sort((a,b) => b.units - a.units || b.edge - a.edge).map((p,i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px",
                  background: "#0d1117", borderRadius: 8, marginBottom: 6, border: "1px solid #21262d" }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#e6edf3", flex: 1 }}>{p.team}</span>
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
                  background: "#0d1117", borderRadius: 8, marginBottom: 6, border: "1px solid #21262d" }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#e6edf3", flex: 1 }}>
                    {p.side === "OVER" ? "▲" : "▼"} {p.side} {p.team}
                  </span>
                  <span style={{ fontSize: 12, color: "#8b949e", width: 60, textAlign: "center" }}>{p.modelTotal?.toFixed?.(1) ?? "—"}</span>
                  <span style={{ fontSize: 11, width: 55, textAlign: "right" }}>{p.edge.toFixed(1)} pts</span>
                  <span style={{ fontSize: 10, fontWeight: 900, color: "#fff",
                    background: p.side === "OVER" ? "#2ea043" : "#58a6ff",
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

      <div style={{ fontSize: 10, color: "#484f58", textAlign: "center", marginTop: 20 }}>
        {lastSync ? `Synced ${lastSync}` : "Not synced"} · {mode} mode · ML cap {ML_CAP}
      </div>
    </div>
  );
}
