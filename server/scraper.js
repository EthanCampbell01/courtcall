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
const GDPR_COOKIE = 'st=l=1033&exp=99999&c=1';

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

// ─── HTML Parsing (regex against tournamentsoftware.com's known HTML structure) ─

/**
 * Parse tournament list page to find Tennis Ireland tournaments.
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

    const following = html.slice(match.index, match.index + 800);
    const locMatch = following.match(/icon-marker[\s\S]{1,300}?nav-link__value[^>]*>\s*([^<]+?)\s*<\/span>/);
    const location = locMatch ? decodeHTMLEntities(locMatch[1].trim()) : null;

    // Dates appear as M/D/YYYY or M/D/YYYY - M/D/YYYY
    const dateMatch = following.match(/(\d{1,2}\/\d{1,2}\/\d{4})/);
    const start_date = dateMatch ? dateMatch[1] : null;

    tournaments.push({ guid, name, location, start_date });
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

    // Scheduled time: try multiple formats TI uses
    let scheduled_time = null;

    // 1. ISO datetime attribute: datetime="2026-04-16T19:00" or datetime="2026-04-16T19:00:00"
    const isoM = block.match(/datetime="(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?::\d{2})?"/);
    if (isoM) {
      scheduled_time = isoM[1];
    }

    // 2. "Thu 16/04/2026 19:00" — day name followed by DD/MM/YYYY HH:MM (TI schedule view)
    if (!scheduled_time) {
      const daySlashM = block.match(/(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*\s+(\d{1,2})\/(\d{2})\/(\d{4})\s+(\d{2}:\d{2})/i);
      if (daySlashM) {
        const [, d, mo, yr, t] = daySlashM;
        scheduled_time = `${yr}-${mo}-${String(d).padStart(2, '0')}T${t}`;
      }
    }

    // 3. DD/MM/YYYY anywhere in the block, followed within 80 chars (including tags) by HH:MM
    if (!scheduled_time) {
      const slashM = block.match(/(\d{2})\/(\d{2})\/(\d{4})/);
      if (slashM) {
        const after = block.slice(slashM.index, slashM.index + 120);
        const timeM = after.match(/(\d{2}):(\d{2})(?!\d)/);
        if (timeM) {
          scheduled_time = `${slashM[3]}-${slashM[2]}-${slashM[1]}T${timeM[1]}:${timeM[2]}`;
        }
      }
    }


    matches.push({
      tiMatchId,
      roundName,
      player1_name: players[0].name,
      player2_name: players[1].name,
      winner_name: winner,
      score,
      sets_played,
      scheduled_time,
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
    .replace(/&#0*39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

/**
 * Try to fetch scheduled match times from TI's various schedule pages.
 * Returns a map of "player1|player2" → "YYYY-MM-DDTHH:MM".
 */
async function fetchScheduleTimes(tournamentGuid, drawId) {
  // Strategy 1: TI's GetMatchesContent AJAX endpoint with tabindex=0 (OOP/schedule tab)
  // This is the same API used for brackets (tabindex=1) but for the schedule tab.
  // It returns static HTML that we can parse without JavaScript rendering.
  try {
    const oopAjaxUrl = `${BASE_URL}/tournament/${tournamentGuid}/Draw/${drawId}/GetMatchesContent?tabindex=0`;
    const html = await fetchPage(oopAjaxUrl, { 'X-Requested-With': 'XMLHttpRequest' });
    const times = parseScheduleTimesFromHtml(html);
    if (Object.keys(times).length > 0) {
      console.log(`   🕐 tabindex=0 found ${Object.keys(times).length} times`);
      return times;
    }
    // Log the first 600 chars of text AND any dates/times found
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    console.log(`   📄 tabindex=0 (${text.length} chars): ${text.slice(0, 400)}`);
    const datesFound = (text.match(/\d{1,2}\/\d{1,2}\/\d{4}/g) || []).slice(0, 10);
    const timesFound = (text.match(/\d{2}:\d{2}/g) || []).slice(0, 10);
    if (datesFound.length) console.log(`   📅 Dates in tabindex=0: ${datesFound.join(', ')}`);
    if (timesFound.length) console.log(`   🕐 Times in tabindex=0: ${timesFound.join(', ')}`);
  } catch (err) {
    console.log(`   ⚠️  tabindex=0 failed: ${err.message}`);
  }

  // Strategy 2: Puppeteer (headless Chrome) for JavaScript-rendered times
  try {
    const { scrapeDrawScheduleTimes } = require('./scraper-auto');
    return await scrapeDrawScheduleTimes(tournamentGuid, drawId);
  } catch {
    return {};
  }
}

/**
 * Parse schedule times from TI's OOP/schedule HTML (tabindex=0 response).
 * TI puts a date/time header (h4.module-divider or similar) BEFORE each group
 * of match blocks. Walk elements in DOM order to associate each match with its time.
 */
function parseScheduleTimesFromHtml(html) {
  const times = {};

  // Extract all section headers with dates: "Thu 17/04/2026 19:00" or "17/04/2026 19:00"
  // and the player names that follow them.
  // Approach: find all date+time patterns and the player names that appear after each.

  // Split HTML into blocks by section headers
  // Section headers look like: <h4 class="module-divider">Thu 17/04/2026 19:00</h4>
  // or the date may be wrapped in spans/divs inside the h4.
  const sectionPattern = /class="[^"]*module-divider[^"]*"[^>]*>([\s\S]*?)<\/h4>/gi;
  const matchBlockPattern = /class="[^"]*match-group__item[^"]*"[^>]*>([\s\S]*?)(?=<li\s|$)/gi;

  // Parse the full doc looking for date headers and match blocks in order
  // Use a simpler regex-walk approach on the raw HTML
  let currentDateTime = null;
  let pos = 0;

  // Combined pattern: either a date header or a player name block
  const chunkPattern = /<(?:h[1-5]|[^>]*module-divider[^>]*|li[^>]*match-group__item[^>]*)>([\s\S]*?)(?=<(?:h[1-5]|li[^>]*match-group|\/(?:ul|section|main|body)))/gi;

  const items = [];
  let m;
  const combined = /<(h[1-6])[^>]*>([\s\S]*?)<\/\1>|<li[^>]*match-group__item[^>]*>([\s\S]*?)<\/li>/gi;
  while ((m = combined.exec(html)) !== null) {
    if (m[1]) {
      // Heading element
      const text = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      items.push({ type: 'heading', text });
    } else {
      // Match block
      const inner = m[3];
      items.push({ type: 'match', inner });
    }
  }

  for (const item of items) {
    if (item.type === 'heading') {
      const dm = item.text.match(/(\d{1,2})\/(\d{2})\/(\d{4})[^\d]*(\d{2}:\d{2})/);
      if (dm) {
        currentDateTime = `${dm[3]}-${dm[2]}-${dm[1].padStart(2, '0')}T${dm[4]}`;
      } else if (/not yet planned/i.test(item.text)) {
        currentDateTime = null;
      }
      continue;
    }

    // Match block — extract player names and optionally embedded date
    const inner = item.inner || '';
    const nameMatches = [...inner.matchAll(/class="[^"]*nav-link__value[^"]*"[^>]*>([^<]+)</gi)];
    const players = nameMatches
      .map(n => n[1].trim())
      .filter(n => n && n !== 'TBD' && n !== 'Bye');
    const p1 = players[0], p2 = players[1];
    if (!p1 || !p2 || p1 === p2) continue;

    // Method A: use date from section header above
    let dt = currentDateTime;

    // Method B: date embedded inside the match block itself
    if (!dt) {
      const bm = inner.replace(/<[^>]+>/g, ' ').match(/(\d{1,2})\/(\d{2})\/(\d{4})[^\d]*(\d{2}:\d{2})/);
      if (bm) dt = `${bm[3]}-${bm[2]}-${bm[1].padStart(2, '0')}T${bm[4]}`;
    }

    if (dt) times[`${p1}|${p2}`] = dt;
  }

  return times;
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
  const landingHtml = await fetchPage(drawsLandingUrl);
  await delay(REQUEST_DELAY_MS);

  const { events } = parseTournamentPage(landingHtml, tournamentGuid);
  console.log(`   Found ${events.length} draws: ${events.map(e => e.name).join(', ')}`);

  const db = getDb();
  const results = { events: 0, rounds: 0, matches: 0 };

  // Extract dates and club from landing page
  const existing = db.prepare('SELECT dates, club FROM tournaments WHERE id = ?').get(tournamentId);
  if (existing) {
    // TI uses M/D/YYYY format e.g. "3/30/2026" — collect all slash-dates and use first two
    const slashDates = landingHtml.match(/\d{1,2}\/\d{1,2}\/\d{4}/g) || [];
    // Also try written format "7 April 2026 – 10 April 2026"
    const writtenDateM = landingHtml.match(/(\d{1,2}\s+\w+\s+\d{4})\s*[-–]\s*(\d{1,2}\s+\w+\s+\d{4})/i);
    // Club: text before the | separator in the location field
    const clubM = landingHtml.match(/icon-marker[\s\S]{1,200}?nav-link__value[^>]*>\s*([^<|]+?)\s*\|/);

    const updates = {};
    if (existing.dates === 'TBC') {
      if (writtenDateM) updates.dates = `${writtenDateM[1]} – ${writtenDateM[2]}`;
      else if (slashDates.length >= 2) updates.dates = `${slashDates[0]} – ${slashDates[slashDates.length - 1]}`;
      else if (slashDates.length === 1) updates.dates = slashDates[0];
    }
    if (existing.club === 'TBC' && clubM) updates.club = clubM[1].trim();
    if (Object.keys(updates).length > 0) {
      const sets = Object.keys(updates).map(k => `${k} = ?`).join(', ');
      db.prepare(`UPDATE tournaments SET ${sets} WHERE id = ?`).run(...Object.values(updates), tournamentId);
      console.log(`   📅 Updated metadata:`, updates);
    }
  }

  // 2. Fetch all draw data into memory first — only wipe DB if we get actual matches
  const fetchedEvents = [];
  for (const event of events) {
    const eventCode = inferEventCode(event.name);
    const eventId = `${tournamentId}-${eventCode}-${event.drawId}`.toLowerCase();
    const ajaxUrl = `${BASE_URL}/tournament/${event.tournamentGuid}/Draw/${event.drawId}/GetMatchesContent?tabindex=1`;
    console.log(`   Fetching ${event.name} (draw ${event.drawId})...`);

    try {
      const drawHtml = await fetchPage(ajaxUrl, { 'X-Requested-With': 'XMLHttpRequest' });
      await delay(REQUEST_DELAY_MS);

      const matches = parseDrawPage(drawHtml);
      console.log(`   Parsed ${matches.length} matches`);

      // Try to get scheduled times from the schedule/order-of-play view (tabindex=0)
      const scheduleTimes = await fetchScheduleTimes(event.tournamentGuid, event.drawId);
      if (Object.keys(scheduleTimes).length > 0) {
        console.log(`   Found ${Object.keys(scheduleTimes).length} scheduled times`);
        for (const m of matches) {
          const key = `${m.player1_name}|${m.player2_name}`;
          const keyRev = `${m.player2_name}|${m.player1_name}`;
          m.scheduled_time = scheduleTimes[key] || scheduleTimes[keyRev] || m.scheduled_time || null;
        }
      }

      fetchedEvents.push({ event, eventId, matches });
    } catch (err) {
      console.error(`   ❌ Error fetching draw ${event.drawId}: ${err.message}`);
    }
  }

  const totalMatchesFetched = fetchedEvents.reduce((sum, e) => sum + e.matches.length, 0);
  if (totalMatchesFetched === 0) {
    console.log(`   ⚠️  No matches fetched — preserving existing data`);
    return results;
  }

  // We have good data — now safe to wipe stale records and re-import.
  // Keep FK off for both the wipe and the re-insert: INSERT OR IGNORE does NOT
  // catch FK violations (only UNIQUE/NOT NULL/CHECK), so a silently-skipped round
  // (e.g. due to a stale NOT NULL on prediction_deadline) would cause the
  // subsequent match inserts to fail with FK errors. Inserts are done in correct
  // FK order (events → rounds → matches) so disabling the check is safe here.
  db.pragma('foreign_keys = OFF');
  try {
    db.prepare('DELETE FROM predictions WHERE match_id IN (SELECT m.id FROM matches m JOIN rounds r ON m.round_id = r.id JOIN events e ON r.event_id = e.id WHERE e.tournament_id = ?)').run(tournamentId);
    db.prepare('DELETE FROM matches WHERE round_id IN (SELECT r.id FROM rounds r JOIN events e ON r.event_id = e.id WHERE e.tournament_id = ?)').run(tournamentId);
    db.prepare('DELETE FROM rounds WHERE event_id IN (SELECT id FROM events WHERE tournament_id = ?)').run(tournamentId);
    db.prepare('DELETE FROM events WHERE tournament_id = ?').run(tournamentId);
    console.log(`   🧹 Cleared stale data for tournament ${tournamentId}`);

    for (const { event, eventId, matches } of fetchedEvents) {
      db.prepare(`
        INSERT OR IGNORE INTO events (id, tournament_id, code, name, draw_size)
        VALUES (?, ?, ?, ?, ?)
      `).run(eventId, tournamentId, event.name, event.name, 8);
      db.prepare(`UPDATE events SET code = ?, name = ? WHERE id = ?`).run(event.name, event.name, eventId);
      results.events++;

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

      for (let r = 0; r < roundOrder.length; r++) {
        const roundName = roundOrder[r];
        const slug = roundName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        const roundId = `${eventId}-${slug}`;
        const roundMatches = byRound[roundName];

        db.prepare(`
          INSERT OR IGNORE INTO rounds (id, event_id, name, round_order, prediction_deadline)
          VALUES (?, ?, ?, ?, ?)
        `).run(roundId, eventId, roundName, r + 1, null);
        results.rounds++;

        for (let m = 0; m < roundMatches.length; m++) {
          const match = roundMatches[m];
          const tiIdUsable = match.tiMatchId && match.tiMatchId !== '0';
          const matchId = tiIdUsable
            ? `${eventId}-ti${match.tiMatchId}`
            : `${roundId}-${(match.player1_name + match.player2_name).replace(/\s+/g, '').toLowerCase().slice(0, 20)}`;

          db.prepare(`
            INSERT OR IGNORE INTO matches (id, round_id, player1_name, player1_seed, player2_name, player2_seed, status, winner_name, score, sets_played, match_order, scheduled_time)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            matchId, roundId,
            match.player1_name, null,
            match.player2_name, null,
            match.status, match.winner_name || null,
            match.score || null, match.sets_played || null,
            m + 1, match.scheduled_time || null
          );
          if (match.scheduled_time) {
            db.prepare('UPDATE matches SET scheduled_time = ? WHERE id = ?').run(match.scheduled_time, matchId);
          }
          results.matches++;
        }
      }
    }
  } finally {
    db.pragma('foreign_keys = ON');
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
    let prevCount = 0;
    for (let page = 1; page <= 20; page++) {
      try {
        const html = await postForm(SEARCH_ENDPOINT, {
          'Page': page,
          'TournamentExtendedFilter.SportID': 0,
          'TournamentFilter.DateFilterType': 1,
          'TournamentFilter.YearNr': year,
          'TournamentFilter.MonthNr': month,
          'TournamentFilter.Q': '',
        });
        const found = parseTournamentList(html);
        console.log(`   Page ${page}: ${found.length} cumulative tournaments`);
        allFound.push(...found);
        await delay(REQUEST_DELAY_MS);
        // TI returns cumulative results — stop when count stops growing
        if (found.length === prevCount) break;
        prevCount = found.length;
      } catch (err) {
        console.error(`❌ Discovery failed for ${year}/${month} page ${page}: ${err.message}`);
        break;
      }
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
    INSERT INTO discovered_tournaments (id, guid, name, ti_url, location, suggested_circuit_id, start_date)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(guid) DO UPDATE SET
      location = excluded.location,
      suggested_circuit_id = excluded.suggested_circuit_id,
      start_date = excluded.start_date
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
      t.location || null, suggestedCircuit, t.start_date || null);
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

      // Probe schedule URLs for draw 18 (first real draw) to find where times live
      const firstDrawId = events[0]?.drawId || '18';
      const scheduleProbes = [];
      const scheduleUrls = [
        `${BASE_URL}/tournament/${ti_guid}/Draw/${firstDrawId}/GetMatchesContent?tabindex=0`,
        `${BASE_URL}/tournament/${ti_guid}/Draw/${firstDrawId}/GetMatchesContent?tabindex=2`,
        `${BASE_URL}/sport/schedule.aspx?id=${ti_guid}&draw=${firstDrawId}`,
        `${BASE_URL}/sport/schedule.aspx?id=${ti_guid}`,
        `${BASE_URL}/tournament/${ti_guid}/order-of-play`,
      ];
      for (const url of scheduleUrls) {
        try {
          const sh = await fetchPage(url, { 'X-Requested-With': 'XMLHttpRequest' });
          await delay(REQUEST_DELAY_MS);
          const hasTime = /\d{2}:\d{2}/.test(sh);
          const hasDate = /\d{2}\/\d{2}\/\d{4}|datetime="/.test(sh);
          scheduleProbes.push({ url, length: sh.length, hasTime, hasDate, snippet: sh.replace(/\s+/g, ' ').slice(0, 400) });
        } catch (e) {
          scheduleProbes.push({ url, error: e.message });
        }
      }

      res.json({
        tournamentUrl,
        htmlLength: html.length,
        eventsFromTournamentPage: events,
        drawProbes: probeResults,
        scheduleProbes,
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
