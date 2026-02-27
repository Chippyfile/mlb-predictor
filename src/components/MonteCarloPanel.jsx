// src/components/MonteCarloPanel.jsx
// Lines 148–189 of App.jsx (extracted)
import React from "react";

export default function MonteCarloPanel({ mc }) {
  if (!mc?.histogram) return null;
  const maxCount = Math.max(...mc.histogram.map(h => h.count), 1);

  return (
    <div style={{ marginTop: 12, padding: "10px 14px", background: "#0a0f1a", border: "1px solid #1e2d4a", borderRadius: 8 }}>
      <div style={{ fontSize: 9, color: "#58a6ff", fontWeight: 800, letterSpacing: 2, marginBottom: 6 }}>
        🎲 MONTE CARLO ({mc.n_sims?.toLocaleString()} SIMS)
      </div>

      <div style={{ display: "flex", gap: 12, marginBottom: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 10, color: "#3fb950" }}>Home Win: {(mc.home_win_pct * 100).toFixed(1)}%</span>
        <span style={{ fontSize: 10, color: "#f85149" }}>Away Win: {(mc.away_win_pct * 100).toFixed(1)}%</span>
        <span style={{ fontSize: 10, color: "#c9d1d9" }}>Avg Margin: {mc.avg_margin > 0 ? "+" : ""}{mc.avg_margin?.toFixed(1)}</span>
        <span style={{ fontSize: 10, color: "#c9d1d9" }}>Avg Total: {mc.avg_total?.toFixed(1)}</span>
        {mc.over_pct != null && (
          <span style={{ fontSize: 10, color: mc.over_pct > 0.54 ? "#3fb950" : mc.under_pct > 0.54 ? "#f85149" : "#c9d1d9" }}>
            O/U {mc.ou_line}: O {(mc.over_pct * 100).toFixed(1)}% / U {(mc.under_pct * 100).toFixed(1)}%
          </span>
        )}
        {mc.home_rl_cover_pct != null && (
          <span style={{ fontSize: 10, color: "#c9d1d9" }}>
            RL -{mc.rl_threshold}: {(mc.home_rl_cover_pct * 100).toFixed(1)}% / +{mc.rl_threshold}: {(mc.away_rl_cover_pct * 100).toFixed(1)}%
          </span>
        )}
        {mc.distribution && (
          <span style={{ fontSize: 9, color: "#484f58" }}>({mc.distribution})</span>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "flex-end", gap: 1, height: 40 }}>
        {mc.histogram.map((b, i) => (
          <div
            key={i}
            title={`Margin ${b.bin > 0 ? "+" : ""}${b.bin}: ${b.count} sims`}
            style={{
              flex: 1,
              height: (b.count / maxCount) * 40,
              background: b.bin > 0 ? "#238636" : "#da3633",
              borderRadius: "2px 2px 0 0",
              opacity: 0.8,
            }}
          />
        ))}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 8, color: "#484f58", marginTop: 2 }}>
        <span>Away blowout</span><span>← Margin →</span><span>Home blowout</span>
      </div>

      {mc.margin_percentiles && (
        <div style={{ fontSize: 8, color: "#484f58", marginTop: 4 }}>
          P10–P90: {mc.margin_percentiles.p10} to +{mc.margin_percentiles.p90} pts
        </div>
      )}
    </div>
  );
}