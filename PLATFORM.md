# CourtCall — Multi-Circuit Platform Architecture

## Vision
CourtCall becomes the fantasy prediction platform for grassroots and university
tennis across Ireland and the UK. Any tennis circuit, club, or university can
set up their own CourtCall community in minutes.

## Target Markets

### 1. Tennis Ireland (Current)
- Ulster Senior Circuit (Ballycastle, CIYMS, Cavehill, etc.)
- Leinster, Munster, Connacht circuits
- ~180 affiliated clubs, ~80,000 players
- Data source: ti.tournamentsoftware.com

### 2. British Universities (BUCS)
- 47 BUCS tennis leagues
- 2,916 students competed in 2025-26
- BUCS Individual Championships (regionals + nationals)
- Data source: bucs.playwaze.com
- Perfect viral loop: students share with teammates

### 3. LTA British Tour (Future)
- County-level tournaments across England, Scotland, Wales
- Club leagues and inter-club competitions
- Data source: LTA Competition Management System

### 4. Club Internal (Future)
- Any club can run their own prediction league
- Club championships, internal ladders
- Admin manually enters draws

---

## Database Architecture — New Tables

### circuits
The top-level organisational unit. Each circuit has its own branding,
data source config, and admin users.

```sql
CREATE TABLE circuits (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,           -- "Tennis Ireland Ulster"
  slug TEXT UNIQUE NOT NULL,    -- "ti-ulster" (used in URLs)
  description TEXT,
  logo_emoji TEXT DEFAULT '🎾',
  country TEXT DEFAULT 'IE',
  data_source TEXT,             -- 'tournamentsoftware', 'playwaze', 'manual'
  data_source_url TEXT,         -- base URL for scraping
  data_source_config TEXT,      -- JSON config for the scraper
  is_public INTEGER DEFAULT 1,  -- visible in circuit browser
  created_by TEXT REFERENCES users(id),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### circuit_members
Users join circuits to participate.

```sql
CREATE TABLE circuit_members (
  id TEXT PRIMARY KEY,
  circuit_id TEXT NOT NULL REFERENCES circuits(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  role TEXT DEFAULT 'member',   -- 'admin', 'moderator', 'member'
  joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(circuit_id, user_id)
);
```

### Modified tournaments table
Add circuit_id foreign key.

```sql
ALTER TABLE tournaments ADD COLUMN circuit_id TEXT REFERENCES circuits(id);
```

### Modified leagues table
Add circuit_id for cross-tournament leagues (e.g. "Season Championship").

```sql
ALTER TABLE leagues ADD COLUMN circuit_id TEXT REFERENCES circuits(id);
```

---

## Data Source Adapters

Each circuit configures a data source adapter:

### 1. TournamentSoftware Adapter (Tennis Ireland)
- URL pattern: `{subdomain}.tournamentsoftware.com`
- Scraper: Puppeteer-based, visits tournament/draw pages
- Config: `{ subdomain: "ti", sportId: "tennis" }`

### 2. Playwaze Adapter (BUCS)
- URL pattern: `bucs.playwaze.com/{season-slug}`
- Scraper: Puppeteer-based, reads league tables and match results
- Config: `{ communitySlug: "bucs-tennis-25-26" }`

### 3. Manual Adapter
- No scraping — admin enters everything
- Good for club-level tournaments

### 4. CSV Import Adapter (Future)
- Upload a CSV with player names and seeds
- Useful for one-off events

---

## Revenue Model Options

### Freemium
- Free: 1 circuit, 1 league, 20 members
- Pro (£2.99/month per circuit admin): Unlimited leagues, custom branding, data sync
- University (£49/year per university): Full BUCS integration, unlimited students

### Per-Tournament
- Free during beta
- £5 per tournament for auto-data-sync
- £0 for manual entry

### Sponsorship
- "Presented by [local tennis shop]" branding on league pages
- Local tennis businesses would pay for visibility

---

## Viral Growth Strategy

### For Universities
1. One student at each university sets up their tennis club's league
2. Shares invite code in the WhatsApp group
3. Everyone joins and predicts BUCS results
4. Screenshot the leaderboard → Instagram story → other unis see it
5. "How do we get this for our club?" → they set up their own

### For Irish Tennis
1. You and your mates use it at Ballycastle
2. People at the tournament ask what you're doing
3. Word spreads to other Ulster clubs
4. Tournament organisers see the engagement
5. Tennis Ireland notices → potential partnership

---

## Implementation Priority

### Phase 1 (Now → Ballycastle July 2026)
- Multi-circuit database schema
- Circuit browser / join flow
- TournamentSoftware adapter (already built)
- Tennis Ireland Ulster circuit pre-configured

### Phase 2 (August → October 2026)
- Playwaze adapter for BUCS
- University onboarding flow
- Season-long standings across tournaments
- Push notifications via web push API

### Phase 3 (November 2026 → Spring 2027)
- React Native mobile app (App Store / Play Store)
- Stripe payments for Pro tier
- LTA adapter
- Public API for third-party integrations
```
