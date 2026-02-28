// src/components/ShapPanel.jsx
// Lines 107–146 of App.jsx (extracted)
import React from "react";

const LABEL_MAP = {
  pred_home_score: "Proj Home Score", pred_away_score: "Proj Away Score",
  pred_home_runs: "Proj Home Runs", pred_away_runs: "Proj Away Runs",
  home_net_rtg: "Home Net Rtg", away_net_rtg: "Away Net Rtg",
  net_rtg_diff: "Net Rtg Diff", score_diff_pred: "Score Diff (pred)",
  total_pred: "Proj Total", home_fav: "Home Favorite",
  win_pct_home: "Model Win %", ou_gap: "O/U Gap",
  home_adj_em: "Home Adj EM", away_adj_em: "Away Adj EM",
  adj_em_diff: "Adj EM Diff", neutral: "Neutral Site",
  spread_vs_market: "Spread vs Market", home_epa: "Home EPA",
  away_epa: "Away EPA", epa_diff: "EPA Diff",
  run_diff_pred: "Run Diff (pred)", ou_total: "O/U Line",
  ranked_game: "Ranked Game", home_rank_fill: "Home Rank", away_rank_fill: "Away Rank",
  // New NCAA features (Phase 1+2)
  ppg_diff: "PPG Diff", opp_ppg_diff: "Opp PPG Diff",
  fgpct_diff: "FG% Diff", threepct_diff: "3P% Diff",
  orb_pct_diff: "ORB% Diff", fta_rate_diff: "FTA Rate Diff",
  ato_diff: "A/TO Diff", def_fgpct_diff: "Def FG% Diff",
  steals_diff: "Steals Diff", blocks_diff: "Blocks Diff",
  sos_diff: "SOS Diff", form_diff: "Form Diff",
  rank_diff: "Rank Diff", win_pct_diff: "Win% Diff",
  tempo_avg: "Avg Tempo", is_ranked_game: "Ranked Game",
  is_top_matchup: "Top 25 Matchup",
  home_fgpct: "Home FG%", away_fgpct: "Away FG%",
  home_threepct: "Home 3P%", away_threepct: "Away 3P%",
  home_orb_pct: "Home ORB%", away_orb_pct: "Away ORB%",
  home_ato_ratio: "Home A/TO", away_ato_ratio: "Away A/TO",
  home_opp_fgpct: "Home Opp FG%", away_opp_fgpct: "Away Opp FG%",
};

export default function ShapPanel({ shap, homeName, awayName }) {
  if (!shap || shap.length === 0) return null;
  const top = shap.slice(0, 6);
  const maxAbs = Math.max(...top.map(s => Math.abs(s.shap)), 0.01);

  return (
    <div style={{ marginTop: 12, padding: "10px 14px", background: "#0a0f1a", border: "1px solid #1e2d4a", borderRadius: 8 }}>
      <div style={{ fontSize: 9, color: "#58a6ff", fontWeight: 800, letterSpacing: 2, marginBottom: 8 }}>🔍 WHY THIS PICK (SHAP)</div>
      {top.map((s, i) => {
        const pct = Math.abs(s.shap) / maxAbs;
        const pos = s.shap > 0;
        return (
          <div key={i} style={{ marginBottom: 6 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, marginBottom: 2 }}>
              <span style={{ color: "#c9d1d9" }}>{LABEL_MAP[s.feature] || s.feature}</span>
              <span style={{ color: pos ? "#3fb950" : "#f85149", fontWeight: 700 }}>
                {pos ? "▲" : "▼"} {pos ? `favors ${homeName}` : `favors ${awayName}`}
              </span>
            </div>
            <div style={{ height: 5, background: "#21262d", borderRadius: 3, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${pct * 100}%`, background: pos ? "#238636" : "#da3633", borderRadius: 3 }} />
            </div>
          </div>
        );
      })}
      <div style={{ fontSize: 8, color: "#484f58", marginTop: 6 }}>Bar width = relative influence on this prediction</div>
    </div>
  );
}