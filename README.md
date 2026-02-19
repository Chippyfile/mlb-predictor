# MLB Predictor v5

Advanced MLB game prediction engine with live data, park factors, probable starters, rolling form, bullpen fatigue, and Pythagorean regression.

## Features
- 📅 **Calendar tab** — fetches today's full MLB schedule automatically (Spring Training, Regular Season, Playoffs)
- ⚾ **Matchup tab** — deep-dive prediction for any two teams
- 🏟️ **Parks tab** — all 30 park factors ranked
- Live probable starters, bullpen relievers, vsTeam splits
- Banner color coding: Green = model edge, Yellow = incomplete data

## How the API proxy works
All MLB API calls go through `/mlb/*` which `vercel.json` rewrites to `statsapi.mlb.com/api/v1/*` on Vercel's edge — no CORS, no CSP issues.

## Deploy to Vercel

### 1. Push to GitHub
```bash
git init
git add .
git commit -m "MLB Predictor v5"
git remote add origin https://github.com/Chippyfile/mlb-predictor.git
git branch -M main
git push -u origin main
```

### 2. Deploy on Vercel
1. Go to vercel.com → Add New Project
2. Import `Chippyfile/mlb-predictor`
3. Framework: **Vite** (auto-detected)
4. Click **Deploy**

That's it. The `vercel.json` proxy handles everything automatically.

## Local Development
```bash
npm install
npm run dev
```
The `vite.config.js` proxy handles `/mlb` → `statsapi.mlb.com` locally too.

## Optional: Live Odds API
Get a free key at the-odds-api.com (500 req/month).
Add `VITE_ODDS_API_KEY=your_key` in Vercel Environment Variables.

## Optional: Statcast Backend (Tier 3)
See the Deploy tab in the app, or add `api/statcast.py` with `pybaseball` to unlock xwOBA, barrel rate, exit velocity.
