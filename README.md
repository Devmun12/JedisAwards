# Jedis Awards

Live award voting for ISB Section J: phones vote, the admin runs each award, the big screen reveals the winner.

- `index.html`: phone voting app
- `admin.html`: admin panel (live control, awards, people, results)
- `screen.html`: big screen for the projector
- `cards.html`: power card reveal, one study group at a time (images in `cards/`)
- `supabase/schema.sql`: the whole database (tables, rules, the 69 names, sample awards)
- `js/config.js`: the only file to edit (your Supabase URL and key)
- `tools/loadtest.mjs`: rehearsal load test (80 simulated phones)

Setup takes about 15 minutes: see **DEPLOY.md**.

Built as a static site (no build step) on GitHub Pages, with Supabase for the database and live updates. Libraries are bundled in `js/vendor/` (supabase-js 2.116.0, qrcode-generator 2.0.4, both MIT) so nothing loads from third-party CDNs on the night. Font: Manrope (SIL Open Font License, `fonts/OFL-Manrope.txt`).
