/**
 * Migration: Add multi-circuit support to CourtCall
 *
 * Run this AFTER setup-db.js to upgrade an existing database,
 * or it will be included in fresh setup-db.js runs.
 *
 * Usage: node migrate-circuits.js
 */

const Database = require('better-sqlite3');
const path = require('path');
const { nanoid } = require('nanoid');

const DB_PATH = path.join(__dirname, 'courtcall.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

console.log('🔄 Migrating database for multi-circuit support...\n');

// ─── Create circuits table ───────────────────────────────────────────
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

// ─── Create circuit_members table ────────────────────────────────────
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

// ─── Add circuit_id to tournaments if not exists ─────────────────────
const tourCols = db.prepare("PRAGMA table_info(tournaments)").all();
if (!tourCols.find(c => c.name === 'circuit_id')) {
  db.exec('ALTER TABLE tournaments ADD COLUMN circuit_id TEXT REFERENCES circuits(id)');
  console.log('  Added circuit_id to tournaments');
}

// ─── Add circuit_id to leagues if not exists ─────────────────────────
const leagueCols = db.prepare("PRAGMA table_info(leagues)").all();
if (!leagueCols.find(c => c.name === 'circuit_id')) {
  db.exec('ALTER TABLE leagues ADD COLUMN circuit_id TEXT REFERENCES circuits(id)');
  console.log('  Added circuit_id to leagues');
}

// ─── Create indexes ──────────────────────────────────────────────────
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_circuit_members_circuit ON circuit_members(circuit_id);
  CREATE INDEX IF NOT EXISTS idx_circuit_members_user ON circuit_members(user_id);
  CREATE INDEX IF NOT EXISTS idx_tournaments_circuit ON tournaments(circuit_id);
  CREATE INDEX IF NOT EXISTS idx_leagues_circuit ON leagues(circuit_id);
`);

// ─── Seed default circuits ───────────────────────────────────────────
console.log('\n📋 Seeding default circuits...\n');

const circuits = [
  {
    id: 'ti-ulster',
    name: 'Tennis Ireland — Ulster Circuit',
    slug: 'ulster',
    description: 'Senior and Masters tournaments across Ulster including Ballycastle, CIYMS, Cavehill, Belfast Boat Club, and more.',
    logo_emoji: '☘️',
    country: 'GB-NIR',
    data_source: 'tournamentsoftware',
    data_source_url: 'https://ti.tournamentsoftware.com',
    data_source_config: JSON.stringify({ subdomain: 'ti', region: 'ulster' }),
  },
  {
    id: 'ti-leinster',
    name: 'Tennis Ireland — Leinster Circuit',
    slug: 'leinster',
    description: 'Leinster tennis tournaments including Fitzwilliam, Lansdowne, and Dublin area clubs.',
    logo_emoji: '☘️',
    country: 'IE',
    data_source: 'tournamentsoftware',
    data_source_url: 'https://ti.tournamentsoftware.com',
    data_source_config: JSON.stringify({ subdomain: 'ti', region: 'leinster' }),
  },
  {
    id: 'ti-munster',
    name: 'Tennis Ireland — Munster Circuit',
    slug: 'munster',
    description: 'Munster tennis tournaments including Rushbrooke, Sunday\'s Well, and Cork area clubs.',
    logo_emoji: '☘️',
    country: 'IE',
    data_source: 'tournamentsoftware',
    data_source_url: 'https://ti.tournamentsoftware.com',
    data_source_config: JSON.stringify({ subdomain: 'ti', region: 'munster' }),
  },
  {
    id: 'bucs-tennis',
    name: 'BUCS University Tennis',
    slug: 'bucs',
    description: 'British Universities & Colleges Sport tennis — league matches, individual championships, and Super Weekends.',
    logo_emoji: '🎓',
    country: 'GB',
    data_source: 'playwaze',
    data_source_url: 'https://bucs.playwaze.com',
    data_source_config: JSON.stringify({ communitySlug: 'bucs-tennis-25-26' }),
  },
];

const insertCircuit = db.prepare(`
  INSERT OR IGNORE INTO circuits (id, name, slug, description, logo_emoji, country, data_source, data_source_url, data_source_config)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

for (const c of circuits) {
  insertCircuit.run(c.id, c.name, c.slug, c.description, c.logo_emoji, c.country, c.data_source, c.data_source_url, c.data_source_config);
}

// ─── Link existing tournaments to Ulster circuit ─────────────────────
db.prepare("UPDATE tournaments SET circuit_id = 'ti-ulster' WHERE circuit_id IS NULL").run();
console.log('  Linked existing tournaments to Ulster circuit');

console.log('\n✅ Migration complete!');
console.log(`   Circuits: ${db.prepare('SELECT COUNT(*) as c FROM circuits').get().c}`);
console.log(`   Tournaments with circuit: ${db.prepare("SELECT COUNT(*) as c FROM tournaments WHERE circuit_id IS NOT NULL").get().c}`);

db.close();
