import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const dataDir = path.join(__dirname, 'data');
const templatesDir = path.join(__dirname, 'playwright');
const generatedDir = path.join(__dirname, 'generated');
const outputDirRoot = path.join(__dirname, 'output');

function fail(message) {
  console.error(message);
  process.exit(1);
}

function failWithResult(message, result) {
  const stdout = String(result?.stdout ?? '').trim();
  const stderr = String(result?.stderr ?? '').trim();
  const details = [stdout, stderr].filter(Boolean).join('\n');
  fail(details ? `${message}\n${details}` : message);
}

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const out = {};
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    if (!line || line.trim().startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx < 0) continue;
    out[line.slice(0, idx).trim()] = line.slice(idx + 1);
  }
  return out;
}

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    if (arg === '--no-open') {
      options.open = false;
      continue;
    }
    if (arg === '--headless') {
      options.headed = false;
      continue;
    }
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) fail(`Missing value for ${arg}`);
    options[arg.slice(2)] = next;
    i += 1;
  }
  return options;
}

function monthRange(year, monthIndex) {
  const from = new Date(Date.UTC(year, monthIndex, 1));
  const to = new Date(Date.UTC(year, monthIndex + 1, 0));
  const mm = String(monthIndex + 1).padStart(2, '0');
  return {
    label: `${year}-${mm}`,
    monthLabel: from.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
    lastDay: to.getUTCDate(),
  };
}

function parseMonthToken(token) {
  const match = /^(\d{4})-(\d{2})$/.exec(token.trim());
  if (!match) fail(`Invalid month token "${token}". Use YYYY-MM.`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) fail(`Invalid month token "${token}". Month must be 01-12.`);
  return monthRange(year, month - 1);
}

function lastCompleteMonths(count, now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const months = [];
  for (let i = count; i >= 1; i -= 1) {
    months.push(monthRange(start.getUTCFullYear(), start.getUTCMonth() - i));
  }
  return months;
}

function buildDefaultDevPairs(now = new Date()) {
  const months = lastCompleteMonths(6, now);
  return [
    [months[0], months[1]],
    [months[2], months[3]],
    [months[4], months[5]],
  ];
}

function buildDefaultQaMonths(now = new Date()) {
  return lastCompleteMonths(6, now);
}

function loadJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(dataDir, relativePath), 'utf8'));
}

function pickDevAccounts(options, roster) {
  const aliases = (options.aliases ?? 'all').split(',').map((item) => item.trim()).filter(Boolean);
  if (aliases.length === 1 && aliases[0] === 'all') {
    return roster.members.map((member) => ({ name: member.name, login: member.githubLogin, alias: member.alias }));
  }
  return aliases.map((alias) => {
    const member = roster.members.find((entry) => entry.alias === alias);
    if (!member) fail(`Unknown developer alias "${alias}".`);
    return { name: member.name, login: member.githubLogin, alias: member.alias };
  });
}

function pickQaComparisons(options, roster) {
  const aliases = (options.comparisons ?? 'default').split(',').map((item) => item.trim()).filter(Boolean);
  const selected = aliases.length === 1 && aliases[0] === 'default'
    ? roster.defaultComparisons
    : aliases.map((alias) => {
        const found = roster.defaultComparisons.find((entry) => entry.alias === alias);
        if (!found) fail(`Unknown QA comparison alias "${alias}".`);
        return found;
      });

  return selected.map((comparison) => {
    const left = roster.members.find((member) => member.alias === comparison.leftQaAlias);
    const right = roster.members.find((member) => member.alias === comparison.rightQaAlias);
    if (!left || !right) fail(`Comparison "${comparison.alias}" references an unknown QA alias.`);
    return {
      slug: comparison.slug,
      leftQa: left.name,
      rightQa: right.name,
      leftGithub: left.githubLogin,
      rightGithub: right.githubLogin,
      alias: comparison.alias,
    };
  });
}

function buildDevPairs(options) {
  if (!options['month-pairs']) return buildDefaultDevPairs();
  return options['month-pairs']
    .split(',')
    .map((pair) => pair.trim())
    .filter(Boolean)
    .map((pair) => {
      const [left, right] = pair.split(':');
      if (!left || !right) fail(`Invalid month pair "${pair}". Use YYYY-MM:YYYY-MM.`);
      return [parseMonthToken(left), parseMonthToken(right)];
    });
}

function buildQaMonths(options) {
  if (!options.months) return buildDefaultQaMonths();
  return options.months
    .split(',')
    .map((month) => month.trim())
    .filter(Boolean)
    .map(parseMonthToken);
}

function resolveQaProject(options, roster) {
  return options.project ?? roster.defaultProject ?? 'VeemTestEngineeringV26';
}

function timestampSlug(date = new Date()) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${yyyy}${mm}${dd}-${hh}${min}${ss}`;
}

function writeGeneratedScript(templatePath, replacements, filename) {
  let source = fs.readFileSync(templatePath, 'utf8');
  for (const [key, value] of Object.entries(replacements)) {
    source = source.replaceAll(key, value);
  }
  fs.mkdirSync(generatedDir, { recursive: true });
  const target = path.join(generatedDir, filename);
  fs.writeFileSync(target, source, 'utf8');
  return target;
}

function buildCommonReplacements(env, outputDir, baseUrl) {
  const account = (env.USER_ACCOUNTS ?? 'a:b').split(',')[0];
  const [username, ...passwordParts] = account.split(':');
  return {
    '__USERNAME__': username,
    '__PASSWORD__': passwordParts.join(':'),
    '__GITHUB_TOKEN__': env.GITHUB_TOKEN ?? '',
    '__GITHUB_ORG__': env.GITHUB_ORG ?? '',
    '__JIRA_BASE_URL__': env.JIRA_BASE_URL ?? 'https://aligncommerce.atlassian.net',
    '__JIRA_EMAIL__': env.JIRA_EMAIL ?? '',
    '__JIRA_API_TOKEN__': env.JIRA_API_TOKEN ?? '',
    '__JIRA_STORY_POINTS_FIELD__': env.JIRA_STORY_POINTS_FIELD ?? 'customfield_11125',
    '__TESTRAIL_BASE_URL__': env.TESTRAIL_BASE_URL ?? '',
    '__TESTRAIL_EMAIL__': env.TESTRAIL_EMAIL ?? '',
    '__TESTRAIL_API_TOKEN__': env.TESTRAIL_API_TOKEN ?? '',
    '__OUT_DIR__': outputDir.replaceAll('\\', '\\\\'),
    '__BASE_URL__': baseUrl,
  };
}

function runCommand(command, args, options = {}) {
  const { quiet = true, ...spawnOptions } = options;
  const result = spawnSync(command, args, {
    stdio: quiet ? 'pipe' : 'inherit',
    cwd: repoRoot,
    encoding: 'utf8',
    ...spawnOptions,
  });
  if (result.status !== 0) {
    failWithResult(`Command failed: ${command} ${args.join(' ')}`, result);
  }
  return result;
}

function buildDevReport(outputDir, developers, monthPairs) {
  const cards = [];
  for (const developer of developers) {
    for (const [left, right] of monthPairs) {
      const fileName = `${developer.login}-${left.label}_vs_${right.label}.png`;
      cards.push(`
<section class="card">
  <div class="meta">${developer.name}</div>
  <h2>${left.label} vs ${right.label}</h2>
  <div class="actions"><a href="${fileName}" target="_blank" rel="noreferrer">Open full screenshot</a></div>
  <a class="thumb" href="${fileName}" target="_blank" rel="noreferrer"><img src="${fileName}" alt="${developer.name} ${left.label} vs ${right.label}" loading="lazy" /></a>
</section>`);
    }
  }
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Developer Monthly Comparisons</title>
<style>
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 0; padding: 24px; background: #0f172a; color: #e5eefc; }
h1 { margin: 0 0 8px; font-size: 28px; }
p { margin: 0 0 24px; color: #94a3b8; max-width: 920px; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(360px, 1fr)); gap: 18px; }
.card { background: #111827; border: 1px solid #243041; border-radius: 18px; padding: 16px; box-shadow: 0 12px 28px rgba(0,0,0,0.28); }
.meta { font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; color: #93c5fd; margin-bottom: 6px; }
h2 { margin: 0 0 10px; font-size: 18px; }
.actions { margin-bottom: 12px; }
a { color: #93c5fd; text-decoration: none; font-weight: 600; }
.thumb { display: block; background: #020617; border: 1px solid #334155; border-radius: 14px; overflow: hidden; }
img { width: 100%; height: 420px; object-fit: contain; display: block; background: #020617; }
</style>
</head>
<body>
<h1>Developer Monthly Comparisons</h1>
<p>Contributions date-comparison mode. Each card includes a direct link to the full-height PNG.</p>
<div class="grid">${cards.join('')}</div>
</body>
</html>`;
}

function buildQaReport(outputDir, comparisons, months) {
  const cards = [];
  for (const comparison of comparisons) {
    for (const month of months) {
      const fileName = `${month.label}-${comparison.slug}.png`;
      cards.push(`
<section class="card">
  <div class="meta">${comparison.leftQa} vs ${comparison.rightQa}</div>
  <h2>${month.label}</h2>
  <div class="actions"><a href="${fileName}" target="_blank" rel="noreferrer">Open full screenshot</a></div>
  <a class="thumb" href="${fileName}" target="_blank" rel="noreferrer"><img src="${fileName}" alt="${comparison.leftQa} vs ${comparison.rightQa} ${month.label}" loading="lazy" /></a>
</section>`);
    }
  }
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>QA Monthly Comparisons</title>
<style>
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 0; padding: 24px; background: #0f172a; color: #e5eefc; }
h1 { margin: 0 0 8px; font-size: 28px; }
p { margin: 0 0 24px; color: #94a3b8; max-width: 920px; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(360px, 1fr)); gap: 18px; }
.card { background: #111827; border: 1px solid #243041; border-radius: 18px; padding: 16px; box-shadow: 0 12px 28px rgba(0,0,0,0.28); }
.meta { font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; color: #93c5fd; margin-bottom: 6px; }
h2 { margin: 0 0 10px; font-size: 18px; }
.actions { margin-bottom: 12px; }
a { color: #93c5fd; text-decoration: none; font-weight: 600; }
.thumb { display: block; background: #020617; border: 1px solid #334155; border-radius: 14px; overflow: hidden; }
img { width: 100%; height: 420px; object-fit: contain; display: block; background: #020617; }
</style>
</head>
<body>
<h1>QA Monthly Comparisons</h1>
<p>QA compare mode. Each card includes a direct link to the full-height PNG.</p>
<div class="grid">${cards.join('')}</div>
</body>
</html>`;
}

function maybeOpen(filePath, shouldOpen) {
  if (!shouldOpen) return;
  if (process.platform === 'darwin') {
    spawnSync('open', [filePath], { stdio: 'ignore' });
  }
}

const [kind, ...rest] = process.argv.slice(2);
if (!kind || !['dev', 'qa'].includes(kind)) {
  fail('Usage: node testing/run-capture.mjs <dev|qa> [--aliases ...] [--comparisons ...] [--month-pairs ...] [--months ...] [--base-url ...] [--output-dir ...] [--headless] [--no-open]');
}

const options = parseArgs(rest);
const env = { ...parseEnvFile(path.join(repoRoot, '.env')), ...process.env };
const baseUrl = options['base-url'] ?? 'http://localhost:3000';
const outputDir = path.resolve(
  repoRoot,
  options['output-dir'] ?? path.join('testing', 'output', `${kind}-${timestampSlug()}`),
);

fs.mkdirSync(outputDir, { recursive: true });
fs.mkdirSync(outputDirRoot, { recursive: true });
const pwcli = path.join(env.CODEX_HOME ?? path.join(os.homedir(), '.codex'), 'skills', 'playwright', 'scripts', 'playwright_cli.sh');
const session = options.session ?? `${kind}-capture`;
const headed = options.headed !== false;
const shouldOpen = options.open !== false;

let generatedScriptPath;
let reportHtml;

if (kind === 'dev') {
  const roster = loadJson('dev-team.json');
  const developers = pickDevAccounts(options, roster);
  const monthPairs = buildDevPairs(options);
  generatedScriptPath = writeGeneratedScript(
    path.join(templatesDir, 'dev-capture.template.js'),
    {
      ...buildCommonReplacements(env, outputDir, baseUrl),
      '__DEVELOPERS_JSON__': JSON.stringify(developers),
      '__MONTH_PAIRS_JSON__': JSON.stringify(monthPairs),
    },
    'dev-capture.generated.js',
  );
  reportHtml = buildDevReport(outputDir, developers, monthPairs);
} else {
  const roster = loadJson('qa-team.json');
  const comparisons = pickQaComparisons(options, roster);
  const months = buildQaMonths(options);
  const projectName = resolveQaProject(options, roster);
  generatedScriptPath = writeGeneratedScript(
    path.join(templatesDir, 'qa-capture.template.js'),
    {
      ...buildCommonReplacements(env, outputDir, baseUrl),
      '__QA_PROJECT__': projectName,
      '__COMPARISONS_JSON__': JSON.stringify(comparisons),
      '__MONTHS_JSON__': JSON.stringify(months),
    },
    'qa-capture.generated.js',
  );
  reportHtml = buildQaReport(outputDir, comparisons, months);
}

runCommand(pwcli, [`-s=${session}`, 'close']);
const openArgs = [`-s=${session}`, 'open', `${baseUrl}/${kind === 'dev' ? 'contributions' : 'qa'}`];
if (headed) openArgs.push('--headed');
runCommand(pwcli, openArgs);
runCommand(pwcli, [`-s=${session}`, 'run-code', '--filename', generatedScriptPath]);

const reportPath = path.join(outputDir, 'index.html');
fs.writeFileSync(reportPath, reportHtml, 'utf8');
maybeOpen(reportPath, shouldOpen);
runCommand(pwcli, [`-s=${session}`, 'close']);
fs.rmSync(generatedScriptPath, { force: true });

console.log(`\nCapture complete.`);
console.log(`Report: ${reportPath}`);
console.log(`Output directory: ${outputDir}`);
