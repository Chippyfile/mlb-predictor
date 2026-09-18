#!/usr/bin/env python3
"""
patch_history_week_filter.py

Add a week dropdown to HistoryTab, and stop truncating the season.
DRY RUN BY DEFAULT.  Run with --apply to write.

Run from ~/Desktop/mlb-predictor.

PROBLEM 1 -- limit=200 HIDES MOST OF THE SEASON
    The query ends `&order=game_date.desc&limit=200`. NFL has 272 rows
    for 2026, so the newest 200 come back and weeks 1-4 never arrive at
    the browser at all. The board shows "Week 18" and nothing before
    week 5, and no amount of grouping can surface rows the query did not
    return.

    Raised to 2000. That covers a full NFL season (272) and a full NCAAF
    season with room. MLB at ~2430 games still truncates, but it
    truncates today at 200 and will truncate less at 2000, so this is
    strictly an improvement there rather than a regression.

PROBLEM 2 -- no way to ask for one week
    Grouping by week landed, but the only filters are a date input and
    10d/30d/90d/All. A week spans four or five dates, so picking a week
    meant knowing its dates and clicking through them.

    The dropdown filters SERVER-SIDE (`&week=eq.N`) and drops the date
    window when a week is chosen. That matters: with the default 10-day
    window, selecting Week 1 would otherwise return nothing, because
    week 1 is outside it. Choosing a week means "show me that week",
    not "show me that week if it happens to be recent".

    Picking a day clears the week, and picking a week clears the day.
    They are alternative questions, not filters that compose.

WEEK OPTIONS COME FROM THEIR OWN QUERY
    The dropdown cannot be built from `records` -- once a week is
    selected, records hold only that week, and the list would collapse
    to the current selection. So the options come from a separate,
    cheap `select=week` query that is not date- or week-filtered.

    Returns [] for MLB and NBA, whose rows carry no week column, and the
    dropdown renders only when the list is non-empty. Those two sports
    are untouched by construction rather than by a flag.

USAGE
    cd ~/Desktop/mlb-predictor
    python3 patch_history_week_filter.py
    python3 patch_history_week_filter.py --apply
"""

import argparse
import datetime as dt
import os
import shutil
import sys

TARGET = "src/components/Shared.jsx"
SENTINEL = "weekOptions"

# ── 1. state ───────────────────────────────────────────────────────────
A1_OLD = '''  const [filterDate, setFilterDate] = useState("");'''

A1_NEW = '''  const [filterDate, setFilterDate] = useState("");
  // Week filter. "all" or a week number as a string. Filtered SERVER-side,
  // and it drops the date window -- picking Week 1 under a 10-day window
  // would otherwise return nothing, since week 1 is outside it.
  const [weekFilter, setWeekFilter] = useState("all");
  // Options come from their own query, NOT from `records`: once a week is
  // selected, records hold only that week and the list would collapse to
  // the current selection. Empty for MLB and NBA, whose rows have no week.
  const [weekOptions, setWeekOptions] = useState([]);'''

# ── 2. query: week filter, no date window when a week is picked, 2000 ──
A2_OLD = '''    const dateFilter = filterDate ? `&game_date=eq.${filterDate}` : (daysBack < 999 ? `&game_date=gte.${_daysAgo(daysBack)}` : "");'''

A2_NEW = '''    // A chosen week overrides the date window entirely. These are
    // alternative questions, not filters that compose.
    const weekSel = weekFilter !== "all" ? `&week=eq.${weekFilter}` : "";
    const dateFilter = weekSel
      ? ""
      : (filterDate ? `&game_date=eq.${filterDate}` : (daysBack < 999 ? `&game_date=gte.${_daysAgo(daysBack)}` : ""));'''

# ── 3. path ────────────────────────────────────────────────────────────
A3_OLD = '''&order=game_date.desc&limit=200`;'''

A3_NEW = '''${weekSel}&order=game_date.desc&limit=2000`;'''

# ── 4. cache key ───────────────────────────────────────────────────────
A4_OLD = '''    const cacheKey = `hist_${table}_${filterDate}_${gameTypeFilter}_${daysBack}_${refreshKey}`;'''

A4_NEW = '''    const cacheKey = `hist_${table}_${filterDate}_${weekFilter}_${gameTypeFilter}_${daysBack}_${refreshKey}`;'''

# ── 5. fetch the option list ───────────────────────────────────────────
A5_OLD = '''    const data = await cachedQuery(cacheKey, () => supabaseQuery(path));
    setRecords(data || []);'''

A5_NEW = '''    const data = await cachedQuery(cacheKey, () => supabaseQuery(path));
    setRecords(data || []);

    // Cheap, unfiltered, one column. Independent of the date window and
    // of the current week so the dropdown never shrinks to its own
    // selection. Fails soft: no weeks, no dropdown.
    try {
      const wk = await cachedQuery(
        `hist_weeks_${table}_${refreshKey}`,
        () => supabaseQuery(`/${table}?select=week&order=week.desc&limit=2000`)
      );
      const uniq = [...new Set((wk || [])
        .map(r => r.week)
        .filter(w => w !== null && w !== undefined))]
        .sort((a, b) => b - a);
      setWeekOptions(uniq);
    } catch {
      setWeekOptions([]);
    }'''

# ── 6. deps ────────────────────────────────────────────────────────────
A6_OLD = '''  }, [filterDate, gameTypeFilter, table, daysBack, refreshKey]);'''

A6_NEW = '''  }, [filterDate, weekFilter, gameTypeFilter, table, daysBack, refreshKey]);'''

# ── 7. the control itself ──────────────────────────────────────────────
A7_OLD = '''        {filterDate && <button onClick={() => setFilterDate("")} style={{ background: C.card, color: C.muted, border: `1px solid ${C.border}`, borderRadius: 6, padding: "5px 10px", cursor: "pointer", fontSize: 11 }}>Clear</button>}'''

A7_NEW = '''        {filterDate && <button onClick={() => setFilterDate("")} style={{ background: C.card, color: C.muted, border: `1px solid ${C.border}`, borderRadius: 6, padding: "5px 10px", cursor: "pointer", fontSize: 11 }}>Clear</button>}
        {/* Only for sports that have weeks. MLB and NBA return no week
            column, so weekOptions is empty and this does not render. */}
        {weekOptions.length > 0 && (
          <select
            value={weekFilter}
            onChange={e => { setWeekFilter(e.target.value); setFilterDate(""); }}
            style={{ background: C.card, color: "#e2e8f0", border: `1px solid ${C.border}`, borderRadius: 6, padding: "5px 10px", fontSize: 11, fontFamily: "inherit", cursor: "pointer" }}
          >
            <option value="all">All weeks</option>
            {weekOptions.map(w => (
              <option key={w} value={String(w)}>Week {w}</option>
            ))}
          </select>
        )}'''

# ── 8. the day buttons clear the week ──────────────────────────────────
A8_OLD = '''            <button key={v} onClick={() => { setDaysBack(v); setFilterDate(""); }} style={{ padding: "3px 8px", borderRadius: 4, border: "none", cursor: "pointer", fontSize: 9, fontWeight: 700, background: daysBack === v && !filterDate ? C.green : "transparent", color: daysBack === v && !filterDate ? C.bg : C.dim }}>{l}</button>'''

A8_NEW = '''            <button key={v} onClick={() => { setDaysBack(v); setFilterDate(""); setWeekFilter("all"); }} style={{ padding: "3px 8px", borderRadius: 4, border: "none", cursor: "pointer", fontSize: 9, fontWeight: 700, background: daysBack === v && !filterDate && weekFilter === "all" ? C.green : "transparent", color: daysBack === v && !filterDate && weekFilter === "all" ? C.bg : C.dim }}>{l}</button>'''

# ── 9. the date input clears the week ──────────────────────────────────
A9_OLD = '''        <input type="date" value={filterDate} onChange={e => setFilterDate(e.target.value)}'''

A9_NEW = '''        <input type="date" value={filterDate} onChange={e => { setFilterDate(e.target.value); setWeekFilter("all"); }}'''

ANCHORS = [("state", A1_OLD, A1_NEW),
           ("date filter", A2_OLD, A2_NEW),
           ("path + limit", A3_OLD, A3_NEW),
           ("cache key", A4_OLD, A4_NEW),
           ("week options fetch", A5_OLD, A5_NEW),
           ("deps", A6_OLD, A6_NEW),
           ("dropdown", A7_OLD, A7_NEW),
           ("day buttons", A8_OLD, A8_NEW),
           ("date input", A9_OLD, A9_NEW)]


def rule(t):
    print(f"\n{'=' * 70}\n  {t}\n{'=' * 70}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    a = ap.parse_args()

    rule(f"HISTORY TAB -- WEEK FILTER   "
         f"mode: {'APPLY' if a.apply else 'DRY RUN'}")

    if not os.path.exists(TARGET):
        sys.exit(f"ABORT: {TARGET} not found.\n"
                 f"  Run from ~/Desktop/mlb-predictor, not the API repo.")
    src = open(TARGET, encoding="utf-8").read()
    if SENTINEL in src:
        sys.exit(f"ABORT: {TARGET} already patched. Nothing written.")
    if "hasWeeks" not in src:
        sys.exit("ABORT: the week-grouping patch must land first.")
    print("  week-grouping patch present")

    out = src
    for name, old, new in ANCHORS:
        n = out.count(old)
        if n != 1:
            sys.exit(f"ABORT: anchor '{name}' matched {n} times, expected 1. "
                     f"Nothing written.")
        print(f"  anchor '{name}': matched once")
        out = out.replace(old, new)

    if "limit=200`" in out:
        sys.exit("ABORT: a limit=200 survives somewhere it should not.")
    print("  no stale limit=200 in the history query")
    if "actual_home_runs" not in out:
        sys.exit("ABORT: the MLB column list is gone.")
    print("  MLB column list intact")
    if "ou_pick_correct" not in out:
        sys.exit("ABORT: the O/U fallback is gone. Not this patch's job.")
    print("  O/U recompute fallback untouched")

    if not a.apply:
        rule("DRY RUN -- nothing written")
        print("""  would add a week dropdown, filter server-side, drop the date
  window when a week is chosen, and raise the row cap 200 -> 2000.

  AFTER APPLYING:
    NFL History shows "All weeks / Week 1 ... Week 18". Picking Week 1
    returns week 1 regardless of how long ago it was.
    Weeks 1-4 become reachable at all -- at limit=200 they were never
    returned by the query.
    MLB and NBA render no dropdown: their rows have no week column, so
    weekOptions comes back empty.

  ONE EXTRA QUERY PER LOAD -- one column, cached by table and
  refreshKey. Necessary: the option list cannot come from `records`,
  which hold only the selected week once a week is selected.""")
        return

    stamp = dt.datetime.now().strftime("%Y%m%d_%H%M%S")
    bak = f"{TARGET}.bak_weekfilter_{stamp}"
    shutil.copy2(TARGET, bak)
    open(TARGET, "w", encoding="utf-8").write(out)
    if SENTINEL not in open(TARGET, encoding="utf-8").read():
        shutil.copy2(bak, TARGET)
        sys.exit("ABORT: read-back failed. Reverted.")

    rule("APPLIED")
    print(f"""  backup: {bak}

  NEXT
  1. npm run build -- JSX is not validated here, only anchors and text.
  2. NFL -> History -> pick Week 1. Should show week 1 and nothing else.
  3. MLB -> History: no dropdown, identical to before. If one appears,
     the week query is returning something it should not.
  4. Click 10d after picking a week -- it should clear back to all weeks.
""")


if __name__ == "__main__":
    main()
