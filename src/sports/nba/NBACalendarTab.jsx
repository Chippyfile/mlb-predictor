import { pstTodayStr } from "../../utils/dateUtils.js";
// src/sports/nba/NBACalendarTab.jsx
// v18: ML-first prediction — single source of truth
// ML API (/predict/nba/full) is PRIMARY. No blending, no reconciliation.
// What you see = what's stored = what's backtested.
// Heuristic nbaPredictGame is FALLBACK only if ML API fails.
import { useState, useEffect, useCallback } from "react";
import { C, Pill, Kv, confColor2, AccuracyDashboard, HistoryTab, ParlayBuilder, BetSignalsPanel } from "../../components/Shared.jsx";
import ShapPanel from "../../components/ShapPanel.jsx";
import MonteCarloPanel from "../../components/MonteCarloPanel.jsx";
import { trueImplied, EDGE_THRESHOLD, DECISIVENESS_GATE } from "../../utils/sharedUtils.js";
import { buildStoredSignals } from "../../utils/buildStoredSignals.js";
import { supabaseQuery } from "../../utils/supabase.js";
import { mlPredictNBAFull, mlMonteCarlo } from "../../utils/mlApi.js";
import { nbaAutoSync, computeDaysRest } from "./nbaSync.js";
import {
  fetchNBAGamesForDate,
  fetchNBATeamStats,
  matchNBAOddsToGame,
  NBA_TEAM_COLORS,
} from "./nbaUtils.js";

// ML moneyline cap — AUDIT-v3: bumped from 500 to 800 for display fidelity
const ML_CAP = 800;

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

// Format moneyline for display
const formatML = (ml) => {
  if (!ml) return "-";
  return ml > 0 ? `+${ml}` : ml.toString();
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
  
  // Need at least one signal to show banner
  if (!sz && !hasOu) return null;

  // O/U-only banner (no ATS bet)
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
                  {ou.side} {ou.modelTotal?.toFixed?.(0) ?? ""} {ou.side === "OVER" ? "▲" : "▼"}
                </span>
              </div>
              <span style={{ fontSize: 10, color: C.muted }}>
                {parseFloat(ou.diff).toFixed(1)} pts edge vs market · {ou.units}u
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

  // ATS banner (with optional O/U)
  const side = sz.side || signals.spread?.side || "";
  const badgeColor = sz.units >= 3 ? "#2ea043" : sz.units >= 2 ? "#d29922" : "#8b949e";
  const pickName = side === "HOME" ? homeName : awayName;
  const checks = "✓".repeat(sz.units);
  const mktSpread = odds?.homeSpread ?? null;
  let spreadLabel = "ATS";
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
        {/* Left: unit blocks + ATS pick + O/U */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {/* ATS unit blocks */}
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
          {/* O/U unit blocks (when both signals fire) */}
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
              <span style={{ fontSize: 9, color: C.dim, letterSpacing: 1 }}>ATS:</span>
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
              {parseFloat(sz.disagree) % 1 === 0 ? parseInt(sz.disagree) : sz.disagree} pts disagreement · {sz.atsHistorical} ATS
              {hasOu && ` · O/U ${parseFloat(ou.diff).toFixed(1)} pts edge`}
            </span>
          </div>
        </div>
        {/* Right: unit badges */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{
            padding: "3px 10px", borderRadius: 4, background: badgeColor, color: "#fff",
            fontSize: 11, fontWeight: 800, letterSpacing: 2,
            display: "flex", alignItems: "center", gap: 4,
          }}>
            <span>{checks}</span>
            <span style={{ fontSize: 9, letterSpacing: 0.5 }}>ATS</span>
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

// ─────────────────────────────────────────────────────────────
// NBACalendarTab
// ─────────────────────────────────────────────────────────────
export function NBACalendarTab({ calibrationFactor, onGamesLoaded }) {
  const todayStr = pstTodayStr();
  const [dateStr, setDateStr] = useState(todayStr);
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const [oddsInfo, setOddsInfo] = useState(null);
  const [refreshingGame, setRefreshingGame] = useState(null);

  // Per-game refresh: calls ML API → saves to Supabase → displays stored result
  const refreshGame = useCallback(async (game) => {
    setRefreshingGame(game.gameId);
    try {
      const mlResult = await mlPredictNBAFull(game.gameId, { gameDate: dateStr });
      if (!mlResult || mlResult.error) { setRefreshingGame(null); return; }

      const mlMargin = mlResult.ml_margin;
      const mlWinHome = Math.max(0.05, Math.min(0.95, mlResult.ml_win_prob_home ?? 0.5));

      // ── Save to Supabase (single source of truth) ──
      const patch = {
        spread_home: parseFloat(mlMargin.toFixed(1)),
        win_pct_home: parseFloat(mlWinHome.toFixed(4)),
        ml_win_prob_home: parseFloat(mlWinHome.toFixed(4)),
        pred_home_score: mlResult.pred_home_score ? parseFloat(mlResult.pred_home_score.toFixed(1)) : null,
        pred_away_score: mlResult.pred_away_score ? parseFloat(mlResult.pred_away_score.toFixed(1)) : null,
        ou_total: mlResult.ou_predicted_total ? parseFloat(mlResult.ou_predicted_total.toFixed(1)) : null,
        ml_feature_coverage: mlResult.feature_coverage || null,
        ml_model_type: mlResult.model_meta?.model_type || null,
      };
      // O/U v2 fields
      if (mlResult.ou_predicted_total != null) patch.ou_predicted_total = parseFloat(mlResult.ou_predicted_total.toFixed(1));
      if (mlResult.ou_edge != null) patch.ou_edge = parseFloat(mlResult.ou_edge.toFixed(1));
      if (mlResult.ou_pick != null) patch.ou_pick = mlResult.ou_pick;
      if (mlResult.ou_tier != null) patch.ou_tier = mlResult.ou_tier;
      if (mlResult.ou_res_avg != null) patch.ou_res_avg = parseFloat(mlResult.ou_res_avg.toFixed(3));

      // ATS signals with direction flip
      const mktSpread = game.odds?.homeSpread;
      if (mktSpread != null) {
        const mktImplied = -mktSpread;
        const disagree = Math.abs(mlMargin - mktImplied);
        const dirFlip = (mlMargin > 0) !== (mktImplied > 0);
        const threshold = dirFlip ? 3 : 4;
        patch.ats_disagree = parseFloat(disagree.toFixed(2));
        if (disagree >= threshold) {
          patch.ats_side = mlMargin > mktImplied ? "HOME" : "AWAY";
          patch.ats_pick_spread = mktSpread;
          patch.ats_units = dirFlip
            ? (disagree >= 7 ? 3 : disagree >= 5 ? 2 : 1)
            : (disagree >= 10 ? 3 : disagree >= 7 ? 2 : 1);
        } else {
          patch.ats_side = null;
          patch.ats_units = 0;
          patch.ats_pick_spread = null;
        }
      }

      await supabaseQuery(`/nba_predictions?game_id=eq.${game.gameId}`, "PATCH", patch).catch(e => {
        console.warn("[NBA refresh] Supabase save failed:", e);
      });

      // ── Update local display from the same data ──
      setGames(prev => prev.map(g => {
        if (g.gameId !== game.gameId) return g;
        const mlWinAway = 1 - mlWinHome;
        const homeScore = mlResult.pred_home_score ?? (mlMargin != null ? (mlMargin / 2) : null);
        const awayScore = mlResult.pred_away_score ?? (mlMargin != null ? -(mlMargin / 2) : null);
        const VIG = 0;
        const hProb = mlWinHome + VIG, aProb = mlWinAway + VIG;
        const pred = {
          ...(g.pred || {}),
          homeScore: parseFloat(homeScore.toFixed?.(1) ?? homeScore),
          awayScore: parseFloat(awayScore.toFixed?.(1) ?? awayScore),
          projectedSpread: parseFloat(mlMargin.toFixed(1)),
          homeWinPct: mlWinHome,
          awayWinPct: mlWinAway,
          ouTotal: mlResult.ou_predicted_total ?? parseFloat((homeScore + awayScore).toFixed(1)),
          modelML_home: mlWinHome >= 0.5
            ? -Math.min(ML_CAP, Math.round((hProb / (1 - hProb)) * 100))
            : +Math.min(ML_CAP, Math.round(((1 - hProb) / hProb) * 100)),
          modelML_away: mlWinAway >= 0.5
            ? -Math.min(ML_CAP, Math.round((aProb / (1 - aProb)) * 100))
            : +Math.min(ML_CAP, Math.round(((1 - aProb) / aProb) * 100)),
          mlEnhanced: true,
          _ouPredictedTotal: mlResult.ou_predicted_total ?? null,
          _ouEdge: mlResult.ou_edge ?? null,
          _ouPick: mlResult.ou_pick ?? null,
          _ouTier: mlResult.ou_tier ?? null,
          // ATS from the patch we just saved
          _storedAtsUnits: patch.ats_units ?? null,
          _storedAtsSide: patch.ats_side ?? null,
          _storedAtsDisagree: patch.ats_disagree ?? null,
          _storedAtsPickSpread: patch.ats_pick_spread ?? null,
          confidence: Math.abs(mlMargin) >= 7 ? "HIGH" : Math.abs(mlMargin) >= 3 ? "MEDIUM" : "LOW",
          confScore: parseFloat(Math.abs(mlMargin).toFixed(1)),
          decisiveness: parseFloat((Math.abs(mlWinHome - 0.5) * 100).toFixed(1)),
        };
        return {
          ...g, pred,
          mlShap: mlResult.shap ?? g.mlShap,
          mlMeta: mlResult.model_meta ?? g.mlMeta,
        };
      }));
    } catch (e) { console.warn("NBA refreshGame error:", e); }
    setRefreshingGame(null);
  }, [dateStr]);

  const load = useCallback(async (d) => {
    setLoading(true); setGames([]);
    const raw = await fetchNBAGamesForDate(d);
    setOddsInfo(null); // v19: No Odds API on page load — stored market odds from Supabase
    setGames(raw.map(g => ({ ...g, loading: true })));

    // ── v19: Fetch stored predictions FIRST (single source of truth) ──
    let storedPredMap = new Map();
    try {
      const storedPreds = await supabaseQuery(
        `/nba_predictions?game_date=eq.${d}&select=game_id,spread_home,win_pct_home,ml_win_prob_home,market_spread_home,market_ou_total,ou_total,pred_home_score,pred_away_score,ats_disagree,ats_units,ats_side,ats_pick_spread,ml_feature_coverage,ml_model_type,ou_predicted_total,ou_edge,ou_pick,ou_tier,ou_res_avg,ou_cls_avg,market_home_ml,market_away_ml,ml_edge_pct,ml_bet_side,home_ppg,away_ppg,home_opp_ppg,away_opp_ppg,home_net_rtg,away_net_rtg,home_pace,away_pace,home_wins,away_wins,home_losses,away_losses`
      );
      if (Array.isArray(storedPreds)) {
        for (const sp of storedPreds) {
          if (sp.game_id) storedPredMap.set(String(sp.game_id), sp);
        }
        console.log(`[NBA] Loaded ${storedPredMap.size} stored predictions for ${d}`);
      }
    } catch (e) {
      console.warn("[NBA] Failed to load stored predictions:", e);
    }

    // Pre-load team stats — SKIP for games with stored predictions
    const allStatsPairs = await Promise.all(raw.map(async g => {
      const stored = storedPredMap.get(String(g.gameId));
      if (stored?.ml_win_prob_home != null && stored?.home_ppg != null) {
        // Build display stats from stored Supabase data — ZERO ESPN calls
        const hs = {
          ppg: stored.home_ppg, oppPpg: stored.home_opp_ppg,
          pace: stored.home_pace, netRtg: stored.home_net_rtg,
          wins: stored.home_wins, losses: stored.home_losses,
          abbr: g.homeAbbr,
        };
        const as_ = {
          ppg: stored.away_ppg, oppPpg: stored.away_opp_ppg,
          pace: stored.away_pace, netRtg: stored.away_net_rtg,
          wins: stored.away_wins, losses: stored.away_losses,
          abbr: g.awayAbbr,
        };
        const nbaRealH = { pace: hs.pace, netRtg: hs.netRtg };
        const nbaRealA = { pace: as_.pace, netRtg: as_.netRtg };
        return { game: g, hs, as_, nbaRealH, nbaRealA };
      }
      // No stored prediction — fetch from ESPN
      const [hs, as_] = await Promise.all([fetchNBATeamStats(g.homeAbbr), fetchNBATeamStats(g.awayAbbr)]);
      const nbaRealH = hs ? { pace: hs.pace, offRtg: hs.adjOE, defRtg: hs.adjDE, netRtg: hs.netRtg } : null;
      const nbaRealA = as_ ? { pace: as_.pace, offRtg: as_.adjOE, defRtg: as_.adjDE, netRtg: as_.netRtg } : null;
      return { game: g, hs, as_, nbaRealH, nbaRealA };
    }));

    const enriched = await Promise.all(allStatsPairs.map(async ({ game: g, hs, as_, nbaRealH, nbaRealA }) => {
      const homeDaysRest = hs ? computeDaysRest(hs, d) : 2;
      const awayDaysRest = as_ ? computeDaysRest(as_, d) : 2;
      const awayPrevCityAbbr = as_?.lastGameCity || null;

      const rawOdds = null; // v19: Odds API removed — use stored market data
      const gameOdds = rawOdds ? (() => {
        const normalize = s => (s || "").toLowerCase().replace(/[^a-z]/g, "");
        const oddsHome = normalize(rawOdds.homeTeam);
        const espnHome = normalize(g.homeTeamName || g.homeAbbr);
        const espnAway = normalize(g.awayTeamName || g.awayAbbr);
        const homeMatchesHome = oddsHome.includes(espnHome.slice(0, 6)) || espnHome.includes(oddsHome.slice(0, 6));
        const homeMatchesAway = oddsHome.includes(espnAway.slice(0, 6)) || espnAway.includes(oddsHome.slice(0, 6));
        const isSwapped = !homeMatchesHome && homeMatchesAway;
        if (isSwapped) console.warn(`⚠️ NBA ODDS SWAP: Odds="${rawOdds.homeTeam}" vs ESPN="${g.homeTeamName}"`);
        return {
          ...rawOdds,
          homeML: isSwapped ? rawOdds.awayML : rawOdds.homeML,
          awayML: isSwapped ? rawOdds.homeML : rawOdds.awayML,
          homeSpread: isSwapped ? -(rawOdds.marketSpreadHome ?? null) : (rawOdds.marketSpreadHome ?? null),
          ouLine: rawOdds.marketTotal ?? null,
          _swapped: isSwapped,
        };
      })() : (() => {
        // v19: No live odds — use stored market data from Supabase
        const stored = storedPredMap.get(String(g.gameId));
        if (stored?.market_spread_home != null) {
          return {
            homeSpread: stored.market_spread_home,
            awaySpread: -stored.market_spread_home,
            homeML: stored.market_home_ml ?? null,
            awayML: stored.market_away_ml ?? null,
            ouLine: stored.market_ou_total ?? null,
            source: "stored",
          };
        }
        return null;
      })();

      // ═══ v19: STORED PREDICTION PRIMARY — no recomputation ═══
      let mlResult = null, mcResult = null;
      let pred = null;

      const stored = storedPredMap.get(String(g.gameId));

      if (stored && stored.ml_win_prob_home != null) {
        // PRIMARY: Use stored prediction from cron — exact same data as backtesting
        const mlMargin = stored.spread_home ?? 0;
        const mlWinHome = Math.max(0.05, Math.min(0.95, stored.ml_win_prob_home ?? stored.win_pct_home ?? 0.5));
        const mlWinAway = 1 - mlWinHome;
        const homeScore = stored.pred_home_score ?? (mlMargin != null ? (mlMargin / 2) : null);
        const awayScore = stored.pred_away_score ?? (mlMargin != null ? -(mlMargin / 2) : null);
        const VIG = 0;
        const hProb = mlWinHome + VIG, aProb = mlWinAway + VIG;
        pred = {
          homeScore: parseFloat(homeScore.toFixed?.(1) ?? homeScore),
          awayScore: parseFloat(awayScore.toFixed?.(1) ?? awayScore),
          homeWinPct: mlWinHome,
          awayWinPct: mlWinAway,
          projectedSpread: parseFloat(mlMargin.toFixed?.(1) ?? mlMargin),
          ouTotal: stored.ou_predicted_total ?? stored.ou_total ?? parseFloat((homeScore + awayScore).toFixed(1)),
          modelML_home: mlWinHome >= 0.5
            ? -Math.min(ML_CAP, Math.round((hProb / (1 - hProb)) * 100))
            : +Math.min(ML_CAP, Math.round(((1 - hProb) / hProb) * 100)),
          modelML_away: mlWinAway >= 0.5
            ? -Math.min(ML_CAP, Math.round((aProb / (1 - aProb)) * 100))
            : +Math.min(ML_CAP, Math.round(((1 - aProb) / aProb) * 100)),
          homeNetRtg: nbaRealH?.netRtg ?? 0,
          awayNetRtg: nbaRealA?.netRtg ?? 0,
          possessions: hs && as_ ? Math.round((hs.pace + as_.pace) / 2) : 99,
          confidence: Math.abs(mlMargin) >= 7 ? "HIGH" : Math.abs(mlMargin) >= 3 ? "MEDIUM" : "LOW",
          confScore: parseFloat(Math.abs(mlMargin).toFixed(1)),
          decisiveness: parseFloat((Math.abs(mlWinHome - 0.5) * 100).toFixed(1)),
          mlEnhanced: true,
          _fromStored: true,
          _featureCoverage: stored.ml_feature_coverage,
          _ouPredictedTotal: stored.ou_predicted_total ?? stored.ou_total ?? null,
          _ouEdge: stored.ou_edge ?? null,
          _ouPick: stored.ou_pick ?? null,
          _ouTier: stored.ou_tier ?? null,
          _ouResAvg: stored.ou_res_avg ?? null,
          // Stored ATS signals (cron computed — single source of truth)
          _storedAtsUnits: stored.ats_units ?? null,
          _storedAtsSide: stored.ats_side ?? null,
          _storedAtsDisagree: stored.ats_disagree ?? null,
          _storedAtsPickSpread: stored.ats_pick_spread ?? null,
          // Stored ML odds for edge calculation
          _storedHomeML: stored.market_home_ml ?? null,
          _storedAwayML: stored.market_away_ml ?? null,
        };
        // Build fake mlResult for SHAP panel (no SHAP from stored — need refresh for that)
        mlResult = {
          ml_margin: mlMargin,
          ml_win_prob_home: mlWinHome,
          feature_coverage: stored.ml_feature_coverage || "stored",
          _fromSupabase: true,
          ou_predicted_total: stored.ou_predicted_total ?? stored.ou_total ?? null,
          ou_edge: stored.ou_edge ?? null,
          ou_pick: stored.ou_pick ?? null,
          ou_tier: stored.ou_tier ?? null,
          model_meta: { model_type: stored.ml_model_type || "stored" },
        };
        console.log(`[NBA STORED] ${g.homeAbbr}: margin=${mlMargin.toFixed?.(1) ?? mlMargin}, wp=${mlWinHome.toFixed(3)}`);

      } else {
        // No stored prediction — show as unpredicted (use 🔄 refresh to generate)
        // Do NOT call ML API on page load — Supabase is the single source of truth.
        if (hs && as_) {
          pred = {
            homeScore: hs?.ppg ?? null,
            awayScore: as_?.ppg ?? null,
            homeWinPct: 0.5,
            awayWinPct: 0.5,
            projectedSpread: 0,
            ouTotal: (hs?.ppg && as_?.ppg) ? hs.ppg + as_.ppg : null,
            modelML_home: 100,
            modelML_away: 100,
            homeNetRtg: nbaRealH?.netRtg ?? 0,
            awayNetRtg: nbaRealA?.netRtg ?? 0,
            possessions: hs && as_ ? Math.round((hs.pace + as_.pace) / 2) : 99,
            confidence: "PENDING",
            confScore: 0,
            decisiveness: 0,
            mlEnhanced: false,
            _notYetPredicted: true,
          };
          console.log(`[NBA PENDING] ${g.homeAbbr}: no stored prediction — use 🔄 to generate`);
        }
      }

      // Monte Carlo — only on refresh, not stored predictions (avoids API call on every page load)
      if (pred && !pred._fromStored && !pred._notYetPredicted) {
        try {
          mcResult = await mlMonteCarlo("NBA", pred.homeScore, pred.awayScore, 10000, gameOdds?.ouLine ?? pred.ouTotal, g.gameId);
        } catch (e) { console.warn("[NBA MC] failed:", e.message); }
      }

      return { ...g, homeStats: hs, awayStats: as_, pred, loading: false, odds: gameOdds, mlShap: mlResult?.shap ?? null, mlMeta: mlResult?.model_meta ?? null, mc: mcResult };
    }));

    // ── Sort: Finals sink to bottom, rest by start time ──
    enriched.sort((a, b) => {
      const aFinal = a.status === "Final" ? 1 : 0;
      const bFinal = b.status === "Final" ? 1 : 0;
      if (aFinal !== bFinal) return aFinal - bFinal;
      return new Date(a.gameDate || 0) - new Date(b.gameDate || 0);
    });

    setGames(enriched); onGamesLoaded?.(enriched); setLoading(false);
  }, [calibrationFactor]);

  useEffect(() => { load(dateStr); }, [dateStr, calibrationFactor]);

  const getBannerInfo = (pred, odds) => {
    if (!pred) return { color: "yellow", label: "⚠ No prediction" };
    const dec = pred.decisiveness ?? (Math.abs(pred.homeWinPct - 0.5) * 100);
    const favSide = pred.homeWinPct >= 0.5 ? "HOME" : "AWAY";
    const favPct = Math.max(pred.homeWinPct, 1 - pred.homeWinPct);
    if (odds?.homeML && odds?.awayML) {
      const market = trueImplied(odds.homeML, odds.awayML);
      const homeEdge = pred.homeWinPct - market.home;
      if (dec >= (DECISIVENESS_GATE?.nba ?? 15) && Math.abs(homeEdge) >= EDGE_THRESHOLD)
        return { color: "green", edge: homeEdge, label: `+${(Math.abs(homeEdge) * 100).toFixed(1)}% ${homeEdge >= 0 ? "HOME" : "AWAY"} edge` };
      if (Math.abs(homeEdge) >= EDGE_THRESHOLD)
        return { color: "neutral", edge: homeEdge, label: `${(Math.abs(homeEdge) * 100).toFixed(1)}% edge (lean)` };
      return { color: "neutral", edge: homeEdge, label: `${(Math.abs(homeEdge) * 100).toFixed(1)}% edge` };
    }
    if (dec >= (DECISIVENESS_GATE?.nba ?? 15)) return { color: "green", label: `${favSide} ${(favPct * 100).toFixed(0)}%` };
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
        <input type="date" value={dateStr} onChange={e => setDateStr(e.target.value)}
          style={{ background: C.card, color: "#e2e8f0", border: `1px solid ${C.border}`, borderRadius: 6, padding: "6px 10px", fontSize: 12, fontFamily: "inherit" }} />
        <button onClick={() => load(dateStr)}
          style={{ background: "#161b22", color: C.orange, border: `1px solid ${C.border}`, borderRadius: 6, padding: "6px 14px", cursor: "pointer", fontSize: 11, fontWeight: 700 }}>
          ↻ REFRESH
        </button>
        {!loading && oddsInfo?.games?.length > 0 && <span style={{ fontSize: 11, color: C.green }}>✓ Live odds ({oddsInfo.games.length})</span>}
        {loading && (
          <span style={{ color: C.dim, fontSize: 11 }}>
            ⏳ Loading {games.length > 0 ? `${games.length} games` : "schedule"}…
          </span>
        )}
      </div>

      {!loading && games.length === 0 && (
        <div style={{ color: C.dim, textAlign: "center", marginTop: 40 }}>
          No NBA games on {dateStr}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {games.map(game => {
          const homeColor = NBA_TEAM_COLORS[game.homeAbbr] || "#334";
          const awayColor = NBA_TEAM_COLORS[game.awayAbbr] || "#334";
          const homeName = game.homeAbbr;
          const awayName = game.awayAbbr;

          if (!game.pred || game.loading) {
            return (
              <div
                key={game.gameId}
                style={{
                  background: `linear-gradient(135deg,${C.card},#111822)`,
                  border: `1px solid ${C.border}`,
                  borderRadius: 10,
                  overflow: "hidden",
                  cursor: "pointer"
                }}
                onClick={() => setExpanded(expanded === game.gameId ? null : game.gameId)}
              >
                {/* Team color bar */}
                <div style={{ height: 3, background: `linear-gradient(90deg,${awayColor},${homeColor})` }} />
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
                    </div>
                    <div style={{ fontSize: 13, color: C.dim }}>@</div>
                    <div>
                      <div style={{ fontSize: 16, fontWeight: 800 }}>{homeName}</div>
                      <div style={{ fontSize: 9, color: C.dim }}>HOME</div>
                    </div>
                  </div>
                  <div style={{ color: C.dim, fontSize: 11 }}>
                    {game.loading ? "Calculating…" : "⚠ Stats unavailable"}
                  </div>
                </div>
              </div>
            );
          }

          // v19: ALL signals from stored data — Supabase is single source of truth
          // ATS + O/U: from cron computation (stored in Supabase)
          // ML edge: from stored win_prob vs live market odds
          const signals = buildStoredSignals({ pred: game.pred, odds: game.odds, sport: "nba", homeName: game.homeAbbr, awayName: game.awayAbbr });

          const isBetGame = !!signals.betSizing || (signals.ou?.verdict === "GO" && !!signals.ou?.units);
          const bannerInfo = getBannerInfo(game.pred, game.odds);

          const borderColor = isBetGame
            ? (signals.betSizing ? "#3fb950" : "#58a6ff")  // green for ATS, blue for O/U-only
            : (bannerInfo.color === "green" ? "#f97316" : C.border);
          const borderWidth = isBetGame ? "2px" : "1px";
          const nbaDecGate = DECISIVENESS_GATE?.nba ?? 15;

          // Team records
          const homeRecord = game.homeStats && (game.homeStats.wins > 0 || game.homeStats.losses > 0)
            ? `${game.homeStats.wins}-${game.homeStats.losses}` : null;
          const awayRecord = game.awayStats && (game.awayStats.wins > 0 || game.awayStats.losses > 0)
            ? `${game.awayStats.wins}-${game.awayStats.losses}` : null;

          return (
            <div
              key={game.gameId}
              style={{
                background: `linear-gradient(135deg,${C.card},#111822)`,
                border: `${borderWidth} solid ${borderColor}`,
                borderRadius: 10,
                overflow: "hidden",
                boxShadow: isBetGame ? "0 0 10px rgba(63, 185, 80, 0.2)" : "none",
                cursor: "pointer"
              }}
              onClick={() => setExpanded(expanded === game.gameId ? null : game.gameId)}
            >
              {/* Team color bar */}
              <div style={{ height: 3, background: `linear-gradient(90deg,${awayColor},${homeColor})` }} />

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
                  <div style={{ fontSize: 11, fontWeight: 600, color: C.orange }}>
                    {formatGameTime(game.gameDate, game.status)}
                  </div>

                  {!isBetGame && bannerInfo.edge != null && Math.abs(bannerInfo.edge) >= EDGE_THRESHOLD && (
                    <div style={{
                      fontSize: 10,
                      padding: "2px 8px",
                      borderRadius: 12,
                      background: "#2d1a0f",
                      color: C.orange
                    }}>
                      {bannerInfo.label}
                    </div>
                  )}
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {game.status === "Final" && <span style={{ fontSize: 10, color: C.green, fontWeight: 700 }}>FINAL {game.awayScore}–{game.homeScore}</span>}
                  {game.status === "Live" && <span style={{ fontSize: 10, color: C.orange, fontWeight: 700 }}>LIVE</span>}
                  {game.status !== "Final" && game.status !== "Live" && (
                    <span
                      onClick={(e) => { e.stopPropagation(); refreshGame(game); }}
                      style={{ cursor: "pointer", fontSize: 11, opacity: refreshingGame === game.gameId ? 0.5 : 1, padding: "2px 6px", borderRadius: 4, background: "rgba(88,166,255,0.1)", color: "#58a6ff" }}
                      title="Refresh prediction (re-fetch latest data)"
                    >
                      {refreshingGame === game.gameId ? "⏳" : "🔄"}
                    </span>
                  )}
                  <span style={{ color: C.dim, fontSize: 12 }}>
                    {expanded === game.gameId ? "▲" : "▼"}
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
                  <div>Spread</div>
                  <div>Mkt</div>
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
                    {awayRecord && (
                      <span style={{ fontSize: 10, color: C.dim }}>{awayRecord}</span>
                    )}
                  </div>

                  {/* Away spread */}
                  <div style={{ fontSize: 12, fontWeight: 500, color: "#e2e8f0" }}>
                    {signals.spread?.verdict === "LEAN" && signals.betSizing && signals.betSizing.side === "AWAY"
                      ? <SignalBadge label="ATS" color="#d29922">{formatSpread(game.pred.projectedSpread)}</SignalBadge>
                      : formatSpread(game.pred.projectedSpread)
                    }
                  </div>
                  {/* Away market spread */}
                  <div style={{ fontSize: 12, fontWeight: 500, color: game.odds?.homeSpread ? "#e2e8f0" : C.dim }}>
                    {game.odds?.homeSpread ? formatSpread(-game.odds.homeSpread) : "-"}
                  </div>
                  {/* Away model ML — green when away favored + decisive */}
                  <div style={{ fontSize: 12, fontWeight: 500, color: (() => {
                    const dec = game.pred.decisiveness ?? (Math.abs(game.pred.homeWinPct - 0.5) * 100);
                    const awayFavored = game.pred.homeWinPct < 0.5;
                    return (awayFavored && dec >= nbaDecGate) ? C.green : "#e2e8f0";
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
                    {homeRecord && (
                      <span style={{ fontSize: 10, color: C.dim }}>{homeRecord}</span>
                    )}
                  </div>

                  {/* Home spread */}
                  <div style={{ fontSize: 12, fontWeight: 500, color: "#e2e8f0" }}>
                    
                    {signals.spread?.verdict === "LEAN" && signals.betSizing && signals.betSizing.side === "HOME"
                      ? <SignalBadge label="ATS" color="#d29922">{formatSpread(-game.pred.projectedSpread)}</SignalBadge>
                      : formatSpread(-game.pred.projectedSpread)
                    }
                  </div>
                  {/* Home market spread */}
                  <div style={{ fontSize: 12, fontWeight: 500, color: game.odds?.homeSpread ? "#e2e8f0" : C.dim }}>
                    {game.odds?.homeSpread ? formatSpread(game.odds.homeSpread) : "-"}
                  </div>
                  {/* Home model ML — green when home favored + decisive */}
                  <div style={{ fontSize: 12, fontWeight: 500, color: (() => {
                    const dec = game.pred.decisiveness ?? (Math.abs(game.pred.homeWinPct - 0.5) * 100);
                    const homeFavored = game.pred.homeWinPct >= 0.5;
                    return (homeFavored && dec >= nbaDecGate) ? C.green : "#e2e8f0";
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
                            {signals.ou.modelTotal?.toFixed?.(0) ?? game.pred.ouTotal}{signals.ou?.side && <span style={{ fontSize: 9, marginLeft: 3 }}>{signals.ou.side === "OVER" ? "▲" : "▼"}</span>}
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
                            {signals.ou.side} {signals.ou.modelTotal?.toFixed?.(0) ?? ""}
                          </span>
                          <span style={{ color: C.dim }}>
                            ({parseFloat(signals.ou.diff).toFixed(1)}pt edge)
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
                        <span style={{ color: C.dim }}>ATS:</span>
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
              {expanded === game.gameId && (
                <div
                  onClick={(e) => e.stopPropagation()}
                  style={{
                  borderTop: `1px solid ${borderColor}`,
                  padding: "14px 18px",
                  background: "rgba(0,0,0,0.3)"
                }}>
                  <div style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill,minmax(140px,1fr))",
                    gap: 8,
                    marginBottom: 10
                  }}>
                    <Kv k="Projected Score" v={`${awayName} ${game.pred.awayScore?.toFixed(0) ?? "—"} — ${homeName} ${game.pred.homeScore?.toFixed(0) ?? "—"}`} />
                    <Kv k="Win %" v={`${homeName} ${(game.pred.homeWinPct*100).toFixed(1)}% / ${awayName} ${((game.pred.awayWinPct ?? (1-game.pred.homeWinPct))*100).toFixed(1)}%`} />
                    <Kv k="Spread" v={game.pred.projectedSpread > 0 ? `${homeName} -${game.pred.projectedSpread.toFixed(1)}` : `${awayName} -${(-game.pred.projectedSpread).toFixed(1)}`} />
                    <Kv k="O/U Total" v={game.pred._ouPredictedTotal
                      ? `${game.pred._ouPredictedTotal.toFixed(1)} ML${game.pred._ouEdge ? ` (${game.pred._ouEdge > 0 ? '+' : ''}${game.pred._ouEdge.toFixed(1)} vs mkt)` : ''}`
                      : game.pred.ouTotal} />
                    <Kv k="Possessions" v={game.pred.possessions} />
                    <Kv k={`${homeName} Net Rtg`} v={game.pred.homeNetRtg} />
                    <Kv k={`${awayName} Net Rtg`} v={game.pred.awayNetRtg} />
                    {game.homeStats && <Kv k={`${homeName} PPG`} v={game.homeStats.ppg?.toFixed(1)} />}
                    {game.awayStats && <Kv k={`${awayName} PPG`} v={game.awayStats.ppg?.toFixed(1)} />}
                    {game.homeStats && <Kv k={`${homeName} Opp PPG`} v={game.homeStats.oppPpg?.toFixed(1)} />}
                    {game.awayStats && <Kv k={`${awayName} Opp PPG`} v={game.awayStats.oppPpg?.toFixed(1)} />}
                    <Kv k="Confidence" v={`${game.pred.confidence} (${game.pred.confScore})`} />
                  </div>
                  <BetSignalsPanel signals={signals} pred={game.pred} odds={game.odds} sport="nba" homeName={homeName} awayName={awayName} />
                  {game.pred?.mlEnhanced && <div style={{ fontSize: 8, color: "#58a6ff", marginTop: 4 }}>⚡ ML-enhanced · trained on {game.mlMeta?.n_train} games · MAE {game.mlMeta?.mae_cv?.toFixed(1)} pts</div>}
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

// ─────────────────────────────────────────────────────────────
// NBASection
// ─────────────────────────────────────────────────────────────
export function NBASection({ nbaGames, setNbaGames, calibrationNBA, setCalibrationNBA, refreshKey, setRefreshKey }) {
  const [tab, setTab] = useState("calendar");
  const [syncMsg, setSyncMsg] = useState("");
  return (
    <div>
      <div style={{ display: "flex", gap: 4, marginBottom: 8, flexWrap: "wrap", alignItems: "center" }}>
        {["calendar","accuracy","history","parlay"].map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: "6px 16px", borderRadius: 7, border: `1px solid ${tab === t ? "#30363d" : "transparent"}`,
            background: tab === t ? "#161b22" : "transparent", color: tab === t ? C.orange : C.dim,
            cursor: "pointer", fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase",
          }}>
            {t === "calendar" ? "📅" : t === "accuracy" ? "📊" : t === "history" ? "📋" : "🎯"} {t}
          </button>
        ))}
        <div style={{ marginLeft: "auto" }}>
          <button onClick={async () => { setSyncMsg("Syncing…"); await nbaAutoSync(m => setSyncMsg(m)); setRefreshKey(k => k+1); setTimeout(() => setSyncMsg(""), 4000); }}
            style={{ background: "#161b22", color: C.muted, border: `1px solid ${C.border}`, borderRadius: 7, padding: "6px 12px", cursor: "pointer", fontSize: 10 }}>
            ⟳ Sync
          </button>
        </div>
      </div>
      {syncMsg && <div style={{ background: "#0d1a10", border: "1px solid #1a3a1a", borderRadius: 7, padding: "8px 14px", marginBottom: 12, fontSize: 11, color: C.green, fontFamily: "monospace" }}>{syncMsg}</div>}
      {tab === "calendar" && <NBACalendarTab calibrationFactor={calibrationNBA} onGamesLoaded={setNbaGames} />}
      {tab === "accuracy" && <AccuracyDashboard table="nba_predictions" refreshKey={refreshKey} onCalibrationChange={setCalibrationNBA} spreadLabel="Spread" />}
      {tab === "history" && <HistoryTab table="nba_predictions" refreshKey={refreshKey} />}
      {tab === "parlay" && <ParlayBuilder mlbGames={[]} ncaaGames={[]} nbaGames={nbaGames} />}
    </div>
  );
}
