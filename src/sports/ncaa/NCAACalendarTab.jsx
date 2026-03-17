// src/sports/ncaa/NCAACalendarTab.jsx
import React, { useState, useEffect, useCallback, useRef } from "react";
import { C, confColor2, Pill, Kv, BetSignalsPanel, AccuracyDashboard, HistoryTab, ParlayBuilder } from "../../components/Shared.jsx";
import ShapPanel from "../../components/ShapPanel.jsx";
import MonteCarloPanel from "../../components/MonteCarloPanel.jsx";
import { getBetSignals, trueImplied, EDGE_THRESHOLD, DECISIVENESS_GATE } from "../../utils/sharedUtils.js";
import { mlPredict, mlMonteCarlo } from "../../utils/mlApi.js";
import { fetchNCAATeamStats, fetchNCAAGamesForDate, ncaaPredictGame, detectMissingStarters, getGameContext, calculateDynamicSigma, fetchNCAAKenPomRatings, applyKenPomRatings, computeRestDays } from "./ncaaUtils.js";
import { ncaaAutoSync, ncaaFullBackfill, ncaaRegradeAllResults } from "./ncaaSync.js";
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

// Bet advantage banner for game cards
// Uses checkmark unit indicators: ✓ = 1u, ✓✓ = 2u, ✓✓✓ = 3u
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
      {/* Left: unit blocks + pick + market ML */}
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
    </div>
  );
};

export default function NCAACalendarTab({ calibrationFactor, onGamesLoaded }) {
  const todayStr = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" })).toISOString().split("T")[0];
  const [dateStr, setDateStr] = useState(todayStr);
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(null);

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
      
      const dynamicSigma = homeStats && awayStats ? calculateDynamicSigma(homeStats, awayStats, d) : 16.0;
      const effectiveNeutral = (gameContext?.override_neutral || g.neutralSite);
      const pred = homeStats && awayStats ? ncaaPredictGame({ homeStats, awayStats, neutralSite: effectiveNeutral, calibrationFactor, sigma: dynamicSigma }) : null;
      const rawOdds = null; // Removed: Odds API matching — using ESPN pickcenter instead
      // Build gameOdds from ESPN data (already extracted in detectMissingStarters, zero extra calls)
      const gameOdds = (injuryData?.espn_spread != null || injuryData?.espn_home_ml != null) ? {
        homeSpread: injuryData.espn_spread,
        awaySpread: injuryData.espn_spread != null ? -injuryData.espn_spread : null,
        homeML: injuryData.espn_home_ml,
        awayML: injuryData.espn_away_ml,
        ouLine: injuryData.espn_over_under,
        source: "ESPN",
      } : null;
      
      let mlResult = null, mcResult = null;
      if (pred) {
        mlResult = await mlPredict("ncaa", {
            home_team_id: g.homeTeamId, away_team_id: g.awayTeamId,
            home_starter_ids: injuryData?.home_starter_ids || "",
            away_starter_ids: injuryData?.away_starter_ids || "",
            pred_home_score: pred.homeScore, pred_away_score: pred.awayScore,
            home_adj_em: pred.homeAdjEM, away_adj_em: pred.awayAdjEM,
            win_pct_home: pred.homeWinPct, ou_total: pred.ouTotal,
            model_ml_home: pred.modelML_home,
            neutral_site: effectiveNeutral,
            spread_home: pred.projectedSpread,
            market_spread_home: gameOdds?.homeSpread ?? null,
            market_ou_total: gameOdds?.ouLine ?? pred.ouTotal,
            // ESPN odds — extracted from same /summary call as injuries (zero extra API calls)
            espn_spread: injuryData?.espn_spread ?? 0,
            espn_over_under: injuryData?.espn_over_under ?? 0,
            espn_home_win_pct: injuryData?.espn_home_win_pct ?? 0.5,
            espn_predictor_home_pct: injuryData?.espn_predictor_home_pct ?? 0.5,
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
        const mlWinProb = mlResult.ml_win_prob_home;

        // v22: Use ML values directly — no blending, no sigma conversion
        // The StackedClassifier + isotonic calibration (Brier 0.111) is the
        // best-calibrated probability. Previous 70/30 blend was compressing it.
        const heuristicMargin = pred.projectedSpread;
        const marginShift = (mlMargin - heuristicMargin) / 2;
        const adjHomeScore = parseFloat((pred.homeScore + marginShift).toFixed(1));
        const adjAwayScore = parseFloat((pred.awayScore - marginShift).toFixed(1));

        const winHome = Math.max(0.05, Math.min(0.95, mlWinProb));
        const winAway = 1 - winHome;

        // Model moneylines with simulated vig (~4.5% total, split per side)
        const VIG = 0.0225; // 2.25% juice per side
        const homeProb = winHome + VIG;
        const awayProb = (1 - winHome) + VIG;
        const newModelML_home = winHome >= 0.5
          ? -Math.min(ML_CAP, Math.round((homeProb / (1 - homeProb)) * 100))
          : +Math.min(ML_CAP, Math.round(((1 - homeProb) / homeProb) * 100));
        const newModelML_away = winHome < 0.5
          ? -Math.min(ML_CAP, Math.round((awayProb / (1 - awayProb)) * 100))
          : +Math.min(ML_CAP, Math.round(((1 - awayProb) / awayProb) * 100));

        return {
          ...pred,
          homeScore: adjHomeScore,
          awayScore: adjAwayScore,
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
        ...g, homeStats, awayStats, pred: finalPred, loading: false,
        odds: gameOdds, mlShap: mlResult?.shap ?? null,
        mlMeta: mlResult?.model_meta ?? null, mc: mcResult,
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
    if (!pred) return { color: "yellow", label: "⚠ No prediction" };
    const dec = pred.decisiveness ?? (Math.abs(pred.homeWinPct - 0.5) * 100);
    const favSide = pred.homeWinPct >= 0.5 ? "HOME" : "AWAY";
    const favPct = Math.max(pred.homeWinPct, 1 - pred.homeWinPct);
    
    if (odds?.homeML && odds?.awayML) {
      const market = trueImplied(odds.homeML, odds.awayML);
      const homeEdge = pred.homeWinPct - market.home;
      if (dec >= DECISIVENESS_GATE.ncaa && Math.abs(homeEdge) >= EDGE_THRESHOLD)
        return { color: "green", edge: homeEdge, label: `+${(Math.abs(homeEdge) * 100).toFixed(1)}% ${homeEdge >= 0 ? "HOME" : "AWAY"} edge` };
      if (Math.abs(homeEdge) >= EDGE_THRESHOLD)
        return { color: "neutral", edge: homeEdge, label: `${(Math.abs(homeEdge) * 100).toFixed(1)}% edge (lean)` };
      return { color: "neutral", edge: homeEdge, label: `${(Math.abs(homeEdge) * 100).toFixed(1)}% edge` };
    }
    if (dec >= DECISIVENESS_GATE.ncaa) return { color: "green", label: `${favSide} ${(favPct * 100).toFixed(0)}%` };
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
              {/* Bet advantage banner - shows unit sizing + LEAN/BET */}
              {isBetGame && (
                <BetBanner signals={signals} homeName={homeName} awayName={awayName} />
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
                  {game.status === "Final" && <span style={{ fontSize: 10, color: C.green, fontWeight: 700 }}>FINAL {game.awayScore}-{game.homeScore}</span>}
                  {game.status === "Live" && <span style={{ fontSize: 10, color: C.orange, fontWeight: 700 }}>LIVE</span>}
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
                      {(signals.ou?.verdict === "GO" || signals.ou?.verdict === "LEAN") && signals.betSizing
                        ? <SignalBadge label={signals.ou?.side === "OVER" ? "OVER" : "UNDER"} color={signals.ou?.side === "OVER" ? "#2ea043" : "#58a6ff"}>
                            {game.pred.ouTotal}{signals.ou?.side && <span style={{ fontSize: 9, marginLeft: 3 }}>{signals.ou.side === "OVER" ? "▲" : "▼"}</span>}
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
                </div>
              )}

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
