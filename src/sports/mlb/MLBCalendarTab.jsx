import { pstTodayStr } from "../../utils/dateUtils.js";
// src/sports/mlb/MLBCalendarTab.jsx
// v2: Matched to NCAA grid layout — BetBanner, UnitBadge, confidence footer, green ML styling
import React, { useState, useEffect, useCallback } from "react";
import { C, confColor2, Pill, Kv, BetSignalsPanel, AccuracyDashboard, HistoryTab, ParlayBuilder } from "../../components/Shared.jsx";
import ShapPanel from "../../components/ShapPanel.jsx";
import MonteCarloPanel from "../../components/MonteCarloPanel.jsx";
import { getBetSignals, trueImplied, EDGE_THRESHOLD, fetchOdds, DECISIVENESS_GATE } from "../../utils/sharedUtils.js";
import { mlPredict, mlMonteCarlo } from "../../utils/mlApi.js";
import { supabaseQuery } from "../../utils/supabase.js";
import {
  mlbTeamById, resolveStatTeamId,
  fetchMLBScheduleForDate, matchMLBOddsToGame,
  fetchTeamHitting, fetchTeamPitching, fetchStarterStats,
  fetchRecentForm, fetchLineup, fetchBullpenFatigue,
  fetchParkWeather, fetchStatcast,
  mlbPredictGame,
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

export default function MLBCalendarTab({ calibrationFactor, onGamesLoaded }) {
  const todayStr = pstTodayStr();
  const [dateStr, setDateStr] = useState(todayStr);
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const [oddsData, setOddsData] = useState(null);

  const loadGames = useCallback(async (d) => {
    setLoading(true); setGames([]);
    const [raw, odds] = await Promise.all([fetchMLBScheduleForDate(d), fetchOdds("baseball_mlb")]);
    setOddsData(odds);

    // ── Fetch stored predictions from Supabase for this date ──
    // Final/Live games can't call ML API (stale data), so load pre-game predictions.
    let storedPredMap = new Map();
    try {
      const storedPreds = await supabaseQuery(
        `/mlb_predictions?game_date=eq.${d}&select=id,game_pk,home_team,away_team,win_pct_home,ou_total,pred_home_runs,pred_away_runs,confidence,market_spread_home,market_ou_total,opening_home_ml,opening_away_ml,ml_win_prob_home`
      );
      if (Array.isArray(storedPreds)) {
        for (const sp of storedPreds) {
          const key = sp.game_pk ? String(sp.game_pk) : `${sp.home_team}|${sp.away_team}`;
          storedPredMap.set(key, sp);
        }
      }
    } catch (e) { console.warn("Failed to load stored MLB predictions:", e); }

    setGames(raw.map(g => ({ ...g, pred: null, loading: true })));
    const enriched = await Promise.all(raw.map(async (g) => {
      const homeStatId = resolveStatTeamId(g.homeTeamId, g.homeAbbr);
      const awayStatId = resolveStatTeamId(g.awayTeamId, g.awayAbbr);
      const [
        homeHit, awayHit, homePitch, awayPitch,
        homeStarter, awayStarter,
        homeForm, awayForm,
        homeLineup, awayLineup,
      ] = await Promise.all([
        fetchTeamHitting(homeStatId), fetchTeamHitting(awayStatId),
        fetchTeamPitching(homeStatId), fetchTeamPitching(awayStatId),
        fetchStarterStats(g.homeStarterId), fetchStarterStats(g.awayStarterId),
        fetchRecentForm(homeStatId), fetchRecentForm(awayStatId),
        fetchLineup(g.gamePk, homeStatId, true), fetchLineup(g.gamePk, awayStatId, false),
      ]);
      if (homeStarter) homeStarter.pitchHand = g.homeStarterHand;
      if (awayStarter) awayStarter.pitchHand = g.awayStarterHand;
      const [homeBullpen, awayBullpen] = await Promise.all([
        fetchBullpenFatigue(g.homeTeamId), fetchBullpenFatigue(g.awayTeamId),
      ]);
      const [parkWeather, homeStatcast, awayStatcast] = await Promise.all([
        fetchParkWeather(g.homeTeamId).catch(() => null),
        fetchStatcast(homeStatId).catch(() => null),
        fetchStatcast(awayStatId).catch(() => null),
      ]);
      const pred = mlbPredictGame({
        homeTeamId: g.homeTeamId, awayTeamId: g.awayTeamId,
        homeHit, awayHit, homePitch, awayPitch,
        homeStarterStats: homeStarter, awayStarterStats: awayStarter,
        homeForm, awayForm,
        homeGamesPlayed: homeForm?.gamesPlayed || 0,
        awayGamesPlayed: awayForm?.gamesPlayed || 0,
        bullpenData: { [g.homeTeamId]: homeBullpen, [g.awayTeamId]: awayBullpen },
        homeLineup, awayLineup,
        umpire: g.umpire,
        parkWeather,
        homeStatcast, awayStatcast,
        calibrationFactor,
      });
      const rawOdds = odds?.games?.find(o => matchMLBOddsToGame(o, g)) || null;
      const isPreGame = g.status !== "Final" && g.status !== "Live";

      // For Final/Live games, prefer stored OPENING odds (pre-game)
      // Live API returns in-game spreads (e.g., -5.5 when team is up 8-0) which are meaningless
      const storedOdds = (() => {
        const stored = storedPredMap.get(String(g.gamePk));
        if (stored?.market_spread_home != null) {
          return {
            homeSpread: stored.market_spread_home,
            awaySpread: -stored.market_spread_home,
            homeML: stored.opening_home_ml ?? null,
            awayML: stored.opening_away_ml ?? null,
            ouLine: stored.market_ou_total ?? null,
            source: "stored",
          };
        }
        return null;
      })();

      const gameOdds = isPreGame
        ? (rawOdds ? { ...rawOdds, homeSpread: rawOdds.marketSpreadHome ?? null, ouLine: rawOdds.marketTotal ?? null } : storedOdds)
        : (storedOdds ?? (rawOdds ? { ...rawOdds, homeSpread: rawOdds.marketSpreadHome ?? null, ouLine: rawOdds.marketTotal ?? null } : null));

      const homeSPipPerStart = pred.homeSpAvgIP ?? 5.5;
      const awaySPipPerStart = pred.awaySpAvgIP ?? 5.5;

      let mlResult = null, mcResult = null, ouResult = null;
      if (isPreGame) {
        const mlPayload = {
            home_team: g.homeAbbr || g.home?.abbreviation,
            away_team: g.awayAbbr || g.away?.abbreviation,
            pred_home_runs: pred.homeRuns, pred_away_runs: pred.awayRuns,
            win_pct_home: pred.homeWinPct, ou_total: pred.ouTotal,
            model_ml_home: pred.modelML_home,
            home_woba: pred.homeWOBA, away_woba: pred.awayWOBA,
            // AUDIT v4 Finding 10: home_fip = TEAM pitching (ERA proxy), not starter FIP
            // sp_relative_fip_diff needs team FIP to compute (starter - team) differential
            home_fip: homePitch?.era || 4.25,
            away_fip: awayPitch?.era || 4.25,
            home_sp_fip: pred.hFIP, away_sp_fip: pred.aFIP,
            home_bullpen_era: homePitch?.era || 4.10,
            away_bullpen_era: awayPitch?.era || 4.10,
            park_factor: pred.parkFactor,
            temp_f: parkWeather?.tempF ?? 70,
            wind_mph: parkWeather?.windMph ?? 5,
            wind_out_flag: parkWeather
              ? ((parkWeather.windDir >= 145 && parkWeather.windDir <= 255) ? 1 : 0)
              : 0,
            home_sp_ip: homeSPipPerStart,
            away_sp_ip: awaySPipPerStart,
            // Market data
            market_spread_home: gameOdds?.homeSpread ?? 0,
            market_ou_total: gameOdds?.ouLine ?? 0,
            home_moneyline: gameOdds?.homeML ?? 0,
            away_moneyline: gameOdds?.awayML ?? 0,
            // K-BB data
            home_k9: homeStarter?.k9 ?? 0,
            home_bb9: homeStarter?.bb9 ?? 0,
            away_k9: awayStarter?.k9 ?? 0,
            away_bb9: awayStarter?.bb9 ?? 0,
            // Platoon — was missing, causing platoon_diff = 0
            home_platoon_delta: pred.homePlatoonDelta ?? 0,
            away_platoon_delta: pred.awayPlatoonDelta ?? 0,
            // Umpire name for ump profile lookup
            ump_name: g.umpire?.name || null,
            // AUDIT FIX F-08/F-02: game_date for series + travel computation
            game_date: dateStr,
            home_rest_days: (() => {
              if (!homeForm?.lastGameDate) return 4;
              const daysSince = Math.floor((Date.now() - new Date(homeForm.lastGameDate).getTime()) / 86400000);
              return Math.max(0, Math.min(7, daysSince));
            })(),
            away_rest_days: (() => {
              if (!awayForm?.lastGameDate) return 4;
              const daysSince = Math.floor((Date.now() - new Date(awayForm.lastGameDate).getTime()) / 86400000);
              return Math.max(0, Math.min(7, daysSince));
            })(),
        };
        [mlResult, mcResult, ouResult] = await Promise.all([
          mlPredict("mlb", mlPayload),
          mlMonteCarlo("MLB", pred.homeRuns, pred.awayRuns, 10000, gameOdds?.ouLine ?? pred.ouTotal, g.gamePk),
          mlPredict("mlb/ou", mlPayload),
        ]);
      } else {
        // Final/Live: reconstruct mlResult from stored Supabase prediction
        const stored = storedPredMap.get(String(g.gamePk));
        if (stored && stored.ml_win_prob_home != null) {
          mlResult = {
            ml_win_prob_home: stored.ml_win_prob_home,
            ml_win_prob_away: 1 - stored.ml_win_prob_home,
            ml_margin: stored.pred_home_runs && stored.pred_away_runs
              ? stored.pred_home_runs - stored.pred_away_runs : 0,
            _fromSupabase: true,
          };
        }
      }
      // Safety clamp: MLB win probs should be [0.25, 0.75] — baseball has high parity
      // Even worst-vs-best matchups rarely exceed 70% pre-game probability
      if (pred) {
        pred.homeWinPct = Math.max(0.25, Math.min(0.75, pred.homeWinPct ?? 0.5));
        pred.awayWinPct = 1 - pred.homeWinPct;
        const VIG = 0.0225;
        const hp = pred.homeWinPct + VIG, ap = pred.awayWinPct + VIG;
        pred.modelML_home = pred.homeWinPct >= 0.5
          ? -Math.min(ML_CAP, Math.round((hp / (1 - hp)) * 100))
          : +Math.min(ML_CAP, Math.round(((1 - hp) / hp) * 100));
        pred.modelML_away = pred.homeWinPct < 0.5
          ? -Math.min(ML_CAP, Math.round((ap / (1 - ap)) * 100))
          : +Math.min(ML_CAP, Math.round(((1 - ap) / ap) * 100));
      }
      // Recalculate modelML from ML win probability with vig for display consistency
      const finalPred = pred && mlResult ? (() => {
        // AUDIT FIX F-04: Use backend probability directly (Gaussian CDF, σ=4.0).
        // No Elo override — backend already clamps to [0.20, 0.80].
        let mlWinHome = Math.max(0.25, Math.min(0.75, mlResult.ml_win_prob_home));
        const VIG = 0.0225;
        const hProb = mlWinHome + VIG;
        const aProb = (1 - mlWinHome) + VIG;
        const newModelML_home = mlWinHome >= 0.5
          ? -Math.min(ML_CAP, Math.round((hProb / (1 - hProb)) * 100))
          : +Math.min(ML_CAP, Math.round(((1 - hProb) / hProb) * 100));
        const newModelML_away = mlWinHome < 0.5
          ? -Math.min(ML_CAP, Math.round((aProb / (1 - aProb)) * 100))
          : +Math.min(ML_CAP, Math.round(((1 - aProb) / aProb) * 100));
        return {
          ...pred,
          homeWinPct: mlResult.ml_win_prob_home,
          awayWinPct: mlResult.ml_win_prob_away,
          modelML_home: newModelML_home,
          modelML_away: newModelML_away,
          mlEnhanced: true,
          // ML O/U model's predicted total (used by getBetSignals for O/U picks)
          mlOuTotal: ouResult?.pred_total ?? null,
          // Update predicted runs to reflect ML margin (keeps total for O/U, adjusts who wins)
          homeRuns: parseFloat(((pred.homeRuns + pred.awayRuns) / 2 + mlResult.ml_margin / 2).toFixed(1)),
          awayRuns: parseFloat(((pred.homeRuns + pred.awayRuns) / 2 - mlResult.ml_margin / 2).toFixed(1)),
        };
      })() : pred;
      // If no ML margin override but O/U model returned, still attach it
      if (finalPred && ouResult?.pred_total && !finalPred.mlOuTotal) {
        finalPred.mlOuTotal = ouResult.pred_total;
      }
      return { ...g, pred: finalPred, loading: false, odds: gameOdds, mlShap: mlResult?.shap ?? null, mlMeta: mlResult?.model_meta ?? null, mc: mcResult, ouModel: ouResult };
    }));

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
  }, [calibrationFactor]);

  useEffect(() => { loadGames(dateStr); }, [dateStr, calibrationFactor]);

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

          if (!game.pred || game.loading) {
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
                  <div style={{ color: C.dim, fontSize: 11 }}>
                    {game.loading ? "Calculating…" : "⚠ Data unavailable"}
                  </div>
                </div>
              </div>
            );
          }

          const signals = getBetSignals({ pred: game.pred, odds: game.odds, sport: "mlb" });
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
                    <Kv k="Projected Score" v={`${awayName} ${game.pred.awayRuns.toFixed(1)} — ${homeName} ${game.pred.homeRuns.toFixed(1)}`} />
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
      {tab === "calendar" && <MLBCalendarTab calibrationFactor={calibrationMLB} onGamesLoaded={setMlbGames} />}
      {tab === "accuracy" && <AccuracyDashboard table="mlb_predictions" refreshKey={refreshKey} onCalibrationChange={setCalibrationMLB} spreadLabel="Run Line" />}
      {tab === "history" && <HistoryTab table="mlb_predictions" refreshKey={refreshKey} />}
      {tab === "parlay" && <ParlayBuilder mlbGames={mlbGames} ncaaGames={[]} />}
    </div>
  );
}
