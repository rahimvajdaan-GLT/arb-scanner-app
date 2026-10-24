# Top Notch Arb — Live Odds Scanner

Live site: **https://arb-scanner-app.vercel.app/scanner.html**

Australian-first sports odds comparison app, with pre-match theoretical
arbitrage calculations. The public scanner displays **positive calculated
opportunities only** and transparently reports when no positive result is
available. Bookmaker APIs have rate limits, variable coverage, and changing
prices; no positive profit can be guaranteed.

## Two automated managers

| Manager | Schedule | Without paid AI key | With optional OpenAI API key |
|---|---|---|---|
| Maintenance Manager | Every six hours | Regression tests, deployed-site checks, incident issues and recovery tracking | Codex may prepare a test-backed repair PR on failure |
| SEO Manager | Daily and on HTML changes | Canonical audits, robots/sitemap auto-regeneration, flagged SEO issues | Weekly Codex SEO proposals as reviewable PRs |

Routine sitemap and robots updates only are automatically committed to main
**when tests pass**. Vercel's connected Git integration deploys main.
AI-written code and content changes must be reviewed and merged through a PR.

Neither monitor calls the odds-scan API, places bets, evades bookmaker
restrictions, or consumes the bookmaker API quotas in routine checks.

### Agent files

- [Developer instructions](AGENTS.md)
- [SEO instructions](SEO_AGENT.md)
- [Maintenance setup guide](MAINTENANCE_AGENT.md)
- [SEO automation](.github/workflows/arb-seo-manager.yml)
- [AI SEO development](.github/workflows/arb-ai-seo.yml)
- [Maintenance automation](.github/workflows/arb-maintenance.yml)
- [AI repair development](.github/workflows/arb-ai-developer.yml)
- [Regression checks](.github/workflows/arb-tests.yml)

### Test locally

```bash
node --test tests/*.test.cjs
node scripts/seo-manager.cjs --audit
node scripts/seo-manager.cjs --check
```

To generate a canonical sitemap/robots update:

```bash
node scripts/seo-manager.cjs --apply
```

To run the safe remote health check (checks only static pages and sports):

```bash
node scripts/site-health.cjs
```

## Optional paid AI code editor

Without a GitHub secret named `OPENAI_API_KEY`, the AI editing workflows skip
automatically. All deterministic monitoring continues. ChatGPT subscriptions
are separate from OpenAI API billing. AI PRs require review and CI success;
no unreviewed agent code merges to production.

## Scope and limitations

Only actual verified bookmaker markets with equivalent settlement rules
are compared. Soccer full-time results require a draw market. Odds may
change and stakes can be rejected or limited. The scanner is a
mathematical analysis tool and cannot guarantee profit or market coverage.
