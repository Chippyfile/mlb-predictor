import { pstTodayStr } from "../../utils/dateUtils.js";
// src/sports/ncaa/NCAACalendarTab.jsx
import React, { useState, useEffect, useCallback, useRef } from "react";
import { C, confColor2, Pill, Kv, BetSignalsPanel, AccuracyDashboard, HistoryTab, ParlayBuilder } from "../../components/Shared.jsx";
import ShapPanel from "../../components/ShapPanel.jsx";
import MonteCarloPanel from "../../components/MonteCarloPanel.jsx";
import { getBetSignals, trueImplied, EDGE_THRESHOLD, DECISIVENESS_GATE } from "../../utils/sharedUtils.js";
import { mlPredict, mlPredictFull, mlMonteCarlo } from "../../utils/mlApi.js";
import { fetchNCAATeamStats, fetchNCAAGamesForDate, ncaaPredictGame, detectMissingStarters, getGameContext, calculateDynamicSigma, fetchNCAAKenPomRatings, applyKenPomRatings, computeRestDays } from "./ncaaUtils.js";
import { ncaaAutoSync, ncaaFullBackfill, ncaaRegradeAllResults } from "./ncaaSync.js";
import { supabaseQuery } from "../../utils/supabase.js";
import MarchMadnessPanel from "./MarchMadnessPanel.jsx";

// Season start (Nov 1 of prior year) — keep in sync with ncaaSync.js
const _ncaaSeasonStart = (() => {
  const now = new Date();
  const seasonYear = now.getMonth() < 7 ? now.getFullYear() - 1 : now.getFullYear();
  return `${seasonYear}-11-01`;
})();

// ML moneyline cap
const ML_CAP = 4000;

// Unit badge for spread/ML/OU cells — replaces "BET"/"LEAN" text with ✓ 1u/2u/3u
// Inline signal badge — wraps a value with a colored label tag
// For ML: shows "2u" (bet sizing). For ATS/O/U: shows "ATS"/"O/U" (signal type)
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

// Bet advantage banner for game cards — ATS DISAGREEMENT BASED
// Uses checkmark unit indicators: ✓ = 1u, ✓✓ = 2u, ✓✓✓ = 3u
// Driven by |model_margin - market_margin| validated on 26K out-of-sample games
const BetBanner = ({ signals, homeName, awayName, odds }) => {
  const sz = signals?.betSizing;
  const ou = signals?.ou;
  const hasOu = ou && ou.verdict === "GO" && ou.side;
  
  // Need at least one signal to show banner
  if (!sz && !hasOu) return null;

  // O/U-only banner (no ATS bet)
  if (!sz && hasOu) {
    const ouColor = ou.side === "OVER" ? "#2ea043" : "#58a6ff";
    const ouChecks = "✓".repeat(ou.units);
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
                  {ou.side} {ou.modelTotal?.toFixed?.(0) ?? ou.marketLine ?? ""} {ou.side === "OVER" ? "▲" : "▼"}
                </span>
              </div>
              <span style={{ fontSize: 10, color: C.muted }}>
                {ou.edge.toFixed(1)} pts edge vs market · {ou.units}u
              </span>
            </div>
          </div>
          <div style={{ padding: "3px 10px", borderRadius: 4, background: ouColor, color: "#fff", fontSize: 11, fontWeight: 800, letterSpacing: 2, display: "flex", alignItems: "center", gap: 4 }}>
            <span>{ouChecks}</span>
            <span style={{ fontSize: 9, letterSpacing: 0.5 }}>{ou.units}u</span>
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
  // ATS pick: team + actual market spread (what you'd bet at the book)
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

  // O/U signal (already declared above)
  const ouColor = ou?.side === "OVER" ? "#2ea043" : "#58a6ff";
  
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
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
        minWidth: 320,
      }}>
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
            {parseFloat(sz.disagree) % 1 === 0 ? parseInt(sz.disagree) : sz.disagree} pts disagreement · {sz.atsHistorical} ATS historical
            {hasOu && ` · O/U ${ou.edge.toFixed(1)} pts edge`}
          </span>
        </div>
      </div>
      
      {/* Right: unit badges */}
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <div style={{
          padding: "3px 10px",
          borderRadius: 4,
          background: badgeColor,
          color: "#fff",
          fontSize: 11,
          fontWeight: 800,
          letterSpacing: 2,
          display: "flex",
          alignItems: "center",
          gap: 4,
        }}>
          <span>{checks}</span>
          <span style={{ fontSize: 9, letterSpacing: 0.5 }}>ATS</span>
        </div>
        {hasOu && (
          <div style={{
            padding: "3px 10px",
            borderRadius: 4,
            background: ouColor,
            color: "#fff",
            fontSize: 11,
            fontWeight: 800,
            letterSpacing: 2,
            display: "flex",
            alignItems: "center",
            gap: 4,
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

export default function NCAACalendarTab({ calibrationFactor, onGamesLoaded }) {
  const todayStr = pstTodayStr();
  const [dateStr, setDateStr] = useState(todayStr);
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const [refreshingGame, setRefreshingGame] = useState(null);

  // Per-game refresh: re-calls ML API and updates display + Supabase
  const refreshGame = useCallback(async (game, idx) => {
    setRefreshingGame(game.gameId);
    try {
      const mlResult = await mlPredictFull(
        game.homeTeamId, game.awayTeamId,
        { neutralSite: game.neutralSite, gameDate: dateStr, gameId: game.gameId }
      );
      if (!mlResult || mlResult.error) {
        setRefreshingGame(null);
        return;
      }
      // Update game in state with new ML data
      setGames(prev => prev.map((g, i) => {
        if (g.gameId !== game.gameId) return g;
        const mlMargin = mlResult.ml_margin;
        const mlWinProb = mlResult.ml_win_prob_home;
        const pred = g.pred ? { ...g.pred } : {};
        const heuristicMargin = pred.projectedSpread || 0;
        const marginShift = (mlMargin - heuristicMargin) / 2;
        pred.homeScore = parseFloat(((pred._heuristicHomeScore || pred.homeScore || 70) + marginShift).toFixed(1));
        pred.awayScore = parseFloat(((pred._heuristicAwayScore || pred.awayScore || 70) - marginShift).toFixed(1));
        pred.projectedSpread = parseFloat(mlMargin.toFixed(1));
        pred.homeWinPct = Math.max(0.05, Math.min(0.95, mlWinProb));
        pred.awayWinPct = 1 - pred.homeWinPct;
        pred.mlEnhanced = true;
        // Recalculate moneylines (no vig — backend probabilities are fair)
        const hp = pred.homeWinPct, ap = pred.awayWinPct;
        pred.modelML_home = pred.homeWinPct >= 0.5
          ? -Math.min(4000, Math.round((hp / (1 - hp)) * 100))
          : +Math.min(4000, Math.round(((1 - hp) / hp) * 100));
        pred.modelML_away = pred.homeWinPct < 0.5
          ? -Math.min(4000, Math.round((ap / (1 - ap)) * 100))
          : +Math.min(4000, Math.round(((1 - ap) / ap) * 100));
        return {
          ...g, pred,
          mlShap: mlResult.shap ?? g.mlShap,
          mlMeta: mlResult.model_meta ?? g.mlMeta,
          mlFeatureCoverage: mlResult.feature_coverage ?? null,
          mlDataSources: mlResult.data_sources ?? null,
        };
      }));
      // Write updated prediction back to Supabase
      const mktSpread = game.odds?.homeSpread ?? null;
      const modelMargin = mlResult.ml_margin;
      const patch = {
        spread_home: parseFloat(modelMargin.toFixed(1)),
        win_pct_home: parseFloat(mlResult.ml_win_prob_home.toFixed(4)),
        ml_win_prob_home: parseFloat(mlResult.ml_win_prob_home.toFixed(4)),
        rating_synced_at: new Date().toISOString(),
      };
      if (mktSpread != null) {
        const mktImplied = -mktSpread;
        const disagree = Math.abs(modelMargin - mktImplied);
        patch.ats_disagree = parseFloat(disagree.toFixed(2));
        if (disagree >= 4) {
          patch.ats_side = modelMargin > mktImplied ? "HOME" : "AWAY";
          patch.ats_pick_spread = mktSpread;
          patch.ats_units = disagree >= 10 ? 3 : disagree >= 7 ? 2 : 1;
        } else {
          patch.ats_side = null;
          patch.ats_units = 0;
          patch.ats_pick_spread = null;
        }
      }
      await supabaseQuery(`/ncaa_predictions?game_id=eq.${game.gameId}`, "PATCH", patch).catch(() => {});
    } catch (e) {
      console.warn("refreshGame error:", e);
    }
    setRefreshingGame(null);
  }, [dateStr]);

  const loadGames = useCallback(async (d) => {
    setLoading(true);
    setGames([]);
    console.log(`Loading NCAA games for ${d}...`);
    
    const [raw, kenPomMap] = await Promise.all([
      fetchNCAAGamesForDate(d),
      fetchNCAAKenPomRatings(),
    ]);
    
    console.log(`Found ${raw?.length || 0} games on ${d}`);
    
    // If no games from ESPN, show empty state
    if (!raw || raw.length === 0) {
      setGames([]);
      onGamesLoaded?.([]);
      setLoading(false);
      return;
    }
    
    // ── Filter out junk games BEFORE expensive enrichment ──
    // ESPN scoreboard returns TBD placeholders (team ID -2), exhibition
    // teams, and non-D1 schools that each waste 4+ API calls for useless data.
    const validGames = raw.filter(g => {
      const hId = parseInt(g.homeTeamId);
      const aId = parseInt(g.awayTeamId);
      if (!hId || !aId || hId < 0 || aId < 0) return false;
      if (/^TBD$/i.test(g.homeAbbr) || /^TBD$/i.test(g.awayAbbr) ||
          /^TBD$/i.test(g.homeTeamName) || /^TBD$/i.test(g.awayTeamName)) return false;
      return true;
    });
    if (validGames.length < raw.length) {
      console.log(`Filtered ${raw.length - validGames.length} TBD/invalid → ${validGames.length} valid`);
    }
    if (validGames.length === 0) {
      setGames([]);
      onGamesLoaded?.([]);
      setLoading(false);
      return;
    }

    // ── Top-150 filter BEFORE expensive enrichment ──
    // kenPomMap is keyed by String(team_id) with rank_adj_em field.
    // Use it to skip games with no top-150 team before expensive API calls.
    const TOP_N = 150;
    const hasKenPom = kenPomMap && kenPomMap.size > 100;

    let rankedGames;
    if (!hasKenPom) {
      // Ratings not loaded — skip pre-filter, enrich everything
      console.log(`Top-${TOP_N} pre-filter: SKIPPED (ratings not loaded, ${kenPomMap?.size || 0} entries)`);
      rankedGames = validGames;
    } else {
      rankedGames = validGames.filter(g => {
        // kenPomMap is keyed by String(team_id)
        const hEntry = kenPomMap.get(String(g.homeTeamId));
        const aEntry = kenPomMap.get(String(g.awayTeamId));
        const hRank = hEntry?.rank_adj_em ?? hEntry?.rank ?? (g.homeRank || 999);
        const aRank = aEntry?.rank_adj_em ?? aEntry?.rank ?? (g.awayRank || 999);
        return hRank <= TOP_N || aRank <= TOP_N;
      });
      console.log(`Top-${TOP_N} pre-filter: ${validGames.length} → ${rankedGames.length} games (skipped ${validGames.length - rankedGames.length} low-ranked)`);
    }

    if (rankedGames.length === 0) {
      console.log(`Top-${TOP_N} pre-filter: 0 games passed — showing all ${validGames.length} as fallback`);
      rankedGames = validGames; // Fallback: never show empty if ESPN returned games
    }

    // ── Fetch stored ML predictions from Supabase for this date ──
    // Final/Live games can't call mlPredictFull (contamination risk),
    // so we load the pre-tip predictions that were saved by the cron job.
    let storedPredMap = new Map();
    try {
      const storedPreds = await supabaseQuery(
        `/ncaa_predictions?game_date=eq.${d}&select=game_id,spread_home,win_pct_home,ml_win_prob_home,market_spread_home,market_ou_total,ats_disagree,ats_units,ats_side,ats_pick_spread,ou_total,pred_home_score,pred_away_score`
      );
      if (Array.isArray(storedPreds)) {
        for (const sp of storedPreds) {
          if (sp.game_id) storedPredMap.set(String(sp.game_id), sp);
        }
        console.log(`Loaded ${storedPredMap.size} stored predictions for ${d}`);
      }
    } catch (e) {
      console.warn("Failed to load stored predictions:", e);
    }

    // ── Batch process 8 games at a time to avoid ESPN throttling ──
    // Promise.all on 37+ games fires 150+ simultaneous ESPN requests.
    const BATCH = 8;
    const allEnriched = [];
    for (let bi = 0; bi < rankedGames.length; bi += BATCH) {
      const slice = rankedGames.slice(bi, bi + BATCH);
      const batchResults = await Promise.all(slice.map(async (g) => {
      const [homeStats, awayStats] = await Promise.all([
        fetchNCAATeamStats(g.homeTeamId).catch(() => null),
        fetchNCAATeamStats(g.awayTeamId).catch(() => null)
      ]);
      
      if (kenPomMap && kenPomMap.size > 100) {
        if (homeStats) applyKenPomRatings(homeStats, kenPomMap);
        if (awayStats) applyKenPomRatings(awayStats, kenPomMap);
      }
      
      const [injuryData, gameContext, homeRestDays, awayRestDays] = await Promise.all([
        detectMissingStarters(g.gameId, g.homeTeamId, g.awayTeamId).catch(() => null),
        Promise.resolve(getGameContext(d, g.neutralSite)),
        computeRestDays(g.homeTeamId, d).catch(() => 3),
        computeRestDays(g.awayTeamId, d).catch(() => 3),
      ]);
      
      const dynamicSigma = homeStats && awayStats ? calculateDynamicSigma(homeStats, awayStats, d) : 6.5;
      const effectiveNeutral = (gameContext?.override_neutral || g.neutralSite);
      // v19: Only compute heuristic if no stored prediction — stored predictions are primary
      const storedHere = storedPredMap.get(String(g.gameId));
      const pred = storedHere?.ml_win_prob_home != null
        ? (() => {
            // Build minimal pred from stored data for downstream compatibility
            const sm = storedHere.spread_home ?? 0;
            const swp = storedHere.ml_win_prob_home ?? 0.5;
            const shs = storedHere.pred_home_score ?? (homeStats?.ppg ?? 70) + sm / 2;
            const sas = storedHere.pred_away_score ?? (awayStats?.ppg ?? 70) - sm / 2;
            return { homeScore: shs, awayScore: sas, projectedSpread: sm, homeWinPct: swp, awayWinPct: 1 - swp, ouTotal: storedHere.ou_total ?? shs + sas };
          })()
        : (homeStats && awayStats ? ncaaPredictGame({ homeStats, awayStats, neutralSite: effectiveNeutral, calibrationFactor, sigma: dynamicSigma }) : null);
      const rawOdds = null; // Removed: Odds API matching — using ESPN pickcenter instead
      // Build gameOdds from ESPN data (already extracted in detectMissingStarters, zero extra calls)
      const gameOdds = (injuryData?.espn_spread != null || injuryData?.espn_home_ml != null) ? {
        homeSpread: injuryData.espn_spread,
        awaySpread: injuryData.espn_spread != null ? -injuryData.espn_spread : null,
        homeML: injuryData.espn_home_ml,
        awayML: injuryData.espn_away_ml,
        ouLine: injuryData.espn_over_under,
        source: "ESPN",
      } : (() => {
        // v26: For Final/Live games, try stored market data from Supabase
        const stored = storedPredMap.get(String(g.gameId));
        if (stored?.market_spread_home != null) {
          return {
            homeSpread: stored.market_spread_home,
            awaySpread: -stored.market_spread_home,
            ouLine: stored.market_ou_total ?? null,
            source: "stored",
          };
        }
        return null;
      })();
      
      let mlResult = null, mcResult = null;
      if (pred) {
        // v25: Use mlPredictFull — backend fetches all 156 features from Supabase + ESPN
        // CRITICAL: Skip for Live/Final games — ESPN data contains in-game/post-game stats
        // which would contaminate the prediction with future information.
        const isPreGame = g.status !== "Final" && g.status !== "Live";
        if (isPreGame) {
          // v19: Stored prediction PRIMARY (from cron) — same data as backtesting
          const stored = storedPredMap.get(String(g.gameId));
          if (stored && stored.ml_win_prob_home != null) {
            mlResult = {
              ml_margin: stored.spread_home ?? 0,
              ml_win_prob_home: stored.ml_win_prob_home ?? stored.win_pct_home ?? 0.5,
              bias_correction_applied: 0,
              feature_coverage: "stored",
              _fromSupabase: true,
              ou_predicted_total: stored.ou_predicted_total ?? stored.ou_total ?? null,
              ou_edge: stored.ou_edge ?? ((stored.ou_predicted_total ?? stored.ou_total) && stored.market_ou_total
                ? parseFloat(((stored.ou_predicted_total ?? stored.ou_total) - stored.market_ou_total).toFixed(1)) : null),
              ou_pick: stored.ou_pick ?? null,
              ou_tier: stored.ou_tier ?? null,
              ou_res_avg: stored.ou_res_avg ?? null,
            };
            console.log(`[NCAA STORED] ${g.homeTeamName}: margin=${mlResult.ml_margin.toFixed?.(1) ?? mlResult.ml_margin}`);
          } else {
            // No stored prediction — keep heuristic pred as-is, no ML overlay
            // Use 🔄 refresh to generate ML prediction and save to Supabase
            console.log(`[NCAA PENDING] ${g.homeTeamName}: no stored prediction — use 🔄 to generate`);
          }
        } else {
          // v26: For Final/Live games, reconstruct mlResult from stored Supabase prediction
          const stored = storedPredMap.get(String(g.gameId));
          if (stored && stored.ml_win_prob_home != null) {
            mlResult = {
              ml_margin: stored.spread_home ?? 0,
              ml_win_prob_home: stored.ml_win_prob_home ?? stored.win_pct_home ?? 0.5,
              bias_correction_applied: 0,
              feature_coverage: "stored",
              _fromSupabase: true,
              // O/U from stored prediction (v29: use v5 fields when available)
              ou_predicted_total: stored.ou_predicted_total ?? stored.ou_total ?? null,
              ou_edge: stored.ou_edge ?? ((stored.ou_predicted_total ?? stored.ou_total) && stored.market_ou_total
                ? parseFloat(((stored.ou_predicted_total ?? stored.ou_total) - stored.market_ou_total).toFixed(1)) : null),
              ou_pick: stored.ou_pick ?? null,   // v5: from backend triple agreement, not simple threshold
              ou_tier: stored.ou_tier ?? null,
              ou_res_avg: stored.ou_res_avg ?? null,
            };
          }
        }
          
        const mlMarginAdj = mlResult ? (mlResult.ml_margin - pred.projectedSpread) / 2 : 0;
        const heuristicTotal = pred.homeScore + pred.awayScore;
        const ouBase = pred.ouTotal ?? heuristicTotal;
        const homeRatio = heuristicTotal > 0 ? pred.homeScore / heuristicTotal : 0.5;
        const mcHome = ouBase * homeRatio + mlMarginAdj;
        const mcAway = ouBase * (1 - homeRatio) - mlMarginAdj;
        mcResult = mlResult?._fromSupabase ? null : await mlMonteCarlo("NCAAB", mcHome, mcAway, 10000, gameOdds?.ouLine ?? pred.ouTotal, g.gameId);
      }
      
      const finalPred = pred && mlResult ? (() => {
        const mlMargin = mlResult.ml_margin;
        const mlWinProb = mlResult.ml_win_prob_home;

        // v22: Use ML values directly — no blending, no sigma conversion
        // The StackedClassifier + isotonic calibration (Brier 0.111) is the
        // best-calibrated probability. Previous 70/30 blend was compressing it.
        const heuristicMargin = pred.projectedSpread;
        const marginShift = (mlMargin - heuristicMargin) / 2;
        const adjHomeScore = parseFloat((pred.homeScore + marginShift).toFixed(1));
        const adjAwayScore = parseFloat((pred.awayScore - marginShift).toFixed(1));

        // v29: Rescale projected scores to match v5 O/U total (market + residual)
        // Keeps the margin from the ATS model, adjusts total from the O/U model
        let finalHomeScore = adjHomeScore;
        let finalAwayScore = adjAwayScore;
        const v5Total = mlResult.ou_predicted_total;
        if (v5Total && v5Total > 100) {
          finalHomeScore = parseFloat(((v5Total + mlMargin) / 2).toFixed(1));
          finalAwayScore = parseFloat(((v5Total - mlMargin) / 2).toFixed(1));
        }

        const winHome = Math.max(0.05, Math.min(0.95, mlWinProb));
        const winAway = 1 - winHome;

        // Model moneylines — no vig, backend probabilities are fair (isotonic calibrated)
        const homeProb = winHome;
        const awayProb = (1 - winHome);
        const newModelML_home = winHome >= 0.5
          ? -Math.min(ML_CAP, Math.round((homeProb / (1 - homeProb)) * 100))
          : +Math.min(ML_CAP, Math.round(((1 - homeProb) / homeProb) * 100));
        const newModelML_away = winHome < 0.5
          ? -Math.min(ML_CAP, Math.round((awayProb / (1 - awayProb)) * 100))
          : +Math.min(ML_CAP, Math.round(((1 - awayProb) / awayProb) * 100));

        return {
          ...pred,
          homeScore: finalHomeScore,
          awayScore: finalAwayScore,
          homeWinPct: winHome,
          awayWinPct: winAway,
          projectedSpread: parseFloat(mlMargin.toFixed(1)),
          ouTotal: pred.ouTotal,
          modelML_home: newModelML_home,
          modelML_away: newModelML_away,
          mlEnhanced: true,
          biasCorrection: mlResult.bias_correction_applied ?? 0,
          _heuristicHomeScore: pred.homeScore,
          _heuristicAwayScore: pred.awayScore,
          _heuristicSpread: pred.projectedSpread,
          _heuristicWinPct: pred.homeWinPct,
          _rawMlWinProb: mlResult.ml_win_prob_home,
          _ouPredictedTotal: mlResult.ou_predicted_total ?? null,
          _ouEdge: mlResult.ou_edge ?? null,
          _ouPick: mlResult.ou_pick ?? null,
        };
      })() : pred;
      
      const _ouBase2 = pred?.ouTotal ?? (pred?.homeScore + pred?.awayScore);
      const _hTotal2 = (pred?.homeScore + pred?.awayScore) || 1;
      const _homeRatio2 = pred?.homeScore / _hTotal2;
      const _mlAdj2 = mlResult ? (mlResult.ml_margin - pred.projectedSpread) / 2 : 0;
      const mcHomeMean = _ouBase2 * _homeRatio2 + _mlAdj2;
      const mcAwayMean = _ouBase2 * (1 - _homeRatio2) - _mlAdj2;
      
      if (pred && !mcResult && !mlResult?._fromSupabase) {
        mcResult = await mlMonteCarlo("NCAAB", mcHomeMean, mcAwayMean, 10000, gameOdds?.ouLine ?? pred.ouTotal, g.gameId);
      }
      
      // Attach display fields that don't live in pred or mlResult
      if (finalPred) {
        // Guard against ESPN tournament-only records (e.g., "1-0" in March)
        const bestRecord = (stats, scoreboardRecord) => {
          const w = stats?.wins || 0, l = stats?.losses || 0;
          if (w + l >= 10) return `${w}-${l}`;
          if (scoreboardRecord) {
            const p = scoreboardRecord.split("-");
            if (p.length === 2 && parseInt(p[0]) + parseInt(p[1]) >= 10) return scoreboardRecord;
          }
          return w + l > 0 ? `${w}-${l}` : scoreboardRecord || null;
        };
        finalPred.home_record_display = bestRecord(homeStats, g.homeRecord);
        finalPred.away_record_display = bestRecord(awayStats, g.awayRecord);
        finalPred.tv_network = g.tvNetwork || null;
      }

      return {
        ...g, homeStats, awayStats, pred: finalPred, loading: false,
        odds: gameOdds, mlShap: mlResult?.shap ?? null,
        mlMeta: mlResult?.model_meta ?? null, mc: mcResult,
        mlFeatureCoverage: mlResult?.feature_coverage ?? null,
        mlDataSources: mlResult?.data_sources ?? null,
        homeRestDays, awayRestDays
      };
    })); // end Promise.all(slice.map)
      allEnriched.push(...batchResults);
      setGames([...allEnriched]); // progressive render after each batch
    } // end for-loop
    
    // ── Sort: Finals sink to bottom, rest by start time ──
    // (Top-150 filter already applied BEFORE enrichment — no duplicate work)
    allEnriched.sort((a, b) => {
      const aFinal = a.status === "Final" ? 1 : 0;
      const bFinal = b.status === "Final" ? 1 : 0;
      if (aFinal !== bFinal) return aFinal - bFinal;
      // Within same group, sort by game time
      return new Date(a.gameDate || 0) - new Date(b.gameDate || 0);
    });
    
    setGames(allEnriched);
    onGamesLoaded?.(allEnriched);
    setLoading(false);
  }, [calibrationFactor]);

  useEffect(() => {
    loadGames(dateStr);
  }, [dateStr, calibrationFactor]);

  const getBannerInfo = (pred, odds) => {
    if (!pred) return { color: "yellow", label: "⚠ No prediction", disagree: 0 };
    const projSpread = pred.projectedSpread;
    const mktSpread = odds?.homeSpread ?? odds?.marketSpreadHome ?? null;

    if (mktSpread !== null && mktSpread !== undefined) {
      const disagree = Math.abs(projSpread - (-mktSpread));
      const side = (projSpread + mktSpread) > 0 ? "HOME" : "AWAY";
      if (disagree >= 10)
        return { color: "green", disagree, label: `${disagree.toFixed(1)} pts disagree · 3u ATS`, side };
      if (disagree >= 7)
        return { color: "green", disagree, label: `${disagree.toFixed(1)} pts disagree · 2u ATS`, side };
      if (disagree >= 4)
        return { color: "green", disagree, label: `${disagree.toFixed(1)} pts disagree · 1u ATS`, side };
      if (disagree >= 2)
        return { color: "neutral", disagree, label: `${disagree.toFixed(1)} pts disagree (no bet)`, side };
      return { color: "neutral", disagree, label: `${disagree.toFixed(1)} pts disagree`, side };
    }
    // No market spread — fall back to win probability
    const favPct = Math.max(pred.homeWinPct, 1 - pred.homeWinPct);
    return { color: "neutral", disagree: 0, label: `${(favPct * 100).toFixed(0)}% win prob` };
  };

  // Format time from ISO string
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
            color: C.orange,
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
        {!loading && games.some(g => g.odds) && (
          <span style={{ fontSize: 11, color: C.green }}>✓ ESPN odds</span>
        )}
        {loading && (
          <span style={{ color: C.dim, fontSize: 11 }}>
            ⏳ Loading {games.length > 0 ? `${games.length} games` : "schedule"}…
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
          if (!game.pred) {
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
                <div style={{ padding: "14px 18px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
                    <div style={{ minWidth: 60 }}>
                      <div style={{ fontSize: 11, color: C.dim }}>
                        {formatGameTime(game.gameDate, game.status)}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: 16, fontWeight: 800 }}>{game.awayAbbr || game.awayTeamName}</div>
                      <div style={{ fontSize: 9, color: C.dim }}>AWAY</div>
                    </div>
                    <div style={{ fontSize: 13, color: C.dim }}>@</div>
                    <div>
                      <div style={{ fontSize: 16, fontWeight: 800 }}>{game.homeAbbr || game.homeTeamName}</div>
                      <div style={{ fontSize: 9, color: C.dim }}>HOME{game.neutralSite ? " (N)" : ""}</div>
                    </div>
                  </div>
                  <div style={{ color: C.dim, fontSize: 11 }}>
                    {game.loading ? "Calculating…" : "⚠ Stats unavailable"}
                  </div>
                </div>
              </div>
            );
          }

          const homeName = game.homeAbbr || (game.homeTeamName || "").slice(0, 8);
          const awayName = game.awayAbbr || (game.awayTeamName || "").slice(0, 8);
          const signals = getBetSignals({ pred: game.pred, odds: game.odds, sport: "ncaa", homeName, awayName });

          // v25: Override ML signal logic
          // Only recommend ML bet when model picks the OPPOSITE team from the market favorite.
          // Example: Duke -20000 vs Siena +3500. Model says Duke 85%. Market says 97%.
          // The "edge" is 12% but Duke still wins — no one should bet Siena ML.
          // ML GO only when model win% > 50% for the team the market has as underdog.
          if (signals.ml && game.pred && game.odds) {
            const modelWinHome = game.pred.homeWinPct ?? 0.5;
            const mktHomeML = game.odds.homeML ?? 0;
            const mktAwayML = game.odds.awayML ?? 0;
            const marketFavorsHome = mktHomeML < 0 || (mktHomeML !== 0 && Math.abs(mktHomeML) < Math.abs(mktAwayML));
            const modelFavorsHome = modelWinHome >= 0.5;
            // Only show ML GO if model disagrees on WHO wins, or if model has strong confidence (>55%) on the dog
            const modelPicksDog = (marketFavorsHome && !modelFavorsHome) || (!marketFavorsHome && modelFavorsHome);
            const modelHasStrongDogEdge = modelPicksDog && (modelFavorsHome ? modelWinHome > 0.55 : (1 - modelWinHome) > 0.55);
            if (!modelPicksDog || !modelHasStrongDogEdge) {
              signals.ml = { ...signals.ml, verdict: "SKIP", label: `Model agrees ${marketFavorsHome ? homeName : awayName} wins — no ML edge` };
            }
          }
          // v26: O/U signals — use validated O/U model (Cat+MLP→EN, 20 features)
          // Threshold: ≥5 edge (55.6% closing, 63.7% opening)
          // Unit sizing: ≥5 = 1u, ≥7 = 2u, ≥10 = 3u
          if (signals.ou && game.pred?._ouPick) {
            const ouEdge = Math.abs(game.pred._ouEdge || 0);
            const ouSide = game.pred._ouPick; // "OVER" or "UNDER"
            if (ouEdge >= 5) {
              const ouUnits = ouEdge >= 10 ? 3 : ouEdge >= 7 ? 2 : 1;
              signals.ou = {
                ...signals.ou,
                verdict: "GO",
                side: ouSide,
                label: `${ouSide} ${ouEdge.toFixed(1)}pts edge · ${ouUnits}u`,
                edge: ouEdge,
                units: ouUnits,
                modelTotal: game.pred._ouPredictedTotal,
                marketLine: game.odds?.ouLine ?? null,
              };
            } else {
              signals.ou = { ...signals.ou, verdict: "SKIP", label: `O/U edge ${ouEdge.toFixed(1)} < 5` };
            }
          } else if (signals.ou) {
            signals.ou = { ...signals.ou, verdict: "SKIP", label: "No O/U model data" };
          }

          const homeRank = game.homeStats?._kenPomRank || (game.homeRank && game.homeRank < 99 ? game.homeRank : null);
          const awayRank = game.awayStats?._kenPomRank || (game.awayRank && game.awayRank < 99 ? game.awayRank : null);
          
          // Determine if this is a "bet game" - has a bet sizing recommendation
          const isBetGame = !!signals.betSizing || (signals.ou?.verdict === "GO");
          const bannerInfo = getBannerInfo(game.pred, game.odds);
          
          // Border color: green for bet games, orange for strong edges, otherwise normal
          const borderColor = isBetGame
            ? (signals.betSizing ? "#3fb950" : "#58a6ff")  // green for ATS, blue for O/U-only
            : (bannerInfo.color === "green" ? "#f97316" : C.border);
          const borderWidth = isBetGame ? "2px" : "1px";

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
              {/* Bet advantage banner - shows unit sizing + LEAN/BET */}
              {isBetGame && (
                <BetBanner signals={signals} homeName={homeName} awayName={awayName} odds={game.odds} />
              )}

              {/* Header - Game time and edge label (non-bet games) */}
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
                  {game.tvNetwork && game.status !== "Final" && game.status !== "Live" && (
                    <div style={{ fontSize: 9, color: "#8b949e", fontWeight: 500, padding: "1px 5px", background: "rgba(139,148,158,0.1)", borderRadius: 3 }}>
                      {game.tvNetwork}
                    </div>
                  )}
                  
                  {!isBetGame && bannerInfo.disagree >= 1.5 && (
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
                  {game.status === "Final" && <span style={{ fontSize: 10, color: C.green, fontWeight: 700 }}>FINAL {game.awayScore}-{game.homeScore}</span>}
                  {game.status === "Live" && <span style={{ fontSize: 10, color: C.orange, fontWeight: 700 }}>LIVE</span>}
                  {game.status !== "Final" && game.status !== "Live" && (
                    <span
                      onClick={(e) => { e.stopPropagation(); refreshGame(game, idx); }}
                      style={{ cursor: "pointer", fontSize: 11, opacity: refreshingGame === game.gameId ? 0.5 : 1, padding: "2px 6px", borderRadius: 4, background: "rgba(88,166,255,0.1)", color: "#58a6ff" }}
                      title="Refresh prediction (re-fetch refs, starters, odds)"
                    >
                      {refreshingGame === game.gameId ? "⏳" : "🔄"}
                    </span>
                  )}
                  <span style={{ color: C.dim, fontSize: 12 }}>
                    {expanded === game.gameId ? "▲" : "▼"}
                  </span>
                </div>
              </div>

              {/* Main game row — scrollable on mobile */}
              <div style={{ padding: "16px 18px", overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
                <div style={{ minWidth: 540 }}>
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
                  <div>ML Spread</div>
                  <div>Mkt Spread</div>
                  <div>ML Odds</div>
                  <div>Mkt Odds</div>
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
                      {awayRank && (
                        <span style={{
                          fontSize: 9,
                          color: C.orange,
                          background: "#2d1a0f",
                          padding: "1px 4px",
                          borderRadius: 8
                        }}>
                          #{awayRank}
                        </span>
                      )}
                      <span style={{ fontSize: 8, color: C.dim, marginLeft: 2 }}>AWAY</span>
                    </div>
                    {/* Team record — guard against ESPN tournament-only records (e.g., "1-0" in March) */}
                    <span style={{ fontSize: 10, color: C.dim }}>
                      {(() => {
                        const w = game.awayStats?.wins || 0, l = game.awayStats?.losses || 0;
                        if (w + l >= 10) return `${w}-${l}`;
                        // Stats record looks suspicious — try scoreboard record
                        const sbr = game.awayRecord || game.pred?.away_record_display;
                        if (sbr) {
                          const parts = sbr.split("-");
                          if (parts.length === 2 && parseInt(parts[0]) + parseInt(parts[1]) >= 10) return sbr;
                        }
                        // Still low but nonzero — show what we have
                        if (w + l > 0) return `${w}-${l}`;
                        return sbr || "No record";
                      })()}
                    </span>                  </div>
                  
                  <div style={{ fontSize: 12, fontWeight: 500, color: "#e2e8f0" }}>
                    {signals.spread?.verdict === "LEAN" && signals.betSizing && signals.betSizing.side === "AWAY"
                      ? <SignalBadge label="ATS" color="#d29922">{formatSpread(game.pred.projectedSpread)}</SignalBadge>
                      : formatSpread(game.pred.projectedSpread)
                    }
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 500, color: game.odds?.homeSpread ? "#e2e8f0" : C.dim }}>
                    {game.odds?.homeSpread ? formatSpread(-game.odds.homeSpread) : "-"}
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 500, color: (() => {
                    const dec = game.pred.decisiveness ?? (Math.abs(game.pred.homeWinPct - 0.5) * 100);
                    const awayFavored = game.pred.homeWinPct < 0.5;
                    return (awayFavored && dec >= DECISIVENESS_GATE.ncaa) ? C.green : "#e2e8f0";
                  })() }}>
                    {(signals.ml?.verdict === "GO" || signals.ml?.verdict === "LEAN") && signals.ml?.side === "AWAY" && signals.betSizing
                      ? <SignalBadge label={`${signals.betSizing.units}u`} color={signals.ml?.verdict === "GO" ? "#2ea043" : "#d29922"}>{formatML(game.pred.modelML_away)}</SignalBadge>
                      : formatML(game.pred.modelML_away)
                    }
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 500, color: game.odds?.awayML ? "#e2e8f0" : C.dim }}>
                    {formatML(game.odds?.awayML)}
                  </div>
                  {/* Empty cell for Total */}
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
                      {homeRank && (
                        <span style={{
                          fontSize: 9,
                          color: C.orange,
                          background: "#2d1a0f",
                          padding: "1px 4px",
                          borderRadius: 8
                        }}>
                          #{homeRank}
                        </span>
                      )}
                      <span style={{ fontSize: 8, color: C.dim, marginLeft: 2 }}>
                        HOME{game.neutralSite ? " (N)" : ""}
                      </span>
                    </div>
                    {/* Team record — guard against ESPN tournament-only records */}
                    <span style={{ fontSize: 10, color: C.dim }}>
                      {(() => {
                        const w = game.homeStats?.wins || 0, l = game.homeStats?.losses || 0;
                        if (w + l >= 10) return `${w}-${l}`;
                        const sbr = game.homeRecord || game.pred?.home_record_display;
                        if (sbr) {
                          const parts = sbr.split("-");
                          if (parts.length === 2 && parseInt(parts[0]) + parseInt(parts[1]) >= 10) return sbr;
                        }
                        if (w + l > 0) return `${w}-${l}`;
                        return sbr || "No record";
                      })()}
                    </span>                  </div>
                  
                  <div style={{ fontSize: 12, fontWeight: 500, color: "#e2e8f0" }}>
                    {signals.spread?.verdict === "LEAN" && signals.betSizing && signals.betSizing.side === "HOME"
                      ? <SignalBadge label="ATS" color="#d29922">{formatSpread(-game.pred.projectedSpread)}</SignalBadge>
                      : formatSpread(-game.pred.projectedSpread)
                    }
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 500, color: game.odds?.homeSpread ? "#e2e8f0" : C.dim }}>
                    {game.odds?.homeSpread ? formatSpread(game.odds.homeSpread) : "-"}
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 500, color: (() => {
                    const dec = game.pred.decisiveness ?? (Math.abs(game.pred.homeWinPct - 0.5) * 100);
                    const homeFavored = game.pred.homeWinPct >= 0.5;
                    return (homeFavored && dec >= DECISIVENESS_GATE.ncaa) ? C.green : "#e2e8f0";
                  })() }}>
                    {(signals.ml?.verdict === "GO" || signals.ml?.verdict === "LEAN") && signals.ml?.side === "HOME" && signals.betSizing
                      ? <SignalBadge label={`${signals.betSizing.units}u`} color={signals.ml?.verdict === "GO" ? "#2ea043" : "#d29922"}>{formatML(game.pred.modelML_home)}</SignalBadge>
                      : formatML(game.pred.modelML_home)
                    }
                  </div>
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
                      {signals.ou?.verdict === "GO"
                        ? <SignalBadge label={`${signals.ou.side} ${signals.ou.units}u`} color={signals.ou?.side === "OVER" ? "#2ea043" : "#58a6ff"}>
                            {signals.ou.modelTotal?.toFixed?.(0) ?? game.pred._ouPredictedTotal?.toFixed(0) ?? game.pred.ouTotal}{signals.ou?.side && <span style={{ fontSize: 9, marginLeft: 3 }}>{signals.ou.side === "OVER" ? "▲" : "▼"}</span>}
                          </SignalBadge>
                        : (game.pred._ouPredictedTotal ? game.pred._ouPredictedTotal.toFixed(0) : game.pred.ouTotal)
                      }
                    </div>
                    {game.odds?.ouLine && (
                      <div style={{ fontSize: 10, color: C.yellow }}>mkt: {game.odds.ouLine}</div>
                    )}
                  </div>
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
                            {signals.ou.side} {signals.ou.modelTotal?.toFixed?.(0) ?? signals.ou.marketLine ?? ""}
                          </span>
                          <span style={{ color: C.dim }}>
                            ({signals.ou.edge.toFixed(1)}pt edge)
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

              {/* Expanded view — clicks here don't close the card */}
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
                    <Kv k="Projected Score" v={`${awayName} ${game.pred.awayScore.toFixed(1)} — ${homeName} ${game.pred.homeScore.toFixed(1)}`} />
                    <Kv k="Home Win %" v={`${(game.pred.homeWinPct * 100).toFixed(1)}%`} />
                    <Kv k="O/U Total" v={game.pred._ouPredictedTotal
                      ? `${game.pred._ouPredictedTotal.toFixed(1)} ML${game.pred._ouEdge ? ` (${game.pred._ouEdge > 0 ? '+' : ''}${game.pred._ouEdge.toFixed(1)} vs mkt)` : ''}`
                      : game.pred.ouTotal} />
                    <Kv k="Spread" v={game.pred.projectedSpread > 0 ? `${homeName} -${game.pred.projectedSpread.toFixed(1)}` : `${awayName} -${(-game.pred.projectedSpread).toFixed(1)}`} />
                    <Kv k="Possessions" v={game.pred.possessions.toFixed(1)} />
                    {game.homeStats && (
                      <Kv k={`${homeName} Adj EM`} v={`${game.pred.homeAdjEM}${game.homeStats._kenPomRank ? ` (#${game.homeStats._kenPomRank})` : ''}`} />
                    )}
                    {game.awayStats && (
                      <Kv k={`${awayName} Adj EM`} v={`${game.pred.awayAdjEM}${game.awayStats._kenPomRank ? ` (#${game.awayStats._kenPomRank})` : ''}`} />
                    )}
                    <Kv k="Confidence" v={`${game.pred.confidence} (${game.pred.confScore})`} />
                    <Kv k="Ratings" v={`${game.pred.ratingsSource || 'SOS'}${game.pred.venueAware ? ' + H/A' : ''}`} />
                    {game.homeRestDays != null && <Kv k={`${homeName} Rest`} v={`${game.homeRestDays}d`} />}
                    {game.awayRestDays != null && <Kv k={`${awayName} Rest`} v={`${game.awayRestDays}d`} />}
                    {game.neutralSite && <Kv k="Site" v="Neutral" />}
                    {game.venue && <Kv k="Venue" v={game.venue} />}
                  </div>

                  {/* Feature coverage + zero features panel */}
                  {game.mlShap && (() => {
                    const zeroFeatures = game.mlShap.filter(s => s.value === 0 && Math.abs(s.shap) > 0.01);
                    const allZero = game.mlShap.filter(s => s.value === 0);
                    const coverage = game.mlFeatureCoverage || `${game.mlShap.length - allZero.length}/${game.mlShap.length}`;
                    const ds = game.mlDataSources || {};
                    return (
                      <div style={{ marginBottom: 10 }}>
                        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", marginBottom: 6 }}>
                          <span style={{ fontSize: 11, color: "#8b949e" }}>
                            Features: <span style={{ color: allZero.length > 30 ? "#f85149" : allZero.length > 15 ? "#d29922" : "#3fb950", fontWeight: 600 }}>{coverage}</span>
                          </span>
                          {ds.referee != null && (
                            <span style={{ fontSize: 10, color: ds.referee ? "#3fb950" : "#d29922" }}>
                              {ds.referee ? "✓ Refs" : "✗ Refs (using league avg)"}
                            </span>
                          )}
                          {ds.spread_movement != null && (
                            <span style={{ fontSize: 10, color: ds.spread_movement ? "#3fb950" : "#8b949e" }}>
                              {ds.spread_movement ? "✓ Line movement" : "✗ Line movement"}
                            </span>
                          )}
                          {ds.attendance != null && (
                            <span style={{ fontSize: 10, color: ds.attendance ? "#3fb950" : "#8b949e" }}>
                              {ds.attendance ? "✓ Attendance" : "✗ Attendance"}
                            </span>
                          )}
                        </div>
                        {zeroFeatures.length > 0 && (
                          <details style={{ fontSize: 11 }}>
                            <summary style={{ cursor: "pointer", color: "#d29922" }}>
                              {allZero.length} zero features ({zeroFeatures.length} with SHAP impact)
                            </summary>
                            <div style={{ marginTop: 4, display: "flex", flexWrap: "wrap", gap: 4 }}>
                              {zeroFeatures.sort((a, b) => Math.abs(b.shap) - Math.abs(a.shap)).map(s => (
                                <span key={s.feature} style={{
                                  fontSize: 9, padding: "1px 5px", borderRadius: 3,
                                  background: Math.abs(s.shap) > 0.1 ? "rgba(248,81,73,0.15)" : "rgba(139,148,158,0.1)",
                                  color: Math.abs(s.shap) > 0.1 ? "#f85149" : "#8b949e",
                                }}>
                                  {s.feature} ({s.shap > 0 ? "+" : ""}{s.shap.toFixed(2)})
                                </span>
                              ))}
                            </div>
                          </details>
                        )}
                      </div>
                    );
                  })()}

                  {/* Bet Signals Panel - Full details */}
                  <BetSignalsPanel
                    signals={signals}
                    pred={game.pred}
                    odds={game.odds}
                    sport="ncaa"
                    homeName={homeName}
                    awayName={awayName}
                  />
                  
                  {game.pred?.mlEnhanced && (
                    <div style={{ fontSize: 8, color: "#58a6ff", marginTop: 4 }}>
                      ⚡ ML-enhanced · trained on {game.mlMeta?.n_train} games · MAE {game.mlMeta?.mae_cv?.toFixed(1)} pts
                    </div>
                  )}
                  
                  {/* SHAP Panel */}
                  <ShapPanel shap={game.mlShap} homeName={homeName} awayName={awayName} />
                  
                  {/* Monte Carlo Panel */}
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

// ── NCAA SECTION (tab wrapper) ────────────────────────────────
export function NCAASection({ ncaaGames, setNcaaGames, calibrationNCAA, setCalibrationNCAA, refreshKey, setRefreshKey }) {
  const [tab, setTab] = useState("calendar");
  const [syncMsg, setSyncMsg] = useState("");
  const [backfilling, setBackfilling] = useState(false);
  const abortRef = useRef(null);
  const TABS = ["calendar", "madness", "accuracy", "history", "parlay"];

  const handleAutoSync = async () => {
    setSyncMsg("🏀 Syncing…");
    await ncaaAutoSync(msg => setSyncMsg(msg));
    setRefreshKey(k => k + 1);
    setTimeout(() => setSyncMsg(""), 4000);
  };

  const handleFullBackfill = async () => {
    if (backfilling) {
      abortRef.current?.abort();
      setBackfilling(false);
      setSyncMsg("🏀 Backfill cancelled");
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setBackfilling(true);
    setSyncMsg("🏀 Starting full season backfill…");
    await ncaaFullBackfill(msg => setSyncMsg(msg), controller.signal);
    setBackfilling(false);
    setRefreshKey(k => k + 1);
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 4, marginBottom: 8, flexWrap: "wrap", alignItems: "center" }}>
        {TABS.map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: "6px 16px",
              borderRadius: 7,
              border: `1px solid ${tab === t ? "#30363d" : "transparent"}`,
              background: tab === t ? "#161b22" : "transparent",
              color: tab === t ? C.orange : C.dim,
              cursor: "pointer",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: 1,
              textTransform: "uppercase"
            }}
          >
            {t === "calendar" ? "📅" : t === "madness" ? "🏀" : t === "accuracy" ? "📊" : t === "history" ? "📋" : "🎯"} {t}
          </button>
        ))}
        <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <button
            onClick={handleAutoSync}
            disabled={backfilling}
            style={{
              background: "#161b22",
              color: C.muted,
              border: `1px solid ${C.border}`,
              borderRadius: 7,
              padding: "6px 12px",
              cursor: backfilling ? "not-allowed" : "pointer",
              fontSize: 10
            }}
          >
            ⟳ Sync
          </button>
          <button
            onClick={handleFullBackfill}
            style={{
              background: backfilling ? "#2a0a0a" : "#1a0a00",
              color: backfilling ? C.red : C.orange,
              border: `1px solid ${backfilling ? "#5a1a1a" : "#3a1a00"}`,
              borderRadius: 7,
              padding: "6px 12px",
              cursor: "pointer",
              fontSize: 10,
              fontWeight: 700
            }}
          >
            {backfilling ? "⏹ Cancel" : "⏮ Full Season Backfill"}
          </button>
          <button
            onClick={async () => {
              if (!window.confirm("Regrade all NCAA records with updated confidence + ATS logic?")) return;
              setSyncMsg("⏳ Regrading…");
              await ncaaRegradeAllResults(msg => setSyncMsg(msg));
              setRefreshKey(k => k + 1);
              setTimeout(() => setSyncMsg(""), 4000);
            }}
            disabled={backfilling}
            style={{
              background: "#1a0a2e",
              color: "#d2a8ff",
              border: "1px solid #3d1f6e",
              borderRadius: 7,
              padding: "6px 12px",
              cursor: "pointer",
              fontSize: 10,
              fontWeight: 700
            }}
          >
            🔧 Regrade
          </button>
        </div>
      </div>
      {syncMsg && (
        <div style={{
          background: "#0d1a10",
          border: `1px solid #1a3a1a`,
          borderRadius: 7,
          padding: "8px 14px",
          marginBottom: 12,
          fontSize: 11,
          color: backfilling ? C.orange : C.green,
          fontFamily: "monospace",
          display: "flex",
          alignItems: "center",
          gap: 8
        }}>
          {backfilling && <span style={{ fontSize: 14 }}>⏳</span>}
          {syncMsg}
        </div>
      )}
      {!syncMsg && (
        <div style={{ fontSize: 10, color: C.dim, marginBottom: 12, letterSpacing: 1 }}>
          NCAA Men's Basketball · Season starts {_ncaaSeasonStart} · ESPN API (free, no key)
        </div>
      )}
      {tab === "calendar" && <NCAACalendarTab calibrationFactor={calibrationNCAA} onGamesLoaded={setNcaaGames} />}
      {tab === "madness" && <MarchMadnessPanel />}
      {tab === "accuracy" && <AccuracyDashboard table="ncaa_predictions" refreshKey={refreshKey} onCalibrationChange={setCalibrationNCAA} spreadLabel="Spread" isNCAA={true} />}
      {tab === "history" && <HistoryTab table="ncaa_predictions" refreshKey={refreshKey} />}
      {tab === "parlay" && <ParlayBuilder mlbGames={[]} ncaaGames={ncaaGames} />}
    </div>
  );
}
