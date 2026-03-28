# 🎾 CourtCall

**Tennis prediction app — pick your winners, compete with mates.**

Built for Irish tennis tournaments (Tennis Ireland) and British university tennis (BUCS). Create leagues with friends, predict match outcomes, earn points, and climb the leaderboard.

## Quickstart (Local)

```bash
# 1. Install dependencies
cd server && npm install
cd ../client && npm install

# 2. Set up database with demo data
cd ../server && node setup-db.js

# 3. Start the server (serves API + static frontend)
npm run dev

# 4. In another terminal, start the frontend dev server
cd ../client && npm run dev
```

Open `http://localhost:5173` — the Vite dev server proxies API calls to the Express server on port 3001.

### Demo login
- **Username:** `demo` | **PIN:** `0000`
- **League invite code:** `TENNIS`
- **Admin:** First user to register gets admin access

## Deploy to Railway (recommended)

Railway is the easiest — one push and you're live for ~$5/month.

### Step 1: Push to GitHub
```bash
git init
git add -A
git commit -m "initial commit"
gh repo create courtcall --public --push
```

### Step 2: Connect Railway
1. Go to [railway.app](https://railway.app) and sign in with GitHub
2. Click **New Project → Deploy from GitHub repo**
3. Select your `courtcall` repo
4. Railway auto-detects the Dockerfile. Click **Deploy**.
5. Once built, go to **Settings → Networking → Generate Domain** to get your public URL
6. Add environment variable: `ADMIN_KEY` = (your secret key for admin access)

### Step 3: Build the frontend
Railway runs the Dockerfile which builds the Vite frontend into `client/dist/` and the Express server serves it statically. No separate frontend deploy needed.

### Step 4: Initialise the database
Railway's first deploy runs `node setup-db.js` automatically via the Dockerfile's CMD. Your demo data will be ready.

## Deploy to Render (alternative)

1. Push to GitHub
2. Go to [render.com](https://render.com) → **New Web Service** → Connect your repo
3. Render will use `render.yaml` for configuration
4. Add a **Disk** at `/data` for SQLite persistence
5. Set `DB_PATH=/data/courtcall.db` in environment variables

## How to add a real tournament

### Option A: Admin Panel (easiest)
1. Sign in as the first registered user (admin)
2. Go to ⚙️ Admin Panel
3. **Add Tournament** tab → Fill in name, club, dates, surface
4. **Add Matches** tab → Select the tournament → QuickSetup creates the event + round
5. Type matches: `C. McAllister [1] vs D. O'Brien` (one per line)
6. When results come in → **Enter Results** tab

### Option B: Chrome Extension (for TournamentSoftware)
1. Load the `extension/` folder as an unpacked Chrome extension
2. Browse to a tournament on `ti.tournamentsoftware.com`
3. Click the CourtCall extension icon → one-click import of the full draw

### Option C: API
```bash
# Create tournament
curl -X POST http://localhost:3001/api/admin/tournaments \
  -H "Content-Type: application/json" \
  -d '{"name":"My Tournament","club":"My Club","dates":"1-7 Jul","surface":"Hard","user_id":"YOUR_ADMIN_ID"}'

# Create event
curl -X POST http://localhost:3001/api/admin/events \
  -H "Content-Type: application/json" \
  -d '{"tournament_id":"my-tournament","code":"MS","name":"Mens Singles","user_id":"YOUR_ADMIN_ID"}'
```

## Tech Stack

| Layer | Tech |
|-------|------|
| Frontend | React 18 + Vite (PWA) |
| Backend | Express + SQLite (better-sqlite3) |
| Scoring | Custom engine (10pt winner, 5pt sets, 15pt score, 8pt upset, 10pt perfect) |
| Deploy | Docker / Railway / Render |

## Project Structure

```
courtcall/
├── client/           # React frontend
│   ├── src/
│   │   ├── pages/    # 13 pages (Auth, Tournaments, Predict, Leagues, Stats...)
│   │   ├── components/ # 9 components (Countdown, BracketView, ReactionBar...)
│   │   ├── hooks/    # useAuth
│   │   └── utils/    # API client
│   └── public/       # PWA manifest, icons
├── server/           # Express backend
│   ├── index.js      # 30 API endpoints
│   ├── setup-db.js   # Schema + seed data
│   ├── scoring.js    # Scoring engine
│   ├── scraper.js    # TournamentSoftware HTTP scraper
│   └── scraper-auto.js # Puppeteer scraper
├── extension/        # Chrome extension for TI import
├── Dockerfile        # Multi-stage Docker build
├── docker-compose.yml
├── railway.toml
└── render.yaml
```

## Scoring System

| Category | Points | Condition |
|----------|--------|-----------|
| Correct Winner | 10 | Pick the right player |
| Correct Sets | 5 | Predict 2 or 3 sets correctly |
| Correct Score | 15 | Exact scoreline (requires correct winner) |
| Upset Bonus | 8 | Correctly predict lower seed winning |
| Perfect Match | 10 | Winner + sets + score all correct |

**Maximum per match: 48 points** (upset + perfect)
