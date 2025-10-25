module.exports = {};

const fs = require('fs').promises;
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const EXTS = ['.ts','.tsx','.js','.jsx','.mjs','.cts','.mts','.css','.sh','.zsh'];
const IGNORE = ['node_modules', '.git', '.next', 'dist', 'out', 'public'];

async function walk(dir) {
  const dirents = await fs.readdir(dir, { withFileTypes: true });
  const results = [];
  for (const d of dirents) {
    const name = path.join(dir, d.name);
    if (IGNORE.some(i => name.includes(path.sep + i + path.sep) || name.endsWith(path.sep + i))) continue;
    if (d.isDirectory()) {
      results.push(...await walk(name));
    } else {
      results.push(name);
    }
  }
  return results;
}

function stripForExt(content, ext) {
  let out = content;
  if (['.ts','.js','.mjs','.cts','.mts','.jsx','.tsx'].includes(ext)) {

    out = out.replace(/\/\*[\s\S]*?\*\

    out = out.replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

    out = out.replace(/^([^\n]*?)?\/[\/]{1}.*$/gm, (m) => {



      const idx = m.indexOf('//');
      const prefix = m.slice(0, idx);
      if (/['"`]/.test(prefix)) return m; // skip

      return prefix.replace(/\s+$/,'');
    });

    out = out.split('\n').map(l => l.replace(/\s+$/,'')).join('\n');
  } else if (ext === '.css') {
    out = out.replace(/\/\*[\s\S]*?\*\
    out = out.split('\n').map(l => l.replace(/\s+$/,'')).join('\n');
  } else if (ext === '.sh' || ext === '.zsh') {

    const lines = out.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (i === 0 && lines[i].startsWith('#!')) continue;
      if (/^\s*#/.test(lines[i])) lines[i] = '';
    }
    out = lines.join('\n');
  }
  return out;
}

(async () => {
  console.log('Scanning files from', ROOT);
  const files = await walk(ROOT);
  const targets = files.filter(f => EXTS.includes(path.extname(f).toLowerCase()));
  console.log('Found', targets.length, 'candidate files');
  let modified = 0;
  for (const f of targets) {
    try {
      const raw = await fs.readFile(f, 'utf8');
      const ext = path.extname(f).toLowerCase();
      const stripped = stripForExt(raw, ext);
      if (stripped !== raw) {

        const bak = f + '.orig';
        await fs.writeFile(bak, raw, 'utf8');
        await fs.writeFile(f, stripped, 'utf8');
        modified++;
        console.log('Modified:', path.relative(ROOT, f));
      }
    } catch (err) {
      console.error('Error processing', f, err && err.message);
    }
  }
  console.log('Completed. Modified files:', modified);
})();
