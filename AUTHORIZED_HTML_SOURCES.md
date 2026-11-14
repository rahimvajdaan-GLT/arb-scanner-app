# Permissioned bookmaker website collection — initial framework

`lib/authorized-html-collector.cjs` parses structured `SportsEvent` JSON-LD
from **already obtained, approved** HTML. It makes no network calls. The parser
rejects unapproved sources, stale captures, started fixtures, incomplete outcome
sets, and markets other than exact full-match winners. Soccer requires three
prices including the draw. Tests use synthetic markup and consume no odds quota.

This is **not a working live scraper**. Most bookmakers use JavaScript odds
widgets rather than suitable JSON-LD, and their data extraction/public display
rights must be established separately. Do not assume their public HTML is
licensed for automatic collection, and do not bypass access controls or 403s.

## Next integration step

1. Identify a bookmaker offering permitted automated access **and permission
   to display prices on Top Notch Arb's public website**.
2. Record source URL, authorized collection method, market settlement rules,
   limits, licence evidence, and freshness in the source registry.
3. Build a source-specific extractor based on an approved sanitized fixture,
   then normalize to the same event shape as `api/arbitrage.js`.
4. Connect the collector behind an explicit server-side flag after tests and
   approval. Never poll a bookmaker just to run routine QA checks.

No external bookmaker is enabled by this change, and production behavior
remains untouched pending a reviewed pull request.
