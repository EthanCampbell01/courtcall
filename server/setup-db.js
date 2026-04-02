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

// ─── Seed circuits only (no fake tournament data) ────────────────────
console.log('📋 Seeding circuits...\n');

const { nanoid } = require('nanoid');

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

console.log('✅ Database setup complete!');
console.log(`   Database file: ${DB_PATH}`);
console.log('');
console.log('🚀 Run "npm run dev" to start the server');
console.log('🔑 Admin: first registered user gets admin access');

db.close();
