#!/bin/bash
# Run this from your mlb-predictor root directory:
#   chmod +x fix-imports.sh && ./fix-imports.sh

set -e
echo "═══════════════════════════════════════════════"
echo "  Applying import fixes to mlb-predictor"
echo "═══════════════════════════════════════════════"

# ── Fix 1: Rename Sports/ to sports/ ──────────────────────
if [ -d "src/Sports" ] && [ ! -d "src/sports" ]; then
  echo "✅ Fix 1: Renaming src/Sports/ → src/sports/"
  cd src
  mv Sports sports_temp
  mv sports_temp sports
  cd ..
elif [ -d "src/sports" ]; then
  echo "⏩ Fix 1: src/sports/ already lowercase — skipping"
else
  echo "❌ Fix 1: Neither src/Sports nor src/sports found!"
  exit 1
fi

# ── Fix 2: NBACalendarTab.jsx ─────────────────────────────
echo "✅ Fix 2: Patching NBACalendarTab.jsx imports"
sed -i.bak '
s|from "../../components/shared.jsx"|from "../../components/Shared.jsx"|
s|import { ShapPanel } from|import ShapPanel from|
s|import { MonteCarloPanel } from|import MonteCarloPanel from|
' src/sports/nba/NBACalendarTab.jsx

# Replace the getBetSignals/BetSignalsPanel import block
sed -i.bak 's|import { getBetSignals, BetSignalsPanel } from "../../utils/betUtils.js";|import { getBetSignals } from "../../utils/sharedUtils.js";|' src/sports/nba/NBACalendarTab.jsx

# Add BetSignalsPanel to the Shared.jsx import line
sed -i.bak 's|ParlayBuilder } from "../../components/Shared.jsx"|ParlayBuilder, BetSignalsPanel } from "../../components/Shared.jsx"|' src/sports/nba/NBACalendarTab.jsx

# ── Fix 3: NFLCalendarTab.jsx ─────────────────────────────
echo "✅ Fix 3: Patching NFLCalendarTab.jsx (shared → Shared)"
sed -i.bak 's|from "../../components/shared.jsx"|from "../../components/Shared.jsx"|' src/sports/nfl/NFLCalendarTab.jsx

# ── Fix 4: NCAAFCalendarTab.jsx ───────────────────────────
echo "✅ Fix 4: Patching NCAAFCalendarTab.jsx (shared → Shared)"
sed -i.bak 's|from "../../components/shared.jsx"|from "../../components/Shared.jsx"|' src/sports/ncaaf/NCAAFCalendarTab.jsx

# ── Fix 5: nflSync.js — fetchNFLRealEPA import ───────────
echo "✅ Fix 5: Patching nflSync.js (fetchNFLRealEPA → betUtils)"
sed -i.bak 's|import { fetchNFLRealEPA } from "./nflUtils.js";|import { fetchNFLRealEPA } from "../../utils/betUtils.js";|' src/sports/nfl/nflSync.js

# ── Fix 6: betUtils.js — mlbUtils → mlb ──────────────────
echo "✅ Fix 6: Patching betUtils.js (mlbUtils.js → mlb.js)"
sed -i.bak 's|from "../sports/mlb/mlbUtils.js"|from "../sports/mlb/mlb.js"|' src/utils/betUtils.js

# ── Cleanup .bak files ────────────────────────────────────
find src -name "*.bak" -delete 2>/dev/null || true

echo ""
echo "═══════════════════════════════════════════════"
echo "  All fixes applied! Verify with:"
echo "    head -10 src/sports/nba/NBACalendarTab.jsx"
echo "    grep 'shared\.' src/sports/nfl/NFLCalendarTab.jsx"
echo "    grep 'fetchNFLRealEPA' src/sports/nfl/nflSync.js"
echo "    grep 'mlbPredictGame' src/utils/betUtils.js"
echo "═══════════════════════════════════════════════"
