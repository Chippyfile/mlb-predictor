#!/usr/bin/env python3
"""
patch_history_week_grouping.py

Group HistoryTab by week for sports that have weeks, and stop gating the
ATS record on units.
DRY RUN BY DEFAULT.  Run with --apply to write.

Run from ~/Desktop/mlb-predictor.

SHARED COMPONENT -- FIVE SPORTS USE THIS
    HistoryTab lives in components/Shared.jsx and is rendered by MLB,
    NBA, NCAA, NCAAF and NFL. MLB and NBA have no concept of a week, so
    week grouping has to be conditional or it breaks three sports to fix
    two.

    It keys off the DATA, not off a prop: if the fetched rows carry a
    non-null week, group by week; otherwise group by date exactly as
    now. MLB rows have no week column, so MLB is untouched by
    construction rather than by a flag someone has to remember to pass.

PROBLEM 1 -- week is never fetched
    TABLE_COLS[nfl_predictions].hist selects game_date and not week. So
    the grouping could not have used it regardless. Same for
    ncaaf_predictions. Both column lists get `week` added.

    This is also why NFL Week 1 is hard to find: its games span
    2026-09-09 through 2026-09-14, which is four separate date headers
    with no indication they are one week.

PROBLEM 2 -- the ATS record is gated on units, which are hard zero
        const atsW = graded.filter(r => r.ats_units > 0 && r.ats_correct === true)

    ats_units is 0 at source for NFL and NCAAF (Council V5, serve only)
    and always will be. So the ATS column in History has never displayed
    anything but a blank, for either sport, since it was written.

    This is the FOURTH file carrying a gate written against a future
    where stakes exist: nfl_full_predict.py withheld ats_pick_side,
    NFLCalendarTab gated results on units, nfl_grade.py left
    ats_correct null, and this. All four were correct when written. The
    pattern is worth naming -- a guard that waits for a condition the
    system is designed never to reach is not a guard, it is an off
    switch nobody labelled.

    Gate is now `ats_correct !== null`: the backend only writes that
    column when a pick existed and the game did not push.

WHAT THIS DOES NOT TOUCH
    The O/U recompute fallback below the ATS lines is left exactly as
    is. It reconstructs a trigger from model-vs-market divergence for
    sports that do not write ou_pick_correct, and it is the known
    `ou_correct counted by truthiness` item. Changing it is a separate
    decision with its own correctness argument.

USAGE
    cd ~/Desktop/mlb-predictor
    python3 patch_history_week_grouping.py
    python3 patch_history_week_grouping.py --apply
"""

import argparse
import datetime as dt
import os
import shutil
import sys

TARGET = "src/components/Shared.jsx"
SENTINEL = "keys off the DATA, not off a prop"

# ── 1. fetch week for ncaaf ────────────────────────────────────────────
A1_OLD = '''    hist: "id,game_date,home_team,away_team,ou_total:pred_total," +
          "win_pct_home:win_probability,result_entered,ml_correct,ats_correct," +
          "ats_units,ats_side:ats_pick,ou_correct,actual_home_score," +
          "actual_away_score,market_spread_home,market_ou_total:market_total," +
          "pred_home_score,pred_away_score",'''

A1_NEW = '''    hist: "id,game_date,week,home_team,away_team,ou_total:pred_total," +
          "win_pct_home:win_probability,result_entered,ml_correct,ats_correct," +
          "ats_units,ats_side:ats_pick,ou_correct,actual_home_score," +
          "actual_away_score,market_spread_home,market_ou_total:market_total," +
          "pred_home_score,pred_away_score",'''

# ── 2. fetch week for nfl ──────────────────────────────────────────────
A2_OLD = '''    hist: "id,game_date,home_team,away_team,ou_total:pred_total," +
          "win_pct_home:ml_win_prob_home,result_entered:graded,ml_correct," +
          "ats_correct,ats_units,ats_side:ats_pick_side,ou_correct," +
          "actual_home_score,actual_away_score,market_ou_total:total_line," +
          "pred_home_score,pred_away_score",'''

A2_NEW = '''    hist: "id,game_date,week,home_team,away_team,ou_total:pred_total," +
          "win_pct_home:ml_win_prob_home,result_entered:graded,ml_correct," +
          "ats_correct,ats_units,ats_side:ats_pick_side,ou_correct," +
          "actual_home_score,actual_away_score,market_ou_total:total_line," +
          "pred_home_score,pred_away_score",'''

# ── 3. group by week when the data has weeks ───────────────────────────
A3_OLD = '''  const grouped = records.reduce((acc, r) => {
    if (!acc[r.game_date]) acc[r.game_date] = [];
    acc[r.game_date].push(r);
    return acc;
  }, {});'''

A3_NEW = '''  // Group by week where the sport has one, by date where it does not.
  // This keys off the DATA, not off a prop: MLB and NBA rows carry no
  // week column, so they fall through to date grouping without anyone
  // having to remember to pass a flag. A week spans four or five dates
  // -- NFL Week 1 2026 runs 09-09 to 09-14 -- so date headers scatter a
  // single week across the page with nothing tying them together.
  const hasWeeks = records.some(r => r.week != null);
  const grouped = records.reduce((acc, r) => {
    const key = hasWeeks && r.week != null ? `Week ${r.week}` : r.game_date;
    if (!acc[key]) acc[key] = [];
    acc[key].push(r);
    return acc;
  }, {});'''

# ── 4. the ATS record, ungated from units ──────────────────────────────
A4_OLD = '''        const atsW = graded.filter(r => r.ats_units > 0 && r.ats_correct === true).length;
        const atsL = graded.filter(r => r.ats_units > 0 && r.ats_correct === false).length;'''

A4_NEW = '''        // NOT `ats_units > 0`. Units are hard zero at source for NFL and
        // NCAAF (V5, serve only) and always will be, so that gate meant
        // this column has never shown a number for either sport. The
        // backend writes ats_correct only when a pick existed and the
        // game did not push, so a non-null value IS the gate.
        const atsW = graded.filter(r => r.ats_correct === true).length;
        const atsL = graded.filter(r => r.ats_correct === false).length;'''

# ── 5. header label ────────────────────────────────────────────────────
A5_OLD = '''letterSpacing: 2 }}>📅 {date}</div>'''

A5_NEW = '''letterSpacing: 2 }}>{hasWeeks ? "🏈" : "📅"} {date}</div>'''

ANCHORS = [("ncaaf hist cols", A1_OLD, A1_NEW),
           ("nfl hist cols", A2_OLD, A2_NEW),
           ("grouping", A3_OLD, A3_NEW),
           ("ats units gate", A4_OLD, A4_NEW),
           ("group header", A5_OLD, A5_NEW)]


def rule(t):
    print(f"\n{'=' * 70}\n  {t}\n{'=' * 70}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    a = ap.parse_args()

    rule(f"HISTORY TAB -- WEEK GROUPING   "
         f"mode: {'APPLY' if a.apply else 'DRY RUN'}")

    if not os.path.exists(TARGET):
        sys.exit(f"ABORT: {TARGET} not found.\n"
                 f"  Run from ~/Desktop/mlb-predictor, not the API repo.")
    src = open(TARGET, encoding="utf-8").read()
    if SENTINEL in src:
        sys.exit(f"ABORT: {TARGET} already patched. Nothing written.")

    out = src
    for name, old, new in ANCHORS:
        n = out.count(old)
        if n != 1:
            sys.exit(f"ABORT: anchor '{name}' matched {n} times, expected 1.")
        print(f"  anchor '{name}': matched once")
        out = out.replace(old, new)

    # MLB must be untouched -- it has no week column and its own hist list.
    if "actual_home_runs" not in out:
        sys.exit("ABORT: the MLB column list is gone.")
    print("  MLB column list intact (no week, groups by date as before)")
    if "ou_pick_correct" not in out:
        sys.exit("ABORT: the O/U fallback is gone. Not this patch's job.")
    print("  O/U recompute fallback untouched")

    if not a.apply:
        rule("DRY RUN -- nothing written")
        print("""  would add `week` to the NFL and NCAAF history queries, group by
  week when the rows carry one, and ungate the ATS record from units.

  AFTER APPLYING:
    NFL history groups as "Week 1" / "Week 2" instead of four date
    headers per week. MLB and NBA are unchanged -- their rows have no
    week column, so hasWeeks is false and they group by date.

    The ATS column will show a record for the first time. Expect 0-0
    until Sunday's games are graded: nothing NFL has been played since
    picks started being written on 09-11.

  STILL DATE-FILTERED. The date input and the 10d/30d/90d/All buttons
  are unchanged -- they filter, the grouping only organises what comes
  back. Default is 10 days, so older weeks need "All" to appear.""")
        return

    stamp = dt.datetime.now().strftime("%Y%m%d_%H%M%S")
    bak = f"{TARGET}.bak_weekgroup_{stamp}"
    shutil.copy2(TARGET, bak)
    open(TARGET, "w", encoding="utf-8").write(out)
    if SENTINEL not in open(TARGET, encoding="utf-8").read():
        shutil.copy2(bak, TARGET)
        sys.exit("ABORT: read-back failed. Reverted.")

    rule("APPLIED")
    print(f"""  backup: {bak}

  NEXT
  1. npm run build -- JSX is not validated here, only anchors and text.
  2. Open NFL -> History. Headers should read "Week 1" / "Week 2".
  3. Click "All" if a week is missing; the default window is 10 days.
  4. MLB -> History should be visually identical to before. If it
     grouped by week, hasWeeks is picking up a column it should not.
""")


if __name__ == "__main__":
    main()
