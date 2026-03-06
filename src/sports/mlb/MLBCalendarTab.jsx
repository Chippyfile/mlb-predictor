// src/sports/mlb/MLBCalendarTab.jsx
// v2: Matched to NCAA grid layout — BetBanner, UnitBadge, confidence footer, green ML styling
import React, { useState, useEffect, useCallback } from "react";
import { C, confColor2, Pill, Kv, BetSignalsPanel, AccuracyDashboard, HistoryTab, ParlayBuilder } from "../../components/Shared.jsx";
import ShapPanel from "../../components/ShapPanel.jsx";
import MonteCarloPanel from "../../components/MonteCarloPanel.jsx";
import { getBetSignals, trueImplied, EDGE_THRESHOLD, fetchOdds, DECISIVENESS_GATE } from "../../utils/sharedUtils.js";
import { mlPredict, mlMonteCarlo } from "../../utils/mlApi.js";
import {
  mlbTeamById, resolveStatTeamId,
  fetchMLBScheduleForDate, matchMLBOddsToGame,
  fetchTeamHitting, fetchTeamPitching, fetchStarterStats,
  fetchRecentForm, fetchLineup, fetchBullpenFatigue,
  fetchParkWeather, fetchStatcast,
  mlbPredictGame,
} from "./mlb.js";
import { mlbAutoSync } from "./mlbSync.js";

// ML moneyline cap
const ML_CAP = 4000;

// Unit badge for spread/ML/OU cells
const UnitBadge = ({ units, isGo, children }) => {
  if (!units) return <>{children}</>;
  const badgeColor = isGo ? "#2ea043" : "#d29922";
  return (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      background: `${badgeColor}18`,
      border: `1px solid ${badgeColor}55`,
      borderRadius: 5,
      padding: "2px 6px",
    }}>
      <span>{children}</span>
      <span style={{
        fontSize: 7, fontWeight: 800, color: badgeColor,
        background: `${badgeColor}30`, borderRadius: 3,
        padding: "0 3px", lineHeight: "13px",
        whiteSpace: "nowrap",
      }}>{units}u</span>
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
const BetBanner = ({ signals, homeName, awayName }) => {
  if (!signals?.betSizing) return null;
  const sz = signals.betSizing;
  const side = sz.side || signals.ml?.side || "";
  const edgePct = sz.edge || signals.ml?.edgePct || "0";
  const badgeColor = sz.units >= 2 ? "#2ea043" : "#d29922";
  const pickName = side === "HOME" ? homeName : awayName;
  const checks = "✓".repeat(sz.units);
  const mlLine = sz.marketML > 0 ? `+${sz.marketML}` : sz.marketML;

  return (
    <div style={{
      padding: "8px 14px",
      background: sz.units >= 2
        ? "linear-gradient(135deg, #0b2012, #0e2818)"
        : "linear-gradient(135deg, #1a1500, #1e1a08)",
      borderBottom: `1px solid ${sz.units >= 2 ? "#2ea04355" : "#d2992244"}`,
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      flexWrap: "wrap",
      gap: 8,
    }}>
      {/* Left: unit blocks + pick */}
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
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 9, color: C.dim, letterSpacing: 1 }}>VALUE:</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: badgeColor }}>
              {pickName} ML {mlLine}
            </span>
          </div>
          <span style={{ fontSize: 10, color: C.muted }}>
            +{edgePct}% edge · {sz.winPct}% model vs {(100 - parseFloat(edgePct) - parseFloat(sz.winPct)).toFixed(0)}% market
          </span>
        </div>
      </div>

      {/* Right: unit badge with checkmarks */}
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
        <span style={{ fontSize: 9, letterSpacing: 0.5 }}>{sz.units}u</span>
      </div>
    </div>
  );
};

export default function MLBCalendarTab({ calibrationFactor, onGamesLoaded }) {
  const todayStr = new Date().toISOString().split("T")[0];
  const [dateStr, setDateStr] = useState(todayStr);
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const [oddsData, setOddsData] = useState(null);

  const loadGames = useCallback(async (d) => {
    setLoading(true); setGames([]);
    const [raw, odds] = await Promise.all([fetchMLBScheduleForDate(d), fetchOdds("baseball_mlb")]);
    setOddsData(odds);
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
      const gameOdds = odds?.games?.find(o => matchMLBOddsToGame(o, g)) || null;
      const homeSPipPerStart = pred.homeSpAvgIP ?? 5.5;
      const awaySPipPerStart = pred.awaySpAvgIP ?? 5.5;
      const [mlResult, mcResult] = await Promise.all([
        mlPredict("mlb", {
          pred_home_runs: pred.homeRuns, pred_away_runs: pred.awayRuns,
          win_pct_home: pred.homeWinPct, ou_total: pred.ouTotal,
          model_ml_home: pred.modelML_home,
          home_woba: pred.homeWOBA, away_woba: pred.awayWOBA,
          home_fip: pred.hFIP, away_fip: pred.aFIP,
          home_sp_fip: pred.hFIP, away_sp_fip: pred.aFIP,
          home_bullpen_era: homeBullpen?.era || 4.10,
          away_bullpen_era: awayBullpen?.era || 4.10,
          park_factor: pred.parkFactor,
          temp_f: parkWeather?.tempF ?? 70,
          wind_mph: parkWeather?.windMph ?? 5,
          wind_out_flag: parkWeather
            ? ((parkWeather.windDir >= 145 && parkWeather.windDir <= 255) ? 1 : 0)
            : 0,
          home_sp_ip: homeSPipPerStart,
          away_sp_ip: awaySPipPerStart,
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
        }),
        mlMonteCarlo("MLB", pred.homeRuns, pred.awayRuns, 10000, gameOdds?.ouLine ?? pred.ouTotal, g.gamePk),
      ]);
      // Recalculate modelML from ML win probability with vig for display consistency
      const finalPred = pred && mlResult ? (() => {
        const mlWinHome = mlResult.ml_win_prob_home;
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
        };
      })() : pred;
      return { ...g, pred: finalPred, loading: false, odds: gameOdds, mlShap: mlResult?.shap ?? null, mlMeta: mlResult?.model_meta ?? null, mc: mcResult };
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
          const isBetGame = !!signals.betSizing;
          const bannerInfo = getBannerInfo(game.pred, game.odds, game.homeStarter && game.awayStarter);

          const borderColor = isBetGame ? "#3fb950" : (bannerInfo.color === "green" ? "#f97316" : C.border);
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
                <BetBanner signals={signals} homeName={homeName} awayName={awayName} />
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
                      ? <UnitBadge units={signals.betSizing.units} isGo={signals.ml?.verdict === "GO"}>{formatML(game.pred.modelML_away)}</UnitBadge>
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
                      ? <UnitBadge units={signals.betSizing.units} isGo={signals.ml?.verdict === "GO"}>{formatML(game.pred.modelML_home)}</UnitBadge>
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
                      {(signals.ou?.verdict === "GO" || signals.ou?.verdict === "LEAN") && signals.betSizing
                        ? <UnitBadge units={signals.ou?.verdict === "GO" ? Math.min(3, (signals.betSizing?.units || 0) + 1) : 1} isGo={signals.ou?.verdict === "GO"}>
                            {game.pred.ouTotal}{signals.ou?.side && <span style={{ fontSize: 9, marginLeft: 3 }}>{signals.ou.side === "OVER" ? "▲" : "▼"}</span>}
                          </UnitBadge>
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
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  fontSize: 10,
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
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ color: C.dim }}>Win%:</span>
                    <span style={{ color: C.green, fontWeight: 700 }}>
                      {(Math.max(game.pred.homeWinPct, 1 - game.pred.homeWinPct) * 100).toFixed(1)}%
                    </span>
                    <span style={{ color: C.dim }}>
                      {game.pred.homeWinPct >= 0.5 ? homeName : awayName}
                    </span>
                  </div>
                </div>
              )}

              {/* Expanded view */}
              {expanded === game.gamePk && (
                <div style={{
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
