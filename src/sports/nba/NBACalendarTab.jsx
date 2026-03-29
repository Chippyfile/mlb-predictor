// src/sports/nba/NBACalendarTab.jsx
// v2: Matched to NCAA grid layout — BetBanner, UnitBadge, confidence footer, green ML styling
// v17 audit fixes preserved: removed redundant fetchNBARealPace calls
import { useState, useEffect, useCallback } from "react";
import { C, Pill, Kv, confColor2, AccuracyDashboard, HistoryTab, ParlayBuilder, BetSignalsPanel } from "../../components/Shared.jsx";
import ShapPanel from "../../components/ShapPanel.jsx";
import MonteCarloPanel from "../../components/MonteCarloPanel.jsx";
import { getBetSignals, trueImplied, EDGE_THRESHOLD, fetchOdds, DECISIVENESS_GATE } from "../../utils/sharedUtils.js";
import { mlPredict, mlPredictNBAFull, mlMonteCarlo } from "../../utils/mlApi.js";
import { nbaAutoSync, computeDaysRest } from "./nbaSync.js";
import {
  fetchNBAGamesForDate,
  fetchNBATeamStats,
  nbaPredictGame,
  matchNBAOddsToGame,
  NBA_TEAM_COLORS,
  computeLeagueAverages,
} from "./nbaUtils.js";

// ML moneyline cap
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

// ─────────────────────────────────────────────────────────────
// NBACalendarTab
// ─────────────────────────────────────────────────────────────
export function NBACalendarTab({ calibrationFactor, onGamesLoaded }) {
  const todayStr = new Date().toISOString().split("T")[0];
  const [dateStr, setDateStr] = useState(todayStr);
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const [oddsInfo, setOddsInfo] = useState(null);

  const load = useCallback(async (d) => {
    setLoading(true); setGames([]);
    const [raw, odds] = await Promise.all([fetchNBAGamesForDate(d), fetchOdds("basketball_nba")]);
    setOddsInfo(odds);
    setGames(raw.map(g => ({ ...g, loading: true })));
    // Pre-load all team stats and compute dynamic league averages
    const allStatsPairs = await Promise.all(raw.map(async g => {
      const [hs, as_] = await Promise.all([fetchNBATeamStats(g.homeAbbr), fetchNBATeamStats(g.awayAbbr)]);
      const nbaRealH = hs ? { pace: hs.pace, offRtg: hs.adjOE, defRtg: hs.adjDE, netRtg: hs.netRtg } : null;
      const nbaRealA = as_ ? { pace: as_.pace, offRtg: as_.adjOE, defRtg: as_.adjDE, netRtg: as_.netRtg } : null;
      return { game: g, hs, as_, nbaRealH, nbaRealA };
    }));
    // Compute league averages from all unique teams loaded today
    const uniqueNbaStats = [];
    const seenNba = new Set();
    for (const { hs, as_ } of allStatsPairs) {
      if (hs && !seenNba.has(hs.abbr)) { seenNba.add(hs.abbr); uniqueNbaStats.push(hs); }
      if (as_ && !seenNba.has(as_.abbr)) { seenNba.add(as_.abbr); uniqueNbaStats.push(as_); }
    }
    if (uniqueNbaStats.length >= 10) computeLeagueAverages(uniqueNbaStats);

    const enriched = await Promise.all(allStatsPairs.map(async ({ game: g, hs, as_, nbaRealH, nbaRealA }) => {
      const homeDaysRest = hs ? computeDaysRest(hs, d) : 2;
      const awayDaysRest = as_ ? computeDaysRest(as_, d) : 2;
      const awayPrevCityAbbr = as_?.lastGameCity || null;

      const pred = hs && as_ ? nbaPredictGame({
        homeStats: hs, awayStats: as_,
        neutralSite: g.neutralSite,
        calibrationFactor,
        homeRealStats: nbaRealH, awayRealStats: nbaRealA,
        homeAbbr: g.homeAbbr, awayAbbr: g.awayAbbr,
        homeDaysRest, awayDaysRest,
        awayPrevCityAbbr,
      }) : null;
      const rawOdds = odds?.games?.find(o => matchNBAOddsToGame(o, g)) || null;
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
      })() : null;
      // ── ML API: calibrated win prob + SHAP + Monte Carlo ──
      let mlResult = null, mcResult = null;
      if (pred) {
        try {
          // v27: Use /predict/nba/full — backend fetches all 55 features server-side
          // (ESPN summary, Supabase enrichment, referee profiles, rolling PBP, etc.)
          mlResult = await mlPredictNBAFull(g.gameId, { gameDate: d });
          if (mlResult) console.log(`[NBA ML] ${g.homeAbbr}: margin=${mlResult.ml_margin}, shap=${!!mlResult.shap}, meta=${!!mlResult.model_meta}`);
        } catch (e) { console.warn("[NBA ML] predict failed:", e.message); }
        // MC with ML-adjusted means
        const heuristicTotal = pred.homeScore + pred.awayScore;
        const ouBase = pred.ouTotal ?? heuristicTotal;
        const homeRatio = heuristicTotal > 0 ? pred.homeScore / heuristicTotal : 0.5;
        const mlMarginAdj = mlResult ? (mlResult.ml_margin - pred.projectedSpread) / 2 : 0;
        const mcHome = ouBase * homeRatio + mlMarginAdj;
        const mcAway = ouBase * (1 - homeRatio) - mlMarginAdj;
        try {
          mcResult = await mlMonteCarlo("NBA", mcHome, mcAway, 10000, gameOdds?.ouLine ?? pred.ouTotal, g.gameId);
        } catch (e) { console.warn("[NBA MC] failed:", e.message); }
      }
      // Reconcile projected scores with ML margin
      const finalPred = pred && mlResult ? (() => {
        const mlMargin = mlResult.ml_margin;
        const heuristicMargin = pred.projectedSpread;
        const marginShift = (mlMargin - heuristicMargin) / 2;
        const adjHomeScore = parseFloat((pred.homeScore + marginShift).toFixed(1));
        const adjAwayScore = parseFloat((pred.awayScore - marginShift).toFixed(1));
        const SIGMA = 15.0;
        const marginBasedWinProb = 1 / (1 + Math.pow(10, -mlMargin / SIGMA));
        const MARGIN_WEIGHT = 0.70;
        const rawBlended = MARGIN_WEIGHT * marginBasedWinProb + (1 - MARGIN_WEIGHT) * mlResult.ml_win_prob_home;
        const blendedWinHome = Math.max(0.08, Math.min(0.92, rawBlended));
        const blendedWinAway = 1 - blendedWinHome;
        const VIG = 0.0225;
        const hProb = blendedWinHome + VIG;
        const aProb = blendedWinAway + VIG;
        const newModelML_home = blendedWinHome >= 0.5
          ? -Math.min(ML_CAP, Math.round((hProb / (1 - hProb)) * 100))
          : +Math.min(ML_CAP, Math.round(((1 - hProb) / hProb) * 100));
        const newModelML_away = blendedWinAway >= 0.5
          ? -Math.min(ML_CAP, Math.round((aProb / (1 - aProb)) * 100))
          : +Math.min(ML_CAP, Math.round(((1 - aProb) / aProb) * 100));
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
          _heuristicHomeScore: pred.homeScore,
          _heuristicAwayScore: pred.awayScore,
          _heuristicSpread: pred.projectedSpread,
          _heuristicWinPct: pred.homeWinPct,
          _rawMlWinProb: mlResult.ml_win_prob_home,
        };
      })() : pred;
      return { ...g, homeStats: hs, awayStats: as_, pred: finalPred, loading: false, odds: gameOdds, mlShap: mlResult?.shap ?? null, mlMeta: mlResult?.model_meta ?? null, mc: mcResult };
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

          const signals = getBetSignals({ pred: game.pred, odds: game.odds, sport: "nba" });
          const isBetGame = !!signals.betSizing;
          const bannerInfo = getBannerInfo(game.pred, game.odds);

          const borderColor = isBetGame ? "#3fb950" : (bannerInfo.color === "green" ? "#f97316" : C.border);
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
                    <Kv k="Projected Score" v={`${awayName} ${game.pred.awayScore.toFixed(0)} — ${homeName} ${game.pred.homeScore.toFixed(0)}`} />
                    <Kv k="Win %" v={`${homeName} ${(game.pred.homeWinPct*100).toFixed(1)}% / ${awayName} ${((game.pred.awayWinPct ?? (1-game.pred.homeWinPct))*100).toFixed(1)}%`} />
                    <Kv k="Spread" v={game.pred.projectedSpread > 0 ? `${homeName} -${game.pred.projectedSpread.toFixed(1)}` : `${awayName} -${(-game.pred.projectedSpread).toFixed(1)}`} />
                    <Kv k="O/U Total" v={game.pred.ouTotal} />
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
