// src/sports/ncaaf/NCAAFCalendarTab.jsx
// Reads ncaaf_predictions. Computes nothing.
//
// The client-side path is gone: no ncaafPredictGame, no fetchNCAAFTeamStats,
// no fetchOdds, no getBetSignals. Market lines, projections, gate output and
// results all come from Supabase. Anything on screen that isn't in a row
// isn't on screen.

import { useState, useEffect, useCallback, useMemo } from "react";
import { C, Pill, Kv, AccuracyDashboard, HistoryTab, ParlayBuilder } from "../../components/Shared.jsx";
import { NFL_TEAMS } from "../nfl/nflUtils.js";
import {
  loadNCAAFPredictions,
  refreshNCAAFWeek,
  ncaafAutoSync,
} from "./ncaafSync.js";

// Gate reference values — see ncaaf_serve.py:150-190
const VOTERS = 4;                    // ml, indep, lasso, residual (consensus>=4 is unanimity)
const EDGE_TIERS = [5, 3, 2];
const OU_EDGE_BASELINE = 1.82;
const FEATURE_COVERAGE_BASELINE = 0.23;

const BLOCK_LABEL = { consensus: "Consensus", not_contrarian: "Contrarian", avg_edge: "Avg edge" };

const n1 = (v, d = 1) => (v == null || v === "" || Number.isNaN(Number(v)) ? "—" : Number(v).toFixed(d));
const sgn = (v, d = 1) => {
  if (v == null || v === "" || Number.isNaN(Number(v))) return "—";
  const x = Number(v);
  return `${x > 0 ? "+" : ""}${x.toFixed(d)}`;
};

const tierOf = (edge) => {
  if (edge == null) return null;
  const [a, b, c] = EDGE_TIERS;
  return edge >= a ? "T1" : edge >= b ? "T2" : edge >= c ? "T3" : null;
};

// Cross-check the stored block reason against the gate's own inputs. The
// stored value always wins on screen; a mismatch flag means the notes and the
// code disagree about check order.
const deriveBlock = (g) => {
  if (g.atsConsensus == null) return null;
  if (!g.atsContrarian) return "not_contrarian";
  if (g.atsConsensus < VOTERS) return "consensus";
  if (g.atsAvgEdge == null || g.atsAvgEdge < EDGE_TIERS[2]) return "avg_edge";
  return null;
};

const teamColor = (abbr) => NFL_TEAMS.find((t) => t.abbr === abbr)?.color || "#1e3050";

// ─────────────────────────────────────────────────────────────
// DIAGNOSTICS — the Week 0 watch, on the page instead of in SQL
// ─────────────────────────────────────────────────────────────
function Diagnostics({ games }) {
  const d = useMemo(() => {
    const counts = { pass: 0, consensus: 0, not_contrarian: 0, avg_edge: 0, unlabeled: 0 };
    let ouSum = 0, ouN = 0, shadowN = 0, zeros = 0, suppressed = 0, mismatch = 0, noTotal = 0, covSum = 0, covN = 0, maxMissing = 0;

    games.forEach((g) => {
      const block = g.atsGateBlock;
      if (!block && g.atsPick) counts.pass++;
      else if (block && counts[block] !== undefined) counts[block]++;
      else counts.unlabeled++;

      const priced = Number(g.total) > 0;
      if (!priced) noTotal++;
      if (g.ouEdge != null && priced) { ouSum += Number(g.ouEdge); ouN++; }
      if (g.ouShadowPick) shadowN++;
      zeros += Number(g.atsNZero) || 0;
      if (g.featureCoverage != null) { covSum += Number(g.featureCoverage); covN++; }
      if (g.nMissing != null) maxMissing = Math.max(maxMissing, Number(g.nMissing));
      if (g.suppressReason) suppressed++;
      if ((g.atsGateBlock || null) !== deriveBlock(g)) mismatch++;
    });

    return {
      n: games.length, counts, mismatch, zeros, suppressed, shadowN, noTotal,
      coverage_mean: covN ? covSum / covN : null,
      n_missing_max: maxMissing || null,
      ouMean: ouN ? ouSum / ouN : null,
      ouN,
      coverage: games.length ? shadowN / games.length : null,
    };
  }, [games]);

  const drift = (v, base, tol) => (v == null ? C.dim : Math.abs(v - base) > tol ? C.yellow : C.green);

  const seg = [
    { k: "pass", label: "Pick fired", col: "#2ea043" },
    { k: "not_contrarian", label: "Contrarian", col: "#3d4650" },
    { k: "avg_edge", label: "Avg edge", col: "#4d5865" },
    { k: "consensus", label: "Consensus", col: "#5d6b7a" },
    { k: "unlabeled", label: "Unlabeled", col: "#8b3a3a" },
  ].filter((s) => d.counts[s.k]);

  const box = { background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 12px" };
  const cap = { fontSize: 9, color: C.dim, letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 4 };


  return (
    <div style={{ marginBottom: 14, display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 8 }}>
        <div style={box}>
          <div style={cap}>O/U edge mean</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: drift(d.ouMean, OU_EDGE_BASELINE, 0.75) }}>
            {d.ouMean == null ? "—" : sgn(d.ouMean, 2)}
          </div>
          <div style={{ fontSize: 10, color: C.dim }}>vs +{OU_EDGE_BASELINE} · {d.ouN} priced{d.noTotal ? `, ${d.noTotal} unpriced excluded` : ""}</div>
        </div>

        <div style={box}>
          <div style={cap}>Shadow coverage</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: d.shadowN === 0 ? C.dim : C.green }}>
            {d.coverage == null ? "—" : d.coverage.toFixed(2)}
          </div>
          <div style={{ fontSize: 10, color: C.dim }}>
            {d.shadowN === 0 ? "all null — expected" : `${d.shadowN} shadow picks`}
          </div>
        </div>

        <div style={box}>
          <div style={cap}>Feature coverage</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: d.coverage_mean == null ? C.dim : Math.abs(d.coverage_mean - FEATURE_COVERAGE_BASELINE) < 0.02 ? C.dim : d.coverage_mean > FEATURE_COVERAGE_BASELINE ? C.green : "#ff6b6b" }}>
            {d.coverage_mean == null ? "—" : d.coverage_mean.toFixed(2)}
          </div>
          <div style={{ fontSize: 10, color: C.dim }}>vs {FEATURE_COVERAGE_BASELINE} baseline · {d.n_missing_max ?? "?"} feats missing</div>
        </div>

        <div style={box}>
          <div style={cap}>Suppressed</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: d.suppressed > 0 ? C.yellow : C.green }}>
            {d.suppressed}
          </div>
          <div style={{ fontSize: 10, color: C.dim }}>rows with suppress_reason</div>
        </div>
      </div>

      <div style={box}>
        <div style={cap}>Gate outcome · {d.n} games</div>
        <div style={{ display: "flex", height: 8, borderRadius: 4, overflow: "hidden", background: "#0d1117", marginBottom: 6 }}>
          {seg.map((s) => (
            <div key={s.k} style={{ width: `${(d.counts[s.k] / Math.max(d.n, 1)) * 100}%`, background: s.col }} title={`${s.label}: ${d.counts[s.k]}`} />
          ))}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
          {seg.map((s) => (
            <span key={s.k} style={{ fontSize: 10, color: C.muted, display: "flex", alignItems: "center", gap: 5 }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: s.col }} />
              {s.label} <b style={{ color: "#e2e8f0" }}>{d.counts[s.k]}</b>
            </span>
          ))}
          {d.mismatch > 0 && (
            <span style={{ fontSize: 10, color: "#ff6b6b" }}>
              ⚠ {d.mismatch} row{d.mismatch !== 1 ? "s" : ""} where stored block ≠ derived
            </span>
          )}
        </div>
      </div>

    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// GAME CARD
// ─────────────────────────────────────────────────────────────
function GameCard({ g, open, onToggle }) {
  const fired = g.atsUnits > 0 && !g.atsGateBlock;
  const stored = g.atsGateBlock || null;
  const mismatch = stored !== deriveBlock(g);
  const aCol = teamColor(g.awayTeam);
  const hCol = teamColor(g.homeTeam);
  const pickSide = g.atsPick;

  return (
    <div style={{
      background: fired ? "linear-gradient(135deg,#0b2012,#0e2315)" : "linear-gradient(135deg,#0d1117,#111822)",
      border: `1px solid ${fired ? "#2ea043" : C.border}`, borderRadius: 10, overflow: "hidden",
    }}>
      <div style={{ height: 3, background: `linear-gradient(90deg,${aCol},${hCol})` }} />
      <div onClick={onToggle} style={{ padding: "12px 18px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>

        <div style={{ minWidth: 190 }}>
          <div style={{ fontSize: 13, color: "#e2e8f0" }}>
            {g.awayTeam} <span style={{ color: C.dim }}>@</span>{" "}
            <b>{g.homeTeam}</b>
          </div>
          <div style={{ fontSize: 10, color: C.dim }}>
            {g.gameDate}{g.week != null ? ` · Wk ${g.week}` : ""}{g.neutralSite ? " · neutral" : ""}
          </div>
        </div>

        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <Pill label="MKT" value={sgn(g.spread)} />
          <Pill label="TOTAL" value={n1(g.total)} />
          <Pill label="PROJ" value={`${n1(g.predAwayScore, 0)}–${n1(g.predHomeScore, 0)}`} />
          <Pill label="MARGIN" value={sgn(g.predMargin)} />
          {g.winProbability != null && <Pill label="WIN%" value={`${(Number(g.winProbability) * 100).toFixed(0)}%`} />}
        </div>

        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {fired ? (
            <span style={{ background: "#0d2818", border: "1px solid #2ea043", borderRadius: 6, padding: "3px 9px", fontSize: 11, fontWeight: 700, color: "#3fb950" }}>
              {pickSide} {g.atsUnits}u{tierOf(g.atsAvgEdge) ? ` ${tierOf(g.atsAvgEdge)}` : ""}
            </span>
          ) : (
            <span style={{ background: "#161b22", border: `1px solid ${C.border}`, borderRadius: 6, padding: "3px 9px", fontSize: 10, color: C.dim }}>
              {BLOCK_LABEL[stored] || stored || "no pick"}
            </span>
          )}
          {mismatch && <span style={{ fontSize: 9, color: "#ff6b6b" }} title={`stored ${stored ?? "null"} / derived ${deriveBlock(g) ?? "pass"}`}>≠</span>}
          {g.resultEntered && (
            <span style={{ fontSize: 10, color: g.mlCorrect ? C.green : "#ff4466", fontWeight: 700 }}>
              {g.actualAwayScore}–{g.actualHomeScore}
            </span>
          )}
          <span style={{ color: C.dim, fontSize: 12 }}>{open ? "▲" : "▼"}</span>
        </div>
      </div>

      {open && (
        <div style={{ borderTop: `1px solid ${C.border}`, padding: "14px 18px", background: "rgba(0,0,0,0.3)" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(145px,1fr))", gap: 8 }}>
            <Kv k="Consensus" v={`${g.atsConsensus ?? "—"} / ${VOTERS}`} />
            <Kv k="Contrarian" v={g.atsContrarian ? "yes" : "no"} />
            <Kv k="Avg edge" v={n1(g.atsAvgEdge, 2)} />
            <Kv k="ATS edge" v={sgn(g.atsEdge, 2)} />
            <Kv k="Gate" v={stored ? BLOCK_LABEL[stored] || stored : fired ? "passed" : "no pick"} />
            <Kv k="O/U edge" v={sgn(g.ouEdge, 2)} />
            <Kv k="O/U pick" v={g.ouPick ? `${g.ouPick} ${g.ouUnits}u` : "—"} />
            <Kv k="O/U shadow" v={g.ouShadowPick ? `${g.ouShadowPick} ${n1(g.ouShadowUnits)}u` : "—"} />
            <Kv k="Pred total" v={n1(g.predTotal)} />
            <Kv k="Vote split" v={`${g.atsNHome ?? "—"}H / ${g.atsNAway ?? "—"}A / ${g.atsNZero ?? "—"}Z`} />
            <Kv k="Model" v={g.modelVersion ?? "—"} />
            <Kv k="Missing feats" v={g.nMissing ?? "—"} />
            <Kv k="Books" v={g.numProviders ?? "—"} />
            {g.suppressReason && <Kv k="Suppressed" v={g.suppressReason} />}
            {g.gradedAt && <Kv k="Graded" v={String(g.gradedAt).slice(0, 16).replace("T", " ")} />}
            {g.featureCoverage != null && <Kv k="Feature coverage" v={n1(g.featureCoverage, 2)} />}
            {g.conferenceGame && <Kv k="Conference" v="yes" />}
            {g.resultEntered && <Kv k="ML" v={g.mlCorrect ? "✅" : "❌"} />}
            {g.resultEntered && g.atsUnits > 0 && (
              <Kv k="ATS" v={g.atsCorrect === true ? "✅" : g.atsCorrect === false ? "❌" : "—"} />
            )}
          </div>
          <div style={{ marginTop: 10, fontSize: 10, color: C.dim }}>
            Every value above is a stored column. Nothing on this card is computed in the browser.
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// CALENDAR TAB
// ─────────────────────────────────────────────────────────────
export function NCAAFCalendarTab({ season = new Date().getFullYear(), onGamesLoaded }) {
  const [games, setGames]     = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [week, setWeek]       = useState("all");
  const [picksOnly, setPicksOnly] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const rows = await loadNCAAFPredictions({ season });
      setGames(rows);
      onGamesLoaded?.(rows);
    } catch (e) {
      setError(e.message);
      setGames([]);
    } finally {
      setLoading(false);
    }
  }, [season]);

  useEffect(() => { load(); }, [load]);

  const weeks = useMemo(
    () => [...new Set(games.map((g) => g.week).filter((w) => w != null))].sort((a, b) => a - b),
    [games]
  );

  const scoped = useMemo(
    () => (week === "all" ? games : games.filter((g) => String(g.week) === String(week))),
    [games, week]
  );
  const visible = picksOnly ? scoped.filter((g) => g.atsUnits > 0) : scoped;

  const doRefresh = async () => {
    if (week === "all") return load();
    setRefreshing(true); setError(null);
    try {
      const rows = await refreshNCAAFWeek(season, week);
      setGames(rows);
      onGamesLoaded?.(rows);
    } catch (e) {
      setError(e.message);
    } finally {
      setRefreshing(false);
    }
  };

  const ctrl = { background: C.card, color: "#e2e8f0", border: `1px solid ${C.border}`, borderRadius: 6, padding: "5px 10px", fontSize: 11, fontFamily: "inherit" };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
        <select value={week} onChange={(e) => setWeek(e.target.value)} style={ctrl}>
          <option value="all">All weeks</option>
          {weeks.map((w) => <option key={w} value={w}>Week {w}</option>)}
        </select>

        <button onClick={doRefresh} disabled={loading || refreshing}
          style={{ ...ctrl, color: "#f97316", background: "#161b22", fontWeight: 700, cursor: "pointer" }}>
          {refreshing ? "⏳ RUNNING…" : week === "all" ? "↻ RELOAD" : "↻ RE-PREDICT WEEK"}
        </button>

        <label style={{ fontSize: 11, color: C.muted, display: "flex", alignItems: "center", gap: 5 }}>
          <input type="checkbox" checked={picksOnly} onChange={(e) => setPicksOnly(e.target.checked)} />
          Picks only
        </label>

        {loading && <span style={{ fontSize: 11, color: C.dim }}>⏳ Reading ncaaf_predictions…</span>}
        {!loading && !error && (
          <span style={{ fontSize: 10, color: C.dim }}>
            {visible.length} of {games.length} rows · season {season}
          </span>
        )}
      </div>

      {error && (
        <div style={{ background: "#1a0808", border: "1px solid #5a1a1a", borderRadius: 8, padding: "10px 14px", marginBottom: 12, fontSize: 11, color: "#ff6b6b", fontFamily: "monospace" }}>
          {error}
          <div style={{ color: C.dim, marginTop: 4 }}>
            Rows are unchanged. This is a read failure, not an empty slate — check the column names before changing the query.
          </div>
        </div>
      )}

      {!loading && !error && games.length > 0 && <Diagnostics games={scoped} />}

      {!loading && !error && games.length === 0 && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: "18px", fontSize: 12, color: C.dim }}>
          No rows in ncaaf_predictions for season {season}. The backend writes this table — run a
          prediction for a week, then reload.
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {visible.map((g) => (
          <GameCard key={g.id ?? g.gameId} g={g} open={expanded === (g.id ?? g.gameId)}
            onToggle={() => setExpanded(expanded === (g.id ?? g.gameId) ? null : (g.id ?? g.gameId))} />
        ))}
      </div>

      {!loading && !error && games.length > 0 && visible.length === 0 && (
        <div style={{ padding: "24px", textAlign: "center", fontSize: 11, color: C.dim }}>
          {picksOnly
            ? "No picks fired here. Uncheck picks only to see what the gate blocked and why."
            : "No games in this week."}
        </div>
      )}

      {!loading && !error && games.length > 0 && (
        <div style={{ marginTop: 12, fontSize: 10, color: C.dim, lineHeight: 1.6 }}>
          Blocked games stay on the board — the block distribution is the measurement, so hiding
          non-picks would hide it. Tiers are avg_edge ≥ {EDGE_TIERS.join(" / ")}; consensus ≥ {VOTERS} is
          unanimity across ml, indep, lasso and residual.
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// NCAAF SECTION (tab wrapper)
// ─────────────────────────────────────────────────────────────
export function NCAAFSection({ ncaafGames, setNcaafGames, refreshKey, setRefreshKey }) {
  const [tab, setTab] = useState("calendar");
  const [syncMsg, setSyncMsg] = useState("");

  return (
    <div>
      <div style={{ display: "flex", gap: 4, marginBottom: 8, flexWrap: "wrap", alignItems: "center" }}>
        {["calendar", "accuracy", "history", "parlay"].map((t) => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: "6px 16px", borderRadius: 7,
            border: `1px solid ${tab === t ? "#30363d" : "transparent"}`,
            background: tab === t ? "#161b22" : "transparent",
            color: tab === t ? "#f97316" : C.dim,
            cursor: "pointer", fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase",
          }}>
            {t === "calendar" ? "📅" : t === "accuracy" ? "📊" : t === "history" ? "📋" : "🎯"} {t}
          </button>
        ))}
        <div style={{ marginLeft: "auto" }}>
          <button onClick={async () => {
            setSyncMsg("Loading…");
            try { await ncaafAutoSync((m) => setSyncMsg(m)); setRefreshKey((k) => k + 1); }
            catch { /* message already set by ncaafAutoSync */ }
            setTimeout(() => setSyncMsg(""), 6000);
          }} style={{ background: "#161b22", color: C.muted, border: `1px solid ${C.border}`, borderRadius: 7, padding: "6px 12px", cursor: "pointer", fontSize: 10 }}>
            ⟳ Sync
          </button>
        </div>
      </div>

      {syncMsg && (
        <div style={{ background: "#0d1a10", border: "1px solid #1a3a1a", borderRadius: 7, padding: "8px 14px", marginBottom: 12, fontSize: 11, color: C.green, fontFamily: "monospace" }}>
          {syncMsg}
        </div>
      )}

      <div style={{ fontSize: 10, color: C.dim, marginBottom: 12, letterSpacing: 1 }}>
        NCAAF · 10-model production stack · Supabase is the source of truth · nothing computed in-browser
      </div>

      {tab === "calendar" && <NCAAFCalendarTab onGamesLoaded={setNcaafGames} />}
      {tab === "accuracy" && <AccuracyDashboard table="ncaaf_predictions" refreshKey={refreshKey} spreadLabel="Spread" />}
      {tab === "history"  && <HistoryTab table="ncaaf_predictions" refreshKey={refreshKey} />}
      {tab === "parlay"   && <ParlayBuilder mlbGames={[]} ncaaGames={ncaafGames} />}
    </div>
  );
}
