// src/sports/ncaa/NCAACalendarTab.jsx
import React, { useState, useEffect, useCallback, useRef } from "react";
import { C, confColor2, Pill, Kv, BetSignalsPanel, AccuracyDashboard, HistoryTab, ParlayBuilder } from "../../components/Shared.jsx";
import ShapPanel from "../../components/ShapPanel.jsx";
import MonteCarloPanel from "../../components/MonteCarloPanel.jsx";
import { getBetSignals, trueImplied, EDGE_THRESHOLD, fetchOdds, DECISIVENESS_GATE } from "../../utils/sharedUtils.js";
import { mlPredict, mlMonteCarlo } from "../../utils/mlApi.js";
import { fetchNCAATeamStats, fetchNCAAGamesForDate, ncaaPredictGame, matchNCAAOddsToGame, normalizeNCAAOdds, detectMissingStarters, getGameContext, calculateDynamicSigma, fetchNCAAKenPomRatings, applyKenPomRatings, computeRestDays } from "./ncaaUtils.js";
import { ncaaAutoSync, ncaaFullBackfill, ncaaRegradeAllResults } from "./ncaaSync.js";

// Season start (Nov 1 of prior year) — keep in sync with ncaaSync.js
const _ncaaSeasonStart = (() => {
  const now = new Date();
  const seasonYear = now.getMonth() < 7 ? now.getFullYear() - 1 : now.getFullYear();
  return `${seasonYear}-11-01`;
})();

// ML moneyline cap — prevents absurd -1194 type values
const ML_CAP = 800;

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

// Bet size indicator component (compact version for header)
const CompactBetIndicator = ({ betSizing }) => {
  if (!betSizing) return null;
  
  const colors = {
    green: "#3fb950",
    yellow: "#f97316",
    muted: "#8b949e"
  };
  
  return (
    <div style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 4,
      padding: "2px 8px",
      background: "#161b22",
      borderRadius: 12,
      border: `1px solid ${colors[betSizing.color]}`,
      fontSize: 10,
      fontWeight: 600,
      color: colors[betSizing.color],
      marginLeft: 8
    }}>
      <span>🎯 BET {betSizing.units}u</span>
      <span style={{ color: "#c9d1d9", fontSize: 9 }}>
        ({betSizing.edge}% edge)
      </span>
    </div>
  );
};

export default function NCAACalendarTab({ calibrationFactor, onGamesLoaded }) {
  const todayStr = new Date().toISOString().split("T")[0];
  const [dateStr, setDateStr] = useState(todayStr);
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const [oddsData, setOddsData] = useState(null);

  const loadGames = useCallback(async (d) => {
    setLoading(true);
    setGames([]);
    console.log(`Loading NCAA games for ${d}...`);
    
    const [raw, odds, kenPomMap] = await Promise.all([
      fetchNCAAGamesForDate(d),
      fetchOdds("basketball_ncaab"),
      fetchNCAAKenPomRatings(),
    ]);
    
    console.log(`Found ${raw?.length || 0} games on ${d}`);
    setOddsData(odds);
    
    // If no games from ESPN, show empty state
    if (!raw || raw.length === 0) {
      setGames([]);
      onGamesLoaded?.([]);
      setLoading(false);
      return;
    }
    
    const enriched = await Promise.all(raw.map(async (g) => {
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
      
      const dynamicSigma = homeStats && awayStats ? calculateDynamicSigma(homeStats, awayStats, d) : 16.0;
      const effectiveNeutral = (gameContext?.override_neutral || g.neutralSite);
      const pred = homeStats && awayStats ? ncaaPredictGame({ homeStats, awayStats, neutralSite: effectiveNeutral, calibrationFactor, sigma: dynamicSigma }) : null;
      const rawOdds = odds?.games?.find(o => matchNCAAOddsToGame(o, g)) || null;
      const gameOdds = normalizeNCAAOdds(rawOdds, g);
      
      let mlResult = null, mcResult = null;
      if (pred) {
        mlResult = await mlPredict("ncaa", {
            pred_home_score: pred.homeScore, pred_away_score: pred.awayScore,
            home_adj_em: pred.homeAdjEM, away_adj_em: pred.awayAdjEM,
            win_pct_home: pred.homeWinPct, ou_total: pred.ouTotal,
            model_ml_home: pred.modelML_home,
            neutral_site: effectiveNeutral,
            spread_home: pred.projectedSpread,
            market_spread_home: gameOdds?.homeSpread ?? null,
            market_ou_total: gameOdds?.ouLine ?? pred.ouTotal,
            home_conference: homeStats?.conferenceName || "",
            away_conference: awayStats?.conferenceName || "",
            game_date: d,
            home_ppg: homeStats?.ppg, away_ppg: awayStats?.ppg,
            home_opp_ppg: homeStats?.oppPpg, away_opp_ppg: awayStats?.oppPpg,
            home_fgpct: homeStats?.fgPct, away_fgpct: awayStats?.fgPct,
            home_threepct: homeStats?.threePct, away_threepct: awayStats?.threePct,
            home_ftpct: homeStats?.ftPct, away_ftpct: awayStats?.ftPct,
            home_assists: homeStats?.assists, away_assists: awayStats?.assists,
            home_turnovers: homeStats?.turnovers, away_turnovers: awayStats?.turnovers,
            home_tempo: homeStats?.tempo, away_tempo: awayStats?.tempo,
            home_orb_pct: homeStats?.orbPct, away_orb_pct: awayStats?.orbPct,
            home_fta_rate: homeStats?.ftaRate, away_fta_rate: awayStats?.ftaRate,
            home_ato_ratio: homeStats?.atoRatio, away_ato_ratio: awayStats?.atoRatio,
            home_opp_fgpct: homeStats?.oppFGpct, away_opp_fgpct: awayStats?.oppFGpct,
            home_opp_threepct: homeStats?.oppThreePct, away_opp_threepct: awayStats?.oppThreePct,
            home_steals: homeStats?.steals, away_steals: awayStats?.steals,
            home_blocks: homeStats?.blocks, away_blocks: awayStats?.blocks,
            home_wins: homeStats?.wins, away_wins: awayStats?.wins,
            home_losses: homeStats?.losses, away_losses: awayStats?.losses,
            home_form: homeStats?.formScore, away_form: awayStats?.formScore,
            home_sos: null, away_sos: null,
            home_rank: homeStats?._kenPomRank || g.homeRank || 200,
            away_rank: awayStats?._kenPomRank || g.awayRank || 200,
            home_injury_penalty: injuryData?.home_injury_penalty ?? 0,
            away_injury_penalty: injuryData?.away_injury_penalty ?? 0,
            injury_diff: injuryData?.injury_diff ?? 0,
            home_missing_starters: injuryData?.home_missing_starters ?? 0,
            away_missing_starters: injuryData?.away_missing_starters ?? 0,
            is_conference_tournament: gameContext?.is_conference_tournament ?? false,
            is_ncaa_tournament: gameContext?.is_ncaa_tournament ?? false,
            is_bubble_game: gameContext?.is_bubble_game ?? false,
            is_early_season: gameContext?.is_early_season ?? false,
            importance_multiplier: gameContext?.importance_multiplier ?? 1.0,
            home_rest_days: homeRestDays,
            away_rest_days: awayRestDays,
          });
          
        const mlMarginAdj = mlResult ? (mlResult.ml_margin - pred.projectedSpread) / 2 : 0;
        const heuristicTotal = pred.homeScore + pred.awayScore;
        const ouBase = pred.ouTotal ?? heuristicTotal;
        const homeRatio = heuristicTotal > 0 ? pred.homeScore / heuristicTotal : 0.5;
        const mcHome = ouBase * homeRatio + mlMarginAdj;
        const mcAway = ouBase * (1 - homeRatio) - mlMarginAdj;
        mcResult = await mlMonteCarlo("NCAAB", mcHome, mcAway, 10000, gameOdds?.ouLine ?? pred.ouTotal, g.gameId);
      }
      
      const finalPred = pred && mlResult ? (() => {
        const mlMargin = mlResult.ml_margin;
        const heuristicMargin = pred.projectedSpread;
        const marginShift = (mlMargin - heuristicMargin) / 2;
        const adjHomeScore = parseFloat((pred.homeScore + marginShift).toFixed(1));
        const adjAwayScore = parseFloat((pred.awayScore - marginShift).toFixed(1));

        const SIGMA = dynamicSigma || 16.0;
        const marginBasedWinProb = 1 / (1 + Math.pow(10, -mlMargin / SIGMA));

        const MARGIN_WEIGHT_BASE = 0.70;
        const divergence = Math.abs(marginBasedWinProb - mlResult.ml_win_prob_home);
        const adaptiveMarginWeight = Math.min(0.95, MARGIN_WEIGHT_BASE + divergence);
        const rawBlended = adaptiveMarginWeight * marginBasedWinProb + (1 - adaptiveMarginWeight) * mlResult.ml_win_prob_home;

        const blendedWinHome = Math.max(0.05, Math.min(0.95, rawBlended));
        const blendedWinAway = 1 - blendedWinHome;

        const newModelML_home = blendedWinHome >= 0.5
          ? -Math.min(ML_CAP, Math.round((blendedWinHome / (1 - blendedWinHome)) * 100))
          : +Math.min(ML_CAP, Math.round(((1 - blendedWinHome) / blendedWinHome) * 100));
        const newModelML_away = blendedWinHome >= 0.5
          ? +Math.min(ML_CAP, Math.round(((1 - blendedWinHome) / blendedWinHome) * 100))
          : -Math.min(ML_CAP, Math.round((blendedWinHome / (1 - blendedWinHome)) * 100));

        return {
          ...pred,
          homeScore: adjHomeScore,
          awayScore: adjAwayScore,
          homeWinPct: blendedWinHome,
          awayWinPct: blendedWinAway,
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
          _marginBasedWinProb: marginBasedWinProb,
          _adaptiveMarginWeight: adaptiveMarginWeight,
          _divergence: divergence,
        };
      })() : pred;
      
      const _ouBase2 = pred?.ouTotal ?? (pred?.homeScore + pred?.awayScore);
      const _hTotal2 = (pred?.homeScore + pred?.awayScore) || 1;
      const _homeRatio2 = pred?.homeScore / _hTotal2;
      const _mlAdj2 = mlResult ? (mlResult.ml_margin - pred.projectedSpread) / 2 : 0;
      const mcHomeMean = _ouBase2 * _homeRatio2 + _mlAdj2;
      const mcAwayMean = _ouBase2 * (1 - _homeRatio2) - _mlAdj2;
      
      if (pred && !mcResult) {
        mcResult = await mlMonteCarlo("NCAAB", mcHomeMean, mcAwayMean, 10000, gameOdds?.ouLine ?? pred.ouTotal, g.gameId);
      }
      
      return {
        ...g,
        homeStats,
        awayStats,
        pred: finalPred,
        loading: false,
        odds: gameOdds,
        mlShap: mlResult?.shap ?? null,
        mlMeta: mlResult?.model_meta ?? null,
        mc: mcResult,
        homeRestDays,
        awayRestDays
      };
    }));
    
    setGames(enriched);
    onGamesLoaded?.(enriched);
    setLoading(false);
  }, [calibrationFactor]);

  useEffect(() => {
    loadGames(dateStr);
  }, [dateStr, calibrationFactor]);

  const getBannerInfo = (pred, odds) => {
    if (!pred) return { color: "yellow", label: "⚠ No prediction" };
    const dec = pred.decisiveness ?? (Math.abs(pred.homeWinPct - 0.5) * 100);
    const favSide = pred.homeWinPct >= 0.5 ? "HOME" : "AWAY";
    const favPct = Math.max(pred.homeWinPct, 1 - pred.homeWinPct);
    
    if (odds?.homeML && odds?.awayML) {
      const market = trueImplied(odds.homeML, odds.awayML);
      const homeEdge = pred.homeWinPct - market.home;
      if (dec >= 25 && Math.abs(homeEdge) >= EDGE_THRESHOLD)
        return { color: "green", edge: homeEdge, label: `+${(Math.abs(homeEdge) * 100).toFixed(1)}% ${homeEdge >= 0 ? "HOME" : "AWAY"} edge` };
      if (Math.abs(homeEdge) >= EDGE_THRESHOLD)
        return { color: "neutral", edge: homeEdge, label: `${(Math.abs(homeEdge) * 100).toFixed(1)}% edge (lean)` };
      return { color: "neutral", edge: homeEdge, label: `${(Math.abs(homeEdge) * 100).toFixed(1)}% edge` };
    }
    if (dec >= 25) return { color: "green", label: `${favSide} ${(favPct * 100).toFixed(0)}%` };
    return { color: "neutral", label: "Close matchup" };
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
        {!loading && oddsData?.games?.length > 0 && (
          <span style={{ fontSize: 11, color: C.green }}>✓ Live odds ({oddsData.games.length})</span>
        )}
        {!loading && oddsData?.noKey && (
          <span style={{ fontSize: 11, color: C.dim }}>⚠ Add ODDS_API_KEY for live lines</span>
        )}
        {loading && (
          <span style={{ color: C.dim, fontSize: 11 }}>
            ⏳ Loading {games.length > 0 ? `${games.length} games` : "schedule"}…
          </span>
        )}
        <span style={{ fontSize: 10, color: C.dim }}>NCAA Men's Basketball · ESPN API</span>
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

          const signals = getBetSignals({ pred: game.pred, odds: game.odds, sport: "ncaa" });
          const homeName = game.homeAbbr || (game.homeTeamName || "").slice(0, 8);
          const awayName = game.awayAbbr || (game.awayTeamName || "").slice(0, 8);
          const homeRank = game.homeStats?._kenPomRank || (game.homeRank && game.homeRank < 99 ? game.homeRank : null);
          const awayRank = game.awayStats?._kenPomRank || (game.awayRank && game.awayRank < 99 ? game.awayRank : null);
          
          // Determine if this is a "bet game" - has a bet sizing recommendation
          const isBetGame = !!signals.betSizing;
          const bannerInfo = getBannerInfo(game.pred, game.odds);
          
          // Border color: green for bet games, orange for strong edges, otherwise normal
          const borderColor = isBetGame ? "#3fb950" : (bannerInfo.color === "green" ? "#f97316" : C.border);
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
              {/* Header - Game time and bet indicator */}
              <div style={{
                padding: "8px 18px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                borderBottom: expanded === game.gameId ? `1px solid ${borderColor}` : "none",
                background: "rgba(0,0,0,0.2)"
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: C.orange }}>
                    {formatGameTime(game.gameDate, game.status)}
                  </div>
                  
                  {/* Edge label if no bet but has edge */}
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
                
                {/* Compact bet indicator on the right */}
                {isBetGame && <CompactBetIndicator betSizing={signals.betSizing} />}
                
                {!isBetGame && (
                  <div style={{ color: C.dim, fontSize: 12 }}>
                    {expanded === game.gameId ? "▲" : "▼"}
                  </div>
                )}
              </div>

              {/* Main game row */}
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
                    {/* Team record */}
                    {game.awayStats && (game.awayStats.wins > 0 || game.awayStats.losses > 0) ? (
                      <span style={{ fontSize: 10, color: C.dim }}>
                        {game.awayStats.wins}-{game.awayStats.losses}
                      </span>
                    ) : (
                      <span style={{ fontSize: 10, color: C.dim, fontStyle: "italic" }}>
                        No record
                      </span>
                    )}
                  </div>
                  
                  <div style={{ fontSize: 12, fontWeight: 500, color: "#e2e8f0" }}>
                    {formatSpread(game.pred.projectedSpread)}
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 500, color: game.odds?.homeSpread ? "#e2e8f0" : C.dim }}>
                    {game.odds?.homeSpread ? formatSpread(game.odds.homeSpread) : "-"}
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 500, color: "#e2e8f0" }}>
                    {formatML(game.pred.modelML_away)}
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
                    {/* Team record */}
                    {game.homeStats && (game.homeStats.wins > 0 || game.homeStats.losses > 0) ? (
                      <span style={{ fontSize: 10, color: C.dim }}>
                        {game.homeStats.wins}-{game.homeStats.losses}
                      </span>
                    ) : (
                      <span style={{ fontSize: 10, color: C.dim, fontStyle: "italic" }}>
                        No record
                      </span>
                    )}
                  </div>
                  
                  <div style={{ fontSize: 12, fontWeight: 500, color: "#e2e8f0" }}>
                    {formatSpread(-game.pred.projectedSpread)}
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 500, color: game.odds?.homeSpread ? "#e2e8f0" : C.dim }}>
                    {game.odds?.homeSpread ? formatSpread(-game.odds.homeSpread) : "-"}
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 500, color: "#e2e8f0" }}>
                    {formatML(game.pred.modelML_home)}
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
                    gap: 2
                  }}>
                    <div style={{ color: "#e2e8f0" }}>{game.pred.ouTotal}</div>
                    {game.odds?.ouLine && (
                      <div style={{ fontSize: 10, color: C.yellow }}>mkt: {game.odds.ouLine}</div>
                    )}
                  </div>
                </div>
              </div>

              {/* Expanded view */}
              {expanded === game.gameId && (
                <div style={{
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
                    <Kv k="O/U Total" v={game.pred.ouTotal} />
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
  const TABS = ["calendar", "accuracy", "history", "parlay"];

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
