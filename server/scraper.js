/**
 * CourtCall — TournamentSoftware.com Scraper
 *
 * Scrapes ti.tournamentsoftware.com for Tennis Ireland tournament data.
 * Designed to be polite: rate-limited, cached, and minimal requests.
 *
 * URL patterns discovered from existing open-source scrapers:
 *   Tournament page:  https://ti.tournamentsoftware.com/tournament/{GUID}
 *   Draw page:        https://ti.tournamentsoftware.com/sport/draws.aspx?id={GUID}&draw={DRAW_ID}
 *   Player page:      https://ti.tournamentsoftware.com/sport/player.aspx?id={GUID}&player={PLAYER_ID}
 *
 * The HTML structure uses tables for draws with player names in <a> tags
 * that link to player.aspx pages. Seeds appear in parentheses after names.
 * Match scores appear in table cells adjacent to player names.
 */

const https = require('https');
const http = require('http');
const { getDb } = require('./db');
const { nanoid } = require('nanoid');

// ─── Configuration ────────────────────────────────────────────────────
const BASE_URL = 'https://ti.tournamentsoftware.com';
const USER_AGENT = 'CourtCall/1.0 (Irish Tennis Predictions App; contact@courtcall.ie)';
const REQUEST_DELAY_MS = 2000; // 2 seconds between requests — be polite
const GDPR_COOKIE = 'st=l=1033&exp=99999&c=1'; // Consent cookie

// ─── HTTP Helper ──────────────────────────────────────────────────────
function fetchPage(url) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const client = parsedUrl.protocol === 'https:' ? https : http;

    const options = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'GET',
      headers: {
        'User-Agent': USER_AGENT,
        'Cookie': GDPR_COOKIE,
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-GB,en;q=0.9',
      },
    };

    const req = client.request(options, (res) => {
      // Follow redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const redirectUrl = res.headers.location.startsWith('http')
          ? res.headers.location
          : `${parsedUrl.protocol}//${parsedUrl.hostname}${res.headers.location}`;
        return resolve(fetchPage(redirectUrl));
      }

      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        } else {
          resolve(data);
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Request timeout')); });
    req.end();
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── HTML Parsing (no external deps — uses regex for lightweight parsing) ──
// Note: For production, consider using cheerio. This uses regex patterns
// that match tournamentsoftware.com's known HTML structure.

/**
 * Parse tournament list page to find Tennis Ireland tournaments.
 * The find page at ti.tournamentsoftware.com/find lists upcoming tournaments.
 */
function parseTournamentList(html) {
  const tournaments = [];

  // Tournament links follow pattern: /tournament/{GUID}
  const tournamentRegex = /href="\/tournament\/([A-F0-9-]+)"[^>]*>([^<]+)/gi;
  let match;
  while ((match = tournamentRegex.exec(html)) !== null) {
    const guid = match[1];
    const name = decodeHTMLEntities(match[2].trim());
    if (name && !tournaments.find(t => t.guid === guid)) {
      tournaments.push({ guid, name });
    }
  }

  return tournaments;
}

/**
 * Parse a tournament page to extract event/draw links.
 * Events (MS, WS, MD, etc.) appear as draw links on the tournament page.
 */
function parseTournamentPage(html) {
  const events = [];

  // Draw links: /sport/draws.aspx?id=GUID&draw=DRAW_ID
  const drawRegex = /href="[^"]*draws\.aspx\?id=([A-F0-9-]+)&amp;draw=(\d+)"[^>]*>([^<]+)/gi;
  let match;
  while ((match = drawRegex.exec(html)) !== null) {
    const tournamentGuid = match[1];
    const drawId = match[2];
    const eventName = decodeHTMLEntities(match[3].trim());
    events.push({ tournamentGuid, drawId, name: eventName });
  }

  // Also try alternate format without &amp;
  const drawRegex2 = /href="[^"]*draws\.aspx\?id=([A-F0-9-]+)&draw=(\d+)"[^>]*>([^<]+)/gi;
  while ((match = drawRegex2.exec(html)) !== null) {
    const tournamentGuid = match[1];
    const drawId = match[2];
    const eventName = decodeHTMLEntities(match[3].trim());
    if (!events.find(e => e.drawId === drawId)) {
      events.push({ tournamentGuid, drawId, name: eventName });
    }
  }

  // Extract tournament metadata
  const meta = {};
  const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
  if (titleMatch) meta.title = decodeHTMLEntities(titleMatch[1].trim());

  // Look for dates, venue, surface in common locations
  const venueMatch = html.match(/Venue[^:]*:\s*([^<]+)/i);
  if (venueMatch) meta.venue = decodeHTMLEntities(venueMatch[1].trim());

  const dateMatch = html.match(/(\d{1,2}\s+\w+\s+\d{4}\s*[-–]\s*\d{1,2}\s+\w+\s+\d{4})/i);
  if (dateMatch) meta.dates = dateMatch[1].trim();

  return { events, meta };
}

/**
 * Parse a draw page to extract matches with players, seeds, and scores.
 * TournamentSoftware renders draws as HTML tables where:
 * - Player names are in <a href="player.aspx?..."> tags
 * - Seeds appear as [1] or (1) after/before player names
 * - Scores appear in cells near player names when match is completed
 * - Winners are often bold or have a specific CSS class
 */
function parseDrawPage(html) {
  const matches = [];

  // Strategy: Find all player links and group them in pairs to form matches.
  // Player links: player.aspx?id=GUID&player=PLAYER_ID
  const playerRegex = /<a[^>]*href="[^"]*player\.aspx[^"]*"[^>]*>([^<]+)<\/a>/gi;
  const players = [];
  let pmatch;
  while ((pmatch = playerRegex.exec(html)) !== null) {
    const name = decodeHTMLEntities(pmatch[1].trim());
    if (name && name !== 'Bye' && name.length > 1) {
      players.push({ name, index: pmatch.index });
    }
  }

  // Extract seed info — seeds appear as [N] or (N) near player names
  const seedRegex = /[\[(](\d{1,2})[\])]\s*/g;
  const seeds = [];
  let smatch;
  while ((smatch = seedRegex.exec(html)) !== null) {
    seeds.push({ seed: parseInt(smatch[1]), index: smatch.index });
  }

  // Extract score cells — scores look like "6-4" or "6-4 6-3" or "6-4 3-6 7-5"
  const scoreRegex = /(\d-\d(?:\s+\d-\d){0,2})/g;
  const scoreMatches = [];
  let scmatch;
  while ((scmatch = scoreRegex.exec(html)) !== null) {
    scoreMatches.push({ score: scmatch[1], index: scmatch.index });
  }

  // Pair players into matches (every 2 consecutive players = 1 match)
  for (let i = 0; i < players.length - 1; i += 2) {
    const p1 = players[i];
    const p2 = players[i + 1];

    // Find closest seed to each player
    const p1Seed = findClosestSeed(seeds, p1.index, 100);
    const p2Seed = findClosestSeed(seeds, p2.index, 100);

    // Find score between these two players
    const matchScore = findClosestScore(scoreMatches, p1.index, p2.index);

    const matchData = {
      player1_name: cleanPlayerName(p1.name),
      player1_seed: p1Seed,
      player2_name: cleanPlayerName(p2.name),
      player2_seed: p2Seed,
      score: matchScore?.score || null,
      status: matchScore ? 'completed' : 'upcoming',
    };

    // Determine winner from score (player with more sets won)
    if (matchScore) {
      matchData.winner_name = determineWinner(matchData, matchScore.score);
      matchData.sets_played = matchScore.score.split(/\s+/).length;
    }

    matches.push(matchData);
  }

  return matches;
}

// ─── Helper Functions ─────────────────────────────────────────────────

function findClosestSeed(seeds, playerIndex, maxDistance) {
  let closest = null;
  let minDist = maxDistance;
  for (const s of seeds) {
    const dist = Math.abs(s.index - playerIndex);
    if (dist < minDist) {
      minDist = dist;
      closest = s.seed;
    }
  }
  return closest;
}

function findClosestScore(scoreMatches, p1Index, p2Index) {
  const midpoint = (p1Index + p2Index) / 2;
  let closest = null;
  let minDist = 500; // Max character distance to look for score
  for (const s of scoreMatches) {
    const dist = Math.abs(s.index - midpoint);
    if (dist < minDist && s.index > p1Index && s.index < p2Index + 500) {
      minDist = dist;
      closest = s;
    }
  }
  return closest;
}

function determineWinner(match, score) {
  const sets = score.split(/\s+/);
  let p1Sets = 0, p2Sets = 0;
  for (const set of sets) {
    const [s1, s2] = set.split('-').map(Number);
    if (s1 > s2) p1Sets++;
    else if (s2 > s1) p2Sets++;
  }
  return p1Sets > p2Sets ? match.player1_name : match.player2_name;
}

function cleanPlayerName(name) {
  // Remove seed markers and extra whitespace
  return name.replace(/[\[(]\d+[\])]/g, '').replace(/\s+/g, ' ').trim();
}

function decodeHTMLEntities(text) {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

// ─── High-Level Scraper Functions ─────────────────────────────────────

/**
 * Scrape a specific tournament's draws and import into the database.
 * @param {string} tournamentGuid - The GUID from the TI URL
 * @param {string} tournamentId - Our internal tournament ID
 */
async function scrapeTournamentDraws(tournamentGuid, tournamentId) {
  console.log(`🎾 Scraping draws for tournament ${tournamentGuid}...`);

  // 1. Fetch tournament page to discover events/draws
  const tournamentUrl = `${BASE_URL}/tournament/${tournamentGuid}`;
  let tournamentHtml;
  try {
    tournamentHtml = await fetchPage(tournamentUrl);
  } catch (err) {
    console.error(`   ❌ Failed to fetch tournament page: ${err.message}`);
    return { events: 0, rounds: 0, matches: 0 };
  }
  await delay(REQUEST_DELAY_MS);

  const { events } = parseTournamentPage(tournamentHtml);
  console.log(`   Found ${events.length} events: ${events.map(e => e.name).join(', ')}`);

  const db = getDb();
  const results = { events: 0, rounds: 0, matches: 0 };

  // 2. For each event, fetch the draw page
  for (const event of events) {
    const eventCode = inferEventCode(event.name);
    const eventId = `${tournamentId}-${eventCode}`.toLowerCase();

    // Insert/update event
    db.prepare(`
      INSERT OR REPLACE INTO events (id, tournament_id, code, name, draw_size)
      VALUES (?, ?, ?, ?, ?)
    `).run(eventId, tournamentId, eventCode, event.name, 8);
    results.events++;

    // Fetch draw page
    const drawUrl = `${BASE_URL}/sport/draws.aspx?id=${event.tournamentGuid}&draw=${event.drawId}`;
    console.log(`   Fetching ${eventCode} draw...`);

    try {
      const drawHtml = await fetchPage(drawUrl);
      await delay(REQUEST_DELAY_MS);

      const matches = parseDrawPage(drawHtml);
      console.log(`   Parsed ${matches.length} matches from ${eventCode}`);

      if (matches.length > 0) {
        // Determine rounds from match count
        const rounds = inferRounds(matches.length);

        let matchIdx = 0;
        for (let r = 0; r < rounds.length; r++) {
          const roundId = `${eventId}-r${r + 1}`;
          const roundMatchCount = rounds[r].matchCount;

          // Calculate deadline (day before round starts, roughly)
          const deadline = new Date();
          deadline.setDate(deadline.getDate() + r * 2);
          deadline.setHours(23, 59, 0, 0);

          db.prepare(`
            INSERT OR REPLACE INTO rounds (id, event_id, name, round_order, prediction_deadline)
            VALUES (?, ?, ?, ?, ?)
          `).run(roundId, eventId, rounds[r].name, r + 1, deadline.toISOString());
          results.rounds++;

          // Insert matches for this round
          for (let m = 0; m < roundMatchCount && matchIdx < matches.length; m++) {
            const match = matches[matchIdx++];
            const matchId = nanoid(12);

            db.prepare(`
              INSERT INTO matches (id, round_id, player1_name, player1_seed, player2_name, player2_seed, status, winner_name, score, sets_played, match_order)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              matchId, roundId,
              match.player1_name, match.player1_seed,
              match.player2_name, match.player2_seed,
              match.status, match.winner_name || null,
              match.score || null, match.sets_played || null,
              m + 1
            );
            results.matches++;
          }
        }
      }
    } catch (err) {
      console.error(`   ❌ Error fetching ${eventCode}: ${err.message}`);
    }
  }

  console.log(`✅ Import complete: ${results.events} events, ${results.rounds} rounds, ${results.matches} matches`);
  return results;
}

/**
 * Scrape results for active tournaments — checks for score updates.
 * Call this periodically during tournament week.
 */
async function scrapeResultUpdates(tournamentGuid, tournamentId) {
  console.log(`🔄 Checking for result updates...`);

  const db = getDb();

  // Get unfinished matches
  const openMatches = db.prepare(`
    SELECT m.*, r.event_id
    FROM matches m
    JOIN rounds r ON m.round_id = r.id
    JOIN events e ON r.event_id = e.id
    WHERE e.tournament_id = ? AND m.status = 'upcoming' AND m.player1_name != 'TBD'
  `).all(tournamentId);

  if (openMatches.length === 0) {
    console.log('   No open matches to check');
    return;
  }

  // Re-scrape draws to get updated scores
  // (This is the simplest approach — tournamentsoftware updates the same draw page)
  return scrapeTournamentDraws(tournamentGuid, tournamentId);
}

// ─── Round Inference ──────────────────────────────────────────────────

function inferRounds(matchCount) {
  // Standard elimination draw sizes
  if (matchCount >= 15) return [
    { name: 'Round 1', matchCount: 8 },
    { name: 'Quarter-Finals', matchCount: 4 },
    { name: 'Semi-Finals', matchCount: 2 },
    { name: 'Final', matchCount: 1 },
  ];
  if (matchCount >= 7) return [
    { name: 'Quarter-Finals', matchCount: 4 },
    { name: 'Semi-Finals', matchCount: 2 },
    { name: 'Final', matchCount: 1 },
  ];
  if (matchCount >= 3) return [
    { name: 'Semi-Finals', matchCount: 2 },
    { name: 'Final', matchCount: 1 },
  ];
  return [
    { name: 'Final', matchCount: matchCount },
  ];
}

function inferEventCode(eventName) {
  const lower = eventName.toLowerCase();
  if (lower.includes("men's singles") || lower.includes('ms ') || lower === 'ms') return 'MS';
  if (lower.includes("women's singles") || lower.includes('ws ') || lower === 'ws') return 'WS';
  if (lower.includes("men's doubles") || lower.includes('md ') || lower === 'md') return 'MD';
  if (lower.includes("women's doubles") || lower.includes('wd ') || lower === 'wd') return 'WD';
  if (lower.includes('mixed') || lower.includes('xd')) return 'XD';
  if (lower.includes('boys') || lower.includes('u18') || lower.includes('u16')) return 'JBS';
  if (lower.includes('girls')) return 'JGS';
  if (lower.includes('veteran') || lower.includes('over')) return 'VET';
  // Default: use first 3 chars uppercase
  return eventName.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase();
}

// ─── Tournament Discovery ─────────────────────────────────────────────

/**
 * Scrape a TI search/listing page and store any new tournaments found
 * in the `discovered_tournaments` table for admin review.
 * @param {string} [searchUrl] - Override the default discovery URL
 */
async function discoverNewTournaments(searchUrl) {
  const url = searchUrl || 'https://ti.tournamentsoftware.com/find';
  console.log(`🔍 Discovering tournaments from ${url}...`);

  let html;
  try {
    html = await fetchPage(url);
  } catch (err) {
    console.error(`❌ Discovery failed: ${err.message}`);
    return { found: 0, newCount: 0 };
  }

  const found = parseTournamentList(html);
  const db = getDb();

  const insert = db.prepare(`
    INSERT OR IGNORE INTO discovered_tournaments (id, guid, name, ti_url)
    VALUES (?, ?, ?, ?)
  `);

  let newCount = 0;
  for (const t of found) {
    // Skip if already linked to a tournament in our DB
    const linked = db.prepare("SELECT id FROM tournaments WHERE ti_url LIKE ?").get(`%${t.guid}%`);
    if (linked) continue;

    // Skip if already dismissed
    const existing = db.prepare("SELECT status FROM discovered_tournaments WHERE guid = ?").get(t.guid);
    if (existing?.status === 'dismissed') continue;
    if (existing) continue; // already pending or approved

    const result = insert.run(nanoid(12), t.guid, t.name, `https://ti.tournamentsoftware.com/tournament/${t.guid}`);
    if (result.changes > 0) newCount++;
  }

  console.log(`🔍 Discovery complete: ${found.length} on page, ${newCount} new`);
  return { found: found.length, newCount };
}

// ─── Scheduled Scraping ───────────────────────────────────────────────

/**
 * Start the background scraper that runs periodically.
 * - Every 4 hours: check result updates for active linked tournaments
 * - Every 24 hours: discover new tournaments from TI
 */
function startScheduledScraper() {
  const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours
  const DISCOVER_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

  console.log('⏰ Background scraper started (results every 4h, discovery every 24h)');

  async function runCheck() {
    const db = getDb();

    // Get tournaments that have a TI GUID stored
    const tournaments = db.prepare(`
      SELECT * FROM tournaments
      WHERE ti_url IS NOT NULL AND ti_url != '' AND status IN ('upcoming', 'active')
    `).all();

    for (const t of tournaments) {
      // Extract GUID from ti_url
      const guidMatch = t.ti_url.match(/([A-F0-9]{8}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{12})/i);
      if (!guidMatch) continue;

      const guid = guidMatch[1];

      try {
        // Check if we already have matches for this tournament
        const existingMatches = db.prepare(`
          SELECT COUNT(*) as c FROM matches m
          JOIN rounds r ON m.round_id = r.id
          JOIN events e ON r.event_id = e.id
          WHERE e.tournament_id = ?
        `).get(t.id);

        if (existingMatches.c === 0) {
          // No matches yet — try to scrape the draw
          console.log(`📋 Attempting to scrape draw for ${t.name}...`);
          await scrapeTournamentDraws(guid, t.id);
        } else {
          // Has matches — check for result updates
          const openMatches = db.prepare(`
            SELECT COUNT(*) as c FROM matches m
            JOIN rounds r ON m.round_id = r.id
            JOIN events e ON r.event_id = e.id
            WHERE e.tournament_id = ? AND m.status = 'upcoming'
          `).get(t.id);

          if (openMatches.c > 0) {
            console.log(`🔄 Checking result updates for ${t.name}...`);
            await scrapeResultUpdates(guid, t.id);
          }
        }

        await delay(REQUEST_DELAY_MS * 3); // Extra delay between tournaments
      } catch (err) {
        console.error(`❌ Error scraping ${t.name}: ${err.message}`);
      }
    }
  }

  async function runDiscovery() {
    try {
      await discoverNewTournaments();
    } catch (err) {
      console.error(`❌ Scheduled discovery error: ${err.message}`);
    }
  }

  // Run first check after 10 seconds
  setTimeout(runCheck, 10000);
  // Run first discovery after 30 seconds (staggered)
  setTimeout(runDiscovery, 30000);

  // Then run periodically
  setInterval(runCheck, CHECK_INTERVAL_MS);
  setInterval(runDiscovery, DISCOVER_INTERVAL_MS);
}

// ─── Express Routes (add to your server) ──────────────────────────────

function addScraperRoutes(app, adminAuth) {
  const auth = adminAuth || ((_req, _res, next) => next()); // fallback if not provided

  // Manually trigger a scrape for a tournament
  app.post('/api/admin/scrape', auth, async (req, res) => {
    const { tournament_id, ti_guid } = req.body;
    if (!tournament_id || !ti_guid) {
      return res.status(400).json({ error: 'tournament_id and ti_guid required' });
    }

    try {
      const results = await scrapeTournamentDraws(ti_guid, tournament_id);
      res.json({ success: true, ...results });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Store a TI URL for a tournament (enables auto-scraping)
  app.post('/api/admin/link-ti', auth, async (req, res) => {
    const { tournament_id, ti_url } = req.body;
    if (!tournament_id || !ti_url) {
      return res.status(400).json({ error: 'tournament_id and ti_url required' });
    }

    const db = getDb();
    db.prepare('UPDATE tournaments SET ti_url = ? WHERE id = ?').run(ti_url, tournament_id);
    res.json({ success: true });
  });

  // Check scraper status
  app.get('/api/admin/scraper-status', auth, (_req, res) => {
    const db = getDb();
    const linked = db.prepare(`
      SELECT id, name, ti_url,
        (SELECT COUNT(*) FROM matches m
          JOIN rounds r ON m.round_id = r.id
          JOIN events e ON r.event_id = e.id
          WHERE e.tournament_id = tournaments.id) as match_count,
        (SELECT COUNT(*) FROM matches m
          JOIN rounds r ON m.round_id = r.id
          JOIN events e ON r.event_id = e.id
          WHERE e.tournament_id = tournaments.id AND m.status = 'completed') as completed_count
      FROM tournaments
      WHERE ti_url IS NOT NULL AND ti_url != ''
    `).all();

    res.json({ linked_tournaments: linked });
  });
}

module.exports = {
  fetchPage,
  parseTournamentList,
  parseTournamentPage,
  parseDrawPage,
  scrapeTournamentDraws,
  scrapeResultUpdates,
  discoverNewTournaments,
  startScheduledScraper,
  addScraperRoutes,
};
