const express = require('express');
const cors = require('cors');
const path = require('path');
const { getDb } = require('./db');
const { SCORING, scoreMatchPredictions } = require('./scoring');
const { nanoid } = require('nanoid');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Handle malformed JSON bodies — return JSON error not HTML
app.use((err, _req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid JSON in request body' });
  }
  next(err);
});

// Serve static frontend in production
app.use(express.static(path.join(__dirname, '..', 'client', 'dist')));

// ─── Boot: init DB if missing, then migrate ───────────────────────────
(function boot() {
  const fs = require('fs');
  const { DB_PATH } = require('./db');
  if (!fs.existsSync(DB_PATH)) {
    console.log('No database found — running setup-db.js...');
    require('./setup-db');
  }
  // Migrations (safe to run on every boot)
  try {
    const db = getDb();
    const cols = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
    if (cols.length && !cols.includes('is_admin')) {
      db.exec("ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0");
    }
    db.exec("CREATE INDEX IF NOT EXISTS idx_matches_status ON matches(status)");
    db.exec(`CREATE TABLE IF NOT EXISTS discovered_tournaments (
      id TEXT PRIMARY KEY,
      guid TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      ti_url TEXT NOT NULL,
      location TEXT,
      suggested_circuit_id TEXT,
      discovered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      status TEXT DEFAULT 'pending'
    )`);
    try { db.exec('ALTER TABLE discovered_tournaments ADD COLUMN location TEXT'); } catch (e) { /* already exists */ }
    try { db.exec('ALTER TABLE discovered_tournaments ADD COLUMN suggested_circuit_id TEXT'); } catch (e) { /* already exists */ }
    try { db.exec('ALTER TABLE discovered_tournaments ADD COLUMN start_date TEXT'); } catch (e) { /* already exists */ }

    // ─── Remove fake seed tournaments ────────────────────────────────
    try {
      const fakeTournamentIds = [
        'ballycastle-2026', 'ciyms-2026', 'cavehill-2026', 'bbc-2026',
        'bangor-2026', 'portadown-2026', 'windsor-2026', 'enniskillen-2026',
        'dl-belfast-2026', 'larne-ladies-2026', 'mt-pleasant-2026', 'casey-tiles-2026',
      ];
      const p = fakeTournamentIds.map(() => '?').join(',');
      // Correct FK order: leagues/league_members first, then predictions → matches → rounds → events → tournaments
      db.prepare(`DELETE FROM league_members WHERE league_id IN (SELECT id FROM leagues WHERE tournament_id IN (${p}))`).run(...fakeTournamentIds);
      db.prepare(`DELETE FROM leagues WHERE tournament_id IN (${p})`).run(...fakeTournamentIds);
      db.prepare(`DELETE FROM predictions WHERE match_id IN (
        SELECT m.id FROM matches m JOIN rounds r ON m.round_id=r.id JOIN events e ON r.event_id=e.id WHERE e.tournament_id IN (${p})
      )`).run(...fakeTournamentIds);
      db.prepare(`DELETE FROM matches WHERE round_id IN (
        SELECT r.id FROM rounds r JOIN events e ON r.event_id=e.id WHERE e.tournament_id IN (${p})
      )`).run(...fakeTournamentIds);
      db.prepare(`DELETE FROM rounds WHERE event_id IN (SELECT id FROM events WHERE tournament_id IN (${p}))`).run(...fakeTournamentIds);
      db.prepare(`DELETE FROM events WHERE tournament_id IN (${p})`).run(...fakeTournamentIds);
      db.prepare(`DELETE FROM tournaments WHERE id IN (${p})`).run(...fakeTournamentIds);
      // Remove demo league and demo user
      db.prepare("DELETE FROM league_members WHERE league_id = 'demo-league'").run();
      db.prepare("DELETE FROM leagues WHERE id = 'demo-league'").run();
      db.prepare("DELETE FROM predictions WHERE user_id = 'demo-user-01'").run();
      db.prepare("DELETE FROM circuit_members WHERE user_id = 'demo-user-01'").run();
      db.prepare("DELETE FROM users WHERE id = 'demo-user-01'").run();
      console.log('✅ Fake seed data removed');
    } catch (e) { console.error('Cleanup migration error:', e.message); }
  } catch (e) { console.error('Migration error:', e.message); }
})();

// ─── Helpers ──────────────────────────────────────────────────────────
function hashPin(pin) {
  return crypto.createHash('sha256').update(pin).digest('hex');
}

function generateInviteCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

// ─── AUTH ROUTES ──────────────────────────────────────────────────────

// Register
app.post('/api/auth/register', (req, res) => {
  const { username, display_name, pin, avatar } = req.body;
  if (!username || !display_name || !pin || pin.length < 4) {
    return res.status(400).json({ error: 'Username, display name, and 4+ digit PIN required' });
  }

  // Validate username: 3-20 chars, alphanumeric + underscores only
  const cleanUsername = username.trim().toLowerCase();
  if (!/^[a-z0-9_]{3,20}$/.test(cleanUsername)) {
    return res.status(400).json({ error: 'Username must be 3-20 characters, letters/numbers/underscores only' });
  }

  // Sanitise display name
  const cleanDisplayName = display_name.trim().slice(0, 30);
  if (cleanDisplayName.length < 1) {
    return res.status(400).json({ error: 'Display name is required' });
  }

  const db = getDb();
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(cleanUsername);
  if (existing) {
    return res.status(409).json({ error: 'Username already taken' });
  }

  const id = nanoid(12);
  const userAvatar = avatar || '🎾';
  try {
    db.prepare('INSERT INTO users (id, username, display_name, pin_hash, avatar) VALUES (?, ?, ?, ?, ?)')
      .run(id, cleanUsername, cleanDisplayName, hashPin(pin), userAvatar);
  } catch (err) {
    if (err.message?.includes('UNIQUE')) {
      return res.status(409).json({ error: 'Username already taken' });
    }
    throw err;
  }

  res.json({ id, username: cleanUsername, display_name: cleanDisplayName, avatar: userAvatar });
});

// Login
app.post('/api/auth/login', (req, res) => {
  const { username, pin } = req.body;
  if (!username || !pin) {
    return res.status(400).json({ error: 'Username and PIN required' });
  }

  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username.toLowerCase());
  if (!user || user.pin_hash !== hashPin(pin)) {
    return res.status(401).json({ error: 'Invalid username or PIN' });
  }

  res.json({ id: user.id, username: user.username, display_name: user.display_name, avatar: user.avatar });
});

// Check if current user has admin access
app.get('/api/auth/is-admin', (req, res) => {
  res.json({ isAdmin: isAdminUser(req.query.user_id) });
});

// ─── CIRCUIT ROUTES ──────────────────────────────────────────────────

// List all public circuits
app.get('/api/circuits', (_req, res) => {
  const db = getDb();
  const circuits = db.prepare(`
    SELECT c.*,
      (SELECT COUNT(*) FROM circuit_members WHERE circuit_id = c.id) as member_count,
      (SELECT COUNT(*) FROM tournaments WHERE circuit_id = c.id) as tournament_count
    FROM circuits c
    WHERE c.is_public = 1
    ORDER BY member_count DESC
  `).all();
  res.json(circuits);
});

// Get user's circuits (MUST come before :slug route)
app.get('/api/circuits/user/:userId', (req, res) => {
  const db = getDb();
  const circuits = db.prepare(`
    SELECT c.*, cm.role,
      (SELECT COUNT(*) FROM circuit_members WHERE circuit_id = c.id) as member_count
    FROM circuits c
    JOIN circuit_members cm ON c.id = cm.circuit_id
    WHERE cm.user_id = ?
    ORDER BY cm.joined_at DESC
  `).all(req.params.userId);
  res.json(circuits);
});

// Get circuit detail
app.get('/api/circuits/:slug', (req, res) => {
  const db = getDb();
  const circuit = db.prepare('SELECT * FROM circuits WHERE slug = ? OR id = ?')
    .get(req.params.slug, req.params.slug);
  if (!circuit) return res.status(404).json({ error: 'Circuit not found' });

  circuit.members = db.prepare(`
    SELECT u.id, u.display_name, u.avatar, cm.role
    FROM circuit_members cm JOIN users u ON cm.user_id = u.id
    WHERE cm.circuit_id = ?
  `).all(circuit.id);

  circuit.tournaments = db.prepare(`
    SELECT t.*,
      (SELECT COUNT(*) FROM matches m JOIN rounds r ON m.round_id = r.id JOIN events e ON r.event_id = e.id WHERE e.tournament_id = t.id) as match_count
    FROM tournaments t WHERE t.circuit_id = ?
    ORDER BY COALESCE(t.start_date, t.dates) ASC
  `).all(circuit.id);

  res.json(circuit);
});

// Join a circuit
app.post('/api/circuits/join', (req, res) => {
  const { circuit_id, user_id } = req.body;
  if (!circuit_id || !user_id) return res.status(400).json({ error: 'circuit_id and user_id required' });

  const db = getDb();

  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(user_id);
  if (!user) return res.status(404).json({ error: 'Account not found. Please sign out and register again.' });

  const circuit = db.prepare('SELECT * FROM circuits WHERE id = ? OR slug = ?').get(circuit_id, circuit_id);
  if (!circuit) return res.status(404).json({ error: 'Circuit not found' });

  const existing = db.prepare('SELECT * FROM circuit_members WHERE circuit_id = ? AND user_id = ?')
    .get(circuit.id, user_id);
  if (existing) return res.json({ success: true, already_member: true });

  try {
    db.prepare('INSERT INTO circuit_members (id, circuit_id, user_id, role) VALUES (?, ?, ?, ?)')
      .run(nanoid(12), circuit.id, user_id, 'member');
  } catch (err) {
    console.error('circuit join error:', err.message);
    return res.status(500).json({ error: 'Failed to join circuit. Please try again.' });
  }

  res.json({ success: true, circuit: { id: circuit.id, name: circuit.name } });
});

// Create a new circuit (any user can create)
app.post('/api/circuits', (req, res) => {
  const { name, slug, description, country, user_id, data_source, data_source_url } = req.body;
  if (!name || !slug || !user_id) return res.status(400).json({ error: 'name, slug, and user_id required' });

  const db = getDb();
  const cleanSlug = slug.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 30);
  const existing = db.prepare('SELECT id FROM circuits WHERE slug = ?').get(cleanSlug);
  if (existing) return res.status(409).json({ error: 'Circuit slug already taken' });

  const id = nanoid(12);
  db.prepare(`
    INSERT INTO circuits (id, name, slug, description, country, data_source, data_source_url, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, name, cleanSlug, description || '', country || 'GB', data_source || 'manual', data_source_url || null, user_id);

  // Auto-add creator as admin
  db.prepare('INSERT INTO circuit_members (id, circuit_id, user_id, role) VALUES (?, ?, ?, ?)')
    .run(nanoid(12), id, user_id, 'admin');

  res.json({ id, name, slug: cleanSlug });
});

// ─── TOURNAMENT ROUTES ────────────────────────────────────────────────

// List tournaments — optionally filter by circuit
app.get('/api/tournaments', (req, res) => {
  const db = getDb();
  const circuitId = req.query.circuit;

  let query = `
    SELECT t.*,
      (SELECT COUNT(*) FROM events WHERE tournament_id = t.id) as event_count,
      (SELECT COUNT(*) FROM matches m
        JOIN rounds r ON m.round_id = r.id
        JOIN events e ON r.event_id = e.id
        WHERE e.tournament_id = t.id) as match_count,
      (SELECT MIN(r.prediction_deadline) FROM rounds r
        JOIN events e ON r.event_id = e.id
        WHERE e.tournament_id = t.id AND r.prediction_deadline > datetime('now')
      ) as next_deadline,
      c.name as circuit_name, c.slug as circuit_slug
    FROM tournaments t
    LEFT JOIN circuits c ON t.circuit_id = c.id
  `;

  const params = [];
  if (circuitId) {
    query += ' WHERE t.circuit_id = ?';
    params.push(circuitId);
  }

  query += ' ORDER BY COALESCE(t.start_date, t.dates) ASC';

  const tournaments = db.prepare(query).all(...params);
  res.json(tournaments);
});

// Get single tournament with full draw
app.get('/api/tournaments/:id', (req, res) => {
  const db = getDb();
  const tournament = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(req.params.id);
  if (!tournament) return res.status(404).json({ error: 'Tournament not found' });

  const events = db.prepare('SELECT * FROM events WHERE tournament_id = ?').all(tournament.id);

  for (const event of events) {
    event.rounds = db.prepare('SELECT * FROM rounds WHERE event_id = ? ORDER BY round_order').all(event.id);
    for (const round of event.rounds) {
      round.matches = db.prepare('SELECT * FROM matches WHERE round_id = ? ORDER BY match_order').all(round.id);
    }
  }

  tournament.events = events;
  res.json(tournament);
});

// ─── PREDICTION ROUTES ────────────────────────────────────────────────

// Submit/update a prediction
app.post('/api/predictions', (req, res) => {
  const { user_id, match_id, predicted_winner, predicted_sets, predicted_score } = req.body;
  if (!user_id || !match_id || !predicted_winner) {
    return res.status(400).json({ error: 'user_id, match_id, and predicted_winner required' });
  }

  const db = getDb();

  // Check match exists and is still open for predictions
  const match = db.prepare(`
    SELECT m.*, r.prediction_deadline
    FROM matches m
    JOIN rounds r ON m.round_id = r.id
    WHERE m.id = ?
  `).get(match_id);

  if (!match) return res.status(404).json({ error: 'Match not found' });
  if (match.status !== 'upcoming') return res.status(400).json({ error: 'Match is no longer open for predictions' });

  // Check deadline — if no deadline set, allow predictions
  if (match.prediction_deadline) {
    const now = new Date();
    const deadline = new Date(match.prediction_deadline);
    if (now > deadline) return res.status(400).json({ error: 'Prediction deadline has passed' });
  }

  // Validate winner is one of the players
  if (predicted_winner !== match.player1_name && predicted_winner !== match.player2_name) {
    return res.status(400).json({ error: 'Predicted winner must be one of the match players' });
  }

  const id = nanoid(12);
  db.prepare(`
    INSERT INTO predictions (id, user_id, match_id, predicted_winner, predicted_sets, predicted_score, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id, match_id) DO UPDATE SET
      predicted_winner = excluded.predicted_winner,
      predicted_sets = excluded.predicted_sets,
      predicted_score = excluded.predicted_score,
      updated_at = CURRENT_TIMESTAMP
  `).run(id, user_id, match_id, predicted_winner, predicted_sets || null, predicted_score || null);

  res.json({ success: true });
});

// Get user's predictions for a tournament
// Note: you can only see your OWN predictions. For other users, predictions
// are only visible via the league activity/h2h endpoints which filter by deadline.
app.get('/api/predictions/:userId/:tournamentId', (req, res) => {
  const db = getDb();
  // requesting_user reserved for future cross-user visibility

  // Only allow viewing your own predictions (or all if you're requesting your own)
  // Other users' predictions are visible through league endpoints after deadline
  const predictions = db.prepare(`
    SELECT p.*, m.player1_name, m.player2_name, m.player1_seed, m.player2_seed,
           m.winner_name, m.score as actual_score, m.sets_played, m.status as match_status,
           r.name as round_name, r.prediction_deadline, e.code as event_code
    FROM predictions p
    JOIN matches m ON p.match_id = m.id
    JOIN rounds r ON m.round_id = r.id
    JOIN events e ON r.event_id = e.id
    WHERE p.user_id = ? AND e.tournament_id = ?
    ORDER BY r.round_order, m.match_order
  `).all(req.params.userId, req.params.tournamentId);

  res.json(predictions);
});

// Get all predictions for a user
app.get('/api/predictions/:userId', (req, res) => {
  const db = getDb();
  const predictions = db.prepare(`
    SELECT p.*, m.player1_name, m.player2_name, m.player1_seed, m.player2_seed,
           m.winner_name, m.score as actual_score, m.sets_played, m.status as match_status,
           r.name as round_name, r.prediction_deadline, e.code as event_code,
           t.name as tournament_name, t.id as tournament_id
    FROM predictions p
    JOIN matches m ON p.match_id = m.id
    JOIN rounds r ON m.round_id = r.id
    JOIN events e ON r.event_id = e.id
    JOIN tournaments t ON e.tournament_id = t.id
    WHERE p.user_id = ?
    ORDER BY p.created_at DESC
  `).all(req.params.userId);

  res.json(predictions);
});

// ─── LEAGUE ROUTES ────────────────────────────────────────────────────

// Create a league
app.post('/api/leagues', (req, res) => {
  const { name, buy_in, tournament_id, user_id } = req.body;
  if (!name || !user_id) {
    return res.status(400).json({ error: 'Name and user_id required' });
  }

  const db = getDb();
  const id = nanoid(12);

  // Generate unique invite code with retry on collision
  let invite_code;
  for (let attempt = 0; attempt < 10; attempt++) {
    invite_code = generateInviteCode();
    const existing = db.prepare('SELECT id FROM leagues WHERE invite_code = ?').get(invite_code);
    if (!existing) break;
    if (attempt === 9) return res.status(500).json({ error: 'Failed to generate unique invite code. Try again.' });
  }

  const createLeague = db.transaction(() => {
    db.prepare(`
      INSERT INTO leagues (id, name, invite_code, buy_in, tournament_id, created_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, name, invite_code, buy_in || 0, tournament_id || null, user_id);
    db.prepare('INSERT INTO league_members (id, league_id, user_id) VALUES (?, ?, ?)')
      .run(nanoid(12), id, user_id);
  });
  createLeague();

  res.json({ id, name, invite_code, buy_in: buy_in || 0, tournament_id });
});

// Join a league
app.post('/api/leagues/join', (req, res) => {
  const { invite_code, user_id } = req.body;
  if (!invite_code || !user_id) {
    return res.status(400).json({ error: 'Invite code and user_id required' });
  }

  const db = getDb();
  const league = db.prepare('SELECT * FROM leagues WHERE invite_code = ?').get(invite_code.toUpperCase());
  if (!league) return res.status(404).json({ error: 'League not found. Check the invite code.' });

  const existing = db.prepare('SELECT * FROM league_members WHERE league_id = ? AND user_id = ?')
    .get(league.id, user_id);
  if (existing) return res.status(409).json({ error: "You're already in this league!" });

  db.prepare('INSERT INTO league_members (id, league_id, user_id) VALUES (?, ?, ?)')
    .run(nanoid(12), league.id, user_id);

  res.json({ success: true, league: { id: league.id, name: league.name } });
});

// Leave a league
app.post('/api/leagues/leave', (req, res) => {
  const { league_id, user_id } = req.body;
  if (!league_id || !user_id) return res.status(400).json({ error: 'league_id and user_id required' });

  const db = getDb();

  // Check if user is the league creator — can't leave if you created it
  const league = db.prepare('SELECT * FROM leagues WHERE id = ?').get(league_id);
  if (!league) return res.status(404).json({ error: 'League not found' });
  if (league.created_by === user_id) {
    return res.status(400).json({ error: "You can't leave a league you created. Transfer ownership or delete it." });
  }

  db.prepare('DELETE FROM league_members WHERE league_id = ? AND user_id = ?')
    .run(league_id, user_id);

  res.json({ success: true });
});

// Get user's leagues
app.get('/api/leagues/user/:userId', (req, res) => {
  const db = getDb();
  const leagues = db.prepare(`
    SELECT l.*,
      (SELECT COUNT(*) FROM league_members WHERE league_id = l.id) as member_count,
      t.name as tournament_name
    FROM leagues l
    JOIN league_members lm ON l.id = lm.league_id
    LEFT JOIN tournaments t ON l.tournament_id = t.id
    WHERE lm.user_id = ?
    ORDER BY l.created_at DESC
  `).all(req.params.userId);

  res.json(leagues);
});

// Get league detail with leaderboard
app.get('/api/leagues/:id', (req, res) => {
  const db = getDb();
  const league = db.prepare(`
    SELECT l.*, t.name as tournament_name
    FROM leagues l
    LEFT JOIN tournaments t ON l.tournament_id = t.id
    WHERE l.id = ?
  `).get(req.params.id);

  if (!league) return res.status(404).json({ error: 'League not found' });

  // Get members with total points — scoped to the league's tournament if set
  const members = db.prepare(`
    SELECT u.id, u.display_name, u.avatar,
      COALESCE(SUM(p.points_earned), 0) as total_points,
      COUNT(p.id) as predictions_made
    FROM league_members lm
    JOIN users u ON lm.user_id = u.id
    LEFT JOIN predictions p ON p.user_id = u.id AND p.is_scored = 1
      AND (? IS NULL OR p.match_id IN (
        SELECT m.id FROM matches m
        JOIN rounds r ON m.round_id = r.id
        JOIN events e ON r.event_id = e.id
        WHERE e.tournament_id = ?
      ))
    WHERE lm.league_id = ?
    GROUP BY u.id
    ORDER BY total_points DESC, u.display_name ASC
  `).all(league.tournament_id, league.tournament_id, league.id);

  league.members = members;
  res.json(league);
});

// ─── ADMIN ROUTES ─────────────────────────────────────────────────────

// Simple admin auth: require admin_key header or check if user is first registered (admin)
const ADMIN_KEY = process.env.ADMIN_KEY || 'courtcall-admin-2026';

function isAdminUser(userId) {
  if (!userId) return false;
  const db = getDb();
  const user = db.prepare('SELECT id, username, is_admin FROM users WHERE id = ?').get(userId);
  if (!user) return false;
  // DB flag
  if (user.is_admin) return true;
  // ADMIN_USERS env var
  const adminUsers = (process.env.ADMIN_USERS || '').split(',').map(u => u.trim().toLowerCase()).filter(Boolean);
  if (adminUsers.includes(user.username.toLowerCase())) return true;
  // First real registered user (not demo)
  const firstReal = db.prepare("SELECT id FROM users WHERE username != 'demo' ORDER BY created_at ASC LIMIT 1").get();
  if (firstReal && firstReal.id === userId) return true;
  return false;
}

function adminAuth(req, res, next) {
  if (req.headers['x-admin-key'] === ADMIN_KEY) return next();
  const userId = req.body?.user_id || req.query?.user_id;
  if (isAdminUser(userId)) return next();
  return res.status(403).json({ error: 'Admin access required.' });
}

// List all users
app.get('/api/admin/users', adminAuth, (_req, res) => {
  const db = getDb();
  const users = db.prepare("SELECT id, username, display_name, avatar, created_at, is_admin FROM users ORDER BY created_at ASC").all();
  const firstReal = db.prepare("SELECT id FROM users WHERE username != 'demo' ORDER BY created_at ASC LIMIT 1").get();
  const adminUsers = (process.env.ADMIN_USERS || '').split(',').map(u => u.trim().toLowerCase()).filter(Boolean);
  res.json(users.map(u => ({
    ...u,
    is_admin: !!(u.is_admin || adminUsers.includes(u.username.toLowerCase()) || (firstReal && firstReal.id === u.id)),
    is_env_admin: adminUsers.includes(u.username.toLowerCase()) || (firstReal && firstReal.id === u.id),
  })));
});

// Set or revoke admin for a user
app.post('/api/admin/users/:id/set-admin', adminAuth, (req, res) => {
  const db = getDb();
  const { admin } = req.body;
  db.prepare('UPDATE users SET is_admin = ? WHERE id = ?').run(admin ? 1 : 0, req.params.id);
  res.json({ success: true });
});

// Add a tournament
app.post('/api/admin/tournaments', adminAuth, (req, res) => {
  const { name, club, province, dates, surface, ti_url } = req.body;
  if (!name || !club || !dates) {
    return res.status(400).json({ error: 'Name, club, and dates required' });
  }

  const db = getDb();
  const id = name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

  db.prepare(`
    INSERT OR IGNORE INTO tournaments (id, name, club, province, dates, surface, ti_url)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, name, club, province || 'Ulster', dates, surface || 'Hard', ti_url || null);

  res.json({ id, name });
});

// Add an event to a tournament
app.post('/api/admin/events', adminAuth, (req, res) => {
  const { tournament_id, code, name, draw_size } = req.body;
  if (!tournament_id || !code) return res.status(400).json({ error: 'tournament_id and code required' });

  const db = getDb();
  const tournament = db.prepare('SELECT id FROM tournaments WHERE id = ?').get(tournament_id);
  if (!tournament) return res.status(404).json({ error: 'Tournament not found' });

  const id = `${tournament_id}-${code}`.toLowerCase().replace(/[^a-z0-9-]/g, '');

  db.prepare('INSERT OR REPLACE INTO events (id, tournament_id, code, name, draw_size) VALUES (?, ?, ?, ?, ?)')
    .run(id, tournament_id, code, name || code, draw_size || 8);

  res.json({ id });
});

// Add a round to an event
app.post('/api/admin/rounds', adminAuth, (req, res) => {
  const { event_id, name, round_order, prediction_deadline } = req.body;
  if (!event_id || !name) return res.status(400).json({ error: 'event_id and name required' });

  const db = getDb();
  const event = db.prepare('SELECT id FROM events WHERE id = ?').get(event_id);
  if (!event) return res.status(404).json({ error: 'Event not found' });

  const id = nanoid(12);
  const deadline = prediction_deadline || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  db.prepare('INSERT INTO rounds (id, event_id, name, round_order, prediction_deadline) VALUES (?, ?, ?, ?, ?)')
    .run(id, event_id, name, round_order || 1, deadline);

  res.json({ id });
});

// Add matches to a round (batch)
app.post('/api/admin/matches', adminAuth, (req, res) => {
  const { round_id, matches } = req.body;
  if (!round_id || !matches?.length) {
    return res.status(400).json({ error: 'round_id and matches array required' });
  }

  const db = getDb();
  const round = db.prepare('SELECT id FROM rounds WHERE id = ?').get(round_id);
  if (!round) return res.status(404).json({ error: 'Round not found' });
  const insert = db.prepare(`
    INSERT INTO matches (id, round_id, player1_name, player1_seed, player2_name, player2_seed, match_order, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'upcoming')
  `);

  const insertMany = db.transaction((matchList) => {
    for (let i = 0; i < matchList.length; i++) {
      const m = matchList[i];
      insert.run(nanoid(12), round_id, m.player1_name, m.player1_seed || null, m.player2_name, m.player2_seed || null, i + 1);
    }
  });

  insertMany(matches);
  res.json({ success: true, count: matches.length });
});

// Enter match result and score predictions
// Supports: normal results, walkovers (w/o), retirements (ret.), and byes
app.post('/api/admin/results', adminAuth, (req, res) => {
  const { match_id, winner_name, score, sets_played, result_type } = req.body;
  // result_type: 'normal' (default), 'walkover', 'retirement', 'bye'
  if (!match_id || !winner_name) {
    return res.status(400).json({ error: 'match_id and winner_name required' });
  }

  const db = getDb();
  const type = result_type || 'normal';

  // Validate match exists and winner is one of the players
  const existingMatch = db.prepare('SELECT * FROM matches WHERE id = ?').get(match_id);
  if (!existingMatch) return res.status(404).json({ error: 'Match not found' });
  if (winner_name !== existingMatch.player1_name && winner_name !== existingMatch.player2_name) {
    return res.status(400).json({ error: `Winner must be "${existingMatch.player1_name}" or "${existingMatch.player2_name}"` });
  }

  // Build display score
  let displayScore = score || null;
  if (type === 'walkover') displayScore = 'W/O';
  if (type === 'retirement') displayScore = score ? `${score} ret.` : 'ret.';
  if (type === 'bye') displayScore = 'Bye';

  // Update match
  db.prepare(`
    UPDATE matches SET winner_name = ?, score = ?, sets_played = ?, status = 'completed'
    WHERE id = ?
  `).run(winner_name, displayScore, sets_played || null, match_id);

  // Get the full match info for scoring
  const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(match_id);

  // Get all predictions for this match
  const predictions = db.prepare('SELECT * FROM predictions WHERE match_id = ?').all(match_id);

  // Score them
  const results = scoreMatchPredictions(predictions, match);

  // Update prediction scores
  const update = db.prepare('UPDATE predictions SET points_earned = ?, is_scored = 1 WHERE id = ?');
  const updateAll = db.transaction((resultList) => {
    for (const r of resultList) {
      update.run(r.points, r.predictionId);
    }
  });

  updateAll(results);

  // Auto-update tournament status if all matches are completed
  const tournamentInfo = db.prepare(`
    SELECT e.tournament_id FROM events e
    JOIN rounds r ON r.event_id = e.id
    WHERE r.id = (SELECT round_id FROM matches WHERE id = ?)
  `).get(match_id);

  if (tournamentInfo) {
    const remaining = db.prepare(`
      SELECT COUNT(*) as c FROM matches m
      JOIN rounds r ON m.round_id = r.id
      JOIN events e ON r.event_id = e.id
      WHERE e.tournament_id = ? AND m.status != 'completed' AND m.player1_name != 'TBD'
    `).get(tournamentInfo.tournament_id);

    if (remaining.c === 0) {
      db.prepare("UPDATE tournaments SET status = 'completed' WHERE id = ?").run(tournamentInfo.tournament_id);
    } else {
      db.prepare("UPDATE tournaments SET status = 'active' WHERE id = ? AND status = 'upcoming'").run(tournamentInfo.tournament_id);
    }
  }

  res.json({
    success: true,
    scored: results.length,
    results: results.map(r => ({
      userId: r.userId,
      points: r.points,
      breakdown: r.breakdown,
    })),
  });
});

// ─── SCORING INFO ─────────────────────────────────────────────────────
app.get('/api/scoring', (_req, res) => {
  res.json(SCORING);
});

// ─── REACTIONS ────────────────────────────────────────────────────────

// Add/update a reaction on a prediction
app.post('/api/reactions', (req, res) => {
  const { prediction_id, user_id, emoji } = req.body;
  if (!prediction_id || !user_id || !emoji) {
    return res.status(400).json({ error: 'prediction_id, user_id, and emoji required' });
  }

  const allowed = ['😂', '🔥', '💀', '👏', '🤡', '😤', '💪', '🧠'];
  if (!allowed.includes(emoji)) {
    return res.status(400).json({ error: 'Invalid emoji' });
  }

  const db = getDb();
  const id = nanoid(12);

  // Upsert — one reaction per user per prediction
  db.prepare(`
    INSERT INTO reactions (id, prediction_id, user_id, emoji)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(prediction_id, user_id) DO UPDATE SET emoji = excluded.emoji
  `).run(id, prediction_id, user_id, emoji);

  res.json({ success: true });
});

// Remove a reaction
app.delete('/api/reactions', (req, res) => {
  const { prediction_id, user_id } = req.body;
  if (!prediction_id || !user_id) {
    return res.status(400).json({ error: 'prediction_id and user_id required' });
  }

  const db = getDb();
  db.prepare('DELETE FROM reactions WHERE prediction_id = ? AND user_id = ?')
    .run(prediction_id, user_id);

  res.json({ success: true });
});

// Get reactions for a set of predictions (batch)
app.get('/api/reactions/:predictionIds', (req, res) => {
  const db = getDb();
  const ids = req.params.predictionIds.split(',').filter(Boolean);
  if (ids.length === 0) return res.json({});

  const placeholders = ids.map(() => '?').join(',');
  const reactions = db.prepare(`
    SELECT r.*, u.display_name, u.avatar as user_avatar
    FROM reactions r
    JOIN users u ON r.user_id = u.id
    WHERE r.prediction_id IN (${placeholders})
  `).all(...ids);

  // Group by prediction_id
  const grouped = {};
  for (const r of reactions) {
    if (!grouped[r.prediction_id]) grouped[r.prediction_id] = [];
    grouped[r.prediction_id].push(r);
  }

  res.json(grouped);
});

// ─── HEAD-TO-HEAD ─────────────────────────────────────────────────────
// Compare two users' predictions on the same matches
app.get('/api/h2h/:userId1/:userId2', (req, res) => {
  const db = getDb();
  const { userId1, userId2 } = req.params;
  const tournamentId = req.query.tournament || null;

  // Get all matches where both users made predictions
  let query = `
    SELECT
      p1.match_id,
      p1.predicted_winner as user1_pick,
      p1.points_earned as user1_points,
      p2.predicted_winner as user2_pick,
      p2.points_earned as user2_points,
      m.player1_name, m.player2_name, m.winner_name, m.score,
      m.status as match_status,
      r.name as round_name, e.code as event_code, t.name as tournament_name
    FROM predictions p1
    JOIN predictions p2 ON p1.match_id = p2.match_id
    JOIN matches m ON p1.match_id = m.id
    JOIN rounds r ON m.round_id = r.id
    JOIN events e ON r.event_id = e.id
    JOIN tournaments t ON e.tournament_id = t.id
    WHERE p1.user_id = ? AND p2.user_id = ?
  `;
  const params = [userId1, userId2];

  if (tournamentId) {
    query += ' AND e.tournament_id = ?';
    params.push(tournamentId);
  }

  query += ' ORDER BY m.created_at DESC';

  const matches = db.prepare(query).all(...params);

  // Filter out pre-deadline predictions — only show picks after deadline or match completed
  const visibleMatches = matches.map(m => {
    // If match is completed, show everything
    if (m.match_status === 'completed') return m;
    // Otherwise redact picks
    return { ...m, user1_pick: '🔒', user2_pick: '🔒', user1_points: 0, user2_points: 0 };
  });

  // Calculate summary from completed matches only
  const scored = visibleMatches.filter(m => m.match_status === 'completed');
  const user1Wins = scored.filter(m => m.user1_points > m.user2_points).length;
  const user2Wins = scored.filter(m => m.user2_points > m.user1_points).length;
  const draws = scored.filter(m => m.user1_points === m.user2_points).length;
  const user1Total = scored.reduce((a, m) => a + (m.user1_points || 0), 0);
  const user2Total = scored.reduce((a, m) => a + (m.user2_points || 0), 0);

  // Get user names
  const u1 = db.prepare('SELECT display_name, avatar FROM users WHERE id = ?').get(userId1);
  const u2 = db.prepare('SELECT display_name, avatar FROM users WHERE id = ?').get(userId2);

  res.json({
    user1: { id: userId1, ...u1, totalPoints: user1Total, matchesWon: user1Wins },
    user2: { id: userId2, ...u2, totalPoints: user2Total, matchesWon: user2Wins },
    draws,
    totalMatches: scored.length,
    matches: scored.slice(0, 20),
  });
});

// ─── LEAGUE ACTIVITY FEED ─────────────────────────────────────────────
app.get('/api/leagues/:id/activity', (req, res) => {
  const db = getDb();
  const league = db.prepare('SELECT * FROM leagues WHERE id = ?').get(req.params.id);
  if (!league) return res.status(404).json({ error: 'League not found' });

  // Get recent predictions by league members
  // Before deadline: show that someone predicted, but hide WHO they picked
  // After deadline/completed: show full details
  const activity = db.prepare(`
    SELECT p.*, u.display_name, u.avatar,
      m.player1_name, m.player2_name, m.winner_name, m.status as match_status,
      r.name as round_name, r.prediction_deadline, e.code as event_code
    FROM predictions p
    JOIN league_members lm ON p.user_id = lm.user_id AND lm.league_id = ?
    JOIN users u ON p.user_id = u.id
    JOIN matches m ON p.match_id = m.id
    JOIN rounds r ON m.round_id = r.id
    JOIN events e ON r.event_id = e.id
    ${league.tournament_id ? 'WHERE e.tournament_id = ?' : ''}
    ORDER BY p.updated_at DESC
    LIMIT 30
  `).all(...[req.params.id, league.tournament_id].filter(Boolean));

  // Redact picks that are still before deadline
  const now = new Date();
  const redacted = activity.map(a => {
    const deadline = new Date(a.prediction_deadline);
    if (now < deadline && a.match_status === 'upcoming') {
      return {
        ...a,
        predicted_winner: '🔒 Hidden',
        predicted_score: null,
        predicted_sets: null,
      };
    }
    return a;
  });

  res.json(redacted);
});

// ─── TOURNAMENT DISCOVERY ─────────────────────────────────────────────

// List pending discovered tournaments
app.get('/api/admin/discovered', adminAuth, (_req, res) => {
  const db = getDb();
  const { inferCircuitFromLocation } = require('./scraper');
  const items = db.prepare(
    "SELECT * FROM discovered_tournaments WHERE status = 'pending' ORDER BY start_date ASC NULLS LAST, discovered_at DESC"
  ).all();
  // Backfill suggested_circuit_id on-the-fly for rows stored before location extraction was added
  const enriched = items.map(item => {
    if (item.suggested_circuit_id) return item;
    const inferred = inferCircuitFromLocation(item.location);
    if (inferred) {
      db.prepare("UPDATE discovered_tournaments SET suggested_circuit_id = ? WHERE id = ?").run(inferred, item.id);
      return { ...item, suggested_circuit_id: inferred };
    }
    return item;
  });
  res.json(enriched);
});

// Manually trigger discovery (optionally with a custom URL)
app.post('/api/admin/discover', adminAuth, async (req, res) => {
  const { url } = req.body;
  try {
    const { discoverNewTournaments } = require('./scraper');
    const result = await discoverNewTournaments(url || undefined);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Approve a discovery — creates the tournament, links it, and kicks off a draw scrape
app.post('/api/admin/discovered/:id/approve', adminAuth, async (req, res) => {
  const db = getDb();
  const { circuit_id, surface, province } = req.body;

  const disc = db.prepare('SELECT * FROM discovered_tournaments WHERE id = ?').get(req.params.id);
  if (!disc) return res.status(404).json({ error: 'Not found' });

  const tournId = nanoid(12);
  db.prepare(`
    INSERT INTO tournaments (id, name, club, province, dates, surface, status, ti_url, circuit_id)
    VALUES (?, ?, ?, ?, ?, ?, 'upcoming', ?, ?)
  `).run(tournId, disc.name, 'TBC', province || 'Ulster', 'TBC', surface || 'Hard', disc.ti_url, circuit_id || null);

  db.prepare("UPDATE discovered_tournaments SET status = 'approved' WHERE id = ?").run(disc.id);

  // Kick off draw scrape in background (don't await — respond immediately)
  const guidMatch = disc.ti_url && disc.ti_url.match(/([A-F0-9]{8}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{12})/i);
  if (guidMatch) {
    const { scrapeTournamentDraws } = require('./scraper');
    scrapeTournamentDraws(guidMatch[1], tournId).catch(err =>
      console.error(`Auto-scrape after approve failed for ${disc.name}: ${err.message}`)
    );
  }

  res.json({ success: true, tournament_id: tournId });
});

// Dismiss a discovery (won't appear again)
app.post('/api/admin/discovered/:id/dismiss', adminAuth, (req, res) => {
  const db = getDb();
  db.prepare("UPDATE discovered_tournaments SET status = 'dismissed' WHERE id = ?").run(req.params.id);
  res.json({ success: true });
});

// ─── SCRAPER INTEGRATION ──────────────────────────────────────────────
const { addScraperRoutes, startScheduledScraper } = require('./scraper');
addScraperRoutes(app, adminAuth);
startScheduledScraper();

// Auto-scraper (Puppeteer-based) — only load if puppeteer is available
try {
  const { addAutoScraperRoutes } = require('./scraper-auto');
  addAutoScraperRoutes(app, adminAuth);
  console.log('  ✅ Puppeteer auto-scraper loaded');
} catch (e) {
  console.log('  ℹ️  Puppeteer not installed — auto-scraper disabled (npm install puppeteer to enable)');
}

// ─── STATUS PAGE ──────────────────────────────────────────────────────
app.get('/status', (_req, res) => {
  const db = getDb();

  const circuits   = db.prepare('SELECT id, name, is_public FROM circuits').all();
  const users      = db.prepare("SELECT id, username, display_name, is_admin, created_at FROM users WHERE username != 'demo'").all();
  const tournaments = db.prepare('SELECT id, name, status, circuit_id FROM tournaments ORDER BY status, name').all();
  const events     = db.prepare('SELECT id, tournament_id, code, name FROM events').all();
  const matches    = db.prepare(`
    SELECT m.id, m.player1_name, m.player2_name, m.status, m.winner_name, m.score,
           r.name as round_name, e.tournament_id
    FROM matches m
    JOIN rounds r ON m.round_id = r.id
    JOIN events e ON r.event_id = e.id
    ORDER BY e.tournament_id, r.round_order, m.match_order
  `).all();
  const predictions = db.prepare(`
    SELECT p.id, u.username, m.player1_name, m.player2_name, p.predicted_winner,
           p.points_earned, p.is_scored
    FROM predictions p
    JOIN users u ON p.user_id = u.id
    JOIN matches m ON p.match_id = m.id
    ORDER BY p.created_at DESC
    LIMIT 100
  `).all();
  const leagues    = db.prepare('SELECT id, name, invite_code, circuit_id FROM leagues').all();

  const esc = (s) => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  const table = (headers, rows) => `
    <table>
      <thead><tr>${headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead>
      <tbody>${rows.length ? rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${headers.length}" class="empty">none</td></tr>`}</tbody>
    </table>`;

  const section = (title, content) => `<section><h2>${esc(title)}</h2>${content}</section>`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>CourtCall Status</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0d1117; color: #c9d1d9; padding: 24px; }
  h1 { color: #00e87b; font-size: 22px; margin-bottom: 4px; }
  .meta { color: #6e7681; font-size: 13px; margin-bottom: 28px; }
  section { margin-bottom: 32px; }
  h2 { color: #58a6ff; font-size: 15px; font-weight: 600; margin-bottom: 10px; padding-bottom: 6px; border-bottom: 1px solid #21262d; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { background: #161b22; color: #8b949e; text-align: left; padding: 6px 10px; font-weight: 500; }
  td { padding: 5px 10px; border-bottom: 1px solid #21262d; color: #c9d1d9; white-space: nowrap; max-width: 260px; overflow: hidden; text-overflow: ellipsis; }
  tr:hover td { background: #161b22; }
  td.empty { color: #6e7681; font-style: italic; text-align: center; }
  .badge { display: inline-block; padding: 1px 7px; border-radius: 4px; font-size: 11px; font-weight: 600; }
  .badge-active { background: rgba(0,232,123,0.15); color: #00e87b; }
  .badge-upcoming { background: rgba(88,166,255,0.15); color: #58a6ff; }
  .badge-completed { background: rgba(110,118,129,0.15); color: #8b949e; }
  .counts { display: flex; gap: 20px; flex-wrap: wrap; margin-bottom: 28px; }
  .count-card { background: #161b22; border: 1px solid #21262d; border-radius: 8px; padding: 12px 18px; }
  .count-card .n { font-size: 26px; font-weight: 700; color: #00e87b; line-height: 1; }
  .count-card .l { font-size: 12px; color: #6e7681; margin-top: 2px; }
</style>
</head>
<body>
<h1>🎾 CourtCall Status</h1>
<div class="meta">Generated ${new Date().toUTCString()}</div>

<div class="counts">
  ${[
    [circuits.length, 'Circuits'],
    [users.length, 'Users'],
    [tournaments.length, 'Tournaments'],
    [matches.length, 'Matches'],
    [matches.filter(m => m.status === 'completed').length, 'Completed'],
    [predictions.length > 100 ? '100+' : predictions.length, 'Predictions (recent)'],
    [leagues.length, 'Leagues'],
  ].map(([n, l]) => `<div class="count-card"><div class="n">${esc(n)}</div><div class="l">${esc(l)}</div></div>`).join('')}
</div>

${section('Circuits', table(
  ['ID', 'Name', 'Public'],
  circuits.map(c => [c.id, c.name, c.is_public ? 'yes' : 'no'])
))}

${section(`Users (${users.length})`, table(
  ['ID', 'Username', 'Display Name', 'Admin', 'Joined'],
  users.map(u => [u.id, u.username, u.display_name, u.is_admin ? '✓' : '', u.created_at])
))}

${section(`Tournaments (${tournaments.length})`, table(
  ['ID', 'Name', 'Status', 'Circuit'],
  tournaments.map(t => [t.id, t.name, t.status, t.circuit_id || ''])
))}

${section(`Events (${events.length})`, table(
  ['ID', 'Tournament', 'Code', 'Name'],
  events.map(e => [e.id, e.tournament_id, e.code, e.name])
))}

${section(`Matches (${matches.length})`, table(
  ['Tournament', 'Round', 'Player 1', 'Player 2', 'Status', 'Winner', 'Score'],
  matches.map(m => [m.tournament_id, m.round_name, m.player1_name, m.player2_name, m.status, m.winner_name || '', m.score || ''])
))}

${section(`Leagues (${leagues.length})`, table(
  ['ID', 'Name', 'Invite Code', 'Circuit'],
  leagues.map(l => [l.id, l.name, l.invite_code, l.circuit_id || ''])
))}

${section(`Recent Predictions (last 100)`, table(
  ['User', 'Match', 'Predicted', 'Points', 'Scored'],
  predictions.map(p => [p.username, `${p.player1_name} v ${p.player2_name}`, p.predicted_winner, p.points_earned ?? '', p.is_scored ? 'yes' : 'no'])
))}
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html');
  res.send(html);
});

// ─── API 404 handler (must come before SPA fallback) ──────────────────
app.all('/api/*', (_req, res) => {
  res.status(404).json({ error: 'API endpoint not found' });
});

// ─── SPA FALLBACK ─────────────────────────────────────────────────────
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'client', 'dist', 'index.html'));
});

// ─── GLOBAL ERROR HANDLER ─────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// Prevent process crash on unhandled errors
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});

// ─── START ────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🎾 CourtCall server running on http://localhost:${PORT}`);
  console.log(`   API: http://localhost:${PORT}/api`);
  console.log(`   Admin: POST to /api/admin/* endpoints`);
  console.log(`   Scraper commands:`);
  console.log(`     npm run scrape              — scrape all linked tournaments once`);
  console.log(`     npm run scrape:daemon        — run scraper on 4-hour loop`);
  console.log(`     npm run scrape:tournament ID — scrape specific tournament\n`);
});
