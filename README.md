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
