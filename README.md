# Numisma

## Local Fund Review Data

Fund review JSON is local-only and not tracked in git.

Resolution order:
1. `--file /path/to/review.json`
2. A single bare positional `.json` path, for compatibility
3. `NUMISMA_FUND_REVIEW_FILE=/path/to/review.json`
4. `data/fund-review.local.json`

Default local file:
- `data/fund-review.local.json` via `data/.gitignore`

You can also provide a file explicitly:
- `pnpm report -- --file /path/to/review.json`
- `pnpm dev -- --file /path/to/review.json`

Or through an environment variable:
- `NUMISMA_FUND_REVIEW_FILE=/path/to/review.json pnpm report`

If more than one bare positional `.json` path is provided, Numisma exits with a
clear error and asks you to use `--file`.

If `--file` is provided without a value, Numisma exits with a clear error rather
than silently falling back to another path.

The repo intentionally does not ship real or sample portfolio data.
