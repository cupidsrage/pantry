# Pantry & List

Recipe -> grocery list -> pantry stock tracker. Node/Express + SQLite (better-sqlite3), static frontend.

## Deploy to Railway

1. Push this folder to a GitHub repo.
2. In Railway: **New Project -> Deploy from GitHub repo**, pick the repo.
3. Under the service **Variables**, add:
   - `ANTHROPIC_API_KEY` = your key (used server-side to parse recipes)
4. Railway auto-detects Node, runs `npm install`, then `npm start`. `PORT` is injected automatically.

### Persistent storage (recommended)
The container filesystem resets on every redeploy, so the default SQLite file is wiped.
To keep your pantry/list across deploys:
1. Add a **Volume** to the service, mount path e.g. `/data`.
2. Add variable `DB_PATH=/data/pantry.db`.

## Local dev
```
npm install
ANTHROPIC_API_KEY=sk-ant-... npm start
# http://localhost:3000
```

## Install on your phone (PWA)

The app is a Progressive Web App — no app store needed.

**iPhone/iPad (Safari):** open your Railway URL, tap the Share button, then "Add to Home Screen."

**Android (Chrome):** open your Railway URL, tap the ⋮ menu, then "Install app" (or "Add to Home Screen").

It then launches full-screen from your home screen with its own icon. Your data lives on the server, so it's the same list across every device you install it on. Needs an internet connection to load and sync (the shell is cached for fast open, but the pantry/list data is always live from the server).

## Link fetching from protected sites (optional)

The app fetches recipe links directly by default. That works on most food blogs,
but big sites (allrecipes, NYT Cooking, etc.) block automated reads and will ask
you to paste the recipe instead. To make links work everywhere, add a scraper —
the app tries the free direct fetch first and only calls the scraper when a site
blocks it, so a paid/limited plan lasts a long time.

**Easiest — ScraperAPI** (free tier: 1,000 requests/month, no card required for
the free plan; a 7-day trial adds 5,000 one-time credits on top):
1. Sign up at https://www.scraperapi.com and copy your API key.
2. In Railway -> service -> Variables, add `SCRAPER_KEY=your_key`.

**Any other provider** (ScrapingBee, ChocoData, a self-hosted proxy, etc.):
set both variables, using a URL template with `{url}` and optional `{key}`:
```
SCRAPER_KEY=your_key
SCRAPER_URL=https://app.scrapingbee.com/api/v1/?api_key={key}&url={url}
```
The target URL is inserted automatically (URL-encoded). No code changes needed to
switch providers — just change the variables and redeploy.
