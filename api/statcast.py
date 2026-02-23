"""
Vercel Serverless Function — /api/statcast
Fetches Statcast batting data via pybaseball for a given MLB team + season.

Deploy: place this file at /api/statcast.py in your repo root.
Requirements: add pybaseball to requirements.txt

Returns:
  xwOBA      — expected weighted on-base average (strips out luck on balls in play)
  barrelRate — barrel % (exit velo ≥ 98mph + launch angle 26-30°)
  hardHitPct — hard-hit % (exit velocity ≥ 95mph)
  sprintSpeed — avg sprint speed ft/s (team average)

Usage: GET /api/statcast?teamId=147&season=2025
"""

import json
import os
import sys

def handler(request, response):
    # Set CORS headers
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "GET, OPTIONS"
    response.headers["Content-Type"] = "application/json"

    if request.method == "OPTIONS":
        response.status_code = 200
        return response.send("")

    team_id = request.args.get("teamId")
    season  = request.args.get("season", str(__import__('datetime').datetime.now().year))

    if not team_id:
        response.status_code = 400
        return response.send(json.dumps({"error": "Missing teamId param"}))

    # MLB team ID → Statcast team abbreviation mapping
    TEAM_ID_TO_STATCAST = {
        108: "LAA", 109: "ARI", 110: "BAL", 111: "BOS", 112: "CHC",
        113: "CIN", 114: "CLE", 115: "COL", 116: "DET", 117: "HOU",
        118: "KC",  119: "LAD", 120: "WSH", 121: "NYM", 133: "OAK",
        134: "PIT", 135: "SD",  136: "SEA", 137: "SF",  138: "STL",
        139: "TB",  140: "TEX", 141: "TOR", 142: "MIN", 143: "PHI",
        144: "ATL", 145: "CWS", 146: "MIA", 147: "NYY", 158: "MIL",
    }

    try:
        team_id_int = int(team_id)
        season_int  = int(season)
    except (ValueError, TypeError):
        response.status_code = 400
        return response.send(json.dumps({"error": "Invalid teamId or season"}))

    team_abbr = TEAM_ID_TO_STATCAST.get(team_id_int)
    if not team_abbr:
        response.status_code = 404
        return response.send(json.dumps({"error": f"Unknown team ID: {team_id_int}"}))

    try:
        import pybaseball
        pybaseball.cache.enable()

        # Statcast season batting data — all batters, filter by team
        # statcast_batter_exitvelo_barrels returns per-player exit velo/barrel data
        # We aggregate to team level
        start_dt = f"{season_int}-03-01"
        end_dt   = f"{season_int}-11-01"

        # Team-level batting Statcast summary
        # pybaseball.team_batting_bref is season-level; for Statcast we use statcast_batter
        # Use statcast_single_game is too granular — use team_game_logs or batting_stats_bref
        # Best approach: pybaseball.statcast_batter_exitvelo_barrels(season_int) → filter by team
        barrels_df = pybaseball.statcast_batter_exitvelo_barrels(season_int, minPA=50)

        if barrels_df is None or barrels_df.empty:
            response.status_code = 200
            return response.send(json.dumps({"error": "NO_DATA", "teamId": team_id_int, "season": season_int}))

        # Filter by team
        team_df = barrels_df[barrels_df["team_name_alt"] == team_abbr] \
                  if "team_name_alt" in barrels_df.columns \
                  else barrels_df[barrels_df["team"] == team_abbr]

        if team_df.empty:
            # Try partial match
            mask = barrels_df.get("team_name_alt", barrels_df.get("team", "")).str.contains(team_abbr, na=False)
            team_df = barrels_df[mask]

        if team_df.empty:
            response.status_code = 200
            return response.send(json.dumps({"error": "NO_TEAM_DATA", "team": team_abbr}))

        # Weighted averages by PA
        pa_col = "pa" if "pa" in team_df.columns else "attempts"
        total_pa = team_df[pa_col].sum() if pa_col in team_df.columns else len(team_df)

        def wavg(col, weight_col):
            if col not in team_df.columns: return None
            if weight_col not in team_df.columns: return float(team_df[col].mean())
            w = team_df[weight_col]
            return float((team_df[col] * w).sum() / w.sum()) if w.sum() > 0 else float(team_df[col].mean())

        xwoba      = wavg("xwoba", pa_col)
        barrel_pct = wavg("brl_percent", pa_col)   # already in % form (e.g. 8.2 for 8.2%)
        hard_hit   = wavg("hard_hit_percent", pa_col)

        # Convert percentages to decimals if they look like whole numbers
        if barrel_pct and barrel_pct > 1:
            barrel_pct = barrel_pct / 100.0
        if hard_hit and hard_hit > 1:
            hard_hit = hard_hit / 100.0

        # Sprint speed — separate endpoint
        sprint_speed = None
        try:
            speed_df = pybaseball.statcast_sprint_speed(season_int, min_opp=10)
            if speed_df is not None and not speed_df.empty:
                team_speed = speed_df[speed_df["team"] == team_abbr] if "team" in speed_df.columns else speed_df
                if not team_speed.empty and "hp_to_1b" in team_speed.columns:
                    sprint_speed = float(team_speed["hp_to_1b"].mean())
                elif not team_speed.empty and "sprint_speed" in team_speed.columns:
                    sprint_speed = float(team_speed["sprint_speed"].mean())
        except Exception:
            pass  # sprint speed is optional

        result = {
            "teamId":     team_id_int,
            "team":       team_abbr,
            "season":     season_int,
            "xwOBA":      round(xwoba, 3)      if xwoba      else None,
            "barrelRate": round(barrel_pct, 4)  if barrel_pct else None,
            "hardHitPct": round(hard_hit, 4)    if hard_hit   else None,
            "sprintSpeed": round(sprint_speed, 2) if sprint_speed else None,
            "sampleSize": int(total_pa),
        }

        # Cache for 6 hours (Statcast data doesn't change intraday much)
        response.headers["Cache-Control"] = "s-maxage=21600, stale-while-revalidate=3600"
        response.status_code = 200
        return response.send(json.dumps(result))

    except ImportError:
        response.status_code = 503
        return response.send(json.dumps({
            "error": "PYBASEBALL_NOT_INSTALLED",
            "message": "Add 'pybaseball' to requirements.txt and redeploy"
        }))
    except Exception as e:
        response.status_code = 500
        return response.send(json.dumps({"error": str(e), "team": team_abbr}))
