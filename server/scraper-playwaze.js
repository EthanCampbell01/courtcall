/**
 * CourtCall — Playwaze Scraper Adapter (BUCS Tennis)
 *
 * Scrapes bucs.playwaze.com for BUCS tennis league fixtures and results.
 * Uses the same Puppeteer approach as the TournamentSoftware scraper.
 *
 * Playwaze page structure:
 *   League page: bucs.playwaze.com/{community}/{league-id}/league-display/{display-id}
 *   Contains: Tables tab (standings), Fixtures tab, Results tab
 *   Match data in table rows with team names, scores, dates
 *
 * Usage:
 *   const adapter = require('./scraper-playwaze');
 *   await adapter.scrapeLeague('bucs-tennis-25-26', 'league-display-id', 'bucs-tennis');
 */

const { getDb } = require('./db');
const { nanoid } = require('nanoid');

// Re-use browser management from scraper-auto
let puppeteer;
try { puppeteer = require('puppeteer'); } catch (e) { /* not installed */ }

const CONFIG = {
  baseUrl: 'https://bucs.playwaze.com',
  delayBetweenPages: 3000,
};

const delay = (ms) => new Promise(r => setTimeout(r, ms));

let browser = null;
async function getBrowser() {
  if (!puppeteer) throw new Error('Puppeteer not installed — run npm install puppeteer');
  if (!browser || !browser.isConnected()) {
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
  }
  return browser;
}

async function loadPage(url) {
  const b = await getBrowser();
  const page = await b.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
  await page.setViewport({ width: 1280, height: 900 });

  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
  await delay(2000); // Playwaze loads content dynamically

  // Dismiss any cookie banners
  try {
    const cookieBtn = await page.$('button[id*="accept"], .cookie-accept, [class*="consent"] button');
    if (cookieBtn) await cookieBtn.click();
    await delay(500);
  } catch (e) { /* ignore */ }

  return page;
}

/**
 * Scrape a BUCS Playwaze league page for fixtures and results.
 * Playwaze renders league data in tabs — we need the Fixtures/Results tab.
 */
async function scrapePlaywazeLeague(communitySlug, leagueUrl) {
  const url = leagueUrl.startsWith('http') ? leagueUrl : `${CONFIG.baseUrl}/${communitySlug}`;
  console.log(`  📋 Loading Playwaze league: ${url}`);

  const page = await loadPage(url);

  // Try to click the "Results" or "Fixtures" tab to load match data
  try {
    const tabs = await page.$$('button, a, [role="tab"]');
    for (const tab of tabs) {
      const text = await page.evaluate(el => el.textContent, tab);
      if (text && (text.includes('Results') || text.includes('Fixtures'))) {
        await tab.click();
        await delay(2000);
        break;
      }
    }
  } catch (e) { /* tabs might not exist */ }

  const data = await page.evaluate(() => {
    const result = {
      leagueName: '',
      teams: [],
      fixtures: [],
    };

    // League name from heading
    const heading = document.querySelector('h1, h2, [class*="title"], [class*="heading"]');
    if (heading) result.leagueName = heading.textContent.trim();

    // Parse fixture/result rows
    // Playwaze typically uses table rows or card layouts
    const rows = document.querySelectorAll('tr, [class*="fixture"], [class*="match"], [class*="result"]');

    rows.forEach(row => {
      const cells = row.querySelectorAll('td, [class*="team"], [class*="score"]');
      const links = row.querySelectorAll('a');
      const text = row.textContent.trim();

      // Look for match pattern: "Team A  3 - 1  Team B" or "Team A vs Team B"
      // Playwaze uses team names in links or spans
      if (cells.length >= 2 || (links.length >= 2 && text.includes('-'))) {
        const teamEls = row.querySelectorAll('[class*="team"], [class*="name"], a');
        const scoreEls = row.querySelectorAll('[class*="score"]');

        let team1 = '', team2 = '', score = '';

        if (teamEls.length >= 2) {
          team1 = teamEls[0].textContent.trim();
          team2 = teamEls[teamEls.length > 2 ? teamEls.length - 1 : 1].textContent.trim();
        }

        // Score pattern: look for "X - Y" in the row text
        const scoreMatch = text.match(/(\d+)\s*[-–]\s*(\d+)/);
        if (scoreMatch) {
          score = `${scoreMatch[1]}-${scoreMatch[2]}`;
        }

        // Date
        const dateEl = row.querySelector('[class*="date"], time');
        const dateText = dateEl ? dateEl.textContent.trim() : '';

        if (team1 && team2 && team1 !== team2) {
          // For BUCS tennis team matches, the "score" is rubbers won (e.g. 4-2)
          // Individual rubbers within are singles/doubles matches
          let winner = null;
          if (scoreMatch) {
            const s1 = parseInt(scoreMatch[1]);
            const s2 = parseInt(scoreMatch[2]);
            if (s1 > s2) winner = team1;
            else if (s2 > s1) winner = team2;
          }

          result.fixtures.push({
            team1: cleanTeamName(team1),
            team2: cleanTeamName(team2),
            score: score || null,
            winner: winner ? cleanTeamName(winner) : null,
            date: dateText,
            status: score ? 'completed' : 'upcoming',
          });
        }
      }
    });

    // Deduplicate
    const seen = new Set();
    result.fixtures = result.fixtures.filter(f => {
      const key = `${f.team1}-${f.team2}-${f.date}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    function cleanTeamName(name) {
      return name.replace(/\s+/g, ' ').replace(/^\d+\.\s*/, '').trim();
    }

    return result;
  });

  await page.close();
  console.log(`  Found ${data.fixtures.length} fixtures: ${data.leagueName}`);
  return data;
}

/**
 * Import Playwaze fixtures into the CourtCall database.
 * Maps team matches to our match structure.
 * For BUCS: each "match" is a team tie (e.g. Stirling vs Nottingham)
 * which contains individual rubber matches (singles/doubles).
 */
async function importPlaywazeData(circuitId, leagueData) {
  const db = getDb();

  // Create or get tournament for this league
  const tournamentId = `${circuitId}-${leagueData.leagueName || 'league'}`
    .toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').slice(0, 50);

  db.prepare(`
    INSERT OR IGNORE INTO tournaments (id, name, club, province, dates, surface, status, circuit_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    tournamentId,
    leagueData.leagueName || 'BUCS Tennis League',
    'BUCS',
    'UK',
    '2025-26 Season',
    'Indoor',
    'active',
    circuitId
  );

  // Create event
  const eventId = `${tournamentId}-team`;
  db.prepare('INSERT OR REPLACE INTO events (id, tournament_id, code, name, draw_size) VALUES (?, ?, ?, ?, ?)')
    .run(eventId, tournamentId, 'TEAM', 'Team Matches', leagueData.fixtures.length);

  // Create single round for all fixtures
  const roundId = `${eventId}-fixtures`;
  const deadline = new Date();
  deadline.setDate(deadline.getDate() + 7);

  db.prepare(`
    INSERT OR REPLACE INTO rounds (id, event_id, name, round_order, prediction_deadline)
    VALUES (?, ?, ?, ?, ?)
  `).run(roundId, eventId, 'Fixtures', 1, deadline.toISOString());

  // Clear existing matches for this round
  const existingMatches = db.prepare('SELECT id FROM matches WHERE round_id = ?').all(roundId);
  for (const m of existingMatches) {
    db.prepare('DELETE FROM predictions WHERE match_id = ?').run(m.id);
  }
  db.prepare('DELETE FROM matches WHERE round_id = ?').run(roundId);

  // Insert fixtures as matches
  let imported = 0;
  for (let i = 0; i < leagueData.fixtures.length; i++) {
    const f = leagueData.fixtures[i];
    const matchId = nanoid(12);

    db.prepare(`
      INSERT INTO matches (id, round_id, player1_name, player1_seed, player2_name, player2_seed,
        status, winner_name, score, match_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      matchId, roundId,
      f.team1, null,
      f.team2, null,
      f.status || 'upcoming',
      f.winner || null,
      f.score || null,
      i + 1
    );
    imported++;
  }

  return { tournamentId, imported };
}

module.exports = {
  scrapePlaywazeLeague,
  importPlaywazeData,
};
