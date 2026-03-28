# CourtCall Chrome Extension — TI Draw Importer

This Chrome extension lets you import tournament draws from
**ti.tournamentsoftware.com** into CourtCall with one click.

## How to Install

1. Open Chrome and go to `chrome://extensions/`
2. Turn on **Developer mode** (toggle in top-right)
3. Click **Load unpacked**
4. Select this `extension` folder
5. The 🎾 CourtCall icon appears in your toolbar

## How to Use

### Importing a Draw

1. Go to **ti.tournamentsoftware.com** and navigate to a tournament
2. Click into the event you want (e.g. Men's Singles)
3. Click the draw tab so the bracket/draw is visible
4. Click the **🎾 CourtCall** extension icon
5. You'll see all the matches it found on the page
6. Enter the Tournament ID (e.g. `ballycastle-2026`), event name, and round name
7. Hit **Import** — the matches are sent to your CourtCall backend

### Tournament Pages

When you're on a tournament overview page, the extension shows you
all the events/draws available. Click one to navigate to its draw page.

### Settings

At the bottom of the popup, set your CourtCall server URL:
- Local development: `http://localhost:3001`
- Deployed: `https://your-courtcall-domain.com`

## How It Works

The extension runs a content script on tournamentsoftware.com pages.
When you click the extension, it reads the page's DOM to find:

- Player names (from `<a href="player.aspx?...">` links)
- Seeds (from `[N]` or `(N)` markers near player names)
- Scores (from patterns like `6-4 6-3` in the draw tables)
- Event names (from active navigation tabs)

This is the same as you manually reading the page — the extension
just structures it for you. No automated scraping or background requests.

## Troubleshooting

- **"Please refresh the TI page"** — The content script needs to load.
  Refresh the page and try again.
- **"Not a recognized TI page"** — Navigate to a tournament or draw page.
- **0 matches found** — The draw might not be published yet, or the
  page layout is different. Try the "Copy as JSON" button to see raw data.
- **Import fails** — Check that your CourtCall server is running and
  the server URL in settings is correct.
