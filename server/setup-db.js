const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'courtcall.db');

// --fresh flag deletes existing database and starts clean
if (process.argv.includes('--fresh') || process.argv.includes('-f')) {
  if (fs.existsSync(DB_PATH)) {
    fs.unlinkSync(DB_PATH);
    // Also remove WAL and SHM files if they exist
    if (fs.existsSync(DB_PATH + '-wal')) fs.unlinkSync(DB_PATH + '-wal');
    if (fs.existsSync(DB_PATH + '-shm')) fs.unlinkSync(DB_PATH + '-shm');
    console.log('🗑️  Deleted existing database\n');
  }
}

// Ensure directory exists
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

console.log('🎾 Setting up CourtCall database...\n');

// ─── Users ────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    pin_hash TEXT NOT NULL,
    avatar TEXT DEFAULT '🎾',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// ─── Tournaments ──────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS tournaments (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    club TEXT NOT NULL,
    province TEXT NOT NULL DEFAULT 'Ulster',
    dates TEXT NOT NULL,
    start_date TEXT,
    surface TEXT DEFAULT 'Hard',
    status TEXT DEFAULT 'upcoming',
    ti_url TEXT,
    circuit_id TEXT REFERENCES circuits(id),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// ─── Events (MS, WS, MD, etc) ────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    tournament_id TEXT NOT NULL REFERENCES tournaments(id),
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    draw_size INTEGER DEFAULT 8,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// ─── Rounds ───────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS rounds (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL REFERENCES events(id),
    name TEXT NOT NULL,
    round_order INTEGER NOT NULL,
    prediction_deadline DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// ─── Matches ──────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS matches (
    id TEXT PRIMARY KEY,
    round_id TEXT NOT NULL REFERENCES rounds(id),
    player1_name TEXT NOT NULL,
    player1_seed INTEGER,
    player2_name TEXT NOT NULL,
    player2_seed INTEGER,
    status TEXT DEFAULT 'upcoming',
    winner_name TEXT,
    score TEXT,
    sets_played INTEGER,
    match_order INTEGER DEFAULT 0,
    scheduled_time DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// ─── Predictions ──────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS predictions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    match_id TEXT NOT NULL REFERENCES matches(id),
    predicted_winner TEXT NOT NULL,
    predicted_sets INTEGER,
    predicted_score TEXT,
    points_earned INTEGER DEFAULT 0,
    is_scored INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, match_id)
  );
`);

// ─── Leagues ──────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS leagues (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    invite_code TEXT UNIQUE NOT NULL,
    buy_in REAL DEFAULT 0,
    tournament_id TEXT REFERENCES tournaments(id),
    circuit_id TEXT REFERENCES circuits(id),
    created_by TEXT NOT NULL REFERENCES users(id),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// ─── League Members ───────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS league_members (
    id TEXT PRIMARY KEY,
    league_id TEXT NOT NULL REFERENCES leagues(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(league_id, user_id)
  );
`);

// ─── Reactions (emoji reactions on predictions) ──────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS reactions (
    id TEXT PRIMARY KEY,
    prediction_id TEXT NOT NULL REFERENCES predictions(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    emoji TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(prediction_id, user_id)
  );
`);

// ─── Circuits ────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS circuits (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    description TEXT,
    logo_emoji TEXT DEFAULT '🎾',
    country TEXT DEFAULT 'IE',
    data_source TEXT DEFAULT 'manual',
    data_source_url TEXT,
    data_source_config TEXT,
    is_public INTEGER DEFAULT 1,
    created_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// ─── Circuit Members ─────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS circuit_members (
    id TEXT PRIMARY KEY,
    circuit_id TEXT NOT NULL REFERENCES circuits(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    role TEXT DEFAULT 'member',
    joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(circuit_id, user_id)
  );
`);

// ─── Indexes ──────────────────────────────────────────────────────────
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_events_tournament ON events(tournament_id);
  CREATE INDEX IF NOT EXISTS idx_rounds_event ON rounds(event_id);
  CREATE INDEX IF NOT EXISTS idx_matches_round ON matches(round_id);
  CREATE INDEX IF NOT EXISTS idx_predictions_user ON predictions(user_id);
  CREATE INDEX IF NOT EXISTS idx_predictions_match ON predictions(match_id);
  CREATE INDEX IF NOT EXISTS idx_league_members_league ON league_members(league_id);
  CREATE INDEX IF NOT EXISTS idx_league_members_user ON league_members(user_id);
  CREATE INDEX IF NOT EXISTS idx_reactions_prediction ON reactions(prediction_id);
  CREATE INDEX IF NOT EXISTS idx_circuit_members_circuit ON circuit_members(circuit_id);
  CREATE INDEX IF NOT EXISTS idx_circuit_members_user ON circuit_members(user_id);
  CREATE INDEX IF NOT EXISTS idx_matches_status ON matches(status);
`);

// ─── Add circuit_id columns if missing (safe for re-runs) ────────────
try { db.exec('ALTER TABLE tournaments ADD COLUMN circuit_id TEXT REFERENCES circuits(id)'); } catch (e) { /* already exists */ }
try { db.exec('ALTER TABLE leagues ADD COLUMN circuit_id TEXT REFERENCES circuits(id)'); } catch (e) { /* already exists */ }

// ─── Seed data ───────────────────────────────────────────────────────
console.log('📋 Seeding circuits and tournaments...\n');

const { nanoid } = require('nanoid');

// ─── Seed circuits ───────────────────────────────────────────────────
const circuitSeed = db.prepare(`
  INSERT OR IGNORE INTO circuits (id, name, slug, description, logo_emoji, country, data_source, data_source_url, data_source_config)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

circuitSeed.run('ti-ulster', 'Tennis Ireland — Ulster', 'ulster',
  'Senior and Masters tournaments across Ulster including Ballycastle, CIYMS, Cavehill, Belfast Boat Club, and more.',
  '☘️', 'GB-NIR', 'tournamentsoftware', 'https://ti.tournamentsoftware.com',
  JSON.stringify({ subdomain: 'ti', region: 'ulster' }));

circuitSeed.run('ti-leinster', 'Tennis Ireland — Leinster', 'leinster',
  'Leinster tennis tournaments including Fitzwilliam, Lansdowne, and Dublin area clubs.',
  '☘️', 'IE', 'tournamentsoftware', 'https://ti.tournamentsoftware.com',
  JSON.stringify({ subdomain: 'ti', region: 'leinster' }));

circuitSeed.run('ti-munster', 'Tennis Ireland — Munster', 'munster',
  'Munster tennis tournaments including Rushbrooke, Sunday\'s Well, and Cork area clubs.',
  '☘️', 'IE', 'tournamentsoftware', 'https://ti.tournamentsoftware.com',
  JSON.stringify({ subdomain: 'ti', region: 'munster' }));

circuitSeed.run('bucs-tennis', 'BUCS University Tennis', 'bucs',
  'British Universities & Colleges Sport tennis — league matches, individual championships, and Super Weekends.',
  '🎓', 'GB', 'playwaze', 'https://bucs.playwaze.com',
  JSON.stringify({ communitySlug: 'bucs-tennis-25-26' }));

// ─── Seed tournaments (linked to Ulster circuit) ─────────────────────
const bcId = 'ballycastle-2026';
db.prepare(`
  INSERT OR IGNORE INTO tournaments (id, name, club, province, dates, start_date, surface, status, ti_url, circuit_id)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`).run(bcId, 'Ballycastle Open 2026', 'Ballycastle Tennis Club', 'Ulster', '11–18 Jul 2026', '2026-07-11', 'Grass', 'upcoming', 'https://ti.tournamentsoftware.com/tournament/90F4BBFC-DBE1-451F-8078-C1D1E12D9AD4', 'ti-ulster');

// Men's Singles event
const msId = 'bc26-ms';
db.prepare(`
  INSERT OR IGNORE INTO events (id, tournament_id, code, name, draw_size)
  VALUES (?, ?, ?, ?, ?)
`).run(msId, bcId, 'MS', "Men's Singles", 8);

// Round 1
const r1Id = 'bc26-ms-r1';
db.prepare(`
  INSERT OR IGNORE INTO rounds (id, event_id, name, round_order, prediction_deadline)
  VALUES (?, ?, ?, ?, ?)
`).run(r1Id, msId, 'Round 1', 1, '2026-07-13T23:59:00');

// QF
const qfId = 'bc26-ms-qf';
db.prepare(`
  INSERT OR IGNORE INTO rounds (id, event_id, name, round_order, prediction_deadline)
  VALUES (?, ?, ?, ?, ?)
`).run(qfId, msId, 'Quarter-Finals', 2, '2026-07-15T23:59:00');

// SF
const sfId = 'bc26-ms-sf';
db.prepare(`
  INSERT OR IGNORE INTO rounds (id, event_id, name, round_order, prediction_deadline)
  VALUES (?, ?, ?, ?, ?)
`).run(sfId, msId, 'Semi-Finals', 3, '2026-07-17T23:59:00');

// Final
const fId = 'bc26-ms-f';
db.prepare(`
  INSERT OR IGNORE INTO rounds (id, event_id, name, round_order, prediction_deadline)
  VALUES (?, ?, ?, ?, ?)
`).run(fId, msId, 'Final', 4, '2026-07-19T23:59:00');

// Note: R1 matches are left empty — admin will populate them from the real draw
// This is intentional: the admin inputs real player names once the draw is published

// Insert more Ulster tournaments
const ulsterTournaments = [
  ['ciyms-2026', 'CIYMS Open 2026', 'CIYMS Tennis', '21–27 Jul 2026', '2026-07-21', 'Artificial Grass'],
  ['cavehill-2026', 'Cavehill Open 2026', 'Cavehill Tennis Club', '28 Jul – 3 Aug 2026', '2026-07-28', 'Hard'],
  ['bbc-2026', 'Belfast Boat Club Championships', 'Belfast Boat Club', '4–10 Aug 2026', '2026-08-04', 'Hard'],
  ['bangor-2026', 'Bangor Open 2026', 'Bangor LTC', '11–17 Aug 2026', '2026-08-11', 'Artificial Grass'],
  ['portadown-2026', 'Portadown Open 2026', 'Portadown Tennis Club', '18–24 Aug 2026', '2026-08-18', 'Hard'],
  ['windsor-2026', 'Windsor Open 2026', 'Windsor Tennis Club', '25–31 Aug 2026', '2026-08-25', 'Hard'],
  ['enniskillen-2026', 'Enniskillen Open 2026', 'Enniskillen Tennis Club', '1–7 Sep 2026', '2026-09-01', 'Hard'],
];

const insertTournament = db.prepare(`
  INSERT OR IGNORE INTO tournaments (id, name, club, province, dates, start_date, surface, status, circuit_id)
  VALUES (?, ?, ?, ?, ?, ?, ?, 'upcoming', ?)
`);

for (const [id, name, club, dates, startDate, surface] of ulsterTournaments) {
  insertTournament.run(id, name, club, 'Ulster', dates, startDate, surface, 'ti-ulster');
}

// ─── Current real tournaments (from TournamentSoftware, March 2026) ──
const currentTournaments = [
  ['dl-belfast-2026', 'David Lloyd Belfast Singles Box Leagues', 'David Lloyd Belfast', 'Ulster',
   '12 Jan – 30 Dec 2026', '2026-01-12', 'Hard', 'active', 'ti-ulster'],
  ['larne-ladies-2026', 'Larne Ladies Tennis Ladder 2025/2026', 'Larne Bowling & Tennis Club', 'Ulster',
   '1 Oct 2025 – 31 Mar 2026', '2025-10-01', 'Hard', 'active', 'ti-ulster'],
  ['mt-pleasant-2026', 'Mount Pleasant Spring Tournament 2026', 'Mount Pleasant LTC', 'Leinster',
   '9 Feb – 18 Apr 2026', '2026-02-09', 'Hard', 'active', 'ti-leinster'],
  ['casey-tiles-2026', 'Casey Tiles Spring Leagues 2026', 'Larkspur Park TC', 'Munster',
   '26 Jan – 8 May 2026', '2026-01-26', 'Hard', 'active', 'ti-munster'],
];

const insertCurrentTournament = db.prepare(`
  INSERT OR IGNORE INTO tournaments (id, name, club, province, dates, start_date, surface, status, circuit_id)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
for (const t of currentTournaments) {
  insertCurrentTournament.run(...t);
}

// ─── Demo draw: Ballycastle Men's Singles R1 with realistic players ──
// These are realistic but fictional Ulster tennis player names
const bc_r1_matches = [
  { id: 'bc26-m1', p1: 'C. McAllister', s1: 1, p2: 'D. O\'Brien', s2: null },
  { id: 'bc26-m2', p1: 'R. Stewart', s1: 3, p2: 'F. Gallagher', s2: null },
  { id: 'bc26-m3', p1: 'P. Murray', s1: 2, p2: 'J. Quinn', s2: 4 },
  { id: 'bc26-m4', p1: 'S. Campbell', s1: null, p2: 'T. Doherty', s2: 5 },
  { id: 'bc26-m5', p1: 'K. Lavery', s1: 6, p2: 'A. McKeown', s2: null },
  { id: 'bc26-m6', p1: 'B. Hamill', s1: null, p2: 'N. Molloy', s2: 7 },
  { id: 'bc26-m7', p1: 'E. Donnelly', s1: null, p2: 'G. Smyth', s2: 8 },
  { id: 'bc26-m8', p1: 'L. Magee', s1: null, p2: 'M. Fitzpatrick', s2: null },
];

const insertMatch = db.prepare(`
  INSERT OR IGNORE INTO matches (id, round_id, player1_name, player1_seed, player2_name, player2_seed, status, winner_name, score, sets_played)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

for (const m of bc_r1_matches) {
  insertMatch.run(m.id, r1Id, m.p1, m.s1, m.p2, m.s2, 'upcoming', null, null, null);
}

// ─── Some QF matches with completed results (for testing scoring) ────
const bc_qf_matches = [
  { id: 'bc26-qf1', p1: 'C. McAllister', s1: 1, p2: 'F. Gallagher', s2: null, status: 'completed', winner: 'C. McAllister', score: '6-3 6-4', sets: 2 },
  { id: 'bc26-qf2', p1: 'P. Murray', s1: 2, p2: 'T. Doherty', s2: 5, status: 'completed', winner: 'T. Doherty', score: '4-6 6-3 7-5', sets: 3 },
  { id: 'bc26-qf3', p1: 'K. Lavery', s1: 6, p2: 'N. Molloy', s2: 7, status: 'upcoming', winner: null, score: null, sets: null },
  { id: 'bc26-qf4', p1: 'G. Smyth', s1: 8, p2: 'L. Magee', s2: null, status: 'upcoming', winner: null, score: null, sets: null },
];

for (const m of bc_qf_matches) {
  insertMatch.run(m.id, qfId, m.p1, m.s1, m.p2, m.s2, m.status, m.winner, m.score, m.sets);
}

// ─── Demo user + predictions (so stats page has data) ───────────────
const demoUserId = 'demo-user-01';
db.prepare(`
  INSERT OR IGNORE INTO users (id, username, display_name, pin_hash, avatar)
  VALUES (?, ?, ?, ?, ?)
`).run(demoUserId, 'demo', 'Demo Player', '0000', '🎾');

// Auto-join demo user to Ulster circuit
db.prepare(`INSERT OR IGNORE INTO circuit_members (id, circuit_id, user_id) VALUES (?, ?, ?)`)
  .run(nanoid(12), 'ti-ulster', demoUserId);

// Demo predictions for QF matches (so we can see scoring work)
const insertPrediction = db.prepare(`
  INSERT OR IGNORE INTO predictions (id, user_id, match_id, predicted_winner, predicted_sets, predicted_score)
  VALUES (?, ?, ?, ?, ?, ?)
`);

insertPrediction.run(nanoid(12), demoUserId, 'bc26-qf1', 'C. McAllister', 2, '6-3 6-4');
insertPrediction.run(nanoid(12), demoUserId, 'bc26-qf2', 'P. Murray', 2, '6-4 6-3');

// Score the demo predictions
const { scorePrediction } = require('./scoring');
const completedMatches = db.prepare("SELECT * FROM matches WHERE status = 'completed'").all();
for (const match of completedMatches) {
  const preds = db.prepare('SELECT * FROM predictions WHERE match_id = ?').all(match.id);
  for (const pred of preds) {
    const { total: points } = scorePrediction(pred, match);
    db.prepare('UPDATE predictions SET points_earned = ?, is_scored = 1 WHERE id = ?')
      .run(points, pred.id);
  }
}

// ─── Women's Singles event for Ballycastle ──────────────────────────
const wsId = 'bc26-ws';
db.prepare(`
  INSERT OR IGNORE INTO events (id, tournament_id, code, name, draw_size)
  VALUES (?, ?, ?, ?, ?)
`).run(wsId, bcId, 'WS', "Women's Singles", 8);

const wsR1Id = 'bc26-ws-r1';
db.prepare(`
  INSERT OR IGNORE INTO rounds (id, event_id, name, round_order, prediction_deadline)
  VALUES (?, ?, ?, ?, ?)
`).run(wsR1Id, wsId, 'Round 1', 1, '2026-07-13T23:59:00');

const bc_ws_matches = [
  { id: 'bc26-ws-m1', p1: 'S. Mullan', s1: 1, p2: 'R. Bradley', s2: null },
  { id: 'bc26-ws-m2', p1: 'C. Doran', s1: null, p2: 'A. Keane', s2: 2 },
  { id: 'bc26-ws-m3', p1: 'E. McCloskey', s1: 3, p2: 'L. Hanna', s2: null },
  { id: 'bc26-ws-m4', p1: 'F. Corr', s1: null, p2: 'M. Thompson', s2: 4 },
];

for (const m of bc_ws_matches) {
  insertMatch.run(m.id, wsR1Id, m.p1, m.s1, m.p2, m.s2, 'upcoming', null, null, null);
}

// ─── Demo league ────────────────────────────────────────────────────
db.prepare(`
  INSERT OR IGNORE INTO leagues (id, name, invite_code, created_by, tournament_id, buy_in)
  VALUES (?, ?, ?, ?, ?, ?)
`).run('demo-league', 'Ballycastle Bandits', 'TENNIS', demoUserId, bcId, 10);

db.prepare(`INSERT OR IGNORE INTO league_members (id, league_id, user_id) VALUES (?, ?, ?)`)
  .run(nanoid(12), 'demo-league', demoUserId);

console.log('✅ Database setup complete!');
console.log(`   Database file: ${DB_PATH}`);
console.log(`   Tournaments: ${db.prepare('SELECT COUNT(*) as c FROM tournaments').get().c}`);
console.log(`   Events: ${db.prepare('SELECT COUNT(*) as c FROM events').get().c}`);
console.log(`   Rounds: ${db.prepare('SELECT COUNT(*) as c FROM rounds').get().c}`);
console.log(`   Matches: ${db.prepare('SELECT COUNT(*) as c FROM matches').get().c}`);
console.log(`   Demo predictions scored: ${db.prepare("SELECT COUNT(*) as c FROM predictions WHERE is_scored = 1").get().c}`);
console.log('');
console.log('🚀 Run "npm run dev" to start the server');
console.log('');
console.log('📱 Demo login:  username=demo  pin=0000');
console.log('🔑 Admin: first registered user gets admin access');
console.log('🏆 Demo league:  invite code = TENNIS');

db.close();
