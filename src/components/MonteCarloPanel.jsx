// src/components/MonteCarloPanel.jsx
// Upgraded: gradient histogram, spread/OU overlays, percentile ribbon, tabs
import React, { useState } from "react";

const StatBox = ({ label, value, color, sub }) => (
  <div style={{
    padding: "6px 10px",
    background: "#0d1117",
    border: "1px solid #1a2744",
    borderRadius: 6,
    flex: "1 1 0",
    minWidth: 80,
  }}>
    <div style={{ fontSize: 8, color: "#484f58", fontWeight: 600, letterSpacing: 1, marginBottom: 2 }}>
      {label}
    </div>
    <div style={{ fontSize: 13, fontWeight: 700, color: color || "#c9d1d9" }}>
      {value}
    </div>
    {sub && <div style={{ fontSize: 8, color: "#484f58", marginTop: 1 }}>{sub}</div>}
  </div>
);

export default function MonteCarloPanel({ mc }) {
  const [view, setView] = useState("margin"); // margin | total
  if (!mc?.histogram) return null;

  const hist = mc.histogram;
  const maxCount = Math.max(...hist.map(h => h.count), 1);
  const spreadLine = mc.spread_line ?? mc.market_spread ?? null;
  const ouLine = mc.ou_line ?? mc.market_ou ?? null;

  // Percentile data
  const p = mc.margin_percentiles || {};
  const hasPercentiles = p.p10 != null && p.p90 != null;

  // Total histogram (if available)
  const totalHist = mc.total_histogram || null;
  const totalMax = totalHist ? Math.max(...totalHist.map(h => h.count), 1) : 1;

  const activeHist = view === "total" && totalHist ? totalHist : hist;
  const activeMax = view === "total" && totalHist ? totalMax : maxCount;

  return (
    <div style={{
      marginTop: 12, padding: "12px 14px",
      background: "linear-gradient(180deg, #080d18 0%, #0a1020 100%)",
      border: "1px solid #1a2744",
      borderRadius: 10,
    }}>
      {/* Header */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10,
      }}>
        <div style={{ fontSize: 9, color: "#58a6ff", fontWeight: 800, letterSpacing: 2 }}>
          🎲 MONTE CARLO {mc.n_sims ? `(${mc.n_sims.toLocaleString()} SIMS)` : ""}
        </div>
        {totalHist && (
          <div style={{ display: "flex", gap: 2 }}>
            {["margin", "total"].map(v => (
              <button
                key={v}
                onClick={() => setView(v)}
                style={{
                  background: view === v ? "#1a2744" : "transparent",
                  border: `1px solid ${view === v ? "#2d4a7a" : "#1a2744"}`,
                  color: view === v ? "#58a6ff" : "#484f58",
                  fontSize: 8, fontWeight: 700, padding: "2px 8px",
                  borderRadius: 4, cursor: "pointer", letterSpacing: 0.5,
                  textTransform: "uppercase",
                }}
              >
                {v}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Summary stats row */}
      <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
        <StatBox
          label="HOME WIN"
          value={`${(mc.home_win_pct * 100).toFixed(1)}%`}
          color={mc.home_win_pct > 0.55 ? "#3fb950" : mc.home_win_pct < 0.45 ? "#f85149" : "#c9d1d9"}
        />
        <StatBox
          label="AVG MARGIN"
          value={`${mc.avg_margin > 0 ? "+" : ""}${mc.avg_margin?.toFixed(1)}`}
          color={mc.avg_margin > 2 ? "#3fb950" : mc.avg_margin < -2 ? "#f85149" : "#c9d1d9"}
        />
        <StatBox
          label="AVG TOTAL"
          value={mc.avg_total?.toFixed(1)}
          color="#c9d1d9"
          sub={ouLine != null ? `Line: ${ouLine}` : null}
        />
        {mc.over_pct != null && (
          <StatBox
            label="OVER"
            value={`${(mc.over_pct * 100).toFixed(1)}%`}
            color={mc.over_pct > 0.54 ? "#3fb950" : mc.under_pct > 0.54 ? "#f85149" : "#c9d1d9"}
            sub={ouLine != null ? `O/U ${ouLine}` : null}
          />
        )}
        {mc.home_rl_cover_pct != null && (
          <StatBox
            label={`RL -${mc.rl_threshold}`}
            value={`${(mc.home_rl_cover_pct * 100).toFixed(1)}%`}
            color={mc.home_rl_cover_pct > 0.55 ? "#3fb950" : "#c9d1d9"}
          />
        )}
      </div>

      {/* Histogram */}
      <div style={{ position: "relative" }}>
        {/* Bars */}
        <div style={{ display: "flex", alignItems: "flex-end", gap: 0.5, height: 60, position: "relative" }}>
          {activeHist.map((b, i) => {
            const h = Math.max((b.count / activeMax) * 56, 1);
            const binVal = b.bin ?? b.range_start ?? 0;
            const isMargin = view === "margin";
            const isPositive = isMargin ? binVal > 0 : true;

            // Highlight bar near spread line
            let highlighted = false;
            if (isMargin && spreadLine != null) {
              highlighted = Math.abs(binVal - (-spreadLine)) < 3;
            }
            if (!isMargin && ouLine != null) {
              highlighted = Math.abs(binVal - ouLine) < 3;
            }

            return (
              <div
                key={i}
                title={`${isMargin ? "Margin" : "Total"} ${binVal > 0 ? "+" : ""}${binVal}: ${b.count} sims`}
                style={{
                  flex: 1,
                  height: h,
                  background: isMargin
                    ? (isPositive
                      ? `linear-gradient(0deg, #238636${highlighted ? "cc" : "88"}, #238636${highlighted ? "88" : "33"})`
                      : `linear-gradient(0deg, #da3633${highlighted ? "cc" : "88"}, #da3633${highlighted ? "88" : "33"})`)
                    : `linear-gradient(0deg, #58a6ff${highlighted ? "cc" : "88"}, #58a6ff${highlighted ? "88" : "33"})`,
                  borderRadius: "2px 2px 0 0",
                  transition: "height 0.2s ease",
                  borderTop: highlighted ? "2px solid #f0c040" : "none",
                }}
              />
            );
          })}

          {/* Zero line for margin view */}
          {view === "margin" && hist.length > 0 && (() => {
            const bins = hist.map(h => h.bin ?? h.range_start ?? 0);
            const minBin = Math.min(...bins);
            const maxBin = Math.max(...bins);
            const range = maxBin - minBin || 1;
            const zeroPos = ((0 - minBin) / range) * 100;
            if (zeroPos > 5 && zeroPos < 95) {
              return (
                <div style={{
                  position: "absolute", left: `${zeroPos}%`, top: 0, bottom: 0,
                  width: 1, background: "#484f58", opacity: 0.6,
                  pointerEvents: "none",
                }} />
              );
            }
            return null;
          })()}
        </div>

        {/* Axis labels */}
        <div style={{
          display: "flex", justifyContent: "space-between",
          fontSize: 8, color: "#484f58", marginTop: 3, padding: "0 2px",
        }}>
          {view === "margin" ? (
            <>
              <span>← Away blowout</span>
              <span style={{ color: "#58a6ff", fontWeight: 600 }}>Margin</span>
              <span>Home blowout →</span>
            </>
          ) : (
            <>
              <span>Low scoring</span>
              <span style={{ color: "#58a6ff", fontWeight: 600 }}>Total Points</span>
              <span>High scoring</span>
            </>
          )}
        </div>
      </div>

      {/* Percentile ribbon */}
      {hasPercentiles && view === "margin" && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 8, color: "#484f58", marginBottom: 4, fontWeight: 600, letterSpacing: 1 }}>
            MARGIN DISTRIBUTION
          </div>
          <div style={{ position: "relative", height: 20, background: "#0d1117", borderRadius: 10, overflow: "hidden" }}>
            {/* P10-P90 range */}
            {(() => {
              const lo = parseFloat(p.p10) || -15;
              const hi = parseFloat(p.p90) || 15;
              const rangeMin = Math.min(lo, -25);
              const rangeMax = Math.max(hi, 25);
              const span = rangeMax - rangeMin || 1;
              const leftPct = ((lo - rangeMin) / span) * 100;
              const widthPct = ((hi - lo) / span) * 100;
              const medPct = p.p50 != null ? ((parseFloat(p.p50) - rangeMin) / span) * 100 : null;

              return (
                <>
                  {/* P10-P90 bar */}
                  <div style={{
                    position: "absolute", left: `${leftPct}%`, width: `${widthPct}%`,
                    top: 3, height: 14, borderRadius: 7,
                    background: "linear-gradient(90deg, #da363366, #48505866, #23863666)",
                  }} />
                  {/* Median marker */}
                  {medPct != null && (
                    <div style={{
                      position: "absolute", left: `${medPct}%`, top: 1, bottom: 1,
                      width: 2, background: "#f0c040", borderRadius: 1,
                    }} />
                  )}
                  {/* Labels */}
                  <div style={{
                    position: "absolute", left: `${leftPct}%`, top: -1,
                    fontSize: 7, color: "#f85149", fontWeight: 600, transform: "translateX(-50%)",
                  }}>
                    {p.p10}
                  </div>
                  <div style={{
                    position: "absolute", left: `${leftPct + widthPct}%`, top: -1,
                    fontSize: 7, color: "#3fb950", fontWeight: 600, transform: "translateX(-50%)",
                  }}>
                    +{p.p90}
                  </div>
                </>
              );
            })()}
          </div>
          <div style={{
            display: "flex", justifyContent: "center", gap: 12, fontSize: 8, color: "#484f58", marginTop: 3,
          }}>
            {p.p25 != null && <span>P25: {p.p25}</span>}
            {p.p50 != null && <span style={{ color: "#f0c040" }}>Median: {p.p50 > 0 ? "+" : ""}{p.p50}</span>}
            {p.p75 != null && <span>P75: +{p.p75}</span>}
          </div>
        </div>
      )}

      {/* Footer */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        fontSize: 8, color: "#484f58", marginTop: 8,
      }}>
        {mc.distribution && <span>{mc.distribution}</span>}
        {spreadLine != null && view === "margin" && (
          <span>Market spread: {spreadLine > 0 ? "+" : ""}{spreadLine}</span>
        )}
      </div>
    </div>
  );
}
