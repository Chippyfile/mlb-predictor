import { pstTodayStr } from "../../utils/dateUtils.js";
// src/sports/mlb/MLBCalendarTab.jsx
// v2: Matched to NCAA grid layout — BetBanner, UnitBadge, confidence footer, green ML styling
import React, { useState, useEffect, useCallback } from "react";
import { C, Kv, BetSignalsPanel, AccuracyDashboard, HistoryTab, ParlayBuilder } from "../../components/Shared.jsx";
import ShapPanel from "../../components/ShapPanel.jsx";
import MonteCarloPanel from "../../components/MonteCarloPanel.jsx";
import { trueImplied, EDGE_THRESHOLD, DECISIVENESS_GATE } from "../../utils/sharedUtils.js";
import { buildStoredSignals } from "../../utils/buildStoredSignals.js";
import { mlPredictMLBFull } from "../../utils/mlApi.js";
import { supabaseQuery } from "../../utils/supabase.js";
import {
  mlbTeamById,
  fetchMLBScheduleForDate,
} from "./mlb.js";
import { mlbAutoSync } from "./mlbSync.js";

// ML moneyline cap — MLB lines rarely exceed ±500 even in extreme mismatches
const ML_CAP = 500;

// Unit badge for spread/ML/OU cells
const SignalBadge = ({ label, color, children }) => {
  if (!label) return <>{children}</>;

  return (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      background: `${color}18`,
      border: `1px solid ${color}55`,
      borderRadius: 5,
      padding: "2px 6px",
    }}>
      <span>{children}</span>
      <span style={{
        fontSize: 7, fontWeight: 800, color,
        background: `${color}30`, borderRadius: 3,
        padding: "0 3px", lineHeight: "13px",
        whiteSpace: "nowrap",
      }}>{label}</span>
    </div>
  );
};

// Format moneyline for display — cap at ±ML_CAP to prevent absurd heuristic values
const formatML = (ml) => {
  if (!ml) return "-";
  const capped = Math.sign(ml) * Math.min(ML_CAP, Math.abs(ml));
  return capped > 0 ? `+${capped}` : capped.toString();
};

// Format spread for display (positive = underdog, negative = favorite)
const formatSpread = (spread) => {
  if (spread === null || spread === undefined) return "-";
  return spread > 0 ? `+${spread.toFixed(1)}` : spread.toFixed(1);
};

// Bet advantage banner for game cards
const BetBanner = ({ signals, homeName, awayName, odds }) => {
  const sz = signals?.betSizing;
  const ou = signals?.ou;
  const hasOu = ou && (ou.verdict === "GO" || ou.verdict === "LEAN") && ou.side && ou.units;
  
  if (!sz && !hasOu) return null;

  // O/U-only banner
  if (!sz && hasOu) {
    const ouColor = ou.side === "OVER" ? "#2ea043" : "#58a6ff";
    return (
      <div style={{
        padding: "8px 14px",
        background: "linear-gradient(135deg, #0a1628, #0e1a2e)",
        borderBottom: `1px solid ${ouColor}44`,
        overflowX: "auto",
        WebkitOverflowScrolling: "touch",
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, minWidth: 320 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ display: "flex", gap: 3 }}>
              {[1, 2, 3].map(i => (
                <div key={i} style={{
                  width: 20, height: 20, borderRadius: 4,
                  background: i <= ou.units ? ouColor : "#1a1e24",
                  border: `1px solid ${i <= ou.units ? ouColor : "#30363d"}`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: i <= ou.units ? 12 : 9, fontWeight: 800,
                  color: i <= ou.units ? "#fff" : "#484f58",
                }}>{i <= ou.units ? "✓" : `${i}u`}</div>
              ))}
            </div>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 9, color: C.dim, letterSpacing: 1 }}>O/U:</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: ouColor }}>
                  {ou.side} {ou.modelTotal?.toFixed?.(1) ?? ""} {ou.side === "OVER" ? "▲" : "▼"}
                </span>
              </div>
              <span style={{ fontSize: 10, color: C.muted }}>
                {parseFloat(ou.diff).toFixed(1)} runs edge vs market · {ou.units}u
              </span>
            </div>
          </div>
          <div style={{ padding: "3px 10px", borderRadius: 4, background: ouColor, color: "#fff", fontSize: 11, fontWeight: 800, letterSpacing: 2, display: "flex", alignItems: "center", gap: 4 }}>
            <span>{"✓".repeat(ou.units)}</span>
            <span style={{ fontSize: 9, letterSpacing: 0.5 }}>O/U</span>
          </div>
        </div>
      </div>
    );
  }

  // ATS/RL banner (with optional O/U)
  const side = sz.side || signals.spread?.side || "";
  const badgeColor = sz.units >= 3 ? "#2ea043" : sz.units >= 2 ? "#d29922" : "#8b949e";
  const pickName = side === "HOME" ? homeName : awayName;
  const checks = "✓".repeat(sz.units);
  const mktSpread = odds?.homeSpread ?? null;
  let spreadLabel = "RL";
  if (mktSpread != null) {
    if (side === "HOME") {
      spreadLabel = mktSpread > 0 ? `+${mktSpread}` : `${mktSpread}`;
    } else {
      const awaySpread = -mktSpread;
      spreadLabel = awaySpread > 0 ? `+${awaySpread}` : `${awaySpread}`;
    }
  }
  const ouColor = hasOu ? (ou.side === "OVER" ? "#2ea043" : "#58a6ff") : null;

  return (
    <div style={{
      padding: "8px 14px",
      background: sz.units >= 2
        ? "linear-gradient(135deg, #0b2012, #0e2818)"
        : "linear-gradient(135deg, #1a1500, #1e1a08)",
      borderBottom: `1px solid ${sz.units >= 2 ? "#2ea04355" : "#d2992244"}`,
      overflowX: "auto",
      WebkitOverflowScrolling: "touch",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, minWidth: 320 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ display: "flex", gap: 3 }}>
            {[1, 2, 3].map(i => (
              <div key={i} style={{
                width: 20, height: 20, borderRadius: 4,
                background: i <= sz.units ? badgeColor : "#1a1e24",
                border: `1px solid ${i <= sz.units ? badgeColor : "#30363d"}`,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: i <= sz.units ? 12 : 9, fontWeight: 800,
                color: i <= sz.units ? "#fff" : "#484f58",
              }}>{i <= sz.units ? "✓" : `${i}u`}</div>
            ))}
          </div>
          {hasOu && (
            <>
              <div style={{ width: 1, height: 18, background: "#30363d" }} />
              <div style={{ display: "flex", gap: 3 }}>
                {[1, 2, 3].map(i => (
                  <div key={`ou-${i}`} style={{
                    width: 20, height: 20, borderRadius: 4,
                    background: i <= ou.units ? ouColor : "#1a1e24",
                    border: `1px solid ${i <= ou.units ? ouColor : "#30363d"}`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: i <= ou.units ? 12 : 9, fontWeight: 800,
                    color: i <= ou.units ? "#fff" : "#484f58",
                  }}>{i <= ou.units ? "✓" : `${i}u`}</div>
                ))}
              </div>
            </>
          )}
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <span style={{ fontSize: 9, color: C.dim, letterSpacing: 1 }}>RL:</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: badgeColor }}>
                {pickName} {spreadLabel}
              </span>
              {hasOu && (
                <>
                  <span style={{ fontSize: 9, color: C.dim }}>·</span>
                  <span style={{ fontSize: 9, color: C.dim, letterSpacing: 1 }}>O/U:</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: ouColor }}>
                    {ou.side} {ou.units}u
                  </span>
                </>
              )}
            </div>
            <span style={{ fontSize: 10, color: C.muted }}>
              {parseFloat(sz.disagree) % 1 === 0 ? parseInt(sz.disagree) : sz.disagree} runs disagreement · {sz.atsHistorical} RL
              {hasOu && ` · O/U ${parseFloat(ou.diff).toFixed(1)} runs edge`}
            </span>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{
            padding: "3px 10px", borderRadius: 4, background: badgeColor, color: "#fff",
            fontSize: 11, fontWeight: 800, letterSpacing: 2,
            display: "flex", alignItems: "center", gap: 4,
          }}>
            <span>{checks}</span>
            <span style={{ fontSize: 9, letterSpacing: 0.5 }}>RL</span>
          </div>
          {hasOu && (
            <div style={{
              padding: "3px 10px", borderRadius: 4, background: ouColor, color: "#fff",
              fontSize: 11, fontWeight: 800, letterSpacing: 2,
              display: "flex", alignItems: "center", gap: 4,
            }}>
              <span>{"✓".repeat(ou.units)}</span>
              <span style={{ fontSize: 9, letterSpacing: 0.5 }}>O/U</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default function MLBCalendarTab({ calibrationFactor, onGamesLoaded, onRefresh }) {
  const todayStr = pstTodayStr();
  const [dateStr, setDateStr] = useState(todayStr);
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const [oddsData, setOddsData] = useState(null);
  const [refreshingGame, setRefreshingGame] = useState(null);

  const loadGames = useCallback(async (d) => {
    setLoading(true); setGames([]);

    // ── v20: Supabase-only page load — ZERO ESPN/Odds API stat calls ──
    // Step 1: ESPN schedule (game list) + Supabase stored predictions in parallel
    const [raw, storedPreds] = await Promise.all([
      fetchMLBScheduleForDate(d),
      supabaseQuery(
        `/mlb_predictions?game_date=eq.${d}&select=id,game_pk,home_team,away_team,win_pct_home,ml_win_prob_home,ou_total,ml_ou_pred_total,pred_total,pred_home_runs,pred_away_runs,confidence,spread_home,market_spread_home,market_ou_total,market_home_ml,market_away_ml,run_line_home,ml_edge_pct,ml_bet_side,ats_units,ats_side,ats_disagree,ats_direction_flip,ou_pick,ou_tier,ou_edge,ou_units,sp_form_combined,home_starter,away_starter,umpire,home_sp_fip,away_sp_fip,home_woba,away_woba,park_factor,ml_feature_coverage`
      ).catch(e => { console.warn("Failed to load stored MLB predictions:", e); return []; }),
    ]);
    setOddsData(null); // v20: No Odds API on page load — stored market odds from Supabase

    let storedPredMap = new Map();
    if (Array.isArray(storedPreds)) {
      for (const sp of storedPreds) {
        const key = sp.game_pk ? String(sp.game_pk) : `${sp.home_team}|${sp.away_team}`;
        storedPredMap.set(key, sp);
      }
      console.log(`[MLB] Loaded ${storedPredMap.size} stored predictions for ${d}`);
    }

    // Step 2: Build enriched games from stored Supabase data — NO ESPN stat fetches
    const enriched = raw.map(g => {
      const stored = storedPredMap.get(String(g.gamePk));

      // Build odds from stored market data (no Odds API call)
      const gameOdds = stored?.market_spread_home != null ? {
        homeSpread: stored.market_spread_home,
        awaySpread: -stored.market_spread_home,
        homeML: stored.market_home_ml ?? null,
        awayML: stored.market_away_ml ?? null,
        ouLine: stored.market_ou_total ?? null,
        source: "stored",
      } : null;

      const homeName = g.homeAbbr || g.home?.abbreviation || stored?.home_team || "HOME";
      const awayName = g.awayAbbr || g.away?.abbreviation || stored?.away_team || "AWAY";

      if (stored && stored.ml_win_prob_home != null) {
        // ═══ PRIMARY: Build pred entirely from stored Supabase data ═══
        const wp = Math.max(0.25, Math.min(0.75, stored.ml_win_prob_home));
        const margin = stored.spread_home ?? 0;
        const VIG = 0;
        const hProb = wp + VIG, aProb = (1 - wp) + VIG;
        const pred = {
          homeWinPct: wp,
          awayWinPct: 1 - wp,
          homeRuns: stored.pred_home_runs ?? (4.5 + margin / 2),
          awayRuns: stored.pred_away_runs ?? (4.5 - margin / 2),
          ouTotal: stored.pred_total ?? stored.ou_total ?? stored.ml_ou_pred_total ?? 9,
          projectedSpread: margin,
          modelML_home: wp >= 0.5
            ? -Math.min(ML_CAP, Math.round((hProb / (1 - hProb)) * 100))
            : +Math.min(ML_CAP, Math.round(((1 - hProb) / hProb) * 100)),
          modelML_away: wp < 0.5
            ? -Math.min(ML_CAP, Math.round((aProb / (1 - aProb)) * 100))
            : +Math.min(ML_CAP, Math.round(((1 - aProb) / aProb) * 100)),
          confidence: stored.confidence || "HIGH",
          confScore: parseFloat(Math.abs(margin).toFixed(1)),
          decisiveness: parseFloat((Math.abs(wp - 0.5) * 100).toFixed(1)),
          mlEnhanced: true,
          _fromStored: true,
          _featureCoverage: stored.ml_feature_coverage,
          // Display stats from stored data
          hFIP: stored.home_sp_fip ?? null,
          aFIP: stored.away_sp_fip ?? null,
          homeWOBA: stored.home_woba ?? null,
          awayWOBA: stored.away_woba ?? null,
          mlOuTotal: stored.pred_total ?? stored.ml_ou_pred_total ?? stored.ou_total ?? null,
          // Stored O/U signals (cron computed)
          _ouPredictedTotal: stored.pred_total ?? stored.ml_ou_pred_total ?? stored.ou_total ?? null,
          _ouPick: stored.ou_pick ?? null,
          _ouTier: stored.ou_tier ?? 0,
          _ouEdge: stored.ou_edge ?? null,
          // Stored ATS signals (cron computed — single source of truth)
          _storedAtsUnits: stored.ats_units ?? null,
          _storedAtsSide: stored.ats_side ?? null,
          _storedAtsDisagree: stored.ats_disagree ?? null,
          _storedAtsPickSpread: stored.market_spread_home ?? null,
          _storedAtsDirectionFlip: stored.ats_direction_flip ?? false,
          // Stored ML odds for edge calculation
          _storedHomeML: stored.market_home_ml ?? null,
          _storedAwayML: stored.market_away_ml ?? null,
        };
        console.log(`[MLB STORED] ${homeName}: wp=${wp.toFixed(3)}, margin=${margin.toFixed?.(1) ?? margin}, ats=${stored.ats_units ?? 0}u`);
        return {
          ...g, pred, loading: false, odds: gameOdds,
          mlShap: null, mlMeta: null, mc: null,
          // Carry through stored starters/umpire for display
          homeStarter: stored.home_starter || g.homeStarter,
          awayStarter: stored.away_starter || g.awayStarter,
          umpire: stored.umpire ? { name: stored.umpire } : g.umpire,
          venue: g.venue,
        };
      }

      // ═══ No stored prediction — PENDING state ═══
      console.log(`[MLB PENDING] ${homeName}: no stored prediction — use 🔄 to generate`);
      return {
        ...g,
        pred: {
          homeWinPct: 0.5, awayWinPct: 0.5,
          homeRuns: null, awayRuns: null,
          ouTotal: null, projectedSpread: 0,
          modelML_home: 100, modelML_away: 100,
          confidence: "PENDING", confScore: 0, decisiveness: 0,
          mlEnhanced: false, _notYetPredicted: true,
          hFIP: null, aFIP: null, homeWOBA: null, awayWOBA: null,
        },
        loading: false, odds: gameOdds,
        mlShap: null, mlMeta: null, mc: null,
      };
    });

    // ── Sort: Finals sink to bottom, rest by start time ──
    enriched.sort((a, b) => {
      const aFinal = a.status === "Final" ? 1 : 0;
      const bFinal = b.status === "Final" ? 1 : 0;
      if (aFinal !== bFinal) return aFinal - bFinal;
      return new Date(a.gameDate || 0) - new Date(b.gameDate || 0);
    });

    setGames(enriched);
    onGamesLoaded?.(enriched);
    setLoading(false);
  }, []);


  // Per-game refresh: calls ML API → computes ATS/O/U → saves to Supabase → displays stored result
  const refreshGame = useCallback(async (game) => {
    const gamePk = game.gamePk || game.gameId;
    setRefreshingGame(gamePk);
    try {
      const mlResult = await mlPredictMLBFull(gamePk, { gameDate: dateStr });
      if (!mlResult) { setRefreshingGame(null); return; }
      if (mlResult.error) { console.warn("[MLB refresh] API error:", mlResult.error); setRefreshingGame(null); return; }

      const margin = mlResult.ml_margin ?? 0;
      const wp = mlResult.ml_win_prob_home ?? 0.5;
      const pt = mlResult.pred_total ?? null;
      const ds = mlResult.data_sources ?? {};
      const totalBase = pt || 9.0;

      // Save to Supabase (single source of truth)
      const patch = {
        win_pct_home: parseFloat(wp.toFixed(4)),
        ml_win_prob_home: parseFloat(wp.toFixed(4)),
        spread_home: parseFloat(margin.toFixed(2)),
        pred_home_runs: parseFloat((totalBase / 2 + margin / 2).toFixed(2)),
        pred_away_runs: parseFloat((totalBase / 2 - margin / 2).toFixed(2)),
        ou_total: pt ? parseFloat(pt.toFixed(1)) : null,
        ml_ou_pred_total: pt ? parseFloat(pt.toFixed(2)) : null,
        ml_feature_coverage: mlResult.feature_coverage || null,
        // Display stats
        home_starter: mlResult.home_starter || null,
        away_starter: mlResult.away_starter || null,
        umpire: mlResult.umpire || null,
        home_sp_fip: ds.home_sp_fip ?? null,
        away_sp_fip: ds.away_sp_fip ?? null,
        home_woba: ds.home_woba ?? null,
        away_woba: ds.away_woba ?? null,
        park_factor: ds.park_factor ?? null,
      };

      // ATS: v9 sniper → 2u, v11 consensus → 1u fallback
      const mktSpread = mlResult.market_spread_home ?? game.odds?.homeSpread ?? null;
      if (mktSpread !== null) {
        patch.market_spread_home = mktSpread;
      }
      if (mlResult.ats_v9_units > 0) {
        patch.ats_side = mlResult.ats_v9_side;
        patch.ats_units = 2;  // v9 sniper = 2u conviction
        patch.ats_models_agree = mlResult.ats_v9_models_agree ?? null;
        patch.ats_model_version = "v9";
        patch.ats_disagree = mlResult.ats_v9_edge ?? null;
      } else if (mlResult.v11_ats_units > 0) {
        patch.ats_side = mlResult.v11_ats_pick;
        patch.ats_units = 1;  // v11 consensus = 1u volume
        patch.ats_models_agree = true;
        patch.ats_model_version = "v11";
        patch.ats_disagree = mlResult.v11_avg_edge ?? null;
      } else {
        patch.ats_units = 0;
      }

      // O/U pick — use backend v2 model result directly
      if (mlResult.ou_pick) {
        patch.ou_pick = mlResult.ou_pick;
        patch.ou_tier = mlResult.ou_tier;
        patch.ou_units = mlResult.ou_units;
      }
      if (mlResult.ou_edge != null) patch.ou_edge = mlResult.ou_edge;
      if (mlResult.market_ou_total) patch.market_ou_total = mlResult.market_ou_total;
      if (mlResult.sp_form_combined != null) patch.sp_form_combined = mlResult.sp_form_combined;
      if (pt) patch.pred_total = parseFloat(pt.toFixed(2));

      // Metadata
      patch.refreshed_at = new Date().toISOString();
      patch.lineup_available = mlResult.lineup_available ?? false;

      // Compute ML edge — prefer backend-fetched odds, fall back to stored
      const hml = mlResult.market_home_ml ?? game.odds?.homeML ?? null;
      const aml = mlResult.market_away_ml ?? game.odds?.awayML ?? null;
      if (hml && aml) {
        const hImp = hml < 0 ? Math.abs(hml) / (Math.abs(hml) + 100) : 100 / (hml + 100);
        const aImp = aml < 0 ? Math.abs(aml) / (Math.abs(aml) + 100) : 100 / (aml + 100);
        const vigT = hImp + aImp;
        const hTrue = vigT > 0 ? hImp / vigT : 0.5;
        const mlEdge = wp - hTrue;
        patch.ml_edge_pct = parseFloat((Math.abs(mlEdge) * 100).toFixed(2));
        patch.ml_bet_side = mlEdge >= 0 ? "HOME" : "AWAY";
        patch.market_home_ml = hml;
        patch.market_away_ml = aml;
      }

      await supabaseQuery(`/mlb_predictions?game_pk=eq.${gamePk}`, "PATCH", patch).catch(e => {
        console.warn("[MLB refresh] Supabase save failed:", e);
      });

      // Reload from Supabase to get consistent state
      await loadGames(dateStr);
      onRefresh?.();
      console.log(`[MLB REFRESH] ${game.homeAbbr}: wp=${wp.toFixed(3)}, ats=${patch.ats_units ?? 0}u${patch.ats_model_version ? `(${patch.ats_model_version})` : ''}, saved to Supabase`);
    } catch (e) { console.warn("[MLB refresh] error:", e); }
    setRefreshingGame(null);
  }, [dateStr, loadGames, onRefresh]);
  useEffect(() => { loadGames(dateStr); }, [dateStr]);

  const getBannerInfo = (pred, odds, hasStarter) => {
    if (!pred) return { color: "yellow", label: "⚠ No prediction" };
    if (!hasStarter) return { color: "yellow", label: "⚠ Starters TBD" };
    const dec = pred.decisiveness ?? (Math.abs(pred.homeWinPct - 0.5) * 100);
    const favSide = pred.homeWinPct >= 0.5 ? "HOME" : "AWAY";
    const favPct = Math.max(pred.homeWinPct, 1 - pred.homeWinPct);
    if (odds?.homeML && odds?.awayML) {
      const market = trueImplied(odds.homeML, odds.awayML);
      const homeEdge = pred.homeWinPct - market.home;
      if (dec >= (DECISIVENESS_GATE?.mlb ?? 10) && Math.abs(homeEdge) >= EDGE_THRESHOLD)
        return { color: "green", edge: homeEdge, label: `+${(Math.abs(homeEdge) * 100).toFixed(1)}% ${homeEdge >= 0 ? "HOME" : "AWAY"} edge` };
      if (Math.abs(homeEdge) >= EDGE_THRESHOLD)
        return { color: "neutral", edge: homeEdge, label: `${(Math.abs(homeEdge) * 100).toFixed(1)}% edge (lean)` };
      return { color: "neutral", edge: homeEdge, label: `${(Math.abs(homeEdge) * 100).toFixed(1)}% edge` };
    }
    if (dec >= (DECISIVENESS_GATE?.mlb ?? 10)) return { color: "green", label: `${favSide} ${(favPct * 100).toFixed(0)}%` };
    return { color: "neutral", label: "Close matchup" };
  };

  const formatGameTime = (gameDate, status) => {
    if (status === "Final") return "FINAL";
    if (status === "Live") return "LIVE";
    if (!gameDate) return "";
    try {
      const date = new Date(gameDate);
      return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    } catch {
      return "";
    }
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <input
          type="date"
          value={dateStr}
          onChange={e => setDateStr(e.target.value)}
          style={{
            background: C.card,
            color: "#e2e8f0",
            border: `1px solid ${C.border}`,
            borderRadius: 6,
            padding: "6px 10px",
            fontSize: 12,
            fontFamily: "inherit"
          }}
        />
        <button
          onClick={() => loadGames(dateStr)}
          style={{
            background: "#161b22",
            color: C.blue,
            border: `1px solid ${C.border}`,
            borderRadius: 6,
            padding: "6px 14px",
            cursor: "pointer",
            fontSize: 11,
            fontWeight: 700
          }}
        >
          ↻ REFRESH
        </button>
        {!loading && oddsData?.games?.length > 0 && <span style={{ fontSize: 11, color: C.green }}>✓ Live odds ({oddsData.games.length})</span>}
        {!loading && oddsData?.noKey && <span style={{ fontSize: 11, color: C.dim }}>⚠ Add ODDS_API_KEY for live lines</span>}
        {loading && (
          <span style={{ color: C.dim, fontSize: 11 }}>
            ⏳ Loading {games.length > 0 ? `${games.length} games` : "predictions"}…
          </span>
        )}
      </div>

      {!loading && games.length === 0 && (
        <div style={{ color: C.dim, textAlign: "center", marginTop: 40 }}>
          No games scheduled for {dateStr}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {games.map(game => {
          const home = mlbTeamById(game.homeTeamId), away = mlbTeamById(game.awayTeamId);
          const homeName = home.abbr;
          const awayName = away.abbr;

          if (!game.pred || game.loading || game.pred._notYetPredicted) {
            return (
              <div
                key={game.gamePk}
                style={{
                  background: `linear-gradient(135deg,${C.card},#111822)`,
                  border: `1px solid ${C.border}`,
                  borderRadius: 10,
                  overflow: "hidden",
                  cursor: "pointer"
                }}
                onClick={() => setExpanded(expanded === game.gamePk ? null : game.gamePk)}
              >
                <div style={{ padding: "14px 18px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
                    <div style={{ minWidth: 60 }}>
                      <div style={{ fontSize: 11, color: C.dim }}>
                        {formatGameTime(game.gameDate, game.status)}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: 16, fontWeight: 800 }}>{awayName}</div>
                      <div style={{ fontSize: 9, color: C.dim }}>AWAY</div>
                      {game.awayStarter && <div style={{ fontSize: 10, color: C.muted }}>{game.awayStarter.split(" ").pop()}{game.awayStarterHand ? ` (${game.awayStarterHand})` : ""}</div>}
                    </div>
                    <div style={{ fontSize: 13, color: C.dim }}>@</div>
                    <div>
                      <div style={{ fontSize: 16, fontWeight: 800 }}>{homeName}</div>
                      <div style={{ fontSize: 9, color: C.dim }}>HOME</div>
                      {game.homeStarter && <div style={{ fontSize: 10, color: C.muted }}>{game.homeStarter.split(" ").pop()}{game.homeStarterHand ? ` (${game.homeStarterHand})` : ""}</div>}
                    </div>
                  </div>
                  <div style={{ color: C.dim, fontSize: 11, display: "flex", alignItems: "center", gap: 8 }}>
                    {game.loading ? "Calculating…" : game.pred?._notYetPredicted ? "PENDING" : "⚠ Data unavailable"}
                    {game.pred?._notYetPredicted && (
                      <span
                        style={{ cursor: "pointer", fontSize: 14, opacity: refreshingGame === game.gamePk ? 0.5 : 1 }}
                        onClick={(e) => { e.stopPropagation(); refreshGame(game); }}
                        title="Generate ML prediction"
                      >
                        {refreshingGame === game.gamePk ? "⏳" : "🔄"}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          }

          const signals = buildStoredSignals({ pred: game.pred, odds: game.odds, sport: "mlb", homeName, awayName });
          const isBetGame = !!signals.betSizing || (signals.ou?.verdict === "GO" && !!signals.ou?.units);
          const bannerInfo = getBannerInfo(game.pred, game.odds, game.homeStarter && game.awayStarter);

          const borderColor = isBetGame
            ? (signals.betSizing ? "#3fb950" : "#58a6ff")
            : (bannerInfo.color === "green" ? "#f97316" : C.border);
          const borderWidth = isBetGame ? "2px" : "1px";
          const mlbDecGate = DECISIVENESS_GATE?.mlb ?? 10;

          return (
            <div
              key={game.gamePk}
              style={{
                background: `linear-gradient(135deg,${C.card},#111822)`,
                border: `${borderWidth} solid ${borderColor}`,
                borderRadius: 10,
                overflow: "hidden",
                boxShadow: isBetGame ? "0 0 10px rgba(63, 185, 80, 0.2)" : "none",
                cursor: "pointer"
              }}
              onClick={() => setExpanded(expanded === game.gamePk ? null : game.gamePk)}
            >
              {/* Bet advantage banner */}
              {isBetGame && (
                <BetBanner signals={signals} homeName={homeName} awayName={awayName} odds={game.odds} />
              )}

              {/* Header - Game time and edge label */}
              <div style={{
                padding: "8px 18px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                background: isBetGame ? "transparent" : "rgba(0,0,0,0.2)"
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: C.blue }}>
                    {formatGameTime(game.gameDate, game.status)}
                  </div>

                  {!isBetGame && bannerInfo.edge != null && Math.abs(bannerInfo.edge) >= EDGE_THRESHOLD && (
                    <div style={{
                      fontSize: 10,
                      padding: "2px 8px",
                      borderRadius: 12,
                      background: "#0d1a2d",
                      color: C.blue
                    }}>
                      {bannerInfo.label}
                    </div>
                  )}
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {game.status === "Final" && <span style={{ fontSize: 10, color: C.green, fontWeight: 700 }}>FINAL {game.awayScore}-{game.homeScore}</span>}
                  {game.status === "Live" && <span style={{ fontSize: 10, color: C.orange, fontWeight: 700 }}>LIVE {game.inningHalf} {game.inning}</span>}
                  {game.umpire?.name && <span style={{ fontSize: 9, color: C.dim }}>⚖ {game.umpire.name.split(" ").pop()}</span>}
                  {game.status !== "Final" && (
                    <span
                      style={{ cursor: "pointer", fontSize: 12, opacity: refreshingGame === game.gamePk ? 0.5 : 1 }}
                      onClick={(e) => { e.stopPropagation(); refreshGame(game); }}
                      title="Refresh prediction with latest data"
                    >
                      {refreshingGame === game.gamePk ? "⏳" : "🔄"}
                    </span>
                  )}
                  <span style={{ color: C.dim, fontSize: 12 }}>
                    {expanded === game.gamePk ? "▲" : "▼"}
                  </span>
                </div>
              </div>

              {/* Main game row — NCAA grid layout */}
              <div style={{ padding: "16px 18px" }}>
                {/* Column headers */}
                <div style={{
                  display: "grid",
                  gridTemplateColumns: "160px 70px 70px 70px 70px 100px",
                  gap: 4,
                  marginBottom: 8,
                  color: C.dim,
                  fontSize: 9,
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.5px"
                }}>
                  <div></div>
                  <div>Runs</div>
                  <div>Mkt RL</div>
                  <div>ML</div>
                  <div>Mkt</div>
                  <div style={{ textAlign: "center" }}>Total (O/U)</div>
                </div>

                {/* Away team */}
                <div style={{
                  display: "grid",
                  gridTemplateColumns: "160px 70px 70px 70px 70px 100px",
                  gap: 4,
                  alignItems: "center",
                  marginBottom: 8
                }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 16, fontWeight: 700 }}>{awayName}</span>
                      <span style={{ fontSize: 8, color: C.dim, marginLeft: 2 }}>AWAY</span>
                    </div>
                    {game.awayStarter && (
                      <span style={{ fontSize: 10, color: C.muted }}>
                        {game.awayStarter.split(" ").pop()}{game.awayStarterHand ? ` (${game.awayStarterHand})` : ""}
                      </span>
                    )}
                  </div>

                  {/* Away projected runs */}
                  <div style={{ fontSize: 12, fontWeight: 500, color: "#e2e8f0" }}>
                    {game.pred.awayRuns?.toFixed(1)}
                  </div>
                  {/* Away market run line */}
                  <div style={{ fontSize: 12, fontWeight: 500, color: game.odds?.homeSpread ? "#e2e8f0" : C.dim }}>
                    {game.odds?.homeSpread ? formatSpread(-game.odds.homeSpread) : "-"}
                  </div>
                  {/* Away model ML — green when away favored + decisive */}
                  <div style={{ fontSize: 12, fontWeight: 500, color: (() => {
                    const dec = game.pred.decisiveness ?? (Math.abs(game.pred.homeWinPct - 0.5) * 100);
                    const awayFavored = game.pred.homeWinPct < 0.5;
                    return (awayFavored && dec >= mlbDecGate) ? C.green : "#e2e8f0";
                  })() }}>
                    
                    {(signals.ml?.verdict === "GO" || signals.ml?.verdict === "LEAN") && signals.ml?.side === "AWAY" && signals.betSizing
                      ? <SignalBadge label={`${signals.betSizing.units}u`} color={signals.ml?.verdict === "GO" ? "#2ea043" : "#d29922"}>{formatML(game.pred.modelML_away)}</SignalBadge>
                      : formatML(game.pred.modelML_away)
                    }
                  </div>
                  {/* Away market ML */}
                  <div style={{ fontSize: 12, fontWeight: 500, color: game.odds?.awayML ? "#e2e8f0" : C.dim }}>
                    {formatML(game.odds?.awayML)}
                  </div>
                  {/* Empty cell for total */}
                  <div></div>
                </div>

                {/* Separator */}
                <div style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginLeft: 70,
                  marginBottom: 8,
                  color: C.dim,
                  fontSize: 10
                }}>
                  @
                </div>

                {/* Home team */}
                <div style={{
                  display: "grid",
                  gridTemplateColumns: "160px 70px 70px 70px 70px 100px",
                  gap: 4,
                  alignItems: "center"
                }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 16, fontWeight: 700 }}>{homeName}</span>
                      <span style={{ fontSize: 8, color: C.dim, marginLeft: 2 }}>HOME</span>
                    </div>
                    {game.homeStarter && (
                      <span style={{ fontSize: 10, color: C.muted }}>
                        {game.homeStarter.split(" ").pop()}{game.homeStarterHand ? ` (${game.homeStarterHand})` : ""}
                      </span>
                    )}
                  </div>

                  {/* Home projected runs */}
                  <div style={{ fontSize: 12, fontWeight: 500, color: "#e2e8f0" }}>
                    {game.pred.homeRuns?.toFixed(1)}
                  </div>
                  {/* Home market run line */}
                  <div style={{ fontSize: 12, fontWeight: 500, color: game.odds?.homeSpread ? "#e2e8f0" : C.dim }}>
                    {game.odds?.homeSpread ? formatSpread(game.odds.homeSpread) : "-"}
                  </div>
                  {/* Home model ML — green when home favored + decisive */}
                  <div style={{ fontSize: 12, fontWeight: 500, color: (() => {
                    const dec = game.pred.decisiveness ?? (Math.abs(game.pred.homeWinPct - 0.5) * 100);
                    const homeFavored = game.pred.homeWinPct >= 0.5;
                    return (homeFavored && dec >= mlbDecGate) ? C.green : "#e2e8f0";
                  })() }}>
                    
                    {(signals.ml?.verdict === "GO" || signals.ml?.verdict === "LEAN") && signals.ml?.side === "HOME" && signals.betSizing
                      ? <SignalBadge label={`${signals.betSizing.units}u`} color={signals.ml?.verdict === "GO" ? "#2ea043" : "#d29922"}>{formatML(game.pred.modelML_home)}</SignalBadge>
                      : formatML(game.pred.modelML_home)
                    }
                  </div>
                  {/* Home market ML */}
                  <div style={{ fontSize: 12, fontWeight: 500, color: game.odds?.homeML ? "#e2e8f0" : C.dim }}>
                    {formatML(game.odds?.homeML)}
                  </div>

                  {/* Total column - shown once for both teams */}
                  <div style={{
                    fontSize: 12,
                    fontWeight: 600,
                    textAlign: "center",
                    display: "flex",
                    flexDirection: "column",
                    gap: 2,
                  }}>

                    <div style={{ color: (signals.ou?.verdict === "GO" || signals.ou?.verdict === "LEAN") ? (signals.ou?.side === "OVER" ? C.green : "#58a6ff") : "#e2e8f0" }}>
                      {(signals.ou?.verdict === "GO") && signals.ou?.units
                        ? <SignalBadge label={`${signals.ou.side} ${signals.ou.units}u`} color={signals.ou?.side === "OVER" ? "#2ea043" : "#58a6ff"}>
                            {signals.ou.modelTotal?.toFixed?.(1) ?? game.pred.ouTotal}{signals.ou?.side && <span style={{ fontSize: 9, marginLeft: 3 }}>{signals.ou.side === "OVER" ? "▲" : "▼"}</span>}
                          </SignalBadge>
                        : game.pred.ouTotal
                      }
                    </div>
                    {game.odds?.ouLine && (
                      <div style={{ fontSize: 10, color: C.yellow }}>mkt: {game.odds.ouLine}</div>
                    )}
                  </div>
                </div>
              </div>

              {/* Confidence footer for bet games */}
              {isBetGame && (
                <div style={{
                  padding: "5px 18px",
                  background: "rgba(0,0,0,0.25)",
                  borderTop: `1px solid ${borderColor}22`,
                  overflowX: "auto",
                  WebkitOverflowScrolling: "touch",
                }}>
                <div style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  fontSize: 10,
                  minWidth: 320,
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ color: C.dim }}>Confidence:</span>
                    <span style={{
                      color: game.pred.confidence === "HIGH" ? C.green : game.pred.confidence === "MEDIUM" ? C.yellow : C.dim,
                      fontWeight: 700,
                    }}>
                      {game.pred.confidence} ({game.pred.confScore})
                    </span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <span style={{ color: C.dim }}>O/U:</span>
                      {signals.ou?.verdict === "GO" ? (
                        <>
                          <span style={{ color: signals.ou.side === "OVER" ? C.green : "#58a6ff", fontWeight: 700 }}>
                            {signals.ou.side} {signals.ou.modelTotal?.toFixed?.(1) ?? ""}
                          </span>
                          <span style={{ color: C.dim }}>
                            ({parseFloat(signals.ou.diff).toFixed(1)} edge)
                          </span>
                        </>
                      ) : game.odds?.ouLine ? (
                        <span style={{ color: C.muted }}>
                          {game.odds.ouLine} (no edge)
                        </span>
                      ) : (
                        <span style={{ color: C.muted }}>—</span>
                      )}
                    </div>
                    {signals.betSizing && (
                      <div style={{ display: "flex", alignItems: "center", gap: 4, borderLeft: `1px solid ${C.border}`, paddingLeft: 8 }}>
                        <span style={{ color: C.dim }}>RL:</span>
                        <span style={{ 
                          color: signals.betSizing.units >= 3 ? C.green : signals.betSizing.units >= 2 ? C.yellow : C.muted, 
                          fontWeight: 700 
                        }}>
                          {signals.betSizing.atsHistorical}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
                </div>
              )}

              {/* Expanded view */}
              {expanded === game.gamePk && (
                <div
                  onClick={(e) => e.stopPropagation()}
                  style={{
                  borderTop: `1px solid ${borderColor}`,
                  padding: "14px 18px",
                  background: "rgba(0,0,0,0.3)"
                }}>
                  <div style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill,minmax(130px,1fr))",
                    gap: 8,
                    marginBottom: 10
                  }}>
                    <Kv k="Projected Score" v={`${awayName} ${game.pred.awayRuns?.toFixed(1) ?? '-'} — ${homeName} ${game.pred.homeRuns?.toFixed(1) ?? '-'}`} />
                    <Kv k="Home Win %" v={`${(game.pred.homeWinPct * 100).toFixed(1)}%`} />
                    <Kv k="O/U Total" v={`${game.pred.ouTotal}`} />
                    <Kv k="Model ML (H)" v={formatML(game.pred.modelML_home)} />
                    <Kv k="Model ML (A)" v={formatML(game.pred.modelML_away)} />
                    {game.odds?.homeML && <Kv k="Market ML (H)" v={formatML(game.odds.homeML)} />}
                    {game.odds?.awayML && <Kv k="Market ML (A)" v={formatML(game.odds.awayML)} />}
                    <Kv k="Home FIP" v={game.pred.hFIP?.toFixed(2)} />
                    <Kv k="Away FIP" v={game.pred.aFIP?.toFixed(2)} />
                    <Kv k="Home wOBA" v={game.pred.homeWOBA?.toFixed(3)} />
                    <Kv k="Away wOBA" v={game.pred.awayWOBA?.toFixed(3)} />
                    {game.umpire?.name && <Kv k="Umpire" v={`${game.umpire.name} (${game.umpire.size})`} />}
                    <Kv k="Confidence" v={`${game.pred.confidence} (${game.pred.confScore})`} />
                    {game.venue && <Kv k="Venue" v={game.venue} />}
                  </div>
                  <BetSignalsPanel
                    signals={signals}
                    pred={game.pred} odds={game.odds} sport="mlb"
                    homeName={homeName} awayName={awayName}
                  />
                  {game.pred?.mlEnhanced && <div style={{ fontSize: 8, color: "#58a6ff", marginTop: 4 }}>⚡ ML-enhanced · trained on {game.mlMeta?.n_train} games · MAE {game.mlMeta?.mae_cv?.toFixed(2)} runs</div>}
                  <ShapPanel shap={game.mlShap} homeName={homeName} awayName={awayName} />
                  <MonteCarloPanel mc={game.mc} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── MLB SECTION (tab wrapper) ────────────────────────────────
export function MLBSection({ mlbGames, setMlbGames, calibrationMLB, setCalibrationMLB, refreshKey, setRefreshKey }) {
  const [tab, setTab] = useState("calendar");
  const TABS = ["calendar", "accuracy", "history", "parlay"];
  return (
    <div>
      <div style={{ display: "flex", gap: 4, marginBottom: 16, flexWrap: "wrap" }}>
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ padding: "6px 16px", borderRadius: 7, border: `1px solid ${tab === t ? "#30363d" : "transparent"}`, background: tab === t ? "#161b22" : "transparent", color: tab === t ? C.blue : C.dim, cursor: "pointer", fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase" }}>
            {t === "calendar" ? "📅" : t === "accuracy" ? "📊" : t === "history" ? "📋" : "🎯"} {t}
          </button>
        ))}
        <button
          onClick={async () => { setRefreshKey(k => k + 1); await mlbAutoSync(msg => console.log(msg)); setRefreshKey(k => k + 1); }}
          style={{ marginLeft: "auto", background: "#161b22", color: C.muted, border: `1px solid ${C.border}`, borderRadius: 7, padding: "6px 14px", cursor: "pointer", fontSize: 10 }}
        >⟳ Auto Sync</button>
      </div>
      {tab === "calendar" && <MLBCalendarTab calibrationFactor={calibrationMLB} onGamesLoaded={setMlbGames} onRefresh={() => setRefreshKey(k => k + 1)} />}
      {tab === "accuracy" && <AccuracyDashboard table="mlb_predictions" refreshKey={refreshKey} onCalibrationChange={setCalibrationMLB} spreadLabel="Run Line" />}
      {tab === "history" && <HistoryTab table="mlb_predictions" refreshKey={refreshKey} />}
      {tab === "parlay" && <ParlayBuilder mlbGames={mlbGames} ncaaGames={[]} />}
    </div>
  );
}
