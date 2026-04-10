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
function fetchPage(url, extraHeaders = {}) {
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
        ...extraHeaders,
      },
    };

    const req = client.request(options, (res) => {
      // Follow redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const redirectUrl = res.headers.location.startsWith('http')
          ? res.headers.location
          : `${parsedUrl.protocol}//${parsedUrl.hostname}${res.headers.location}`;
        return resolve(fetchPage(redirectUrl, extraHeaders));
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

/**
 * POST form data to a URL and return the response body.
 */
function postForm(url, formData) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const body = Object.entries(formData)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');

    const options = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'POST',
      headers: {
        'User-Agent': USER_AGENT,
        'Cookie': GDPR_COOKIE,
        'Accept': 'text/html,*/*',
        'Accept-Language': 'en-GB,en;q=0.9',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
        'X-Requested-With': 'XMLHttpRequest',
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} for POST ${url}`));
        } else {
          resolve(data);
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Request timeout')); });
    req.write(body);
    req.end();
  });
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

  // TI search results use: href="/sport/tournament?id=GUID" title="Name"
  // Both attributes appear on the same <a class="media__link"> tag
  const searchRegex = /href="\/sport\/tournament\?id=([A-F0-9-]{36})"[^>]*title="([^"]+)"/gi;
  let match;
  while ((match = searchRegex.exec(html)) !== null) {
    const guid = match[1];
    const name = decodeHTMLEntities(match[2].trim());
    if (!name || tournaments.find(t => t.guid === guid)) continue;

    // Extract location from the next ~800 chars (icon-marker → nav-link__value)
    const following = html.slice(match.index, match.index + 800);
    const locMatch = following.match(/icon-marker[\s\S]{1,300}?nav-link__value[^>]*>\s*([^<]+?)\s*<\/span>/);
    const location = locMatch ? decodeHTMLEntities(locMatch[1].trim()) : null;

    tournaments.push({ guid, name, location });
  }

  // Fallback: /tournament/{GUID} pattern used on some older TI pages
  const legacyRegex = /href="\/tournament\/([A-F0-9-]{36})"[^>]*>([^<]{5,80})</gi;
  while ((match = legacyRegex.exec(html)) !== null) {
    const guid = match[1];
    const name = decodeHTMLEntities(match[2].trim());
    if (name && !tournaments.find(t => t.guid === guid)) {
      tournaments.push({ guid, name, location: null });
    }
  }

  return tournaments;
}

/**
 * Infer a circuit ID from a TI location string like "Club Name | Dublin"
 * or "Club Name | BELFAST, Northern Ireland".
 *
 * Strategy: only keyword-match on the CITY part (after the | separator).
 * Matching the full string causes false positives e.g. "TENNIS" contains
 * "ENNIS" (a Munster city), so every "Tennis Club" would match Munster.
 * As a fallback, also check the full string for province-level markers
 * that can't be substrings of club names (e.g. "NORTHERN IRELAND").
 */
function inferCircuitFromLocation(location) {
  if (!location) return null;

  // Extract city portion (after the last |), otherwise use full string
  const parts = location.split('|');
  const city = (parts[parts.length - 1] || location).trim().toUpperCase();
  const full = location.toUpperCase();

  // Province-level markers checked against full string (safe — can't be club name substrings)
  if (full.includes('NORTHERN IRELAND')) return 'ti-ulster';
  if (full.includes('REPUBLIC OF IRELAND')) return null; // too vague, fall through to city

  // Ulster — NI cities/towns checked against city portion only
  const ulsterCities = [
    'BELFAST', 'LISBURN', 'ANTRIM', 'BALLYMENA', 'BALLYCLARE', 'CARRICKFERGUS',
    'NEWTOWNABBEY', 'LARNE', 'ARMAGH', 'NEWRY', 'BANBRIDGE', 'DUNGANNON',
    'COOKSTOWN', 'MAGHERAFELT', 'STRABANE', 'DERRY', 'LONDONDERRY', 'COLERAINE',
    'LIMAVADY', 'OMAGH', 'ENNISKILLEN', 'FERMANAGH', 'DOWNPATRICK', 'BANGOR',
    'NEWTOWNARDS', 'HOLYWOOD', 'HILLSBOROUGH', 'COMBER', 'BALLYNAHINCH',
    'DROMORE', 'BALLYCASTLE', 'PORTRUSH', 'PORTSTEWART', 'CASTLEDERG',
    'TYRONE', 'FERMANAGH',
  ];
  if (ulsterCities.some(k => city.includes(k))) return 'ti-ulster';

  // Leinster — Dublin & surrounding counties
  const leinsterCities = [
    'DUBLIN', 'WICKLOW', 'KILDARE', 'MEATH', 'LOUTH', 'WEXFORD',
    'KILKENNY', 'CARLOW', 'LAOIS', 'OFFALY', 'WESTMEATH', 'LONGFORD',
    'BRAY', 'GREYSTONES', 'DROGHEDA', 'DUNDALK', 'NAAS', 'NAVAN',
    'PORTLAOISE', 'MULLINGAR', 'ATHLONE', 'ARKLOW', 'GOREY',
    'DONABATE', 'SWORDS', 'MALAHIDE', 'CLONTARF', 'RATHMINES',
    'BLACKROCK', 'DUNTRY', 'CELBRIDGE', 'MAYNOOTH', 'NEWBRIDGE',
  ];
  if (leinsterCities.some(k => city.includes(k))) return 'ti-leinster';

  // Munster — Cork, Kerry, Limerick, Tipperary, Waterford, Clare
  const munsterCities = [
    'CORK', 'KERRY', 'LIMERICK', 'TIPPERARY', 'WATERFORD', 'CLARE',
    'CASHEL', 'CLONMEL', 'DUNGARVAN', 'TRALEE', 'KILLARNEY',
    'ENNIS', 'NENAGH', 'THURLES', 'KILRUSH', 'YOUGHAL', 'COBH',
    'MALLOW', 'BANTRY', 'SKIBBEREEN',
  ];
  if (munsterCities.some(k => city.includes(k))) return 'ti-munster';

  // Connacht
  const connachtCities = [
    'GALWAY', 'MAYO', 'SLIGO', 'ROSCOMMON', 'LEITRIM',
    'CASTLEBAR', 'BALLINA', 'TUAM', 'BALLINASLOE',
  ];
  if (connachtCities.some(k => city.includes(k))) return null; // no connacht circuit yet

  return null;
}

/**
 * Parse the TI draws landing page (/sport/draws.aspx?id=GUID) to find individual
 * draw event links. Each link is: draw.aspx?id=GUID&draw=N with the event name
 * as link text.
 */
function parseTournamentPage(html, tournamentGuid) {
  const events = [];

  // Draws landing page links: draw.aspx?id=GUID&draw=N (relative URL, singular draw.aspx)
  // Also handles &amp; encoding
  const drawRegex = /href="draw\.aspx\?id=([A-F0-9-]+)&(?:amp;)?draw=(\d+)"[^>]*class="nowrap">([^<]+)/gi;
  let match;
  while ((match = drawRegex.exec(html)) !== null) {
    const guid = match[1];
    const drawId = match[2];
    const eventName = decodeHTMLEntities(match[3].trim());
    if (!events.find(e => e.drawId === drawId)) {
      events.push({ tournamentGuid: guid || tournamentGuid, drawId, name: eventName });
    }
  }

  const meta = {};
  const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
  if (titleMatch) meta.title = decodeHTMLEntities(titleMatch[1].trim());

  return { events, meta };
}

/**
 * Parse the AJAX draw content returned by:
 *   GET /tournament/{GUID}/Draw/{drawId}/GetMatchesContent?tabindex=1
 *
 * Each match is a <li class="match-group__item" id="match_{N}"> block containing:
 * - Round name in <span title="ROUND NAME" class="nav-link">
 * - Two <div class="match__row [has-won]"> blocks (winner has "has-won")
 * - Player name in <span class="nav-link__value">NAME</span> inside a player link or span
 * - Score in <div class="match__result"> as <ul class="points"> blocks per set
 */
function parseDrawPage(html) {
  const matches = [];

  // Split on match blocks
  const blocks = html.split('<li class="match-group__item"').slice(1);

  for (const block of blocks) {
    // TI match ID
    const idM = block.match(/id="match_(\d+)"/);
    const tiMatchId = idM ? idM[1] : null;

    // Round name from title attribute on the nav-link span
    const roundM = block.match(/title="([^"]+)"\s+class="nav-link"/);
    const roundName = roundM ? decodeHTMLEntities(roundM[1].trim()) : 'Final';

    // Split on 'class="match__row ' (with trailing space) — this matches only the
    // two player rows ("match__row has-won" and "match__row ") and NOT the
    // sibling divs match__row-wrapper / match__row-title which use a hyphen.
    const rowParts = block.split('class="match__row ');
    const rows = rowParts.slice(1, 3); // first two rows = player 1 and player 2

    const players = rows.map(row => {
      const isWinner = row.startsWith('has-won');
      // Player name is always in nav-link__value span
      const nameM = row.match(/nav-link__value">([^<]+)<\/span>/);
      const name = nameM ? decodeHTMLEntities(nameM[1].trim()) : 'TBD';
      return { name, isWinner };
    });

    if (players.length < 2) continue;
    if (players[0].name === 'Bye' && players[1].name === 'Bye') continue;

    // Score: each set is a <ul class="points"> with two <li class="points__cell"> values
    const resultM = block.match(/class="match__result">([\s\S]*?)(?:<div class="match__btn"|<\/div>\s*<\/div>\s*<\/li>)/);
    let score = null;
    let sets_played = null;
    if (resultM) {
      const setBlocks = [...resultM[1].matchAll(/<ul class="points">([\s\S]*?)<\/ul>/g)];
      const setScores = setBlocks.map(s => {
        const cells = [...s[1].matchAll(/points__cell[^>]*>\s*(\d+)/g)].map(c => c[1]);
        return cells.length >= 2 ? `${cells[0]}-${cells[1]}` : null;
      }).filter(Boolean);
      if (setScores.length > 0) {
        score = setScores.join(' ');
        sets_played = setScores.length;
      }
    }

    const winner = players[0].isWinner ? players[0].name
      : players[1].isWinner ? players[1].name
      : null;

    matches.push({
      tiMatchId,
      roundName,
      player1_name: players[0].name,
      player2_name: players[1].name,
      winner_name: winner,
      score,
      sets_played,
      status: winner ? 'completed' : 'upcoming',
    });
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

  // 1. Fetch the draws landing page — this lists all individual draw events
  //    URL: /sport/draws.aspx?id=GUID  (no draw= param)
  //    Contains links: draw.aspx?id=GUID&draw=N with event names as text
  const drawsLandingUrl = `${BASE_URL}/sport/draws.aspx?id=${tournamentGuid}`;
  let landingHtml;
  try {
    landingHtml = await fetchPage(drawsLandingUrl);
  } catch (err) {
    console.error(`   ❌ Failed to fetch draws landing page: ${err.message}`);
    return { events: 0, rounds: 0, matches: 0 };
  }
  await delay(REQUEST_DELAY_MS);

  const { events } = parseTournamentPage(landingHtml, tournamentGuid);
  console.log(`   Found ${events.length} draws: ${events.map(e => e.name).join(', ')}`);

  const db = getDb();
  const results = { events: 0, rounds: 0, matches: 0 };

  // Extract dates and club from landing page and update tournament record if still TBC
  const existing = db.prepare('SELECT dates, club FROM tournaments WHERE id = ?').get(tournamentId);
  if (existing && (existing.dates === 'TBC' || existing.club === 'TBC')) {
    // Dates: look for patterns like "7 April 2026 - 10 April 2026" or "07/04/2026"
    const dateM = landingHtml.match(/(\d{1,2}\s+\w+\s+\d{4})\s*[-–]\s*(\d{1,2}\s+\w+\s+\d{4})/i)
      || landingHtml.match(/(\d{1,2}\/\d{1,2}\/\d{4})\s*[-–]\s*(\d{1,2}\/\d{1,2}\/\d{4})/);
    // Club/venue: look for nav-link__value near location icon
    const clubM = landingHtml.match(/icon-marker[\s\S]{1,200}?nav-link__value[^>]*>\s*([^<|]+?)\s*\|/);
    const updates = {};
    if (dateM && existing.dates === 'TBC') updates.dates = `${dateM[1]} – ${dateM[2]}`;
    if (clubM && existing.club === 'TBC') updates.club = clubM[1].trim();
    if (Object.keys(updates).length > 0) {
      const sets = Object.entries(updates).map(([k]) => `${k} = ?`).join(', ');
      db.prepare(`UPDATE tournaments SET ${sets} WHERE id = ?`).run(...Object.values(updates), tournamentId);
      console.log(`   📅 Updated tournament metadata:`, updates);
    }
  }

  // 2. For each event, fetch AJAX draw content and import
  for (const event of events) {
    const eventCode = inferEventCode(event.name);
    // Use drawId in eventId to handle multiple draws with same code (e.g. two MS events)
    const eventId = `${tournamentId}-${eventCode}-${event.drawId}`.toLowerCase();

    db.prepare(`
      INSERT OR REPLACE INTO events (id, tournament_id, code, name, draw_size)
      VALUES (?, ?, ?, ?, ?)
    `).run(eventId, tournamentId, eventCode, event.name, 8);
    results.events++;

    // Fetch AJAX draw content (the actual bracket/results)
    const ajaxUrl = `${BASE_URL}/tournament/${event.tournamentGuid}/Draw/${event.drawId}/GetMatchesContent?tabindex=1`;
    console.log(`   Fetching ${event.name} (draw ${event.drawId})...`);

    try {
      const drawHtml = await fetchPage(ajaxUrl, { 'X-Requested-With': 'XMLHttpRequest' });
      await delay(REQUEST_DELAY_MS);

      const matches = parseDrawPage(drawHtml);
      console.log(`   Parsed ${matches.length} matches`);

      if (matches.length === 0) continue;

      // Group matches by round name, then sort rounds into correct order
      const byRound = {};
      for (const match of matches) {
        if (!byRound[match.roundName]) byRound[match.roundName] = [];
        byRound[match.roundName].push(match);
      }
      const roundOrder = Object.keys(byRound).sort(
        (a, b) => getRoundSortOrder(a) - getRoundSortOrder(b)
      );

      // Upsert rounds and matches
      for (let r = 0; r < roundOrder.length; r++) {
        const roundName = roundOrder[r];
        const slug = roundName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        const roundId = `${eventId}-${slug}`;
        const roundMatches = byRound[roundName];

        const deadline = new Date();
        deadline.setDate(deadline.getDate() + r * 2);
        deadline.setHours(23, 59, 0, 0);

        db.prepare(`
          INSERT OR IGNORE INTO rounds (id, event_id, name, round_order, prediction_deadline)
          VALUES (?, ?, ?, ?, ?)
        `).run(roundId, eventId, roundName, r + 1, deadline.toISOString());
        results.rounds++;

        for (let m = 0; m < roundMatches.length; m++) {
          const match = roundMatches[m];
          // TI box leagues use id="match_0" for all matches — not unique.
          // Fall back to player-name-based ID which is stable across re-scrapes.
          const tiIdUsable = match.tiMatchId && match.tiMatchId !== '0';
          const matchId = tiIdUsable
            ? `${eventId}-ti${match.tiMatchId}`
            : `${roundId}-${(match.player1_name + match.player2_name).replace(/\s+/g, '').toLowerCase().slice(0, 20)}`;

          db.prepare(`
            INSERT OR REPLACE INTO matches (id, round_id, player1_name, player1_seed, player2_name, player2_seed, status, winner_name, score, sets_played, match_order)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            matchId, roundId,
            match.player1_name, null,
            match.player2_name, null,
            match.status, match.winner_name || null,
            match.score || null, match.sets_played || null,
            m + 1
          );
          results.matches++;
        }
      }
    } catch (err) {
      console.error(`   ❌ Error fetching draw ${event.drawId}: ${err.message}`);
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
  // Default: preserve name without spaces up to 6 chars (e.g. "BOX A" → "BOXA", "BOX B" → "BOXB")
  return eventName.replace(/\s+/g, '').toUpperCase().slice(0, 6);
}

/**
 * Sort round names into logical tournament order.
 * "Round 1" < "Round 2" < ... < "Quarter final" < "Semi final" < "Final"
 */
function getRoundSortOrder(name) {
  const lower = name.toLowerCase();
  if (lower === 'final') return 10000;
  if (lower.includes('semi')) return 9000;
  if (lower.includes('quarter')) return 8000;
  if (lower.includes('round of 16')) return 7000;
  if (lower.includes('round of 32')) return 6000;
  const numM = lower.match(/round\s+(\d+)/);
  if (numM) return parseInt(numM[1]);
  return 5000;
}

// ─── Tournament Discovery ─────────────────────────────────────────────

/**
 * Scrape a TI search/listing page and store any new tournaments found
 * in the `discovered_tournaments` table for admin review.
 * @param {string} [searchUrl] - Override the default discovery URL
 */
async function discoverNewTournaments(searchUrl) {
  const db = getDb();
  const SEARCH_ENDPOINT = 'https://ti.tournamentsoftware.com/find/tournament/DoSearch';

  // TI loads results via AJAX POST — build month/page combos to scrape.
  // If a custom URL was supplied, extract year/month from it; otherwise scan
  // current month + next 3 months.
  let monthSlots;
  if (searchUrl) {
    const ym = searchUrl.match(/YearNr=(\d{4}).*MonthNr=(\d{1,2})/);
    if (ym) {
      monthSlots = [{ year: parseInt(ym[1]), month: parseInt(ym[2]) }];
    } else {
      // Custom URL but no recognisable params — fall through to default
      monthSlots = null;
    }
  }

  if (!monthSlots) {
    monthSlots = [];
    const now = new Date();
    for (let offset = 0; offset < 4; offset++) {
      const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
      monthSlots.push({ year: d.getFullYear(), month: d.getMonth() + 1 });
    }
  }

  const allFound = [];
  for (const { year, month } of monthSlots) {
    console.log(`🔍 Discovering tournaments for ${year}/${month}...`);
    try {
      const html = await postForm(SEARCH_ENDPOINT, {
        'Page': 1,
        'TournamentExtendedFilter.SportID': 0,
        'TournamentFilter.DateFilterType': 1,
        'TournamentFilter.YearNr': year,
        'TournamentFilter.MonthNr': month,
        'TournamentFilter.Q': '',
      });
      const found = parseTournamentList(html);
      console.log(`   Found ${found.length} tournaments`);
      allFound.push(...found);
      await delay(REQUEST_DELAY_MS);
    } catch (err) {
      console.error(`❌ Discovery failed for ${year}/${month}: ${err.message}`);
    }
  }

  // Deduplicate by GUID across all pages
  const seen = new Set();
  const unique = allFound.filter(t => {
    if (seen.has(t.guid)) return false;
    seen.add(t.guid);
    return true;
  });

  const upsert = db.prepare(`
    INSERT INTO discovered_tournaments (id, guid, name, ti_url, location, suggested_circuit_id)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(guid) DO UPDATE SET
      location = excluded.location,
      suggested_circuit_id = excluded.suggested_circuit_id
    WHERE status = 'pending'
  `);

  let newCount = 0;
  for (const t of unique) {
    // Skip if already linked to a tournament in our DB
    const linked = db.prepare("SELECT id FROM tournaments WHERE ti_url LIKE ?").get(`%${t.guid}%`);
    if (linked) continue;

    // Skip if already dismissed or approved
    const existing = db.prepare("SELECT status FROM discovered_tournaments WHERE guid = ?").get(t.guid);
    if (existing?.status === 'dismissed') continue;
    if (existing?.status === 'approved') continue;

    const suggestedCircuit = inferCircuitFromLocation(t.location);
    const isNew = !existing;
    upsert.run(nanoid(12), t.guid, t.name,
      `https://ti.tournamentsoftware.com/tournament/${t.guid}`,
      t.location || null, suggestedCircuit);
    if (isNew) newCount++;
  }

  console.log(`🔍 Discovery complete: ${unique.length} unique found, ${newCount} new`);
  return { found: unique.length, newCount };
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

  // Debug: fetch a TI tournament page and return what the parser sees
  // GET /api/admin/scrape-debug?ti_guid=GUID
  app.get('/api/admin/scrape-debug', auth, async (req, res) => {
    const { ti_guid } = req.query;
    if (!ti_guid) return res.status(400).json({ error: 'ti_guid required' });

    try {
      // Fetch the tournament page
      const tournamentUrl = `${BASE_URL}/tournament/${ti_guid}`;
      const html = await fetchPage(tournamentUrl);

      const { events } = parseTournamentPage(html);

      // Also probe draw IDs 1-5 to see which exist
      const probeResults = [];
      for (let drawId = 1; drawId <= 5; drawId++) {
        const drawUrl = `${BASE_URL}/sport/draws.aspx?id=${ti_guid}&draw=${drawId}`;
        try {
          const drawHtml = await fetchPage(drawUrl);
          const drawMatches = parseDrawPage(drawHtml);
          const titleM = drawHtml.match(/<title>([^<]{3,80})/i);
          probeResults.push({
            drawId,
            title: titleM ? titleM[1].trim() : '(no title)',
            matchesFound: drawMatches.length,
            sample: drawMatches.slice(0, 3),
          });
          await delay(REQUEST_DELAY_MS);
        } catch (e) {
          probeResults.push({ drawId, error: e.message });
          break;
        }
      }

      res.json({
        tournamentUrl,
        htmlLength: html.length,
        eventsFromTournamentPage: events,
        drawProbes: probeResults,
        // Snippet of HTML around draw links (for debugging)
        drawLinkSnippet: (() => {
          const idx = html.toLowerCase().indexOf('draws.aspx');
          return idx >= 0 ? html.slice(Math.max(0, idx - 100), idx + 200) : 'NOT FOUND in HTML';
        })(),
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
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
  inferCircuitFromLocation,
  startScheduledScraper,
  addScraperRoutes,
};
