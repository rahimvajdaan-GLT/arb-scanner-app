# Top Notch Arb — Automated Developer Agent Setup

**Already installed in this GitHub repository:**

- `AGENTS.md`: permanent coding instructions, market-safety rules, acceptance criteria.
- `.github/workflows/arb-tests.yml`: automated regression suite on each push and PR.
- `.github/workflows/arb-maintenance.yml`: **every six hours**, independently checks the
  deployed scanner, versioned frontend JavaScript, and sports catalog and runs tests.
  It creates ONE deduplicated GitHub issue if a check fails, adds a daily status
  comment while unresolved, then automatically closes the incident when healthy.
- `scripts/site-health.cjs`: safe monitor that **never calls /api/arbitrage**,
  protecting free bookmaker API credits. Detailed check output is attached to Actions.
- `.github/workflows/arb-ai-developer.yml`: optional *AI code repair* after a failed
  maintenance workflow; uses Codex to edit and test a local checkout then opens a
  **pull request requiring human review**. It does not automatically deploy.
- `tests/site-health.test.cjs`: mock healthy/stale/broken site tests.

## Quick start: free automatic monitoring

1. Visit the repository's [Actions tab](https://github.com/rahimvajdaan-GLT/arb-scanner-app/actions).
2. If GitHub asks, click **Enable workflows**.
3. Choose **Top Notch Arb Maintenance Agent** → **Run workflow** to trigger one
   immediate run. Thereafter the job is scheduled every six hours (UTC).
4. Check [Issues](https://github.com/rahimvajdaan-GLT/arb-scanner-app/issues) if
   a report fails. Open the workflow run to see tests and the downloadable health JSON.
5. If issue creation is blocked, enable GitHub Actions writing issues in repository
   Settings → Actions → General → Workflow permissions. GitHub Actions must have
   permission to write issues. The workflow itself requests minimal scopes.

This monitoring does NOT need any OpenAI API key and does NOT place bets.

## Activate the AI developer that makes repair pull requests (optional; API billed)

The automated repair workflow requires an OpenAI **API** key, which is billed
separately from ChatGPT subscriptions. Do not configure it if you do not want
potential API usage charges.

1. Create an OpenAI API key at https://platform.openai.com/api-keys.
2. GitHub repo → **Settings → Secrets and variables → Actions → New repository secret**.
3. Name the secret **OPENAI_API_KEY** and paste the key as its value. Never paste it
   into source code, browser forms, issues or the chat.
4. In **Settings → Actions → General**, allow GitHub Actions to create pull requests
   when GitHub requires that setting. Workflow permissions must permit write access.
5. Open Actions → **Top Notch Arb AI Developer** → **Run workflow** for a manual
   test, or leave it enabled: it can react to an unsuccessful scheduled maintenance run.
6. Review the generated PR. Check the code and test results before merging. Vercel
   deploys changes merged to `main`.

If **OPENAI_API_KEY** is absent, the AI repair job SKIPS with a setup note,
but all free monitoring continues. The AI agent never runs unattended API calls
against fee-limited odds providers.

## No new API key alternative

If your GitHub account has **GitHub Copilot cloud agent** (paid Copilot feature),
open the maintenance issue → **Assignees → Copilot**. Copilot can prepare a PR
following AGENTS.md for your review.

If you have GitHub connected to Codex in ChatGPT, enable automatic PR review
from Codex settings, or mention `@codex review` on a pull request when enabled
for the repository. This is optional; don't assume the account is enabled.

## What this will and will not do

**It will:** run regression tests, detect deployed-site failures, identify
old JS versions, track incidents in GitHub, and (with the optional AI workflow
enabled) propose fixes as reviewable PRs.

**It will not:** guarantee profitable arbitrage, bypass bookmakers' 429 quotas,
provide unlimited free odds, purchase APIs, change credentials, or silently merge
AI code into production.

**Important:** Full browser simulation, bookmaker feed coverage, market
settlement and API freshness still need periodic human verification. When there
are genuinely zero profitable markets, the correct result is zero.

## Maintenance links

- Scanner: https://arb-scanner-app.vercel.app/scanner.html
- GitHub: https://github.com/rahimvajdaan-GLT/arb-scanner-app
- Scheduled monitor: https://github.com/rahimvajdaan-GLT/arb-scanner-app/actions/workflows/arb-maintenance.yml
- AI developer: https://github.com/rahimvajdaan-GLT/arb-scanner-app/actions/workflows/arb-ai-developer.yml
- Issues: https://github.com/rahimvajdaan-GLT/arb-scanner-app/issues
- Proposed changes: https://github.com/rahimvajdaan-GLT/arb-scanner-app/pulls
