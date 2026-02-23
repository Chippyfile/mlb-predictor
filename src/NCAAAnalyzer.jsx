import { useState, useEffect } from "react";

const SUPABASE_URL = "https://lxaaqtqvlwjvyuedyauo.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx4YWFxdHF2bHdqdnl1ZWR5YXVvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE4MDYzNTUsImV4cCI6MjA4NzM4MjM1NX0.UItPw2j2oo5F2_zJZmf43gmZnNHVQ5FViQgbd4QEii0";

async function fetchAll() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/ncaa_predictions?result_entered=eq.true` +
    `&select=id,game_date,home_team,away_team,win_pct_home,pred_home_score,pred_away_score,` +
    `actual_home_score,actual_away_score,ml_correct,spread_home,confidence,home_adj_em,away_adj_em` +
    `&limit=5000&order=game_date.asc`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
  );
  return res.json();
}

function pct(n, d) { return d ? ((n / d) * 100).toFixed(1) : "—"; }
function avg(arr) { return arr.length ? (arr.reduce((a, b) => a + b, 0) / arr.length) : 0; }
function rmse(arr) { return arr.length ? Math.sqrt(arr.reduce((s, x) => s + x * x, 0) / arr.length) : 0; }
function mae(arr) { return arr.length ? arr.reduce((s, x) => s + Math.abs(x), 0) / arr.length : 0; }
function std(arr) {
  if (!arr.length) return 0;
  const m = avg(arr);
  return Math.sqrt(arr.reduce((s, x) => s + (x - m) ** 2, 0) / arr.length);
}

export default function NCAAAnalyzer() {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [section, setSection] = useState("winner");

  useEffect(() => {
    fetchAll().then(d => { setRecords(d || []); setLoading(false); });
  }, []);

  if (loading) return <div style={{ color: "#aaa", padding: 32, fontFamily: "monospace" }}>Loading records from Supabase…</div>;

  // ── Filter to records with both predicted and actual scores ──
  const scored = records.filter(r =>
    r.pred_home_score != null && r.pred_away_score != null &&
    r.actual_home_score != null && r.actual_away_score != null
  );
  const graded = records.filter(r => r.ml_correct !== null);

  // ── WINNER ACCURACY ─────────────────────────────────────────
  const correct = graded.filter(r => r.ml_correct).length;
  const favWon = graded.filter(r => {
    const favHome = (r.win_pct_home ?? 0.5) >= 0.5;
    const homeWon = r.actual_home_score > r.actual_away_score;
    return favHome ? homeWon : !homeWon;
  }).length;

  // By win probability bucket
  const buckets = [
    { label: "50–55%", min: 0.5, max: 0.55 },
    { label: "55–60%", min: 0.55, max: 0.60 },
    { label: "60–65%", min: 0.60, max: 0.65 },
    { label: "65–70%", min: 0.65, max: 0.70 },
    { label: "70–80%", min: 0.70, max: 0.80 },
    { label: "80%+",   min: 0.80, max: 1.00 },
  ];
  const bucketStats = buckets.map(b => {
    const pool = graded.filter(r => {
      const p = Math.max(r.win_pct_home ?? 0.5, 1 - (r.win_pct_home ?? 0.5));
      return p >= b.min && p < b.max;
    });
    const wins = pool.filter(r => r.ml_correct).length;
    return { ...b, total: pool.length, wins, pct: pool.length ? (wins / pool.length * 100).toFixed(1) : "—" };
  });

  // By confidence tier
  const tierStats = ["HIGH", "MEDIUM", "LOW"].map(tier => {
    const pool = graded.filter(r => r.confidence === tier);
    const wins = pool.filter(r => r.ml_correct).length;
    return { tier, total: pool.length, wins, pct: pool.length ? (wins / pool.length * 100).toFixed(1) : "—" };
  });

  // ── SCORE MARGIN OF ERROR ────────────────────────────────────
  const homeErrors = scored.map(r => r.pred_home_score - r.actual_home_score);
  const awayErrors = scored.map(r => r.pred_away_score - r.actual_away_score);
  const totalErrors = scored.map(r => (r.pred_home_score + r.pred_away_score) - (r.actual_home_score + r.actual_away_score));
  const spreadErrors = scored.map(r => (r.pred_home_score - r.pred_away_score) - (r.actual_home_score - r.actual_away_score));

  // Bias: positive = model over-predicts, negative = under-predicts
  const homeBias = avg(homeErrors);
  const awayBias = avg(awayErrors);
  const totalBias = avg(totalErrors);
  const spreadBias = avg(spreadErrors);

  // MAE / RMSE
  const homeMAE = mae(homeErrors);
  const awayMAE = mae(awayErrors);
  const totalMAE = mae(totalErrors);
  const spreadMAE = mae(spreadErrors);
  const homeRMSE = rmse(homeErrors);
  const awayRMSE = rmse(awayErrors);

  // Error distribution buckets
  const errorBuckets = [
    { label: "0–3 pts",  min: 0, max: 3 },
    { label: "3–6 pts",  min: 3, max: 6 },
    { label: "6–10 pts", min: 6, max: 10 },
    { label: "10–15 pts",min: 10, max: 15 },
    { label: "15+ pts",  min: 15, max: 999 },
  ];
  const homeErrDist = errorBuckets.map(b => ({
    ...b, count: homeErrors.filter(e => Math.abs(e) >= b.min && Math.abs(e) < b.max).length
  }));
  const awayErrDist = errorBuckets.map(b => ({
    ...b, count: awayErrors.filter(e => Math.abs(e) >= b.min && Math.abs(e) < b.max).length
  }));

  // ── UPSET ANALYSIS ───────────────────────────────────────────
  const upsets = graded.filter(r => !r.ml_correct);
  const upsetByEM = [
    { label: "EM gap 0–3",  min: 0, max: 3 },
    { label: "EM gap 3–6",  min: 3, max: 6 },
    { label: "EM gap 6–10", min: 6, max: 10 },
    { label: "EM gap 10+",  min: 10, max: 999 },
  ].map(b => {
    const pool = graded.filter(r => {
      const gap = r.home_adj_em != null && r.away_adj_em != null
        ? Math.abs(r.home_adj_em - r.away_adj_em) : null;
      return gap !== null && gap >= b.min && gap < b.max;
    });
    const wins = pool.filter(r => r.ml_correct).length;
    return { ...b, total: pool.length, wins, pct: pool.length ? (wins / pool.length * 100).toFixed(1) : "—" };
  });

  // ── MONTHLY TREND ─────────────────────────────────────────────
  const byMonth = {};
  graded.forEach(r => {
    const m = r.game_date?.slice(0, 7); if (!m) return;
    if (!byMonth[m]) byMonth[m] = { total: 0, correct: 0, homeErr: [], awayErr: [] };
    byMonth[m].total++;
    if (r.ml_correct) byMonth[m].correct++;
    if (r.pred_home_score && r.actual_home_score) {
      byMonth[m].homeErr.push(Math.abs(r.pred_home_score - r.actual_home_score));
      byMonth[m].awayErr.push(Math.abs(r.pred_away_score - r.actual_away_score));
    }
  });
  const monthlyData = Object.entries(byMonth).sort().map(([m, v]) => ({
    month: m,
    total: v.total,
    correct: v.correct,
    pct: (v.correct / v.total * 100).toFixed(1),
    homeMAE: avg(v.homeErr).toFixed(1),
    awayMAE: avg(v.awayErr).toFixed(1),
  }));

  // ── IMPROVEMENT SUGGESTIONS ──────────────────────────────────
  const suggestions = [];
  if (Math.abs(homeBias) > 1.5) suggestions.push(`Home score bias: model ${homeBias > 0 ? "over-predicts" : "under-predicts"} home team by ${Math.abs(homeBias).toFixed(1)} pts on average → apply a ${homeBias > 0 ? "-" : "+"}${Math.abs(homeBias).toFixed(1)} home correction factor`);
  if (Math.abs(awayBias) > 1.5) suggestions.push(`Away score bias: model ${awayBias > 0 ? "over-predicts" : "under-predicts"} away team by ${Math.abs(awayBias).toFixed(1)} pts on average → apply a ${awayBias > 0 ? "-" : "+"}${Math.abs(awayBias).toFixed(1)} away correction factor`);
  if (Math.abs(totalBias) > 2) suggestions.push(`Total score bias: model projects totals ${totalBias > 0 ? "too high" : "too low"} by ${Math.abs(totalBias).toFixed(1)} pts → O/U line needs ${totalBias > 0 ? "reduction" : "increase"}`);
  if (Math.abs(spreadBias) > 1.5) suggestions.push(`Spread bias: model spread is off by ${Math.abs(spreadBias).toFixed(1)} pts on average → affects ATS accuracy`);
  const lowBucket = bucketStats.find(b => b.label === "50–55%" && b.total > 20);
  if (lowBucket && parseFloat(lowBucket.pct) < 53) suggestions.push(`Toss-up games (50–55% confidence): only ${lowBucket.pct}% accuracy on ${lowBucket.total} games → consider filtering these out of parlay picks`);
  const highBucket = bucketStats.find(b => b.label === "80%+");
  if (highBucket && highBucket.total > 10 && parseFloat(highBucket.pct) > 75) suggestions.push(`High confidence picks (80%+): ${highBucket.pct}% on ${highBucket.total} games → model is well-calibrated at high probability end`);
  if (upsetByEM[0].total > 20 && parseFloat(upsetByEM[0].pct) < 56) suggestions.push(`Close matchups (EM gap 0–3): only ${upsetByEM[0].pct}% accuracy → near-even games are coin flips, reduce bet sizing here`);
  if (upsetByEM[3].total > 10 && parseFloat(upsetByEM[3].pct) > 80) suggestions.push(`Blowout matchups (EM gap 10+): ${upsetByEM[3].pct}% accuracy on ${upsetByEM[3].total} games → large EM gaps are highly reliable`);

  const C = {
    bg: "#0d1117", card: "#161b22", border: "#21262d",
    green: "#3fb950", yellow: "#d29922", red: "#f85149",
    blue: "#58a6ff", orange: "#f0883e", muted: "#8b949e", dim: "#484f58",
    text: "#e6edf3",
  };

  const Section = ({ id, label }) => (
    <button onClick={() => setSection(id)} style={{
      padding: "6px 14px", borderRadius: 7, fontSize: 11, fontWeight: 700,
      letterSpacing: 1, textTransform: "uppercase", cursor: "pointer",
      border: `1px solid ${section === id ? "#30363d" : "transparent"}`,
      background: section === id ? C.card : "transparent",
      color: section === id ? C.orange : C.muted,
    }}>{label}</button>
  );

  const StatRow = ({ label, value, sub, color }) => (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: `1px solid ${C.border}` }}>
      <span style={{ fontSize: 12, color: C.muted }}>{label}</span>
      <div style={{ textAlign: "right" }}>
        <span style={{ fontSize: 16, fontWeight: 800, color: color || C.text }}>{value}</span>
        {sub && <div style={{ fontSize: 10, color: C.dim }}>{sub}</div>}
      </div>
    </div>
  );

  const Table = ({ headers, rows }) => (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
      <thead>
        <tr>{headers.map(h => <th key={h} style={{ padding: "6px 10px", textAlign: "left", fontSize: 10, color: C.dim, letterSpacing: 1, borderBottom: `1px solid ${C.border}` }}>{h}</th>)}</tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i} style={{ background: i % 2 === 0 ? "transparent" : "#0a0f14" }}>
            {row.map((cell, j) => <td key={j} style={{ padding: "7px 10px", color: C.text }}>{cell}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );

  const barColor = (p) => {
    const v = parseFloat(p);
    if (isNaN(v)) return C.dim;
    return v >= 65 ? C.green : v >= 55 ? C.yellow : C.red;
  };

  return (
    <div style={{ background: C.bg, minHeight: "100vh", padding: 24, fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', monospace", color: C.text }}>
      <div style={{ maxWidth: 860, margin: "0 auto" }}>

        {/* Header */}
        <div style={{ marginBottom: 20 }}>
          <h1 style={{ fontSize: 20, fontWeight: 800, margin: 0, color: C.orange }}>🏀 NCAA Prediction Analysis</h1>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>
            {graded.length} graded games · {scored.length} with score predictions · 2024–25 season
          </div>
        </div>

        {/* Summary bar */}
        <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
          {[
            { label: "CORRECT PICKS", value: `${correct} / ${graded.length}`, sub: `${pct(correct, graded.length)}%`, color: C.green },
            { label: "HOME MAE", value: `${homeMAE.toFixed(2)} pts`, sub: `bias ${homeBias > 0 ? "+" : ""}${homeBias.toFixed(1)}`, color: Math.abs(homeBias) > 2 ? C.yellow : C.green },
            { label: "AWAY MAE", value: `${awayMAE.toFixed(2)} pts`, sub: `bias ${awayBias > 0 ? "+" : ""}${awayBias.toFixed(1)}`, color: Math.abs(awayBias) > 2 ? C.yellow : C.green },
            { label: "SPREAD MAE", value: `${spreadMAE.toFixed(2)} pts`, sub: `bias ${spreadBias > 0 ? "+" : ""}${spreadBias.toFixed(1)}`, color: Math.abs(spreadBias) > 2 ? C.yellow : C.green },
            { label: "TOTAL MAE", value: `${totalMAE.toFixed(2)} pts`, sub: `bias ${totalBias > 0 ? "+" : ""}${totalBias.toFixed(1)}`, color: Math.abs(totalBias) > 2 ? C.yellow : C.green },
          ].map(s => (
            <div key={s.label} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: "12px 16px", flex: 1, minWidth: 120, textAlign: "center" }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: s.color }}>{s.value}</div>
              <div style={{ fontSize: 9, color: C.muted, letterSpacing: 1, marginTop: 2 }}>{s.label}</div>
              <div style={{ fontSize: 10, color: C.dim, marginTop: 2 }}>{s.sub}</div>
            </div>
          ))}
        </div>

        {/* Nav */}
        <div style={{ display: "flex", gap: 4, marginBottom: 20, flexWrap: "wrap" }}>
          <Section id="winner"   label="🎯 Winner Accuracy" />
          <Section id="scores"   label="📏 Score Error" />
          <Section id="em"       label="⚡ EM Gap" />
          <Section id="monthly"  label="📅 By Month" />
          <Section id="suggest"  label="🔧 Improvements" />
        </div>

        {/* ── WINNER ACCURACY ── */}
        {section === "winner" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16 }}>
              <div style={{ fontSize: 11, color: C.dim, letterSpacing: 2, marginBottom: 12 }}>OVERALL WINNER ACCURACY</div>
              <StatRow label="Total graded games" value={graded.length} />
              <StatRow label="Correct picks" value={correct} color={C.green} />
              <StatRow label="Wrong picks" value={graded.length - correct} color={C.red} />
              <StatRow label="Accuracy" value={`${pct(correct, graded.length)}%`} color={parseFloat(pct(correct, graded.length)) >= 60 ? C.green : C.yellow} />
              <StatRow label="vs 50% baseline" value={`+${(parseFloat(pct(correct, graded.length)) - 50).toFixed(1)}%`} color={C.blue} />
            </div>

            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16 }}>
              <div style={{ fontSize: 11, color: C.dim, letterSpacing: 2, marginBottom: 12 }}>ACCURACY BY WIN PROBABILITY BUCKET</div>
              <div style={{ fontSize: 10, color: C.muted, marginBottom: 10 }}>Higher probability picks should win more often — this shows if the model is well-calibrated</div>
              <Table
                headers={["WIN PROB RANGE", "GAMES", "CORRECT", "ACCURACY", ""]}
                rows={bucketStats.map(b => [
                  b.label,
                  b.total,
                  b.wins,
                  b.pct === "—" ? "—" : `${b.pct}%`,
                  b.total > 0 ? (
                    <div style={{ background: "#21262d", borderRadius: 4, height: 8, width: 120, overflow: "hidden" }}>
                      <div style={{ background: barColor(b.pct), height: "100%", width: `${Math.min(100, parseFloat(b.pct) || 0)}%` }} />
                    </div>
                  ) : null
                ])}
              />
            </div>

            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16 }}>
              <div style={{ fontSize: 11, color: C.dim, letterSpacing: 2, marginBottom: 12 }}>ACCURACY BY CONFIDENCE TIER</div>
              <Table
                headers={["TIER", "GAMES", "CORRECT", "ACCURACY"]}
                rows={tierStats.map(t => [
                  <span style={{ color: t.tier === "HIGH" ? C.green : t.tier === "MEDIUM" ? C.yellow : C.muted }}>{t.tier}</span>,
                  t.total,
                  t.wins,
                  t.pct === "—" ? "—" : `${t.pct}%`
                ])}
              />
            </div>
          </div>
        )}

        {/* ── SCORE ERROR ── */}
        {section === "scores" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16 }}>
              <div style={{ fontSize: 11, color: C.dim, letterSpacing: 2, marginBottom: 4 }}>SCORE PREDICTION ERROR ({scored.length} games with score predictions)</div>
              <div style={{ fontSize: 10, color: C.muted, marginBottom: 12 }}>MAE = mean absolute error · RMSE = root mean square error (penalizes big misses more) · Bias = consistent over/under-prediction</div>
              <Table
                headers={["METRIC", "MAE", "RMSE", "BIAS", "STD DEV"]}
                rows={[
                  ["Home team score", `${homeMAE.toFixed(2)} pts`, `${homeRMSE.toFixed(2)} pts`,
                    <span style={{ color: Math.abs(homeBias) > 2 ? C.yellow : C.green }}>{homeBias > 0 ? "+" : ""}{homeBias.toFixed(2)} pts</span>,
                    `${std(homeErrors).toFixed(2)} pts`],
                  ["Away team score", `${awayMAE.toFixed(2)} pts`, `${awayRMSE.toFixed(2)} pts`,
                    <span style={{ color: Math.abs(awayBias) > 2 ? C.yellow : C.green }}>{awayBias > 0 ? "+" : ""}{awayBias.toFixed(2)} pts</span>,
                    `${std(awayErrors).toFixed(2)} pts`],
                  ["Game total (O/U)", `${totalMAE.toFixed(2)} pts`, `${rmse(totalErrors).toFixed(2)} pts`,
                    <span style={{ color: Math.abs(totalBias) > 2 ? C.yellow : C.green }}>{totalBias > 0 ? "+" : ""}{totalBias.toFixed(2)} pts</span>,
                    `${std(totalErrors).toFixed(2)} pts`],
                  ["Spread (margin)", `${spreadMAE.toFixed(2)} pts`, `${rmse(spreadErrors).toFixed(2)} pts`,
                    <span style={{ color: Math.abs(spreadBias) > 2 ? C.yellow : C.green }}>{spreadBias > 0 ? "+" : ""}{spreadBias.toFixed(2)} pts</span>,
                    `${std(spreadErrors).toFixed(2)} pts`],
                ]}
              />
            </div>

            <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
              <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16, flex: 1, minWidth: 280 }}>
                <div style={{ fontSize: 11, color: C.dim, letterSpacing: 2, marginBottom: 12 }}>HOME TEAM ERROR DISTRIBUTION</div>
                <Table
                  headers={["ERROR RANGE", "COUNT", "% OF GAMES"]}
                  rows={homeErrDist.map(b => [b.label, b.count, `${pct(b.count, scored.length)}%`])}
                />
              </div>
              <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16, flex: 1, minWidth: 280 }}>
                <div style={{ fontSize: 11, color: C.dim, letterSpacing: 2, marginBottom: 12 }}>AWAY TEAM ERROR DISTRIBUTION</div>
                <Table
                  headers={["ERROR RANGE", "COUNT", "% OF GAMES"]}
                  rows={awayErrDist.map(b => [b.label, b.count, `${pct(b.count, scored.length)}%`])}
                />
              </div>
            </div>

            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16 }}>
              <div style={{ fontSize: 11, color: C.dim, letterSpacing: 2, marginBottom: 8 }}>WHAT THIS MEANS</div>
              <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.7 }}>
                {homeMAE < 8
                  ? `✅ Home score MAE of ${homeMAE.toFixed(1)} pts is reasonable for a college basketball model (Vegas lines typically miss by ~7–9 pts per team).`
                  : `⚠️ Home score MAE of ${homeMAE.toFixed(1)} pts is above the expected range — home efficiency data may need recalibration.`
                }
                {" "}
                {Math.abs(homeBias) > 2
                  ? `⚠️ Home bias of ${homeBias > 0 ? "+" : ""}${homeBias.toFixed(1)} pts suggests the model consistently ${homeBias > 0 ? "over-predicts" : "under-predicts"} home scoring — a static offset correction would improve O/U accuracy.`
                  : `✅ Home bias is within ±2 pts — no systematic offset needed.`
                }
                {" "}
                {Math.abs(awayBias) > 2
                  ? `⚠️ Away bias of ${awayBias > 0 ? "+" : ""}${awayBias.toFixed(1)} pts — same issue on road team projections.`
                  : `✅ Away bias is within ±2 pts.`
                }
              </div>
            </div>
          </div>
        )}

        {/* ── EM GAP ── */}
        {section === "em" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16 }}>
              <div style={{ fontSize: 11, color: C.dim, letterSpacing: 2, marginBottom: 4 }}>ACCURACY BY EFFICIENCY MARGIN GAP</div>
              <div style={{ fontSize: 10, color: C.muted, marginBottom: 12 }}>EM gap = difference in adjusted efficiency margins between teams. Larger gap = more predictable game.</div>
              <Table
                headers={["EM GAP", "GAMES", "CORRECT", "ACCURACY", ""]}
                rows={upsetByEM.map(b => [
                  b.label,
                  b.total,
                  b.wins,
                  b.pct === "—" ? "—" : `${b.pct}%`,
                  b.total > 0 ? (
                    <div style={{ background: "#21262d", borderRadius: 4, height: 8, width: 120, overflow: "hidden" }}>
                      <div style={{ background: barColor(b.pct), height: "100%", width: `${Math.min(100, parseFloat(b.pct) || 0)}%` }} />
                    </div>
                  ) : null
                ])}
              />
            </div>
            <div style={{ background: "#0d1a10", border: `1px solid #1a3a1a`, borderRadius: 10, padding: 16 }}>
              <div style={{ fontSize: 11, color: C.green, fontWeight: 700, marginBottom: 8 }}>KEY INSIGHT</div>
              <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.7 }}>
                The EM gap is your most reliable betting signal. Games with large EM gaps (10+) tend to have the highest accuracy —
                these are where the model has the most edge. Games with EM gaps under 3 are near coin-flips regardless of
                what the win probability says. Consider using EM gap as a filter: only include parlay legs where the EM gap is 5+.
              </div>
            </div>
          </div>
        )}

        {/* ── MONTHLY ── */}
        {section === "monthly" && (
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16 }}>
            <div style={{ fontSize: 11, color: C.dim, letterSpacing: 2, marginBottom: 12 }}>ACCURACY & SCORE ERROR BY MONTH</div>
            <Table
              headers={["MONTH", "GAMES", "CORRECT", "ML %", "HOME MAE", "AWAY MAE"]}
              rows={monthlyData.map(m => [
                m.month,
                m.total,
                m.correct,
                <span style={{ color: barColor(m.pct) }}>{m.pct}%</span>,
                `${m.homeMAE} pts`,
                `${m.awayMAE} pts`,
              ])}
            />
            <div style={{ fontSize: 10, color: C.dim, marginTop: 12 }}>
              Early season months (Nov–Dec) typically show lower accuracy due to small sample sizes and new rosters.
              Post-January numbers are more reliable for calibration.
            </div>
          </div>
        )}

        {/* ── IMPROVEMENTS ── */}
        {section === "suggest" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16 }}>
              <div style={{ fontSize: 11, color: C.dim, letterSpacing: 2, marginBottom: 12 }}>DATA-DRIVEN IMPROVEMENT SUGGESTIONS</div>
              {suggestions.length === 0
                ? <div style={{ color: C.green, fontSize: 13 }}>✅ No major systematic biases detected — model is well-calibrated.</div>
                : suggestions.map((s, i) => (
                    <div key={i} style={{ background: "#1a1200", border: "1px solid #3a2a00", borderRadius: 8, padding: "10px 14px", marginBottom: 8, fontSize: 12, color: C.yellow, lineHeight: 1.6 }}>
                      ⚠️ {s}
                    </div>
                  ))
              }
            </div>
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16 }}>
              <div style={{ fontSize: 11, color: C.dim, letterSpacing: 2, marginBottom: 12 }}>WHAT COULD INCREASE ACCURACY FURTHER</div>
              {[
                { title: "Injury & roster data", desc: "Missing starters have the biggest single-game impact in college basketball. No free API exists but ESPN game notes sometimes mention it." },
                { title: "Home/away split stats", desc: "Some teams play dramatically differently at home vs away. ESPN team stats are season-wide averages — splitting them would improve road game predictions." },
                { title: "Conference strength adjustment", desc: "A team with a 110 OE in the SEC faces harder competition than the same 110 OE in the Sun Belt. Inter-conference games are where the current model has the most error." },
                { title: "Fatigue / travel factor", desc: "Back-to-back games and cross-country travel affect performance, especially for away teams. This could be approximated from schedule data." },
                { title: "Recent form weighting", desc: `Current form weight is capped at 10%. Increasing it for mid-to-late season (when teams have 20+ games) could improve accuracy in February/March.` },
                { title: "Pace of play adjustment", desc: "Current tempo estimate is derived from assists/turnovers. A direct possessions-per-game stat would be more accurate and reduce spread error." },
              ].map((item, i) => (
                <div key={i} style={{ borderBottom: i < 5 ? `1px solid ${C.border}` : "none", padding: "10px 0" }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: C.blue, marginBottom: 3 }}>→ {item.title}</div>
                  <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.6 }}>{item.desc}</div>
                </div>
              ))}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
