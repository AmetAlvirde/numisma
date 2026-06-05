# Numisma

## Local Fund Review Data

Fund review JSON is local-only and not tracked in git.

Default local file:
- `data/fund-review.local.json`

You can also provide a file explicitly:
- `pnpm report -- --file /path/to/review.json`
- `bun src/app.ts --file /path/to/review.json`

Or through an environment variable:
- `NUMISMA_FUND_REVIEW_FILE=/path/to/review.json pnpm report`

The repo intentionally does not ship real or sample portfolio data.
