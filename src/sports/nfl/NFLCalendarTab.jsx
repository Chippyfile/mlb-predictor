import { pstTodayStr } from "../../utils/dateUtils.js";
// src/sports/nfl/NFLCalendarTab.jsx
// v4: Stacked ATS zones (T3/Z2/Z1) + ML (ATS-validated) + O/U UNDER + Predicted Scoreboard
import React, { useState, useEffect, useCallback } from "react";
import { C, Kv, AccuracyDashboard, HistoryTab } from "../../components/Shared.jsx";
import { supabaseQuery } from "../../utils/supabase.js";

// ── Zone colors & labels ──
const ZONE_META = {
  T3: { color: "#f5a623", label: "T3 · 77.5%", desc: "6/6 + spread 3-7 + flip", units: 3 },
  Z2: { color: "#3fb950", label: "Z2 · 66.9%", desc: "≥5/6 + spread 3-7 + flip", units: 2 },
  Z1: { color: "#58a6ff", label: "Z1 · 62.4%", desc: "≥5/6 + spread 0-3 + same", units: 2 },
};

const ML_COLOR = "#a78bfa";  // Purple for moneyline
const OU_COLOR = "#38bdf8";  // Cyan for O/U under

// ── Shared helpers ──
const formatSpread = (s) => s > 0 ? `+${s.toFixed(1)}` : s.toFixed(1);
const formatML = (ml) => {
  if (!ml) return "—";
  const v = Math.round(ml);
  return v > 0 ? `+${v}` : `${v}`;
};
const formatPct = (p) => p ? `${(p * 100).toFixed(0)}%` : "—";

// ── Unit blocks ──
const UnitBlocks = ({ count, max = 3, color }) => (
  <div style={{ display: "flex", gap: 2 }}>
    {Array.from({ length: max }, (_, i) => (
      <div key={i} style={{
        width: 18, height: 18, borderRadius: 3,
        background: i < count ? color : "#1a1e24",
        border: `1px solid ${i < count ? color : "#30363d"}`,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: i < count ? 10 : 8, fontWeight: 800,
        color: i < count ? "#fff" : "#484f58",
      }}>{i < count ? "✓" : `${i + 1}`}</div>
    ))}
  </div>
);

// ── Bet banner (top of game card when there's a bet signal) ──
const NFLBetBanner = ({ ats, ml, ou, homeName, awayName }) => {
  const hasBet = (ats?.units > 0) || (ml?.units > 0) || (ou?.units > 0);
  if (!hasBet) return null;

  const zone = ats?.zone ? ZONE_META[ats.zone] : null;
  const bannerColor = zone ? zone.color : (ml?.units > 0 ? ML_COLOR : OU_COLOR);

  return (
    <div style={{
      padding: "8px 14px",
      background: `linear-gradient(135deg, ${bannerColor}08, ${bannerColor}12)`,
      borderBottom: `1px solid ${bannerColor}44`,
      overflowX: "auto", WebkitOverflowScrolling: "touch",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, minWidth: 320 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          {/* ATS signal */}
          {ats?.units > 0 && zone && (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <UnitBlocks count={ats.units} color={zone.color} />
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <span style={{ fontSize: 9, color: C.dim, letterSpacing: 1 }}>ATS:</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: zone.color }}>
                    {ats.pickLabel} {formatSpread(ats.pickSpread)}
                  </span>
                  <span style={{
                    fontSize: 8, padding: "1px 5px", borderRadius: 3,
                    background: `${zone.color}25`, color: zone.color, fontWeight: 800,
                  }}>{zone.label}</span>
                </div>
                <span style={{ fontSize: 10, color: C.muted }}>
                  {ats.consensus} consensus · {ats.avgEdge} edge{ats.isFlip ? " · FLIP" : ""}
                </span>
              </div>
            </div>
          )}

          {/* ML signal */}
          {ml?.units > 0 && (
            <>
              {ats?.units > 0 && <div style={{ width: 1, height: 20, background: "#30363d" }} />}
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <UnitBlocks count={ml.units} color={ML_COLOR} />
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                    <span style={{ fontSize: 9, color: C.dim, letterSpacing: 1 }}>ML:</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: ML_COLOR }}>
                      {ml.pickLabel} {formatPct(ml.winProb)}
                    </span>
                  </div>
                  <span style={{ fontSize: 10, color: C.muted }}>
                    {ml.consensus} · ATS validated
                  </span>
                </div>
              </div>
            </>
          )}

          {/* O/U signal */}
          {ou?.units > 0 && (
            <>
              {(ats?.units > 0 || ml?.units > 0) && <div style={{ width: 1, height: 20, background: "#30363d" }} />}
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <UnitBlocks count={ou.units} max={1} color={OU_COLOR} />
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                    <span style={{ fontSize: 9, color: C.dim, letterSpacing: 1 }}>O/U:</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: OU_COLOR }}>
                      UNDER ▼
                    </span>
                  </div>
                  <span style={{ fontSize: 10, color: C.muted }}>
                    {ou.pred} residual · {ou.units}u
                  </span>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Right side badges */}
        <div style={{ display: "flex", gap: 4 }}>
          {ats?.units > 0 && (
            <div style={{
              padding: "3px 8px", borderRadius: 4, background: zone?.color || C.green,
              color: "#fff", fontSize: 10, fontWeight: 800, letterSpacing: 1,
            }}>{"✓".repeat(ats.units)} ATS</div>
          )}
          {ml?.units > 0 && (
            <div style={{
              padding: "3px 8px", borderRadius: 4, background: ML_COLOR,
              color: "#fff", fontSize: 10, fontWeight: 800, letterSpacing: 1,
            }}>{"✓".repeat(ml.units)} ML</div>
          )}
          {ou?.units > 0 && (
            <div style={{
              padding: "3px 8px", borderRadius: 4, background: OU_COLOR,
              color: "#fff", fontSize: 10, fontWeight: 800, letterSpacing: 1,
            }}>✓ O/U</div>
          )}
        </div>
      </div>
    </div>
  );
};

// ── Predicted Scoreboard mini ──
const PredictedScore = ({ away, home, awayScore, homeScore, winner }) => (
  <div style={{
    display: "flex", alignItems: "center", gap: 8, padding: "4px 8px",
    background: "#0a0e14", borderRadius: 6, border: "1px solid #1a2030",
  }}>
    <span style={{ fontSize: 11, color: winner === "away" ? "#e2e8f0" : C.dim, fontWeight: winner === "away" ? 700 : 400 }}>
      {away}
    </span>
    <span style={{
      fontSize: 14, fontWeight: 800, fontFamily: "monospace",
      color: "#e2e8f0", letterSpacing: 1,
    }}>
      {awayScore?.toFixed?.(0) ?? "—"} – {homeScore?.toFixed?.(0) ?? "—"}
    </span>
    <span style={{ fontSize: 11, color: winner === "home" ? "#e2e8f0" : C.dim, fontWeight: winner === "home" ? 700 : 400 }}>
      {home}
    </span>
  </div>
);


// ═══════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════
export default function NFLCalendarTab({ calibrationFactor, onGamesLoaded, onRefresh }) {
  const todayStr = pstTodayStr();
  const [dateStr, setDateStr] = useState(todayStr);
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const [weekFilter, setWeekFilter] = useState(null);

  const loadGames = useCallback(async (d) => {
    setLoading(true); setGames([]);

    // Load from Supabase nfl_predictions
    const stored = await supabaseQuery(
      `/nfl_predictions?game_date=eq.${d}&select=*`
    ).catch(e => { console.warn("Failed to load NFL predictions:", e); return []; });

    if (!Array.isArray(stored) || stored.length === 0) {
      // Try loading by week if no games on exact date
      setGames([]); setLoading(false);
      return;
    }

    const enriched = stored.map(sp => {
      const home = sp.home_team || "HOME";
      const away = sp.away_team || "AWAY";
      const spread = sp.spread_line ?? 0;
      const totalLine = sp.total_line ?? 44;

      // ATS signal
      const ats = {
        zone: sp.ats_zone || null,
        units: sp.ats_units ?? 0,
        pickSide: sp.ats_pick_side || null,
        pickLabel: sp.ats_pick_side === "home" ? home : away,
        pickSpread: sp.ats_pick_side === "home" ? spread : -spread,
        consensus: sp.ats_consensus || "—",
        avgEdge: sp.ats_avg_edge ?? 0,
        isFlip: sp.ats_is_flip ?? false,
      };

      // ML signal
      const ml = {
        units: sp.ml_units ?? 0,
        pickSide: sp.ml_pick_side || null,
        pickLabel: sp.ml_pick_side === "home" ? home : away,
        winProb: sp.ml_pick_side === "home" ? sp.ml_win_prob_home : (1 - (sp.ml_win_prob_home ?? 0.5)),
        consensus: sp.ml_consensus || "—",
        unanimous: sp.ml_unanimous ?? false,
        atsValidated: sp.ml_ats_validated ?? false,
      };

      // O/U signal
      const ou = {
        units: sp.ou_units ?? 0,
        pred: sp.ou_pred ?? 0,
        side: sp.ou_side || (sp.ou_pred < 0 ? "UNDER" : "OVER"),
        skipWeek: sp.ou_skip_week ?? false,
      };

      // Predicted scores
      const predHome = sp.pred_home_score ?? null;
      const predAway = sp.pred_away_score ?? null;

      return {
        id: sp.id || sp.game_id,
        gameId: sp.game_id,
        week: sp.week,
        gameDate: sp.game_date,
        gameTime: sp.game_time || null,
        status: sp.status || "scheduled",
        home, away,
        spread, totalLine,
        homeML: sp.home_moneyline ?? null,
        awayML: sp.away_moneyline ?? null,
        actualHomeScore: sp.actual_home_score ?? null,
        actualAwayScore: sp.actual_away_score ?? null,
        actualMargin: sp.actual_margin ?? null,
        actualTotal: sp.actual_total ?? null,
        ats, ml, ou,
        predHome, predAway,
        predMargin: sp.pred_margin ?? null,
        predTotal: sp.pred_total ?? null,
        consistency: sp.consistency || "—",
        // Display meta
        homeRecord: sp.home_record || null,
        awayRecord: sp.away_record || null,
        division: sp.div_game ?? false,
        isPlayoff: sp.is_playoff ?? false,
      };
    });

    // Sort: upcoming first, finals last
    enriched.sort((a, b) => {
      const af = a.status === "Final" ? 1 : 0;
      const bf = b.status === "Final" ? 1 : 0;
      if (af !== bf) return af - bf;
      return (a.gameTime || "").localeCompare(b.gameTime || "");
    });

    setGames(enriched);
    onGamesLoaded?.(enriched);
    setLoading(false);
  }, [onGamesLoaded]);

  useEffect(() => { loadGames(dateStr); }, [dateStr, loadGames]);

  return (
    <div>
      {/* Controls */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <input
          type="date" value={dateStr}
          onChange={e => setDateStr(e.target.value)}
          style={{
            background: C.card, color: "#e2e8f0", border: `1px solid ${C.border}`,
            borderRadius: 6, padding: "6px 10px", fontSize: 12, fontFamily: "inherit",
          }}
        />
        <button
          onClick={() => loadGames(dateStr)}
          style={{
            background: "#161b22", color: C.blue, border: `1px solid ${C.border}`,
            borderRadius: 6, padding: "6px 14px", cursor: "pointer", fontSize: 11, fontWeight: 700,
          }}
        >↻ REFRESH</button>
        {loading && <span style={{ color: C.dim, fontSize: 11 }}>⏳ Loading…</span>}
        {!loading && games.length > 0 && (
          <span style={{ fontSize: 11, color: C.green }}>
            {games.length} games · Week {games[0]?.week ?? "?"}
          </span>
        )}
      </div>

      {/* Empty state */}
      {!loading && games.length === 0 && (
        <div style={{ color: C.dim, textAlign: "center", marginTop: 40, lineHeight: 1.8 }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🏈</div>
          <div>No NFL predictions for {dateStr}</div>
          <div style={{ fontSize: 11 }}>Predictions generated by cron on game days</div>
        </div>
      )}

      {/* Game cards */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {games.map(game => {
          const { ats, ml, ou, home, away } = game;
          const hasBet = (ats.units > 0) || (ml.units > 0) || (ou.units > 0);
          const isFinal = game.status === "Final";
          const zone = ats.zone ? ZONE_META[ats.zone] : null;
          const borderColor = hasBet ? (zone?.color || ML_COLOR) : C.border;

          // ATS result (if final)
          let atsResult = null;
          if (isFinal && ats.units > 0 && game.actualMargin != null) {
            const residual = game.actualMargin + game.spread;
            const covered = ats.pickSide === "home" ? residual > 0 : residual < 0;
            atsResult = covered ? "✅" : "❌";
          }

          // ML result (if final)
          let mlResult = null;
          if (isFinal && ml.units > 0 && game.actualMargin != null) {
            const homeWon = game.actualMargin > 0;
            mlResult = (ml.pickSide === "home") === homeWon ? "✅" : "❌";
          }

          // O/U result
          let ouResult = null;
          if (isFinal && ou.units > 0 && game.actualTotal != null) {
            const wentUnder = game.actualTotal < game.totalLine;
            ouResult = (ou.side === "UNDER" && wentUnder) || (ou.side === "OVER" && !wentUnder) ? "✅" : "❌";
          }

          const predWinner = game.predHome > game.predAway ? "home" : "away";

          return (
            <div
              key={game.gameId || game.id}
              style={{
                background: `linear-gradient(135deg,${C.card},#111822)`,
                border: `${hasBet ? "2px" : "1px"} solid ${borderColor}`,
                borderRadius: 10, overflow: "hidden",
                boxShadow: hasBet ? `0 0 12px ${borderColor}20` : "none",
                cursor: "pointer",
              }}
              onClick={() => setExpanded(expanded === game.gameId ? null : game.gameId)}
            >
              {/* Bet banner */}
              <NFLBetBanner ats={ats} ml={ml} ou={ou} homeName={home} awayName={away} />

              {/* Header row */}
              <div style={{
                padding: "8px 18px",
                display: "flex", alignItems: "center", justifyContent: "space-between",
                background: hasBet ? "transparent" : "rgba(0,0,0,0.2)",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: C.blue }}>
                    {game.gameTime || `Week ${game.week}`}
                  </span>
                  {game.division && <span style={{ fontSize: 9, color: C.yellow, fontWeight: 600 }}>DIV</span>}
                  {game.isPlayoff && <span style={{ fontSize: 9, color: "#f5a623", fontWeight: 600 }}>PLAYOFF</span>}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {isFinal && (
                    <span style={{ fontSize: 10, color: C.green, fontWeight: 700 }}>
                      FINAL {game.actualAwayScore}–{game.actualHomeScore}
                    </span>
                  )}
                  {isFinal && atsResult && <span style={{ fontSize: 11 }}>{atsResult}</span>}
                  <span style={{ color: C.dim, fontSize: 12 }}>
                    {expanded === game.gameId ? "▲" : "▼"}
                  </span>
                </div>
              </div>

              {/* Main game layout */}
              <div style={{ padding: "12px 18px" }}>
                {/* Column headers */}
                <div style={{
                  display: "grid",
                  gridTemplateColumns: "140px 55px 55px 55px 55px 80px",
                  gap: 4, marginBottom: 6,
                  color: C.dim, fontSize: 9, fontWeight: 600,
                  textTransform: "uppercase", letterSpacing: "0.5px",
                }}>
                  <div></div>
                  <div>Pred</div>
                  <div>Spread</div>
                  <div>ML</div>
                  <div>Mkt</div>
                  <div style={{ textAlign: "center" }}>O/U</div>
                </div>

                {/* Away row */}
                <div style={{
                  display: "grid",
                  gridTemplateColumns: "140px 55px 55px 55px 55px 80px",
                  gap: 4, alignItems: "center", marginBottom: 6,
                }}>
                  <div>
                    <span style={{ fontSize: 15, fontWeight: 700 }}>{away}</span>
                    <span style={{ fontSize: 8, color: C.dim, marginLeft: 4 }}>AWAY</span>
                    {game.awayRecord && <div style={{ fontSize: 10, color: C.muted }}>{game.awayRecord}</div>}
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: predWinner === "away" ? "#e2e8f0" : C.dim }}>
                    {game.predAway?.toFixed(0) ?? "—"}
                  </div>
                  <div style={{ fontSize: 12, color: "#e2e8f0" }}>
                    {game.spread ? formatSpread(-game.spread) : "—"}
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 600,
                    color: ml.units > 0 && ml.pickSide === "away" ? ML_COLOR : "#e2e8f0",
                  }}>
                    {formatPct(1 - (game.ml_win_prob_home ?? 0.5))}
                  </div>
                  <div style={{ fontSize: 12, color: game.awayML ? "#e2e8f0" : C.dim }}>
                    {formatML(game.awayML)}
                  </div>
                  <div></div>
                </div>

                {/* Separator */}
                <div style={{ marginLeft: 60, marginBottom: 6, color: C.dim, fontSize: 10 }}>@</div>

                {/* Home row */}
                <div style={{
                  display: "grid",
                  gridTemplateColumns: "140px 55px 55px 55px 55px 80px",
                  gap: 4, alignItems: "center",
                }}>
                  <div>
                    <span style={{ fontSize: 15, fontWeight: 700 }}>{home}</span>
                    <span style={{ fontSize: 8, color: C.dim, marginLeft: 4 }}>HOME</span>
                    {game.homeRecord && <div style={{ fontSize: 10, color: C.muted }}>{game.homeRecord}</div>}
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: predWinner === "home" ? "#e2e8f0" : C.dim }}>
                    {game.predHome?.toFixed(0) ?? "—"}
                  </div>
                  <div style={{ fontSize: 12, color: "#e2e8f0" }}>
                    {game.spread ? formatSpread(game.spread) : "—"}
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 600,
                    color: ml.units > 0 && ml.pickSide === "home" ? ML_COLOR : "#e2e8f0",
                  }}>
                    {formatPct(game.ml_win_prob_home ?? 0.5)}
                  </div>
                  <div style={{ fontSize: 12, color: game.homeML ? "#e2e8f0" : C.dim }}>
                    {formatML(game.homeML)}
                  </div>
                  {/* O/U column */}
                  <div style={{
                    textAlign: "center", fontSize: 12, fontWeight: 600,
                    color: ou.units > 0 ? OU_COLOR : "#e2e8f0",
                  }}>
                    {ou.units > 0 ? (
                      <div style={{
                        display: "inline-flex", alignItems: "center", gap: 3,
                        background: `${OU_COLOR}15`, border: `1px solid ${OU_COLOR}40`,
                        borderRadius: 5, padding: "2px 6px",
                      }}>
                        <span>{game.predTotal?.toFixed(0) ?? game.totalLine}</span>
                        <span style={{ fontSize: 8, fontWeight: 800, color: OU_COLOR }}>▼ UN</span>
                      </div>
                    ) : (
                      game.predTotal?.toFixed(0) ?? game.totalLine
                    )}
                    {game.totalLine && (
                      <div style={{ fontSize: 10, color: C.yellow }}>mkt: {game.totalLine}</div>
                    )}
                  </div>
                </div>
              </div>

              {/* Confidence footer */}
              {hasBet && (
                <div style={{
                  padding: "5px 18px", background: "rgba(0,0,0,0.25)",
                  borderTop: `1px solid ${borderColor}22`,
                }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 10 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ color: C.dim }}>Consistency:</span>
                      <span style={{
                        color: game.consistency === "3/3" ? C.green : C.yellow, fontWeight: 700,
                      }}>{game.consistency}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      {ats.units > 0 && (
                        <span style={{ color: zone?.color || C.green }}>
                          ATS {ats.consensus} · edge {ats.avgEdge} {atsResult || ""}
                        </span>
                      )}
                      {ml.units > 0 && (
                        <span style={{ color: ML_COLOR }}>
                          ML {ml.consensus} {ml.atsValidated ? "· ATS✓" : ""} {mlResult || ""}
                        </span>
                      )}
                      {ou.units > 0 && (
                        <span style={{ color: OU_COLOR }}>
                          O/U {ou.pred?.toFixed?.(1)} {ouResult || ""}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Expanded detail view */}
              {expanded === game.gameId && (
                <div
                  onClick={e => e.stopPropagation()}
                  style={{
                    borderTop: `1px solid ${borderColor}`, padding: "14px 18px",
                    background: "rgba(0,0,0,0.3)",
                  }}
                >
                  {/* Predicted scoreboard */}
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 9, color: C.dim, letterSpacing: 1, marginBottom: 6, textTransform: "uppercase" }}>
                      Predicted Scoreboard
                    </div>
                    <PredictedScore
                      away={away} home={home}
                      awayScore={game.predAway} homeScore={game.predHome}
                      winner={predWinner}
                    />
                    {isFinal && (
                      <div style={{ marginTop: 6 }}>
                        <div style={{ fontSize: 9, color: C.dim, letterSpacing: 1, marginBottom: 4 }}>ACTUAL</div>
                        <PredictedScore
                          away={away} home={home}
                          awayScore={game.actualAwayScore} homeScore={game.actualHomeScore}
                          winner={game.actualMargin > 0 ? "home" : "away"}
                        />
                      </div>
                    )}
                  </div>

                  {/* Detail grid */}
                  <div style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))",
                    gap: 8, marginBottom: 10,
                  }}>
                    <Kv k="Pred Margin" v={game.predMargin != null ? `${game.predMargin > 0 ? home : away} by ${Math.abs(game.predMargin).toFixed(1)}` : "—"} />
                    <Kv k="Pred Total" v={game.predTotal?.toFixed(1) ?? "—"} />
                    <Kv k="Home Win %" v={formatPct(game.ml_win_prob_home)} />
                    <Kv k="ATS Zone" v={ats.zone || "None"} />
                    <Kv k="ATS Consensus" v={ats.consensus} />
                    <Kv k="ATS Edge" v={ats.avgEdge?.toFixed?.(2) ?? "—"} />
                    <Kv k="ATS Flip" v={ats.isFlip ? "Yes (dog)" : "No (fav)"} />
                    <Kv k="ML Consensus" v={ml.consensus} />
                    <Kv k="ML ATS Valid" v={ml.atsValidated ? "✅ Yes" : "❌ No"} />
                    <Kv k="O/U Residual" v={ou.pred?.toFixed?.(2) ?? "—"} />
                    <Kv k="O/U Side" v={ou.side} />
                    <Kv k="Consistency" v={game.consistency} />
                    {game.spread && <Kv k="Spread" v={formatSpread(game.spread)} />}
                    {game.totalLine && <Kv k="Total Line" v={game.totalLine} />}
                    {game.homeML && <Kv k="Home ML" v={formatML(game.homeML)} />}
                    {game.awayML && <Kv k="Away ML" v={formatML(game.awayML)} />}
                    {game.division && <Kv k="Divisional" v="Yes" />}
                    <Kv k="Week" v={game.week} />
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── NFL SECTION (tab wrapper) ────────────────────────────
export function NFLSection({ nflGames, setNflGames, calibrationNFL, setCalibrationNFL, refreshKey, setRefreshKey }) {
  const [tab, setTab] = useState("calendar");
  const TABS = ["calendar", "accuracy", "history"];
  return (
    <div>
      <div style={{ display: "flex", gap: 4, marginBottom: 16, flexWrap: "wrap" }}>
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: "6px 16px", borderRadius: 7,
            border: `1px solid ${tab === t ? "#30363d" : "transparent"}`,
            background: tab === t ? "#161b22" : "transparent",
            color: tab === t ? C.blue : C.dim,
            cursor: "pointer", fontSize: 11, fontWeight: 700,
            letterSpacing: 1, textTransform: "uppercase",
          }}>
            {t === "calendar" ? "🏈" : t === "accuracy" ? "📊" : "📋"} {t}
          </button>
        ))}
      </div>
      {tab === "calendar" && <NFLCalendarTab calibrationFactor={calibrationNFL} onGamesLoaded={g => { setNflGames(g); }} onRefresh={() => setRefreshKey(k => k + 1)} />}
      {tab === "accuracy" && <AccuracyDashboard table="nfl_predictions" refreshKey={refreshKey} onCalibrationChange={setCalibrationNFL} spreadLabel="Spread" />}
      {tab === "history" && <HistoryTab table="nfl_predictions" refreshKey={refreshKey} />}
    </div>
  );
}
