// src/components/ShapPanel.jsx
// Upgraded: bidirectional waterfall bars, expanded labels, show-more toggle
import React, { useState } from "react";

const LABEL_MAP = {
  // Market & core
  mkt_spread: "Market Spread", elo_diff: "Elo Rating Diff", neutral_em_diff: "Neutral EM Diff",
  has_mkt: "Has Market Line", mkt_total: "Market O/U Total", hca_pts: "Home Court Advantage",
  crowd_pct: "Crowd Factor", neutral: "Neutral Site",
  // Shooting & efficiency
  matchup_orb: "Matchup ORB Edge", orb_pct_diff: "Off Reb% Diff", threepct_diff: "3PT% Diff",
  twopt_diff: "2PT% Diff", ppp_diff: "Points Per Poss Diff", efg_diff: "eFG% Diff",
  three_rate_diff: "3PT Rate Diff", fta_rate_diff: "FTA Rate Diff",
  // Team quality
  pit_sos_diff: "SOS Diff (Pitzer)", opp_suppression_diff: "Opp Suppression Diff",
  opp_adj_form_diff: "Opp-Adj Form Diff", opp_ppg_diff: "Opp PPG Diff",
  floor_diff: "Floor Diff", pace_adj_margin_diff: "Pace-Adj Margin Diff",
  // Momentum & form
  roll_garbage_diff: "Roll Garbage Time Diff", roll_run_diff: "Roll Run Diff",
  roll_dominance_diff: "Roll Dominance Diff", roll_ats_margin_gated: "Roll ATS Margin",
  roll_clutch_ft_diff: "Roll Clutch FT Diff", roll_lead_change_avg: "Roll Lead Changes",
  // Style & matchup
  style_familiarity: "Style Familiarity", tempo_avg: "Avg Tempo",
  ato_diff: "A/TO Ratio Diff", blocks_diff: "Blocks Diff",
  assist_rate_diff: "Assist Rate Diff", drb_pct_diff: "Def Reb% Diff",
  to_margin_diff: "Turnover Margin Diff",
  // Context
  season_phase: "Season Phase", fatigue_x_quality: "Fatigue × Quality",
  luck_diff: "Luck Index Diff", opp_orb_pct_diff: "Opp ORB% Diff",
  // Referee
  ref_home_whistle: "Ref Home Bias", ref_ou_bias: "Ref O/U Bias",
  ref_foul_rate: "Ref Foul Rate", ref_pace_impact: "Ref Pace Impact", has_ref_data: "Has Ref Data",
  has_ats_data: "Has ATS Data",
  // Rolling player
  roll_star1_share_diff: "Star Player Share Diff", roll_top3_share_diff: "Top 3 Scoring Share",
  roll_bench_share_diff: "Bench Scoring Share", roll_bench_pts_diff: "Bench Points Diff",
  roll_hhi_diff: "Minutes Concentration Diff", roll_rotation_diff: "Rotation Depth Diff",
  // Orphaned (newly wired)
  adj_oe_diff: "Off Efficiency Diff", adj_de_diff: "Def Efficiency Diff",
  scoring_var_diff: "Scoring Volatility Diff", score_kurtosis_diff: "Score Kurtosis Diff",
  clutch_ratio_diff: "Clutch Performance Diff", garbage_adj_ppp_diff: "Garbage-Adj PPP Diff",
  days_since_loss_diff: "Days Since Loss Diff", games_since_blowout_diff: "Games Since Blowout Diff",
  games_last_14_diff: "Schedule Density Diff", rest_effect_diff: "Rest Effect Diff",
  momentum_halflife_diff: "Momentum Decay Diff", win_aging_diff: "Win Quality Aging Diff",
  centrality_diff: "Schedule Centrality Diff", dow_effect_diff: "Day-of-Week Effect Diff",
  conf_balance_diff: "Conf Balance Diff", n_common_opps: "Common Opponents",
  revenge_margin: "Revenge Margin", is_lookahead: "Lookahead/Trap Game",
  is_postseason: "Postseason Game",
  // Fixed features
  pyth_residual_diff: "Pythagorean Residual Diff", is_conf_tourney: "Conference Tournament",
  // Spread & betting
  spread_regime: "Spread Regime", consistency_x_spread: "Consistency × Spread",
  luck_x_spread: "Luck × Spread", form_x_familiarity: "Form × Familiarity",
  pace_leverage: "Pace Leverage", pace_control_diff: "Pace Control Diff",
  // Older features
  pred_home_score: "Proj Home Score", pred_away_score: "Proj Away Score",
  home_net_rtg: "Home Net Rtg", away_net_rtg: "Away Net Rtg",
  net_rtg_diff: "Net Rtg Diff", home_adj_em: "Home Adj EM", away_adj_em: "Away Adj EM",
  win_pct_home: "Model Win %", espn_wp_edge: "ESPN Win Prob Edge",
  matchup_ft: "Matchup FT Edge", matchup_to: "Matchup TO Edge", matchup_efg: "Matchup eFG Edge",
};

export default function ShapPanel({ shap, homeName, awayName }) {
  const [showAll, setShowAll] = useState(false);
  if (!shap || shap.length === 0) return null;

  const sorted = [...shap].sort((a, b) => Math.abs(b.shap) - Math.abs(a.shap));
  const visible = showAll ? sorted : sorted.slice(0, 8);
  const maxAbs = Math.max(...sorted.slice(0, 8).map(s => Math.abs(s.shap)), 0.01);

  return (
    <div style={{
      marginTop: 12, padding: "12px 14px",
      background: "linear-gradient(180deg, #080d18 0%, #0a1020 100%)",
      border: "1px solid #1a2744",
      borderRadius: 10,
    }}>
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10,
      }}>
        <div style={{ fontSize: 9, color: "#58a6ff", fontWeight: 800, letterSpacing: 2 }}>
          🔍 WHY THIS PICK (SHAP)
        </div>
        {sorted.length > 8 && (
          <button
            onClick={() => setShowAll(!showAll)}
            style={{
              background: "none", border: "1px solid #1e2d4a", borderRadius: 4,
              color: "#58a6ff", fontSize: 8, padding: "2px 8px", cursor: "pointer",
              fontWeight: 700, letterSpacing: 0.5,
            }}
          >
            {showAll ? `TOP 8 ▲` : `ALL ${sorted.length} ▼`}
          </button>
        )}
      </div>

      {/* Column headers */}
      <div style={{
        display: "grid", gridTemplateColumns: "minmax(100px,1fr) 60px 1fr 60px",
        gap: 0, fontSize: 8, color: "#484f58", marginBottom: 4, padding: "0 2px",
      }}>
        <span style={{ textAlign: "right", paddingRight: 4 }}>← {awayName || "Away"}</span>
        <span></span>
        <span></span>
        <span>{homeName || "Home"} →</span>
      </div>

      {visible.map((s, i) => {
        const pct = Math.min(Math.abs(s.shap) / maxAbs, 1);
        const pos = s.shap > 0;
        const barWidth = Math.max(pct * 100, 4);
        const label = LABEL_MAP[s.feature] || s.feature.replace(/_/g, " ");
        const value = Math.abs(s.shap).toFixed(2);

        return (
          <div key={i} style={{
            display: "grid",
            gridTemplateColumns: "1fr 120px 1fr",
            alignItems: "center",
            gap: 0,
            marginBottom: 3,
            padding: "2px 0",
          }}>
            {/* Left bar (away/negative) */}
            <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", height: 18 }}>
              {!pos && (
                <div style={{
                  display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 4,
                }}>
                  <span style={{ fontSize: 8, color: "#f0883e", opacity: 0.7 }}>{value}</span>
                  <div style={{
                    width: `${barWidth}%`, minWidth: 4, height: 14,
                    background: "linear-gradient(90deg, transparent, #da363388)",
                    borderRadius: "3px 0 0 3px",
                    boxShadow: pct > 0.5 ? "0 0 8px #da363344" : "none",
                  }} />
                </div>
              )}
            </div>

            {/* Center label */}
            <div style={{
              textAlign: "center", fontSize: 9, color: "#c9d1d9",
              padding: "0 6px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
              fontWeight: i < 3 ? 600 : 400,
            }} title={label}>
              {label}
            </div>

            {/* Right bar (home/positive) */}
            <div style={{ display: "flex", justifyContent: "flex-start", alignItems: "center", height: 18 }}>
              {pos && (
                <div style={{
                  display: "flex", alignItems: "center", gap: 4,
                }}>
                  <div style={{
                    width: `${barWidth}%`, minWidth: 4, height: 14,
                    background: "linear-gradient(90deg, #23863688, transparent)",
                    borderRadius: "0 3px 3px 0",
                    boxShadow: pct > 0.5 ? "0 0 8px #23863644" : "none",
                  }} />
                  <span style={{ fontSize: 8, color: "#3fb950", opacity: 0.7 }}>{value}</span>
                </div>
              )}
            </div>
          </div>
        );
      })}

      <div style={{
        fontSize: 8, color: "#484f58", marginTop: 8,
        display: "flex", justifyContent: "space-between",
      }}>
        <span>Bars show relative influence on this prediction</span>
        <span>Top {visible.length} of {sorted.length} features</span>
      </div>
    </div>
  );
}
