/**
 * CourtCall — Automated TI Scraper Service
 *
 * Uses Puppeteer (headless Chrome) to visit ti.tournamentsoftware.com
 * as a normal browser user and extract draw/result data automatically.
 *
 * Runs on a schedule:
 *   - Checks for new draws once daily
 *   - During tournament week, checks for results every 2 hours
 *   - Rate-limited: 3-5 second delays between page loads
 *
 * Usage:
 *   node scraper-auto.js              # Run once (manual trigger)
 *   node scraper-auto.js --daemon     # Run as background service
 *   node scraper-auto.js --tournament ballycastle-2026   # Scrape specific tournament
 */

const puppeteer = require('puppeteer');
const { getDb } = require('./db');
const { scoreMatchPredictions } = require('./scoring');
const { nanoid } = require('nanoid');

// ─── Config ─────────────────────────────────────────────────────────
const CONFIG = {
  delayBetweenPages: 3000,        // 3s between page loads (be polite)
  delayBetweenTournaments: 10000, // 10s between tournaments
  checkIntervalHours: 4,          // Check every 4 hours
  dailyCheckHour: 8,              // Daily new-draw check at 8am
  headless: true,                 // Run without visible browser
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── Browser Management ─────────────────────────────────────────────
let browser = null;

async function getBrowser() {
  if (!browser || !browser.isConnected()) {
    browser = await puppeteer.launch({
      headless: CONFIG.headless ? 'new' : false,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--window-size=1280,900',
      ],
    });
  }
  return browser;
}

async function closeBrowser() {
  if (browser) {
    await browser.close();
    browser = null;
  }
}

// ─── Page Helpers ───────────────────────────────────────────────────
async function loadPage(url) {
  const b = await getBrowser();
  const page = await b.newPage();

  await page.setUserAgent(CONFIG.userAgent);
  await page.setViewport({ width: 1280, height: 900 });

  // Accept cookies automatically
  await page.setCookie({
    name: 'st',
    value: 'l=1033&exp=99999&c=1',
    domain: '.tournamentsoftware.com',
  });

  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    // Wait a bit for any dynamic content
    await delay(1500);
  } catch (err) {
    console.error(`  Failed to load ${url}: ${err.message}`);
    await page.close();
    throw err;
  }

  // Dismiss any cookie/GDPR popups
  try {
    const acceptBtn = await page.$('button[id*="accept"], button[class*="accept"], .cookie-accept, #onetrust-accept-btn-handler');
    if (acceptBtn) await acceptBtn.click();
  } catch (e) { /* ignore */ }

  return page;
}

// ─── Tournament Page Scraper ────────────────────────────────────────
async function scrapeTournamentPage(url) {
  console.log(`  📄 Loading tournament page...`);
  const page = await loadPage(url);

  const data = await page.evaluate(() => {
    const result = {
      name: '',
      dates: '',
      venue: '',
      events: [],
    };

    // Title
    const h1 = document.querySelector('h1, .tournament-title, [class*="tournamentname"], .media-heading');
    if (h1) result.name = h1.textContent.trim();
    if (!result.name) result.name = document.title.replace(/\s*[-|–].*$/, '').trim();

    // Find all draw/event links
    const links = document.querySelectorAll('a[href]');
    links.forEach((a) => {
      const href = a.getAttribute('href') || '';
      // Draw links contain "draw" in the URL path
      if ((href.includes('draw') || href.includes('Draw')) &&
          (href.includes('sport/') || href.includes('draws'))) {
        const name = a.textContent.trim();
        if (name && name.length > 0 && name.length < 100 && !name.includes('©')) {
          result.events.push({
            name,
            url: a.href, // Full resolved URL
          });
        }
      }
    });

    // Deduplicate by URL
    const seen = new Set();
    result.events = result.events.filter((e) => {
      if (seen.has(e.url)) return false;
      seen.add(e.url);
      return true;
    });

    // Look for date/venue in info sections
    const allText = document.body.innerText;
    const dateMatch = allText.match(/(\d{1,2}[\s/-]+\w+[\s/-]+\d{4}\s*[-–to]+\s*\d{1,2}[\s/-]+\w+[\s/-]+\d{4})/i);
    if (dateMatch) result.dates = dateMatch[1].trim();

    return result;
  });

  await page.close();
  return data;
}

// ─── Draw Page Scraper ──────────────────────────────────────────────
async function scrapeDrawPage(url) {
  console.log(`  📋 Loading draw page...`);
  const page = await loadPage(url);

  const data = await page.evaluate(() => {
    const result = {
      eventName: '',
      matches: [],
    };

    // Event name from active nav/tab
    const activeEl = document.querySelector('.nav-link.active, .active a, [class*="selected"], [class*="current"]');
    if (activeEl) result.eventName = activeEl.textContent.trim();
    if (!result.eventName) {
      const h2 = document.querySelector('h2, h3, .draw-title');
      if (h2) result.eventName = h2.textContent.trim();
    }

    // ─── Extract players from the page ────────────────────────────
    // TournamentSoftware uses player links: <a href="...player.aspx?...">Name</a>
    // or in newer versions: <a href="/player/GUID/...">Name</a>
    const playerLinks = document.querySelectorAll(
      'a[href*="player.aspx"], a[href*="/player/"], a[href*="Player"]'
    );

    const players = [];
    playerLinks.forEach((a) => {
      let name = a.textContent.trim();
      if (!name || name === 'Bye' || name === 'bye' || name.length < 2) return;

      // Clean seed markers from name
      name = name.replace(/[\[(]\d{1,2}[\])]/g, '').replace(/\s+/g, ' ').trim();

      // Look for seed in parent/sibling text
      const parentText = a.parentElement?.textContent || '';
      const seedMatch = parentText.match(/[\[(](\d{1,2})[\])]/);
      const seed = seedMatch ? parseInt(seedMatch[1]) : null;

      // Look for score nearby — check the closest table row or parent container
      let score = null;
      let row = a.closest('tr') || a.closest('[class*="match"]') || a.closest('div');
      if (row) {
        const rowText = row.textContent;
        const scoreMatch = rowText.match(/\b(\d-\d(?:\(\d+\))?(?:\s+\d-\d(?:\(\d+\))?){0,2})\b/);
        if (scoreMatch) score = scoreMatch[1].trim();
      }

      // Get position in DOM for pairing
      const rect = a.getBoundingClientRect();
      players.push({ name, seed, score, y: rect.top, element: null });
    });

    // ─── Pair players into matches ──────────────────────────────────
    // Sort by vertical position on page, then pair consecutive players
    players.sort((a, b) => a.y - b.y);

    // Remove obvious duplicates (same name appearing multiple times in different rounds)
    // In a draw, the first occurrence of each matchup is in the earliest round
    for (let i = 0; i < players.length - 1; i += 2) {
      const p1 = players[i];
      const p2 = players[i + 1];
      if (!p2) break;

      // Determine score — check both players' detected scores
      const score = p1.score || p2.score || null;

      // Determine winner from score
      let winner = null;
      if (score) {
        const sets = score.split(/\s+/);
        let p1Sets = 0, p2Sets = 0;
        for (const s of sets) {
          const parts = s.replace(/\(\d+\)/g, '').split('-').map(Number);
          if (parts.length === 2) {
            if (parts[0] > parts[1]) p1Sets++;
            else if (parts[1] > parts[0]) p2Sets++;
          }
        }
        winner = p1Sets > p2Sets ? p1.name : p2Sets > p1Sets ? p2.name : null;
      }

      result.matches.push({
        player1_name: p1.name,
        player1_seed: p1.seed,
        player2_name: p2.name,
        player2_seed: p2.seed,
        score: score,
        winner_name: winner,
        sets_played: score ? score.split(/\s+/).length : null,
        status: score ? 'completed' : 'upcoming',
      });
    }

    return result;
  });

  await page.close();
  return data;
}

// ─── Import Logic ───────────────────────────────────────────────────
function inferEventCode(name) {
  if (!name) return 'MS';
  const lower = name.toLowerCase();
  if (lower.includes("men's singles") || lower.includes('ms ') || lower === 'ms') return 'MS';
  if (lower.includes("women's singles") || lower.includes('ws ') || lower === 'ws') return 'WS';
  if (lower.includes("men's doubles") || lower.includes('md ') || lower === 'md') return 'MD';
  if (lower.includes("women's doubles") || lower.includes('wd ') || lower === 'wd') return 'WD';
  if (lower.includes('mixed') || lower.includes('xd')) return 'XD';
  if (lower.includes('boys') || lower.includes('u18') || lower.includes('u16') || lower.includes('u14')) return 'JBS';
  if (lower.includes('girls')) return 'JGS';
  if (lower.includes('veteran') || lower.includes('over 35') || lower.includes('over 45')) return 'VET';
  if (lower.includes('master')) return 'MAS';
  return name.replace(/[^A-Za-z0-9]/g, '').slice(0, 4).toUpperCase() || 'EVT';
}

function inferRounds(matchCount) {
  if (matchCount >= 15) return [
    { name: 'Round 1', count: 8 }, { name: 'Quarter-Finals', count: 4 },
    { name: 'Semi-Finals', count: 2 }, { name: 'Final', count: 1 },
  ];
  if (matchCount >= 7) return [
    { name: 'Quarter-Finals', count: 4 }, { name: 'Semi-Finals', count: 2 }, { name: 'Final', count: 1 },
  ];
  if (matchCount >= 3) return [
    { name: 'Semi-Finals', count: 2 }, { name: 'Final', count: 1 },
  ];
  return [{ name: 'Round 1', count: matchCount }];
}

async function importDrawToDb(tournamentId, eventName, matches) {
  const db = getDb();
  const eventCode = inferEventCode(eventName);
  const eventId = `${tournamentId}-${eventCode}`.toLowerCase().replace(/[^a-z0-9-]/g, '');

  // Create/update event
  db.prepare(`INSERT OR REPLACE INTO events (id, tournament_id, code, name, draw_size) VALUES (?, ?, ?, ?, ?)`)
    .run(eventId, tournamentId, eventCode, eventName || eventCode, matches.length * 2);

  // Check if we already have the same number of matches — skip if no change
  const existingRounds = db.prepare('SELECT id FROM rounds WHERE event_id = ?').all(eventId);
  let existingMatchCount = 0;
  let existingCompletedCount = 0;
  for (const r of existingRounds) {
    const counts = db.prepare('SELECT COUNT(*) as total, SUM(CASE WHEN status = ? THEN 1 ELSE 0 END) as completed FROM matches WHERE round_id = ?')
      .get('completed', r.id);
    existingMatchCount += counts.total;
    existingCompletedCount += counts.completed;
  }

  const newCompletedCount = matches.filter(m => m.status === 'completed').length;

  // Only re-import if match count changed or new results came in
  if (existingMatchCount === matches.length && existingCompletedCount >= newCompletedCount && existingMatchCount > 0) {
    console.log(`     ⏭️  No changes detected (${existingMatchCount} matches, ${existingCompletedCount} completed), skipping`);
    return existingMatchCount;
  }

  // Wrap the entire delete+insert in a transaction so a failed scrape
  // never leaves the DB in a half-deleted state
  const rounds = inferRounds(matches.length);
  let totalImported = 0;

  const importAll = db.transaction(() => {
    // Clear existing data — delete predictions first (FK constraint)
    for (const r of existingRounds) {
      const matchIds = db.prepare('SELECT id FROM matches WHERE round_id = ?').all(r.id);
      for (const m of matchIds) {
        db.prepare('DELETE FROM predictions WHERE match_id = ?').run(m.id);
      }
      db.prepare('DELETE FROM matches WHERE round_id = ?').run(r.id);
    }
    db.prepare('DELETE FROM rounds WHERE event_id = ?').run(eventId);

    let matchIdx = 0;
    const insertPred = db.prepare('UPDATE predictions SET points_earned = ?, is_scored = 1 WHERE id = ?');

    for (let r = 0; r < rounds.length; r++) {
      const roundId = `${eventId}-r${r + 1}`;
      const deadline = new Date();
      deadline.setDate(deadline.getDate() + (r * 2) + 1);
      deadline.setHours(23, 59, 0, 0);

      db.prepare(`INSERT INTO rounds (id, event_id, name, round_order, prediction_deadline) VALUES (?, ?, ?, ?, ?)`)
        .run(roundId, eventId, rounds[r].name, r + 1, deadline.toISOString());

      for (let m = 0; m < rounds[r].count && matchIdx < matches.length; m++) {
        const match = matches[matchIdx++];
        const matchId = nanoid(12);

        db.prepare(`
          INSERT INTO matches (id, round_id, player1_name, player1_seed, player2_name, player2_seed,
            status, winner_name, score, sets_played, match_order)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          matchId, roundId, match.player1_name, match.player1_seed || null,
          match.player2_name, match.player2_seed || null,
          match.status || 'upcoming', match.winner_name || null,
          match.score || null, match.sets_played || null, m + 1
        );
        totalImported++;

        // Auto-score any existing predictions for newly-completed matches
        if (match.status === 'completed' && match.winner_name) {
          const fullMatch = db.prepare('SELECT * FROM matches WHERE id = ?').get(matchId);
          if (!fullMatch) continue;
          const preds = db.prepare('SELECT * FROM predictions WHERE match_id = ?').all(matchId);
          if (preds.length > 0) {
            const results = scoreMatchPredictions(preds, fullMatch);
            for (const res of results) {
              insertPred.run(res.points, res.predictionId);
            }
          }
        }
      }
    }
  });

  importAll();
  return totalImported;
}

// ─── Full Tournament Scrape ─────────────────────────────────────────
async function scrapeTournament(tournamentId) {
  const db = getDb();
  const tournament = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(tournamentId);

  if (!tournament || !tournament.ti_url) {
    console.log(`  ⚠️  No TI URL for ${tournamentId}, skipping`);
    return { events: 0, matches: 0 };
  }

  const guid = tournament.ti_url.match(/([A-F0-9]{8}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{12})/i);
  if (!guid) {
    console.log(`  ⚠️  No valid GUID in URL for ${tournamentId}`);
    return { events: 0, matches: 0 };
  }

  console.log(`\n🎾 Scraping: ${tournament.name}`);
  console.log(`   URL: ${tournament.ti_url}`);

  let totalEvents = 0;
  let totalMatches = 0;

  try {
    // Step 1: Get tournament page to find events
    const tournamentUrl = `https://ti.tournamentsoftware.com/tournament/${guid[1]}`;
    const tournamentData = await scrapeTournamentPage(tournamentUrl);
    await delay(CONFIG.delayBetweenPages);

    console.log(`  Found ${tournamentData.events.length} events: ${tournamentData.events.map(e => e.name).join(', ')}`);

    if (tournamentData.events.length === 0) {
      console.log('  ⚠️  No draw links found — draw may not be published yet');
      return { events: 0, matches: 0 };
    }

    // Step 2: Scrape each event's draw
    for (const event of tournamentData.events) {
      console.log(`\n  📊 Event: ${event.name}`);

      try {
        const drawData = await scrapeDrawPage(event.url);
        await delay(CONFIG.delayBetweenPages);

        console.log(`     Found ${drawData.matches.length} matches`);

        if (drawData.matches.length > 0) {
          const imported = await importDrawToDb(tournamentId, event.name || drawData.eventName, drawData.matches);
          console.log(`     ✅ Imported ${imported} matches to database`);
          totalEvents++;
          totalMatches += imported;
        }
      } catch (err) {
        console.error(`     ❌ Error scraping ${event.name}: ${err.message}`);
      }
    }
  } catch (err) {
    console.error(`  ❌ Error: ${err.message}`);
  }

  console.log(`\n  📊 Summary: ${totalEvents} events, ${totalMatches} matches imported`);
  return { events: totalEvents, matches: totalMatches };
}

// ─── Scrape All Linked Tournaments ──────────────────────────────────
async function scrapeAll() {
  const db = getDb();
  const tournaments = db.prepare(`
    SELECT * FROM tournaments
    WHERE ti_url IS NOT NULL AND ti_url != '' AND status IN ('upcoming', 'active')
  `).all();

  if (tournaments.length === 0) {
    console.log('No tournaments linked to TI. Add ti_url to a tournament first.');
    return;
  }

  console.log(`\n${'═'.repeat(50)}`);
  console.log(`🎾 CourtCall Auto-Scraper — ${new Date().toLocaleString()}`);
  console.log(`   ${tournaments.length} tournaments to check`);
  console.log(`${'═'.repeat(50)}`);

  for (const t of tournaments) {
    await scrapeTournament(t.id);
    await delay(CONFIG.delayBetweenTournaments);
  }

  await closeBrowser();
  console.log(`\n✅ Scrape cycle complete\n`);
}

// ─── Daemon Mode ────────────────────────────────────────────────────
async function runDaemon() {
  console.log(`\n🎾 CourtCall Auto-Scraper starting in daemon mode`);
  console.log(`   Checking every ${CONFIG.checkIntervalHours} hours`);
  console.log(`   Press Ctrl+C to stop\n`);

  // Initial scrape
  await scrapeAll();

  // Schedule periodic scrapes
  const intervalMs = CONFIG.checkIntervalHours * 60 * 60 * 1000;
  setInterval(async () => {
    try {
      await scrapeAll();
    } catch (err) {
      console.error(`Scrape cycle failed: ${err.message}`);
      await closeBrowser();
    }
  }, intervalMs);
}

// ─── Express Route Integration ──────────────────────────────────────
function addAutoScraperRoutes(app, adminAuth) {
  const auth = adminAuth || ((_req, _res, next) => next());

  // Trigger manual scrape for a specific tournament
  app.post('/api/admin/auto-scrape', auth, async (req, res) => {
    const { tournament_id } = req.body;
    if (!tournament_id) return res.status(400).json({ error: 'tournament_id required' });

    try {
      const result = await scrapeTournament(tournament_id);
      await closeBrowser();
      res.json({ success: true, ...result });
    } catch (err) {
      await closeBrowser();
      res.status(500).json({ error: err.message });
    }
  });

  // Trigger scrape of all linked tournaments
  app.post('/api/admin/auto-scrape-all', auth, async (_req, res) => {
    try {
      await scrapeAll();
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}

// ─── CLI ────────────────────────────────────────────────────────────
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.includes('--daemon')) {
    runDaemon().catch((err) => {
      console.error('Fatal error:', err);
      process.exit(1);
    });
  } else if (args.includes('--tournament')) {
    const idx = args.indexOf('--tournament');
    const tournamentId = args[idx + 1];
    if (!tournamentId) {
      console.error('Provide a tournament ID: --tournament ballycastle-2026');
      process.exit(1);
    }
    scrapeTournament(tournamentId).then(() => closeBrowser()).then(() => process.exit(0));
  } else {
    scrapeAll().then(() => process.exit(0));
  }
}

module.exports = {
  scrapeTournament,
  scrapeAll,
  runDaemon,
  addAutoScraperRoutes,
  closeBrowser,
};
