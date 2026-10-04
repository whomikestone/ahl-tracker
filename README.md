# AHL standings tracker

Standings by division, conference, and league, plus playoff odds,
refreshed every day at 3 a.m. Pacific. Runs free on Cloudflare Workers.

## Deploy (about 10 minutes, one time)

1. Install Node.js 20 or newer from https://nodejs.org if you don't have it.
2. Open a terminal in this folder and run:

       npm install
       npx wrangler login

   A browser window opens; approve access to your Cloudflare account.
3. Set a password for the manual refresh link (pick any random string):

       npx wrangler secret put REFRESH_TOKEN

4. Deploy:

       npx wrangler deploy

   Wrangler prints your app's address, something like
   https://ahl-tracker.YOUR-NAME.workers.dev. That's the link to share with friends.

The storage (KV namespace `ahl-tracker-data`) already exists in your account and is
listed in wrangler.toml, so there's nothing else to create.

## First visit

The first time anyone opens the page, it fetches today's data right away instead of
waiting until 3 a.m. After that, it updates nightly.

## Useful links

- `/api/status` shows when the last update ran and whether it worked.
- `/api/refresh?token=YOUR_REFRESH_TOKEN` forces an update now.

## If something goes wrong

- **"The stats feed didn't respond"**: open `/api/status` to see the error. The app
  reads the same public stats feed the AHL website uses. It isn't an official,
  documented API, so if the AHL changes it, the fetch code in `src/worker.js` may need
  a tweak. Bring the error message back to Claude.
- **Wrong season showing**: set `SEASON_ID` in wrangler.toml to the right number and
  redeploy.
- **Exceeded CPU limit errors** in the Cloudflare dashboard: the nightly job only
  downloads and trims data (the odds are calculated in each visitor's browser), so
  this is unlikely on the free plan. If it happens, the $5/month Workers Paid plan
  removes the limit.

## How it's built

- `src/worker.js` downloads teams and the full season schedule with results at
  3 a.m. Pacific and stores a compact copy. Cloudflare schedules run on UTC, so it's
  scheduled at both 10:00 and 11:00 UTC and only acts on whichever is 3 a.m. Pacific,
  which keeps it right through daylight saving changes. A 3:30 a.m. run retries if
  3:00 failed.
- `public/model.js` builds standings from game results and simulates the remaining
  season 5,000 times. Playoff spots per division are set in `PLAYOFF_RULES` at the
  top of that file; update them if the AHL changes its format.
- `public/index.html` and `public/app.js` are the page itself.
