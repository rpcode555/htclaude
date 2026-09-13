const fs = require('fs');
const path = require('path');

function getEnvFilePath() {
  const candidates = [
    path.resolve(__dirname, '../.env'),
    path.resolve(__dirname, '../../.env'),
    path.resolve(process.cwd(), 'server/.env'),
    path.resolve(process.cwd(), '.env'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return path.resolve(__dirname, '../.env');
}

/**
 * Updates process.env and safely writes changes to the local .env file
 */
function updateEnvFile(updates) {
  if (!updates || typeof updates !== 'object') return false;

  // 1. Update in-memory process.env immediately
  for (const [k, v] of Object.entries(updates)) {
    if (v === null || v === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = String(v);
    }
  }

  // 2. Persist to disk if .env file exists or is creatable
  try {
    const targetFile = getEnvFilePath();
    let content = '';
    if (fs.existsSync(targetFile)) {
      content = fs.readFileSync(targetFile, 'utf8');
    }

    for (const [key, value] of Object.entries(updates)) {
      const valStr = value === null || value === undefined ? '' : String(value);
      const regex = new RegExp(`^${key}=.*$`, 'm');
      if (regex.test(content)) {
        content = content.replace(regex, `${key}=${valStr}`);
      } else {
        content = (content.trimEnd() + `\n${key}=${valStr}\n`).trimStart();
      }
    }

    fs.writeFileSync(targetFile, content.trim() + '\n', 'utf8');
    return true;
  } catch (err) {
    console.warn('[EnvHelper] Notice: Could not write .env to disk (normal in read-only serverless):', err.message);
    return false;
  }
}

module.exports = {
  getEnvFilePath,
  updateEnvFile,
};
