/**
 * CourtCall Extension Popup
 * Handles the UI when you click the extension icon.
 * Communicates with the content script to parse the current TI page,
 * then sends the data to the CourtCall backend API.
 */

const content = document.getElementById('content');

// Load saved server URL
let serverUrl = 'http://localhost:3001';
chrome.storage.local.get(['courtcall_server'], (result) => {
  if (result.courtcall_server) serverUrl = result.courtcall_server;
});

// ─── Initialize ─────────────────────────────────────────────────────
async function init() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab?.url?.includes('tournamentsoftware.com')) {
      showNotTI();
      return;
    }

    // Ask content script to parse the page
    const response = await chrome.tabs.sendMessage(tab.id, { action: 'parsePage' });

    if (!response?.success) {
      showError(response?.error || 'Failed to parse page');
      return;
    }

    const data = response.data;

    if (data.type === 'tournament') {
      showTournamentPage(data);
    } else if (data.type === 'draw') {
      showDrawPage(data);
    } else {
      showUnknownPage();
    }
  } catch (err) {
    // Content script might not be loaded yet
    showError('Please refresh the TI page and try again.');
  }
}

// ─── Views ──────────────────────────────────────────────────────────
function showNotTI() {
  content.innerHTML = `
    <div class="status warning">
      This extension only works on <strong>ti.tournamentsoftware.com</strong>
    </div>
    <p style="font-size: 12px; color: #7A8BA0; margin-top: 8px; line-height: 1.5;">
      Navigate to a Tennis Ireland tournament page on ti.tournamentsoftware.com, then click this extension to import the draw.
    </p>
    ${settingsHtml()}
  `;
  bindSettings();
}

function showTournamentPage(data) {
  const eventListHtml = data.events.length > 0
    ? data.events.map((e) => `
        <div class="event-item" data-url="${e.url}">
          <span class="dot"></span>
          <span>${e.name}</span>
        </div>
      `).join('')
    : '<div style="font-size: 12px; color: #4A5B6E; padding: 8px;">No draw links found on this page</div>';

  content.innerHTML = `
    <div class="status success">
      ✅ Tournament page detected
    </div>
    <div class="section">
      <div style="font-size: 15px; font-weight: 700; margin-bottom: 4px;">${data.name || 'Unknown Tournament'}</div>
      ${data.dates ? `<div style="font-size: 12px; color: #7A8BA0;">${data.dates}</div>` : ''}
      ${data.venue ? `<div style="font-size: 12px; color: #7A8BA0;">${data.venue}</div>` : ''}
      ${data.guid ? `<div style="font-size: 10px; color: #4A5B6E; margin-top: 4px; font-family: monospace;">GUID: ${data.guid}</div>` : ''}
    </div>
    <div class="section">
      <div class="section-label">Events / Draws (${data.events.length})</div>
      <div class="event-list" id="scroll-area">
        ${eventListHtml}
      </div>
    </div>
    <p style="font-size: 11px; color: #7A8BA0; line-height: 1.5; margin-bottom: 12px;">
      Click an event above to navigate to its draw page, then click the extension again to import matches.
    </p>
    ${settingsHtml()}
  `;

  // Event clicks navigate to draw pages
  document.querySelectorAll('.event-item').forEach((el) => {
    el.addEventListener('click', async () => {
      const url = el.dataset.url;
      if (url) {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        chrome.tabs.update(tab.id, { url });
        window.close();
      }
    });
  });

  bindSettings();
}

function showDrawPage(data) {
  const matchCount = data.matches.length;
  const completedCount = data.matches.filter((m) => m.status === 'completed').length;
  const upcomingCount = matchCount - completedCount;

  const matchPreviewHtml = data.matches.slice(0, 8).map((m) => {
    const p1Seed = m.player1_seed ? `<span class="seed">[${m.player1_seed}]</span>` : '';
    const p2Seed = m.player2_seed ? `<span class="seed">[${m.player2_seed}]</span>` : '';
    const score = m.score ? `<span class="score">${m.score}</span>` : '';
    return `
      <div class="match-preview">
        <span class="players">${m.player1_name}</span> ${p1Seed}
        <span class="vs">vs</span>
        <span class="players">${m.player2_name}</span> ${p2Seed}
        ${score}
      </div>
    `;
  }).join('');

  const moreText = matchCount > 8 ? `<div style="font-size: 11px; color: #4A5B6E; padding: 4px 0;">...and ${matchCount - 8} more</div>` : '';

  content.innerHTML = `
    <div class="status success">
      ✅ Draw page detected — ${data.eventName || 'Unknown Event'}
    </div>

    <div style="display: flex; gap: 12px; margin-bottom: 12px;">
      <div style="flex: 1; text-align: center; background: #151C25; border-radius: 10px; padding: 10px; border: 1px solid #1E2A3A;">
        <div class="count">${matchCount}</div>
        <div style="font-size: 10px; color: #7A8BA0;">Matches</div>
      </div>
      <div style="flex: 1; text-align: center; background: #151C25; border-radius: 10px; padding: 10px; border: 1px solid #1E2A3A;">
        <div class="count" style="color: #3B82F6;">${completedCount}</div>
        <div style="font-size: 10px; color: #7A8BA0;">Completed</div>
      </div>
      <div style="flex: 1; text-align: center; background: #151C25; border-radius: 10px; padding: 10px; border: 1px solid #1E2A3A;">
        <div class="count" style="color: #F59E0B;">${upcomingCount}</div>
        <div style="font-size: 10px; color: #7A8BA0;">Upcoming</div>
      </div>
    </div>

    <div class="section">
      <div class="section-label">Match Preview</div>
      <div id="scroll-area">${matchPreviewHtml}${moreText}</div>
    </div>

    <div class="section">
      <div class="section-label">Send to CourtCall</div>
      <input id="tournament-id" placeholder="Tournament ID (e.g. ballycastle-2026)" />
      <input id="event-name" placeholder="Event name (e.g. Men's Singles)" value="${data.eventName || ''}" />
      <input id="round-name" placeholder="Round name (e.g. Round 1, Quarter-Finals)" />
    </div>

    <button class="btn btn-primary" id="send-btn" ${matchCount === 0 ? 'disabled' : ''}>
      🎾 Import ${matchCount} matches to CourtCall
    </button>
    <button class="btn btn-secondary" id="copy-btn">
      📋 Copy as JSON
    </button>

    <div id="send-result" style="margin-top: 8px;"></div>
    ${settingsHtml()}
  `;

  // Send to CourtCall
  document.getElementById('send-btn')?.addEventListener('click', async () => {
    const btn = document.getElementById('send-btn');
    const resultDiv = document.getElementById('send-result');
    const tournamentId = document.getElementById('tournament-id').value.trim();
    const eventName = document.getElementById('event-name').value.trim();
    const roundName = document.getElementById('round-name').value.trim();

    if (!tournamentId) {
      resultDiv.innerHTML = '<div class="status error">Enter a tournament ID</div>';
      return;
    }
    if (!roundName) {
      resultDiv.innerHTML = '<div class="status error">Enter a round name</div>';
      return;
    }

    btn.disabled = true;
    btn.textContent = '⏳ Sending...';

    try {
      // Step 1: Ensure event exists
      const eventCode = inferEventCode(eventName);
      await fetch(`${serverUrl}/api/admin/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tournament_id: tournamentId,
          code: eventCode,
          name: eventName || eventCode,
          draw_size: Math.pow(2, Math.ceil(Math.log2(data.matches.length * 2))),
        }),
      });

      // Step 2: Get the tournament to find the event + round IDs
      const tournamentRes = await fetch(`${serverUrl}/api/tournaments/${tournamentId}`);
      const tournament = await tournamentRes.json();

      let event = tournament.events?.find((e) => e.code === eventCode);
      if (!event) {
        throw new Error('Failed to create event');
      }

      // Step 3: Create round if needed
      let round = event.rounds?.find((r) => r.name === roundName);
      if (!round) {
        const roundOrder = event.rounds ? event.rounds.length + 1 : 1;
        const deadline = new Date();
        deadline.setDate(deadline.getDate() + 7);
        const roundRes = await fetch(`${serverUrl}/api/admin/rounds`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            event_id: event.id,
            name: roundName,
            round_order: roundOrder,
            prediction_deadline: deadline.toISOString(),
          }),
        });
        round = await roundRes.json();
      }

      const roundId = round.id;

      // Step 4: Send matches
      const matchesRes = await fetch(`${serverUrl}/api/admin/matches`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          round_id: roundId,
          matches: data.matches.map((m) => ({
            player1_name: m.player1_name,
            player1_seed: m.player1_seed,
            player2_name: m.player2_name,
            player2_seed: m.player2_seed,
          })),
        }),
      });
      const matchResult = await matchesRes.json();

      // Step 5: If any matches have results, submit them
      const completedMatches = data.matches.filter((m) => m.score && m.winner_name);
      // Results would need match IDs from the database, so we skip auto-result-entry for now

      resultDiv.innerHTML = `
        <div class="status success">
          ✅ Imported ${matchResult.count || data.matches.length} matches!
          ${completedMatches.length > 0 ? `<br>${completedMatches.length} have results — enter them in the Admin panel.` : ''}
        </div>
      `;
      btn.textContent = '✅ Done!';
    } catch (err) {
      resultDiv.innerHTML = `<div class="status error">❌ ${err.message}</div>`;
      btn.disabled = false;
      btn.textContent = `🎾 Import ${data.matches.length} matches to CourtCall`;
    }
  });

  // Copy JSON
  document.getElementById('copy-btn')?.addEventListener('click', () => {
    const json = JSON.stringify(data, null, 2);
    navigator.clipboard.writeText(json).then(() => {
      document.getElementById('copy-btn').textContent = '✅ Copied!';
      setTimeout(() => {
        document.getElementById('copy-btn').textContent = '📋 Copy as JSON';
      }, 2000);
    });
  });

  bindSettings();
}

function showError(msg) {
  content.innerHTML = `
    <div class="status error">❌ ${msg}</div>
    ${settingsHtml()}
  `;
  bindSettings();
}

function showUnknownPage() {
  content.innerHTML = `
    <div class="status warning">
      Not sure what this page is. Navigate to a tournament page or a draw page on ti.tournamentsoftware.com.
    </div>
    ${settingsHtml()}
  `;
  bindSettings();
}

// ─── Settings ───────────────────────────────────────────────────────
function settingsHtml() {
  return `
    <div class="settings">
      <label>CourtCall Server URL</label>
      <input id="server-url" value="${serverUrl}" placeholder="http://localhost:3001" style="font-size: 12px; margin-top: 4px;" />
    </div>
  `;
}

function bindSettings() {
  const input = document.getElementById('server-url');
  if (input) {
    input.addEventListener('change', () => {
      serverUrl = input.value.trim().replace(/\/+$/, '');
      chrome.storage.local.set({ courtcall_server: serverUrl });
    });
  }
}

// ─── Helpers ────────────────────────────────────────────────────────
function inferEventCode(name) {
  if (!name) return 'MS';
  const lower = name.toLowerCase();
  if (lower.includes("men's singles") || lower === 'ms') return 'MS';
  if (lower.includes("women's singles") || lower === 'ws') return 'WS';
  if (lower.includes("men's doubles") || lower === 'md') return 'MD';
  if (lower.includes("women's doubles") || lower === 'wd') return 'WD';
  if (lower.includes('mixed')) return 'XD';
  return name.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase() || 'MS';
}

// ─── Start ──────────────────────────────────────────────────────────
init();
