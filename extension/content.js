/**
 * CourtCall Content Script
 * Runs on ti.tournamentsoftware.com pages.
 * Reads the DOM to extract tournament info, events, draws, matches and results.
 *
 * TournamentSoftware HTML structure (from analysis of the platform):
 * - Tournament pages: /tournament/{GUID} — contain event links, dates, venue info
 * - Draw pages: /sport/draws.aspx?id={GUID}&draw={N} — contain the actual bracket
 * - Draw tables use <table> with player names in <a href="player.aspx?..."> tags
 * - Seeds appear as [N] in text near player names
 * - Scores appear as "6-4" patterns in cells
 * - The page nav has links to different events (MS, WS, MD, etc.)
 */

(function () {
  'use strict';

  // Only run on tournamentsoftware.com
  if (!window.location.hostname.includes('tournamentsoftware.com')) return;

  // ─── Page Detection ───────────────────────────────────────────────
  function getPageType() {
    const url = window.location.href.toLowerCase();
    if (url.includes('/sport/draw') || url.includes('/sport/draws')) return 'draw';
    if (url.includes('/tournament/')) return 'tournament';
    if (url.includes('/sport/matches') || url.includes('/sport/match')) return 'matches';
    return 'other';
  }

  // ─── Tournament Page Parser ───────────────────────────────────────
  function parseTournamentPage() {
    const data = {
      type: 'tournament',
      url: window.location.href,
      guid: extractGuid(window.location.href),
      name: '',
      dates: '',
      venue: '',
      events: [],
    };

    // Title — usually in <h1> or <title>
    const h1 = document.querySelector('h1, .tournament-title, [class*="tournamentname"]');
    if (h1) data.name = h1.textContent.trim();
    if (!data.name) data.name = document.title.replace(/\s*[-|].*$/, '').trim();

    // Look for date info
    const dateEl = findElementContaining(['Date', 'Dates', 'Period']);
    if (dateEl) data.dates = dateEl.textContent.replace(/^[^:]+:\s*/, '').trim();

    // Look for venue
    const venueEl = findElementContaining(['Venue', 'Location', 'Club']);
    if (venueEl) data.venue = venueEl.textContent.replace(/^[^:]+:\s*/, '').trim();

    // Find event/draw links
    const allLinks = document.querySelectorAll('a[href]');
    allLinks.forEach((a) => {
      const href = a.getAttribute('href') || '';
      if (href.includes('draw') && (href.includes('sport/') || href.includes('draws'))) {
        const name = a.textContent.trim();
        if (name && name.length > 0 && name.length < 100) {
          const drawMatch = href.match(/draw=(\d+)/i);
          data.events.push({
            name,
            drawId: drawMatch ? drawMatch[1] : null,
            url: new URL(href, window.location.origin).href,
          });
        }
      }
    });

    // Deduplicate events
    const seen = new Set();
    data.events = data.events.filter((e) => {
      const key = e.drawId || e.name;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return data;
  }

  // ─── Draw Page Parser ─────────────────────────────────────────────
  function parseDrawPage() {
    const data = {
      type: 'draw',
      url: window.location.href,
      guid: extractGuid(window.location.href),
      eventName: '',
      matches: [],
    };

    // Event name from active tab or page heading
    const activeTab = document.querySelector('.nav-link.active, .draw-tab.active, [class*="active"] a, .selected');
    if (activeTab) data.eventName = activeTab.textContent.trim();
    if (!data.eventName) {
      const h2 = document.querySelector('h2, h3');
      if (h2) data.eventName = h2.textContent.trim();
    }

    // Strategy 1: Look for draw tables (most common layout)
    const matches = parseDrawTable();
    if (matches.length > 0) {
      data.matches = matches;
      return data;
    }

    // Strategy 2: Look for match cards/divs (newer responsive layout)
    const matchCards = parseMatchCards();
    if (matchCards.length > 0) {
      data.matches = matchCards;
      return data;
    }

    // Strategy 3: Fallback — scan all player links and pair them
    data.matches = parsePlayerLinks();
    return data;
  }

  // ─── Strategy 1: Table-based draws ────────────────────────────────
  function parseDrawTable() {
    const matches = [];
    const tables = document.querySelectorAll('table');

    for (const table of tables) {
      const rows = table.querySelectorAll('tr');
      let currentPlayer1 = null;

      for (const row of rows) {
        const playerLink = row.querySelector('a[href*="player"]');
        const cells = row.querySelectorAll('td, th');
        if (!playerLink && cells.length < 2) continue;

        const playerInfo = extractPlayerFromRow(row);
        if (!playerInfo) continue;

        if (!currentPlayer1) {
          currentPlayer1 = playerInfo;
        } else {
          // We have a pair — create a match
          const score = extractScoreBetween(row, currentPlayer1.element);
          matches.push({
            player1_name: currentPlayer1.name,
            player1_seed: currentPlayer1.seed,
            player2_name: playerInfo.name,
            player2_seed: playerInfo.seed,
            score: score || null,
            winner_name: score ? determineWinner(currentPlayer1.name, playerInfo.name, score) : null,
            status: score ? 'completed' : 'upcoming',
          });
          currentPlayer1 = null;
        }
      }
    }

    return matches;
  }

  // ─── Strategy 2: Match card divs ──────────────────────────────────
  function parseMatchCards() {
    const matches = [];

    // Look for common match container patterns
    const selectors = [
      '[class*="match"]',
      '[class*="fixture"]',
      '[class*="draw-match"]',
      '.match-card',
      '.draw-item',
    ];

    let matchElements = [];
    for (const sel of selectors) {
      matchElements = document.querySelectorAll(sel);
      if (matchElements.length > 0) break;
    }

    for (const el of matchElements) {
      const playerLinks = el.querySelectorAll('a[href*="player"]');
      if (playerLinks.length >= 2) {
        const p1 = extractPlayerFromElement(playerLinks[0]);
        const p2 = extractPlayerFromElement(playerLinks[1]);
        const scoreText = extractScoreFromElement(el);

        if (p1 && p2) {
          matches.push({
            player1_name: p1.name,
            player1_seed: p1.seed,
            player2_name: p2.name,
            player2_seed: p2.seed,
            score: scoreText || null,
            winner_name: scoreText ? determineWinner(p1.name, p2.name, scoreText) : null,
            status: scoreText ? 'completed' : 'upcoming',
          });
        }
      }
    }

    return matches;
  }

  // ─── Strategy 3: Pair all player links ────────────────────────────
  function parsePlayerLinks() {
    const matches = [];
    const allPlayerLinks = document.querySelectorAll('a[href*="player.aspx"], a[href*="/player/"]');
    const players = [];

    allPlayerLinks.forEach((a) => {
      const name = cleanPlayerName(a.textContent.trim());
      if (name && name !== 'Bye' && name.length > 1 && !players.find((p) => p.name === name && p.element === a)) {
        const seed = extractSeedNear(a);
        players.push({ name, seed, element: a });
      }
    });

    // Pair consecutive players
    for (let i = 0; i < players.length - 1; i += 2) {
      matches.push({
        player1_name: players[i].name,
        player1_seed: players[i].seed,
        player2_name: players[i + 1].name,
        player2_seed: players[i + 1].seed,
        score: null,
        winner_name: null,
        status: 'upcoming',
      });
    }

    return matches;
  }

  // ─── Helper Functions ─────────────────────────────────────────────
  function extractGuid(url) {
    const match = url.match(/([A-F0-9]{8}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{12})/i);
    return match ? match[1] : null;
  }

  function extractPlayerFromRow(row) {
    const link = row.querySelector('a[href*="player"]');
    if (!link) return null;
    const name = cleanPlayerName(link.textContent.trim());
    if (!name || name === 'Bye') return null;
    const seed = extractSeedNear(link) || extractSeedFromRow(row);
    return { name, seed, element: link };
  }

  function extractPlayerFromElement(el) {
    const name = cleanPlayerName(el.textContent.trim());
    if (!name || name === 'Bye') return null;
    const seed = extractSeedNear(el);
    return { name, seed };
  }

  function extractSeedNear(el) {
    // Check parent and siblings for seed markers like [1] or (1)
    const parent = el.parentElement;
    if (!parent) return null;
    const text = parent.textContent;
    const seedMatch = text.match(/[\[(](\d{1,2})[\])]/);
    return seedMatch ? parseInt(seedMatch[1]) : null;
  }

  function extractSeedFromRow(row) {
    const text = row.textContent;
    const seedMatch = text.match(/[\[(](\d{1,2})[\])]/);
    return seedMatch ? parseInt(seedMatch[1]) : null;
  }

  function extractScoreBetween(currentRow, previousEl) {
    // Look for score patterns in nearby cells
    const text = currentRow.textContent;
    return findScoreInText(text);
  }

  function extractScoreFromElement(el) {
    return findScoreInText(el.textContent);
  }

  function findScoreInText(text) {
    // Match tennis score patterns: "6-4 6-3" or "6-4 3-6 7-5" or "7-6(5) 6-4"
    const scoreRegex = /\b(\d-\d(?:\(\d+\))?(?:\s+\d-\d(?:\(\d+\))?){0,2})\b/;
    const match = text.match(scoreRegex);
    return match ? match[1].trim() : null;
  }

  function cleanPlayerName(name) {
    return name
      .replace(/[\[(]\d{1,2}[\])]/g, '') // Remove seeds
      .replace(/\s+/g, ' ')
      .replace(/^[\s,]+|[\s,]+$/g, '')
      .trim();
  }

  function determineWinner(p1Name, p2Name, score) {
    if (!score) return null;
    const sets = score.split(/\s+/);
    let p1Sets = 0, p2Sets = 0;
    for (const set of sets) {
      const parts = set.replace(/\(\d+\)/g, '').split('-').map(Number);
      if (parts.length === 2) {
        if (parts[0] > parts[1]) p1Sets++;
        else if (parts[1] > parts[0]) p2Sets++;
      }
    }
    if (p1Sets > p2Sets) return p1Name;
    if (p2Sets > p1Sets) return p2Name;
    return null;
  }

  function findElementContaining(keywords) {
    const allEls = document.querySelectorAll('td, th, dd, dt, span, div, label, p');
    for (const el of allEls) {
      const text = el.textContent.trim();
      for (const kw of keywords) {
        if (text.startsWith(kw) && text.length < 200) return el;
      }
    }
    return null;
  }

  // ─── Matches Page Parser ──────────────────────────────────────────
  function parseMatchesPage() {
    // The matches page shows scheduled/completed matches in a list format
    return parseDrawPage(); // Same extraction logic works
  }

  // ─── Main Parse Function ──────────────────────────────────────────
  function parseCurrentPage() {
    const pageType = getPageType();
    switch (pageType) {
      case 'tournament':
        return parseTournamentPage();
      case 'draw':
        return parseDrawPage();
      case 'matches':
        return parseMatchesPage();
      default:
        return { type: 'unknown', url: window.location.href, message: 'Not a recognized TI page' };
    }
  }

  // ─── Communication with Popup/Background ──────────────────────────
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'parsePage') {
      try {
        const data = parseCurrentPage();
        sendResponse({ success: true, data });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    }
    if (request.action === 'getPageType') {
      sendResponse({ pageType: getPageType(), url: window.location.href });
    }
    return true; // Keep channel open for async response
  });

  // ─── Inject Visual Indicator ──────────────────────────────────────
  function addCourtCallBadge() {
    const badge = document.createElement('div');
    badge.id = 'courtcall-badge';
    badge.innerHTML = '🎾 CourtCall';
    badge.title = 'Click the CourtCall extension to import this draw';
    document.body.appendChild(badge);
  }

  // Add badge after page loads
  if (document.readyState === 'complete') {
    addCourtCallBadge();
  } else {
    window.addEventListener('load', addCourtCallBadge);
  }
})();
