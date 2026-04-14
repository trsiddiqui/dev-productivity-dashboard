import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const reportPackageRoot = path.join(__dirname, 'productivity_20260414');
const builderPath = path.join(reportPackageRoot, 'build_reports.mjs');
const latestMetadataPath = path.join(__dirname, 'productivity_runs', 'latest.json');

function fail(message) {
  console.error(message);
  process.exit(1);
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    if (arg === '--help') {
      options.help = true;
      continue;
    }
    if (arg === '--reuse-data') {
      options.reuseData = true;
      continue;
    }
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) fail(`Missing value for ${arg}`);
    options[arg.slice(2)] = next;
    index += 1;
  }
  return options;
}

function assertDependenciesInstalled() {
  const required = [
    path.join(reportPackageRoot, 'node_modules', 'pptxgenjs'),
    path.join(reportPackageRoot, 'node_modules', 'exceljs'),
  ];
  const missing = required.filter((entry) => !fs.existsSync(entry));
  if (missing.length > 0) {
    fail('Report dependencies are not installed. Run `npm run report:setup` first.');
  }
}

function buildRunId() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `productivity_${yyyy}${mm}${dd}`;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(`Usage: npm run report:productivity -- [options]

Options:
  --base-url <url>            Dashboard base URL. Default: http://localhost:3000
  --end-month <YYYY-MM>       Last month to include. Default: last complete month
  --month-count <n>           Number of months to include. Default: 6
  --run-id <id>               Output folder name. Default: productivity_YYYYMMDD
  --reuse-data                Rebuild from the current run's saved JSON dataset
  --output-base <path>        Override output root relative to repo root
  --fetch-timeout-ms <ms>     API timeout override for slow runs
  --person-concurrency <n>    Parallel people to fetch at once
  --month-concurrency <n>     Parallel months per person to fetch at once
`);
    return;
  }

  assertDependenciesInstalled();
  const env = { ...process.env };

  env.REPORT_BASE_URL = options['base-url'] || env.REPORT_BASE_URL || 'http://localhost:3000';
  env.REPORT_MONTH_COUNT = options['month-count'] || env.REPORT_MONTH_COUNT || '6';
  env.REPORT_RUN_ID = options['run-id'] || env.REPORT_RUN_ID || buildRunId();
  if (options['end-month']) env.REPORT_END_MONTH = options['end-month'];
  if (options['output-base']) env.REPORT_OUTPUT_BASE = options['output-base'];
  if (options['fetch-timeout-ms']) env.REPORT_FETCH_TIMEOUT_MS = options['fetch-timeout-ms'];
  if (options['person-concurrency']) env.REPORT_PERSON_CONCURRENCY = options['person-concurrency'];
  if (options['month-concurrency']) env.REPORT_MONTH_CONCURRENCY = options['month-concurrency'];
  if (options.reuseData) env.REPORT_REUSE_DATA = '1';

  const result = spawnSync(process.execPath, [builderPath], {
    cwd: repoRoot,
    env,
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }

  if (fs.existsSync(latestMetadataPath)) {
    const latest = JSON.parse(fs.readFileSync(latestMetadataPath, 'utf8'));
    console.log('');
    console.log('Latest report artifacts');
    console.log(`Manifest: ${latest.manifest}`);
    console.log(`Developer workbook: ${latest.developerWorkbook}`);
    console.log(`QA workbook: ${latest.qaWorkbook}`);
    console.log(`Developer decks zip: ${latest.developerDeckZip}`);
    console.log(`QA decks zip: ${latest.qaDeckZip}`);
  }
}

main();
