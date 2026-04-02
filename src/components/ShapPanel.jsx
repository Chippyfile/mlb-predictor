// src/components/ShapPanel.jsx
// Enhanced: raw values, zero verification, data pipeline health
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
  ref_foul_rate: "Ref Foul Rate", ref_foul_proxy: "Ref Foul Proxy",
  ref_pace_impact: "Ref Pace Impact", has_ref_data: "Has Ref Data",
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
  // v25 features
  market_wp_edge: "market wp edge", spread_movement: "Spread Movement",
  total_movement: "Total Movement", is_early: "Early Season",
  is_ncaa_tourney: "NCAA Tournament", player_rating_diff: "player rating diff",
  weakest_starter_diff: "weakest starter diff", starter_balance_diff: "Starter Balance Diff",
  starter_experience_diff: "Starter Experience Diff", lineup_changes_diff: "Lineup Changes Diff",
  lineup_stability_diff: "Lineup Stability Diff", h2h_margin_avg: "H2H Margin Avg",
  h2h_home_win_rate: "H2H Home Win Rate", is_revenge_game: "Revenge Game",
  conf_strength_diff: "Conf Strength Diff", cross_conf_flag: "Cross-Conf Game",
  recent_form_diff: "Recent Form Diff", pace_adj_ppg_diff: "Pace-Adj PPG Diff",
  pace_adj_opp_ppg_diff: "Pace-Adj Opp PPG Diff",
  // NBA v27
  scoring_entropy_diff: "Scoring Entropy Diff", scoring_hhi_diff: "Scoring HHI Diff",
  consistency_diff: "Consistency Diff", bimodal_diff: "Bimodal Diff",
  lineup_value_diff: "Lineup Value Diff", ceiling_diff: "Ceiling Diff",
  ts_diff: "True Shooting Diff", opp_efg_diff: "Opp eFG Diff",
  roll_dreb_diff: "Roll DReb Diff", roll_paint_pts_diff: "Roll Paint Pts Diff",
  roll_max_run_avg: "Roll Max Run Avg", roll_fast_break_diff: "Roll Fast Break Diff",
  roll_ft_trip_rate_diff: "Roll FT Trip Rate Diff",
  espn_pregame_wp: "ESPN Pregame WP", espn_pregame_wp_pbp: "ESPN PBP Win Prob",
  implied_prob_home: "Implied Prob Home",
  margin_accel_diff: "Margin Accel Diff", margin_skew_diff: "Margin Skew Diff",
  margin_var_diff: "Margin Variance Diff", margin_trend_diff: "Margin Trend Diff",
  streak_diff: "Streak Diff", pyth_luck_diff: "Pythagorean Luck Diff",
  common_opp_margin_diff: "Common Opp Margin Diff", ats_rolling_diff: "ATS Rolling Diff",
  sharp_spread_signal: "Sharp Spread Signal", sharp_ml_signal: "Sharp ML Signal",
  spread_juice_imbalance: "Spread Juice Imbalance", vig_uncertainty: "Vig Uncertainty",
  overround: "Overround", ou_gap: "O/U Gap",
  market_spread: "Market Spread", market_total: "Market Total",
  rest_diff: "Rest Diff", away_travel: "Away Travel Dist",
  altitude_factor: "Altitude Factor", is_early_season: "Early Season",
  reverse_line_movement: "Reverse Line Movement",
  steals_to_diff: "Steals-TO Diff", turnovers_diff: "Turnovers Diff",
  ftpct_diff: "FT% Diff", three_pt_regression_diff: "3PT Regression Diff",
  three_value_diff: "3PT Value Diff", ts_regression_diff: "TS Regression Diff",
  roll_paint_fg_rate_diff: "Roll Paint FG% Diff", roll_three_fg_rate_diff: "Roll 3PT FG Rate Diff",
  recovery_diff: "Recovery Diff", conference_game: "Conference Game",
  is_friday_sat: "Friday/Saturday", is_sunday: "Sunday Game",
  is_midweek: "Midweek Game", is_revenge_home: "Revenge (Home)",
  after_loss_either: "After Loss (Either)", b2b_diff: "Back-to-Back Diff",
  post_allstar: "Post All-Star", post_trade_deadline: "Post Trade Deadline",
  season_pct: "Season Progress", games_diff: "Games Played Diff",
  h2h_total_games: "H2H Total Games", h2h_avg_margin: "H2H Avg Margin",
  home_fav: "Home Favorite", home_b2b: "Home B2B",
  home_after_loss: "Home After Loss", away_after_loss: "Away After Loss",
  home_is_public_team: "Home Public Team", away_is_public_team: "Away Public Team",
  public_home_spread_pct: "Public Spread %", timezone_diff: "Timezone Diff",
  star1_share_diff: "Star Usage Diff", star_minutes_fatigue_diff: "Star Fatigue Diff",
  def_stability_diff: "Def Stability Diff", injuries_out_diff: "Injuries Out Diff",
  ml_implied_spread: "ML Implied Spread", ml_spread_dislocation: "ML Spread Dislocation",
  elo_market_residual: "Elo-Market Residual", line_reversal: "Line Reversal",
  clutch_x_tight_spread: "Clutch × Tight Spread",
};

// ── FEATURE DESCRIPTIONS — plain-English tooltips shown on hover ──
// Covers MLB, NBA, and NCAA features
const FEATURE_DESC = {
  // ── MARKET & ODDS ──
  mkt_spread: "Vegas point spread (negative = home favored)",
  market_spread: "Vegas point spread for this game",
  market_total: "Vegas over/under total points line",
  mkt_total: "Vegas over/under total line",
  has_mkt: "Whether Vegas odds are available (1=yes, 0=no)",
  has_market: "Whether market odds exist for this game",
  implied_prob_home: "Home win probability derived from moneyline odds (vig-removed)",
  overround: "Total implied probability minus 1 — measures bookmaker margin",
  ou_gap: "Team PPGs combined minus market O/U — positive means teams outscore the line",
  home_fav: "Whether home team is the favorite (1=yes)",
  spread_juice_imbalance: "Difference in juice between home/away spread odds — signals sharp money",
  vig_uncertainty: "Overround minus typical vig (0.045) — higher = more uncertain market",
  sharp_spread_signal: "Spread movement from open to close — large moves signal sharp action",
  sharp_ml_signal: "Moneyline probability shift from open to close",
  reverse_line_movement: "When spread and ML move in opposite directions — signals sharp vs public split",
  line_reversal: "Magnitude of moneyline probability change (open→close)",
  ml_implied_spread: "Point spread implied by the moneyline odds",
  ml_spread_dislocation: "Gap between ML-implied spread and actual spread — arbitrage signal",
  public_home_spread_pct: "DraftKings implied prob minus ESPN model prob — proxy for public money direction",
  spread_movement: "How much the spread moved from open to close",
  total_movement: "How much the O/U total moved from open to close",
  // ── ESPN PREDICTIONS ──
  espn_pregame_wp: "ESPN's pre-game model probability for home team winning",
  espn_pregame_wp_pbp: "ESPN's play-by-play model pre-game home win probability",
  espn_wp_edge: "Our model's edge over ESPN's win probability",
  market_wp_edge: "Edge between our model and market-implied win probability",
  // ── ELO & RATINGS ──
  elo_diff: "Elo rating difference (home − away) normalized to form scale",
  elo_market_residual: "Gap between Elo-implied and spread-implied win probability",
  neutral_em_diff: "Efficiency margin difference on neutral court",
  hca_pts: "Home court advantage in points",
  // ── TEAM STATS (DIFFS) ──
  net_rtg_diff: "Net rating difference (PPG − Opp PPG, home − away)",
  opp_ppg_diff: "Opponent points allowed difference — how tough each team's defense is",
  efg_diff: "Effective FG% difference — accounts for 3-pointers being worth more",
  fgpct_diff: "Field goal percentage difference between teams",
  threepct_diff: "3-point shooting percentage difference",
  ftpct_diff: "Free throw percentage difference",
  turnovers_diff: "Turnover difference — positive means home turns it over more",
  steals_to_diff: "Steals-per-turnover ratio difference — measures defensive disruption efficiency",
  win_pct_diff: "Season win percentage difference (home − away)",
  orb_pct_diff: "Offensive rebound percentage difference",
  ato_ratio_diff: "Assist-to-turnover ratio difference",
  ato_diff: "Assist-to-turnover ratio difference",
  blocks_diff: "Blocks per game difference",
  assist_rate_diff: "Assist rate difference",
  drb_pct_diff: "Defensive rebound percentage difference",
  to_margin_diff: "Turnover margin difference (turnovers forced − committed)",
  twopt_diff: "Two-point FG% difference",
  ppp_diff: "Points per possession difference",
  three_rate_diff: "3-point attempt rate difference (3PA / FGA)",
  fta_rate_diff: "Free throw attempt rate difference (FTA / FGA)",
  // ── SCORING PROFILE ──
  scoring_hhi_diff: "Herfindahl index of scoring — measures how concentrated scoring is across players",
  scoring_entropy_diff: "Shannon entropy of scoring — higher means more balanced scoring",
  scoring_var_diff: "Scoring variance difference — how volatile each team's output is game-to-game",
  consistency_diff: "Ceiling minus floor gap — measures scoring range consistency",
  ceiling_diff: "Scoring ceiling difference — best recent game performance gap",
  floor_diff: "Scoring floor difference — worst recent game performance gap",
  bimodal_diff: "Excess kurtosis of margin distribution — detects bimodal/streaky teams",
  score_kurtosis_diff: "Same as bimodal — kurtosis of game margin distribution",
  lineup_value_diff: "Star player value difference — PPG × FG% for top scorers",
  opp_suppression_diff: "How much each team suppresses opponent scoring vs league average",
  def_stability_diff: "Defensive consistency — opponent scoring variance (lower = more stable D)",
  // ── PACE & TEMPO ──
  pace_leverage: "How much pace matters for this matchup — high when both teams have extreme styles",
  pace_control_diff: "Scoring consistency as pace control — 1/variance (more consistent = more control)",
  tempo_avg: "Average pace/tempo between the two teams",
  // ── MOMENTUM & FORM ──
  momentum_halflife_diff: "Exponential-weighted form — recent games weighted 2x vs older games",
  win_aging_diff: "Time-weighted win rate — recent wins count more than older ones",
  margin_accel_diff: "2nd derivative of margin trend — is a team accelerating or decelerating?",
  margin_trend_diff: "Recent margin trend — improving or declining?",
  margin_var_diff: "Margin variance difference",
  margin_skew_diff: "Margin skew — positive means more blowout wins than losses",
  streak_diff: "Win/loss streak difference (positive = home on better streak)",
  pyth_residual_diff: "Actual win% minus Pythagorean expected win% — measures clutch performance",
  pyth_luck_diff: "Same as Pythagorean residual — teams outperforming their stats are 'lucky'",
  recovery_diff: "Bounce-back rate after losses — how often a loss is followed by a win",
  opp_adj_form_diff: "Form adjusted for opponent quality — wins vs good teams count more",
  days_since_loss_diff: "Days since last loss — longer = hotter streak",
  // ── ROLLING PBP ──
  roll_bench_pts_diff: "Rolling bench points difference — depth advantage",
  roll_paint_pts_diff: "Rolling paint points difference — inside scoring dominance",
  roll_paint_fg_rate_diff: "Rolling paint FG% difference",
  roll_max_run_avg: "Average of both teams' max scoring runs — measures game volatility potential",
  roll_fast_break_diff: "Rolling fast break points difference — transition offense gap",
  roll_ft_trip_rate_diff: "Rolling free throw trip rate difference — who gets to the line more",
  roll_three_fg_rate_diff: "Rolling 3-point FG rate difference (3PA/FGA)",
  roll_dreb_diff: "Rolling defensive rebound difference",
  roll_q4_diff: "Rolling Q4 scoring difference — clutch performance indicator",
  roll_game_pf_combined: "Combined personal fouls — more fouls = more FTs = higher totals",
  // ── SHOOTING REGRESSION ──
  three_pt_regression_diff: "3PT% deviation from league mean — teams shooting hot/cold tend to regress",
  three_value_diff: "Value generated from 3-point shooting above league average",
  ts_regression_diff: "True shooting deviation from league average — regression signal",
  ts_diff: "True shooting percentage difference",
  matchup_efg: "3-point rate matchup — which team has the style advantage",
  matchup_ft: "Free throw trip rate matchup advantage",
  matchup_orb: "Offensive rebound matchup advantage",
  matchup_to: "Net rating matchup proxy — scaled measure of quality gap",
  // ── SCHEDULE & CONTEXT ──
  rest_diff: "Days of rest difference — more rest = fresher legs",
  b2b_diff: "Back-to-back difference (1 if home on B2B, -1 if away, 0 if same)",
  home_b2b: "Whether home team is on a back-to-back (1=yes)",
  games_last_14_diff: "Games played in last 14 days difference — schedule density",
  games_diff: "Total games played difference — schedule position gap",
  altitude_factor: "Denver home game flag — 5,280ft altitude affects visiting teams",
  is_early_season: "First 15 games of season — stats are less reliable",
  is_friday_sat: "Friday or Saturday game — different rest/travel patterns",
  is_sunday: "Sunday game indicator",
  is_midweek: "Tuesday-Thursday game indicator",
  post_allstar: "After the All-Star break — teams shift intensity",
  post_trade_deadline: "After the trade deadline — rosters are set",
  season_phase: "What part of the season (early, mid, late, postseason)",
  season_pct: "Percentage of season completed",
  conference_game: "Whether both teams are in the same conference",
  cross_conf_flag: "Cross-conference game indicator",
  // ── HEAD-TO-HEAD ──
  h2h_total_games: "Number of games these teams have played this season",
  h2h_avg_margin: "Average margin in season series (from home team perspective)",
  h2h_home_win_rate: "Home team's win rate in the season series",
  is_revenge_home: "Home team lost the last meeting — revenge motivation",
  is_revenge_game: "Revenge game indicator",
  revenge_margin: "Margin of the previous loss being 'revenged'",
  // ── SITUATIONAL ──
  after_loss_either: "Either team coming off a loss — affects motivation/urgency",
  home_after_loss: "Home team's last game was a loss",
  away_after_loss: "Away team's last game was a loss",
  away_is_public_team: "Away team draws heavy public betting (LAL, GSW, BOS, etc.)",
  home_is_public_team: "Home team draws heavy public betting",
  crowd_pct: "Attendance as % of venue capacity — crowd energy factor",
  is_lookahead: "Team may be looking ahead to a bigger upcoming game",
  is_postseason: "Postseason game — different intensity level",
  fatigue_x_quality: "Fatigue impact weighted by team quality",
  // ── REFEREE ──
  ref_home_whistle: "Crew chief's historical home team foul bias",
  ref_foul_proxy: "Average foul rate for this referee crew",
  ref_ou_bias: "Referee crew's historical impact on game totals",
  ref_pace_impact: "Referee crew's impact on game pace (more whistles = slower)",
  ref_foul_rate: "Average fouls called per game by this crew",
  has_ref_data: "Whether referee assignment is known",
  // ── ATS / BETTING ──
  roll_ats_margin_gated: "Rolling ATS margin — how teams perform vs the spread recently",
  has_ats_data: "Whether ATS history is available",
  ats_rolling_diff: "Rolling ATS performance difference",
  // ── INJURY ──
  injuries_out_diff: "Difference in number of OUT players",
  // ── PLAYER / LINEUP ──
  star1_share_diff: "Top scorer's share of team points — measures star dependency",
  star_minutes_fatigue_diff: "Star player minutes difference — fatigue proxy",
  // ── NCAA SPECIFIC ──
  pit_sos_diff: "Pitzer strength of schedule difference",
  conf_strength_diff: "Conference strength difference",
  conf_balance_diff: "Conference competitive balance difference",
  n_common_opps: "Number of shared opponents (basis for common-opponent analysis)",
  common_opp_margin_diff: "Performance vs common opponents — apples-to-apples comparison",
  is_conf_tourney: "Conference tournament game — win-or-go-home intensity",
  is_ncaa_tourney: "NCAA March Madness tournament game",
  neutral: "Game on neutral court (no home advantage)",
  player_rating_diff: "Aggregate player rating difference",
  weakest_starter_diff: "Worst starter quality gap — chain is only as strong as weakest link",
  starter_balance_diff: "How balanced starting five's contributions are",
  starter_experience_diff: "Starting lineup experience gap (games played)",
  lineup_changes_diff: "Recent lineup changes — roster instability",
  lineup_stability_diff: "How stable the starting lineup has been",
  recent_form_diff: "Last 5 games win rate difference",
  pace_adj_ppg_diff: "Pace-adjusted PPG difference (tempo-neutral scoring)",
  pace_adj_opp_ppg_diff: "Pace-adjusted opponent PPG difference",
  adj_oe_diff: "Adjusted offensive efficiency difference",
  adj_de_diff: "Adjusted defensive efficiency difference",
  // ── MLB SPECIFIC ──
  woba_diff: "Weighted on-base average difference — overall hitting quality",
  woba_x_park: "wOBA adjusted for park factor — hitter + park interaction",
  fip_diff: "Fielding-independent pitching difference — pitcher quality",
  sp_fip_spread: "Starting pitcher FIP matchup lopsidedness",
  sp_relative_fip_diff: "Starter FIP relative to team average",
  k_bb_diff: "Strikeout minus walk rate difference — pitcher command quality",
  bullpen_era_diff: "Bullpen ERA difference — relief pitching advantage",
  bp_exposure_diff: "Bullpen exposure difference — how many innings relievers must cover",
  sp_ip_diff: "Starting pitcher expected innings difference",
  park_factor: "Ballpark run factor — Coors=1.16 (hitter), Oracle=0.96 (pitcher)",
  temp_f: "Game-time temperature in °F — warmer = ball carries further",
  temp_x_park: "Temperature × park factor interaction — hot + hitter park = high scoring",
  wind_mph: "Wind speed in miles per hour",
  wind_out: "Whether wind is blowing out to the outfield (1=yes, helps hitters)",
  is_warm: "Temperature above 75°F — ball carries further in warm air",
  is_cold: "Temperature below 50°F — ball doesn't carry as far",
  ump_run_env: "Home plate umpire's historical average total runs per game",
  scoring_entropy_combined: "Combined scoring diversity — both teams' offensive versatility",
  scoring_entropy_diff: "Scoring diversity difference between teams",
  first_inn_rate_diff: "First-inning scoring rate difference — early aggression",
  first_inn_rate_combined: "Combined first-inning scoring rate",
  clutch_divergence_diff: "Difference in clutch vs non-clutch performance",
  series_game_num: "Game number in the series (bullpen fatigue accumulates)",
  platoon_diff: "Batter vs pitcher handedness advantage difference",
  rest_combined: "Combined rest days — affects pitching freshness",
  def_oaa_diff: "Outs above average on defense — fielding quality difference",
  opp_adj_form_diff_mlb: "Form adjusted for opponent quality",
  pyth_residual_diff_mlb: "Actual win% minus run-based expected win%",
  total_pred: "Heuristic engine's predicted total runs",
  has_heuristic: "Whether heuristic prediction is available",
  lg_rpg: "League-wide runs per game — current run environment",
};
// Zero here = likely data pipeline issue, not a legitimate game condition
const EXPECTED_NONZERO = new Set([
  "elo_diff", "win_pct_diff", "net_rtg_diff", "ppg_diff", "opp_ppg_diff",
  "fgpct_diff", "threepct_diff", "ftpct_diff", "orb_pct_diff",
  "steals_to_diff", "turnovers_diff", "consistency_diff",
  "scoring_hhi_diff", "scoring_entropy_diff", "efg_diff",
  "implied_prob_home", "espn_pregame_wp", "overround",
  "pace_leverage", "pace_control_diff",
  "momentum_halflife_diff", "win_aging_diff", "pyth_residual_diff",
  "pyth_luck_diff", "margin_accel_diff", "bimodal_diff", "score_kurtosis_diff",
  "lineup_value_diff", "ceiling_diff", "ts_diff", "opp_efg_diff",
  "recovery_diff", "opp_suppression_diff", "opp_adj_form_diff",
  "matchup_orb", "matchup_ft", "matchup_efg",
  "roll_dreb_diff", "roll_paint_pts_diff", "roll_max_run_avg",
  "roll_bench_pts_diff", "roll_ft_trip_rate_diff", "roll_three_fg_rate_diff",
  "roll_paint_fg_rate_diff",
  // MLB
  "woba_diff", "fip_diff", "k_bb_diff", "sp_fip_spread",
]);

// Features that are LEGITIMATELY zero in many games
const OFTEN_ZERO = new Set([
  "altitude_factor", "is_early_season", "is_friday_sat", "is_sunday", "is_midweek",
  "reverse_line_movement", "b2b_diff", "home_b2b", "games_last_14_diff",
  "post_allstar", "post_trade_deadline", "is_revenge_home", "is_revenge_game",
  "after_loss_either", "home_after_loss", "away_after_loss",
  "conference_game", "is_conf_tourney", "is_ncaa_tourney", "is_postseason",
  "neutral", "neutral_site", "h2h_total_games", "h2h_avg_margin",
  "sharp_spread_signal", "sharp_ml_signal", "line_reversal",
  "games_diff", "timezone_diff", "clutch_x_tight_spread",
]);

export default function ShapPanel({ shap, homeName, awayName }) {
  const [showAll, setShowAll] = useState(false);
  const [viewMode, setViewMode] = useState("shap"); // "shap" or "verify"
  if (!shap || shap.length === 0) return null;

  const sorted = [...shap].sort((a, b) => Math.abs(b.shap) - Math.abs(a.shap));

  // Verification stats
  const totalFeatures = sorted.length;
  const nonZeroValues = sorted.filter(s => s.value !== 0).length;
  const zeroValues = sorted.filter(s => s.value === 0);
  const suspiciousZeros = zeroValues.filter(s => EXPECTED_NONZERO.has(s.feature));
  const legitimateZeros = zeroValues.filter(s => OFTEN_ZERO.has(s.feature));
  const unknownZeros = zeroValues.filter(s => !EXPECTED_NONZERO.has(s.feature) && !OFTEN_ZERO.has(s.feature));

  // In verify mode, sort: suspicious zeros first, then unknown zeros, then legitimate zeros, then non-zero by value
  const verifySorted = viewMode === "verify"
    ? [
        ...suspiciousZeros.map(s => ({ ...s, _status: "missing" })),
        ...unknownZeros.map(s => ({ ...s, _status: "unknown" })),
        ...legitimateZeros.map(s => ({ ...s, _status: "ok_zero" })),
        ...sorted.filter(s => s.value !== 0).sort((a, b) => Math.abs(b.value) - Math.abs(a.value)).map(s => ({ ...s, _status: "ok" })),
      ]
    : null;

  const visible = viewMode === "verify"
    ? (showAll ? verifySorted : verifySorted.slice(0, 20))
    : (showAll ? sorted : sorted.slice(0, 8));
  const maxAbs = Math.max(...sorted.slice(0, 8).map(s => Math.abs(s.shap)), 0.01);

  return (
    <div style={{
      marginTop: 12, padding: "12px 14px",
      background: "linear-gradient(180deg, #080d18 0%, #0a1020 100%)",
      border: `1px solid ${suspiciousZeros.length > 0 ? "#d2992244" : "#1a2744"}`,
      borderRadius: 10,
    }}>
      {/* Header */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10,
        flexWrap: "wrap", gap: 6,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 9, color: "#58a6ff", fontWeight: 800, letterSpacing: 2 }}>
            🔍 {viewMode === "verify" ? "DATA VERIFICATION" : "WHY THIS PICK (SHAP)"}
          </span>
          {/* Coverage badge */}
          <span style={{
            fontSize: 8, fontWeight: 700, padding: "1px 6px", borderRadius: 3,
            background: suspiciousZeros.length > 0 ? "rgba(210,153,34,0.15)" : "rgba(63,185,80,0.15)",
            color: suspiciousZeros.length > 0 ? "#d29922" : "#3fb950",
            border: `1px solid ${suspiciousZeros.length > 0 ? "#d2992244" : "#2ea04344"}`,
          }}>
            {nonZeroValues}/{totalFeatures}
            {suspiciousZeros.length > 0 && ` · ${suspiciousZeros.length} ⚠️`}
          </span>
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          {/* Toggle verify mode */}
          <button
            onClick={() => { setViewMode(v => v === "shap" ? "verify" : "shap"); setShowAll(false); }}
            style={{
              background: viewMode === "verify" ? "rgba(88,166,255,0.15)" : "none",
              border: `1px solid ${viewMode === "verify" ? "#58a6ff55" : "#1e2d4a"}`,
              borderRadius: 4, color: "#58a6ff", fontSize: 8, padding: "2px 8px",
              cursor: "pointer", fontWeight: 700,
            }}
          >
            {viewMode === "verify" ? "📊 SHAP" : "🔬 VERIFY"}
          </button>
          {/* Show all toggle */}
          <button
            onClick={() => setShowAll(!showAll)}
            style={{
              background: "none", border: "1px solid #1e2d4a", borderRadius: 4,
              color: "#58a6ff", fontSize: 8, padding: "2px 8px", cursor: "pointer",
              fontWeight: 700, letterSpacing: 0.5,
            }}
          >
            {showAll ? `TOP ${viewMode === "verify" ? 20 : 8} ▲` : `ALL ${sorted.length} ▼`}
          </button>
        </div>
      </div>

      {/* VERIFY MODE */}
      {viewMode === "verify" && (
        <>
          {/* Summary bar */}
          {suspiciousZeros.length > 0 && (
            <div style={{
              padding: "6px 10px", marginBottom: 8, borderRadius: 5,
              background: "rgba(210,153,34,0.08)", border: "1px solid #d2992233",
              fontSize: 9, color: "#d29922", lineHeight: 1.6,
            }}>
              ⚠️ <strong>{suspiciousZeros.length} features</strong> expected to have data but returned 0:
              {" "}{suspiciousZeros.map(s => LABEL_MAP[s.feature] || s.feature).join(", ")}
            </div>
          )}

          {/* Feature list */}
          <div style={{ display: "grid", gridTemplateColumns: "14px 1fr 70px 50px", gap: "2px 6px", fontSize: 9 }}>
            {/* Header */}
            <div style={{ color: "#484f58", fontSize: 7, fontWeight: 700 }}></div>
            <div style={{ color: "#484f58", fontSize: 7, fontWeight: 700 }}>FEATURE</div>
            <div style={{ color: "#484f58", fontSize: 7, fontWeight: 700, textAlign: "right" }}>RAW VALUE</div>
            <div style={{ color: "#484f58", fontSize: 7, fontWeight: 700, textAlign: "right" }}>SHAP</div>

            {visible.map((s, i) => {
              const label = LABEL_MAP[s.feature] || s.feature.replace(/_/g, " ");
              const status = s._status;
              const icon = status === "missing" ? "🔴" : status === "unknown" ? "🟡" : status === "ok_zero" ? "⚪" : "🟢";
              const valueColor = status === "missing" ? "#f85149" : status === "unknown" ? "#d29922" : s.value === 0 ? "#484f58" : "#c9d1d9";
              const shapColor = Math.abs(s.shap) > 0.1 ? "#58a6ff" : Math.abs(s.shap) > 0 ? "#7d8590" : "#484f58";

              return (
                <React.Fragment key={i}>
                  <div style={{ fontSize: 10, lineHeight: "20px" }}>{icon}</div>
                  <div style={{
                    color: status === "missing" ? "#f85149" : "#c9d1d9",
                    fontWeight: status === "missing" ? 600 : 400,
                    lineHeight: "20px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    cursor: FEATURE_DESC[s.feature] ? "help" : "default",
                  }} title={FEATURE_DESC[s.feature] || `${s.feature}: raw=${s.value}, shap=${s.shap}`}>
                    {label}
                  </div>
                  <div style={{ textAlign: "right", fontFamily: "monospace", color: valueColor, lineHeight: "20px" }}>
                    {s.value === 0 ? "0" : (Math.abs(s.value) >= 10 ? s.value.toFixed(1) : s.value.toFixed(3))}
                  </div>
                  <div style={{ textAlign: "right", fontFamily: "monospace", color: shapColor, lineHeight: "20px" }}>
                    {s.shap === 0 ? "—" : (s.shap > 0 ? "+" : "") + s.shap.toFixed(3)}
                  </div>
                </React.Fragment>
              );
            })}
          </div>

          <div style={{ fontSize: 8, color: "#484f58", marginTop: 8, display: "flex", gap: 12 }}>
            <span>🟢 Data OK</span>
            <span>🔴 Expected data, got 0</span>
            <span>🟡 Unknown (may be OK)</span>
            <span>⚪ Legitimately 0</span>
          </div>
        </>
      )}

      {/* SHAP MODE (original) */}
      {viewMode === "shap" && (
        <>
          {/* Column headers */}
          <div style={{
            display: "grid", gridTemplateColumns: "1fr 120px 1fr",
            gap: 0, fontSize: 8, color: "#8b949e", marginBottom: 4, padding: "0 2px",
            fontWeight: 600,
          }}>
            <span style={{ textAlign: "right", paddingRight: 4 }}>← {awayName || "Away"}</span>
            <span></span>
            <span style={{ textAlign: "left", paddingLeft: 4 }}>{homeName || "Home"} →</span>
          </div>

          {visible.map((s, i) => {
            const pct = Math.min(Math.abs(s.shap) / maxAbs, 1);
            const pos = s.shap > 0;
            const barWidth = Math.max(pct * 100, 4);
            const label = LABEL_MAP[s.feature] || s.feature.replace(/_/g, " ");
            const value = Math.abs(s.shap).toFixed(2);
            const rawVal = s.value;
            const isZeroRaw = rawVal === 0;
            const isSuspicious = isZeroRaw && EXPECTED_NONZERO.has(s.feature);

            return (
              <div key={i} style={{
                display: "grid",
                gridTemplateColumns: "1fr 120px 1fr",
                alignItems: "center",
                gap: 0,
                marginBottom: 3,
                padding: "2px 0",
                opacity: isZeroRaw && s.shap === 0 ? 0.4 : 1,
              }}>
                {/* Left bar (away/negative) */}
                <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", height: 18 }}>
                  {!pos && s.shap !== 0 && (
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 4 }}>
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
                  textAlign: "center", fontSize: 9,
                  color: isSuspicious ? "#f85149" : isZeroRaw && s.shap === 0 ? "#484f58" : "#c9d1d9",
                  padding: "0 6px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                  fontWeight: i < 3 ? 600 : 400,
                  cursor: FEATURE_DESC[s.feature] ? "help" : "default",
                }} title={FEATURE_DESC[s.feature] || `${s.feature}: raw=${rawVal}, shap=${s.shap.toFixed(4)}`}>
                  {isSuspicious && "⚠️ "}{label}
                  {isZeroRaw && s.shap === 0 && <span style={{ fontSize: 7, color: "#484f58" }}> (no data)</span>}
                  {!isZeroRaw && s.shap === 0 && <span style={{ fontSize: 7, color: "#7d8590" }}> [={typeof rawVal === 'number' ? (Math.abs(rawVal) >= 10 ? rawVal.toFixed(0) : rawVal.toFixed(2)) : rawVal}]</span>}
                </div>

                {/* Right bar (home/positive) */}
                <div style={{ display: "flex", justifyContent: "flex-start", alignItems: "center", height: 18 }}>
                  {pos && s.shap !== 0 && (
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
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
        </>
      )}
    </div>
  );
}
