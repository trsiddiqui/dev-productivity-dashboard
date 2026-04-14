## Local App

Start the dashboard locally:

```bash
npm install
npm run dev
```

If Next picks a different port than `3000`, use that port in the capture and report commands below with `--base-url`.

## Monthly Productivity Report Workflow

The reusable report runner is:

```bash
npm run report:productivity -- --base-url http://localhost:3000
```

What it does:

- pulls the current developer and QA rosters from `testing/data/`
- fetches the last `6` complete months by default
- builds fresh normalized datasets
- creates PowerPoint decks for every developer and QA resource
- creates one Excel workbook for developers and one for QA
- writes everything under `reports/productivity_runs/<run-id>/artifacts/`
- updates `reports/productivity_runs/latest.json`
- updates `reports/productivity_runs/index.html`

### One-time setup

Install the report-only deck dependencies once:

```bash
npm run report:setup
```

### Default monthly run

This uses the last `6` complete months ending with the last fully completed month:

```bash
npm run report:productivity -- --base-url http://localhost:3000
```

Example on `2026-05-10`:

- months used would be `2025-11` through `2026-04`
- output would go to `reports/productivity_runs/productivity_20260510/artifacts/`

### Run for a specific end month

If you want to lock the window explicitly:

```bash
npm run report:productivity -- \
  --base-url http://localhost:3000 \
  --end-month 2026-04 \
  --month-count 6 \
  --run-id productivity_20260510
```

Meaning:

- `--end-month 2026-04` means the report window ends at April 2026
- `--month-count 6` means include 6 complete months total
- `--run-id` controls the output folder name

### Rebuild decks and workbooks from the same saved dataset

Use this when you are fixing wording, layout, or slide-generation logic and do not want to hit GitHub, Jira, and TestRail again:

```bash
npm run report:productivity:reuse -- \
  --base-url http://localhost:3000 \
  --run-id productivity_20260510
```

This reuses the normalized JSON already saved in the current run folder and refreshes the QA Jira complexity numbers.

### Where to look after the run

Stable pointers:

- latest landing page: `reports/productivity_runs/index.html`
- latest metadata: `reports/productivity_runs/latest.json`

Per-run artifacts:

- manifest: `reports/productivity_runs/<run-id>/artifacts/index.html`
- developer workbook: `reports/productivity_runs/<run-id>/artifacts/workbooks/developers_raw_metrics.xlsx`
- QA workbook: `reports/productivity_runs/<run-id>/artifacts/workbooks/qas_raw_metrics.xlsx`
- developer decks zip: `reports/productivity_runs/<run-id>/artifacts/archives/developer_decks.zip`
- QA decks zip: `reports/productivity_runs/<run-id>/artifacts/archives/qa_decks.zip`

### What you need before running next month

- local `.env` must still contain working GitHub, Jira, and TestRail credentials
- the local app must be running
- `testing/data/*.json` must reflect the current developer and QA rosters
- if QA project naming changes again, update the roster default project or the versioning logic before the run

### Exact next-month routine

When you come back next month:

1. Pull the latest code.
2. Update any team roster JSON files in `testing/data/` if people changed.
3. Start the app:

```bash
npm run dev
```

4. In another terminal, run:

```bash
npm run report:productivity -- --base-url http://localhost:3000
```

5. Open:

```bash
open reports/productivity_runs/index.html
```

That is the only command sequence you should need for the normal monthly rerun.

## Screenshot Capture Harness

Reusable browser capture scripts live under:

- `testing/playwright/`
- `testing/data/`
- `testing/run-capture.mjs`

The capture runner uses:

- the first account from `USER_ACCOUNTS` in `.env` for app sign-in
- the GitHub/Jira/TestRail credentials in `.env` to seed runtime settings in the browser
- a visible browser by default

### Developer comparison capture

This reproduces the Contributions page exercise in date-comparison mode:

```bash
npm run capture:dev -- \
  --aliases all \
  --month-pairs 2025-10:2025-11,2025-12:2026-01,2026-02:2026-03 \
  --base-url http://localhost:3000
```

### QA comparison capture

This reproduces the QA page exercise:

```bash
npm run capture:qa -- \
  --comparisons default \
  --base-url http://localhost:3000
```

### Useful capture options

Run without opening the final HTML report:

```bash
npm run capture:dev -- --aliases all --no-open
```

Run headless:

```bash
npm run capture:qa -- --comparisons default --headless
```

Use the last 6 complete months automatically:

```bash
npm run capture:dev -- --aliases all --base-url http://localhost:3000
npm run capture:qa -- --comparisons default --base-url http://localhost:3000
```
