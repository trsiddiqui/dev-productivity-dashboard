## Local App

Start the dashboard locally:

```bash
npm install
npm run dev
```

If Next picks a different port than `3000`, use that port in the capture commands below with `--base-url`.

## Screenshot Capture Harness

Reusable browser capture scripts live under:

- `testing/playwright/`
- `testing/data/`
- `testing/run-capture.mjs`

Team rosters and aliases:

- Developers: `testing/data/dev-team.json`
- QA: `testing/data/qa-team.json`

The QA roster file also stores the default TestRail project used by the rerun command:

- `VeemTestEngineeringV26`

The capture runner uses:

- the first account from `USER_ACCOUNTS` in `.env` for app sign-in
- the GitHub/Jira/TestRail credentials in `.env` to seed runtime settings in the browser
- a visible browser by default

### Developer Aliases

- `enrique` → Enrique Jimenez → GitHub `enrique-jmnz-veem`
- `julieth` → Julieth Gómez → GitHub `VeemJuliethGomez`
- `daniel` → Daniel Alencar → GitHub `danielalencar83`
- `phat` → Xuan PhatPham → GitHub `phat-veem`
- `gabriel` → Gabriel Borges → GitHub `brenogab`

### QA Comparison Aliases

- `harsha-vs-shanthi` → Harsha Harikumar (`hharikumarveem`) vs Shanthi Neela (`shanthineela`)
- `adeel-vs-asmita` → adeel (`adeelakramveem`) vs Asmita Surse (`asmitafulsagar`)

## Run The Same Exercise Again

### Developer comparison capture

This reproduces the Contributions page exercise in date-comparison mode:

```bash
npm run capture:dev -- \
  --aliases all \
  --month-pairs 2025-10:2025-11,2025-12:2026-01,2026-02:2026-03 \
  --base-url http://localhost:3000
```

What it does:

- opens the Contributions page
- switches to `Date Comparison`
- runs 3 searches per developer
- takes a full-page screenshot after each search
- writes an HTML report plus PNGs into `testing/output/dev-<timestamp>/`

To run only one developer:

```bash
npm run capture:dev -- \
  --aliases enrique \
  --month-pairs 2025-10:2025-11,2025-12:2026-01,2026-02:2026-03 \
  --base-url http://localhost:3000
```

### QA comparison capture

This reproduces the QA page exercise:

```bash
npm run capture:qa -- \
  --comparisons harsha-vs-shanthi,adeel-vs-asmita \
  --months 2025-10,2025-11,2025-12,2026-01,2026-02,2026-03 \
  --project VeemTestEngineeringV26 \
  --base-url http://localhost:3000
```

What it does:

- opens the QA page
- selects the requested TestRail project
- runs each configured comparison for each listed month
- takes a full-page screenshot after each search
- writes an HTML report plus PNGs into `testing/output/qa-<timestamp>/`

## Useful Options

Run without opening the final HTML report:

```bash
npm run capture:dev -- --aliases all --no-open
```

Run headless:

```bash
npm run capture:qa -- --comparisons default --headless
```

Use the last 6 complete months automatically:

- `capture:dev` defaults to 3 pairs:
  - month 1 vs month 2
  - month 3 vs month 4
  - month 5 vs month 6
- `capture:qa` defaults to the last 6 complete months

So after another month passes, you can rerun the same workflow without hardcoding dates:

```bash
npm run capture:dev -- --aliases all --base-url http://localhost:3000
npm run capture:qa -- --comparisons default --base-url http://localhost:3000
```

## Output

Each run writes:

- full-page PNG screenshots
- `index.html` report with direct links to the full screenshots

The runner also generates a temporary Playwright script under `testing/generated/` and deletes it automatically after the run finishes.

Outputs are stored under:

- `testing/output/dev-<timestamp>/`
- `testing/output/qa-<timestamp>/`
