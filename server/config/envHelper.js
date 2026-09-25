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

const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Values that contain dotenv-significant characters are JSON quoted so spaces,
 * comments, quotes, backslashes, and newlines round-trip safely.
 */
function serializeEnvValue(value) {
  const normalized = value === null || value === undefined ? '' : String(value);
  if (!/[\r\n#]/.test(normalized) && normalized === normalized.trim()) {
    return normalized;
  }
  return JSON.stringify(normalized);
}

/**
 * Updates process.env and safely writes changes to the local .env file.
 * Invalid environment variable names are rejected instead of being injected
 * into the dotenv file as arbitrary lines.
 */
function updateEnvFile(updates) {
  if (!updates || typeof updates !== 'object' || Array.isArray(updates)) return false;

  const entries = Object.entries(updates).filter(([key]) => ENV_KEY_PATTERN.test(key));
  if (entries.length === 0) return false;

  // Update in-memory process.env only after validating every supplied key.
  for (const [key, value] of entries) {
    if (value === null || value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = String(value);
    }
  }

  try {
    const targetFile = getEnvFilePath();
    let content = fs.existsSync(targetFile) ? fs.readFileSync(targetFile, 'utf8') : '';

    for (const [key, value] of entries) {
      const serialized = `${key}=${serializeEnvValue(value)}`;
      const linePattern = new RegExp(`^${key}\\s*=.*$`, 'm');
      content = linePattern.test(content)
        ? content.replace(linePattern, serialized)
        : `${content.trimEnd()}${content.length ? '\n' : ''}${serialized}\n`;
    }

    fs.mkdirSync(path.dirname(targetFile), { recursive: true });
    const tempFile = `${targetFile}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tempFile, content.trim() + '\n', { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tempFile, targetFile);

    if (process.platform !== 'win32') {
      fs.chmodSync(targetFile, 0o600);
    }
    return true;
  } catch (err) {
    console.warn('[EnvHelper] Notice: Could not write .env to disk (normal in read-only serverless):', err.message);
    return false;
  }
}

module.exports = {
  getEnvFilePath,
  serializeEnvValue,
  updateEnvFile,
};
