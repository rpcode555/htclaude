const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const targets = ['server', 'api'];
const extensions = new Set(['.js', '.cjs', '.mjs']);
const failures = [];

function collect(entry) {
  const stat = fs.statSync(entry);
  if (stat.isDirectory()) {
    if (['node_modules', 'uploads', 'data'].includes(path.basename(entry))) return;
    for (const child of fs.readdirSync(entry)) collect(path.join(entry, child));
    return;
  }
  if (!extensions.has(path.extname(entry))) return;

  const result = spawnSync(process.execPath, ['--check', entry], {
    cwd: root,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    failures.push({
      file: path.relative(root, entry),
      output: `${result.stdout || ''}${result.stderr || ''}`.trim(),
    });
  }
}

for (const target of targets) collect(path.join(root, target));

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`\nSyntax check failed: ${failure.file}`);
    if (failure.output) console.error(failure.output);
  }
  process.exitCode = 1;
} else {
  console.log('Server and API syntax checks passed.');
}
