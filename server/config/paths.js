const path = require('path');
const fs = require('fs');
const os = require('os');

const isServerless = !!(
  process.env.VERCEL ||
  process.env.AWS_LAMBDA_FUNCTION_NAME ||
  process.env.LAMBDA_TASK_ROOT ||
  process.env.NETLIFY
);

/**
 * Returns a writable path, falling back to os.tmpdir() if the target directory is read-only (like Vercel serverless)
 */
function getSafeWritableDir(localRelPath, tmpSubDir) {
  const localPath = path.resolve(__dirname, '../../', localRelPath);

  if (!isServerless) {
    try {
      if (!fs.existsSync(localPath)) {
        fs.mkdirSync(localPath, { recursive: true });
      }
      const testFile = path.join(localPath, `.test_write_${Date.now()}`);
      fs.writeFileSync(testFile, 'ok');
      fs.unlinkSync(testFile);
      return localPath;
    } catch (e) {
      // Fallback if local path is not writable
    }
  }

  const tmpPath = path.join(os.tmpdir(), tmpSubDir || path.basename(localRelPath));
  try {
    if (!fs.existsSync(tmpPath)) {
      fs.mkdirSync(tmpPath, { recursive: true });
    }
  } catch (e) {
    console.error(`[Paths] Failed to create tmp dir ${tmpPath}:`, e.message);
  }
  return tmpPath;
}

const DATA_DIR = getSafeWritableDir('server/data', 'telecloud_data');
const UPLOADS_DIR = getSafeWritableDir('server/uploads', 'telecloud_uploads');
const CACHE_DIR = getSafeWritableDir('server/uploads/cache', 'telecloud_cache');
const TEMP_UPLOAD_DIR = getSafeWritableDir('server/temp_uploads', 'telecloud_temp');

const TMP_ROOT = path.resolve(os.tmpdir());

/**
 * Sub-directories of os.tmpdir() that belong to this app (see the fallback in
 * getSafeWritableDir). Only these are treated as readable storage roots when
 * running on a serverless runtime - the OS temp folder itself holds unrelated
 * (and sometimes secret) files and must never be served.
 */
const TMP_STORAGE_SUBDIRS = ['telecloud_uploads', 'telecloud_cache', 'telecloud_temp'];

/**
 * Directories that may legitimately contain user-uploaded bytes.
 * Anything outside of these roots (most importantly DATA_DIR, which holds the
 * JSON database, the Telegram session string and API credentials) is never a
 * safe read/serve target.
 */
const ALLOWED_STORAGE_ROOTS = [
  UPLOADS_DIR,
  CACHE_DIR,
  TEMP_UPLOAD_DIR,
  ...TMP_STORAGE_SUBDIRS.map((sub) => path.join(TMP_ROOT, sub)),
].filter(Boolean);

/**
 * Returns true when `targetPath` is a *child* of `rootDir`.
 * Uses path.relative() so the check is boundary aware: a plain
 * `startsWith()` comparison would wrongly accept sibling directories such as
 * "/tmp/telecloud_uploads_evil/x" for the root "/tmp/telecloud_uploads".
 */
function isInsideRoot(rootDir, targetPath) {
  if (!rootDir || !targetPath) return false;
  const root = path.resolve(rootDir);
  const rel = path.relative(root, path.resolve(targetPath));
  // Empty => target IS the root (a directory, not a file) => not a valid hit.
  if (!rel) return false;
  if (rel === '..') return false;
  if (rel.startsWith('..' + path.sep)) return false;
  // A different Windows drive still yields an absolute relative path.
  if (path.isAbsolute(rel)) return false;
  return true;
}

/**
 * Boundary-safe check that a path points inside a storage root this app owns.
 */
function isSafePath(targetPath) {
  if (!targetPath || typeof targetPath !== 'string') return false;

  // NUL bytes / control characters are never valid in a real file path and are
  // a classic way to smuggle a traversal past naive string checks.
  if (/[\u0000-\u001f\u007f]/.test(targetPath)) return false;

  let resolved;
  try {
    resolved = path.resolve(targetPath);
  } catch (e) {
    return false;
  }

  // The JSON database + settings/secrets store is never a safe serve target,
  // even on serverless where it happens to live inside the OS temp folder.
  if (isInsideRoot(DATA_DIR, resolved)) return false;

  return ALLOWED_STORAGE_ROOTS.some((root) => isInsideRoot(root, resolved));
}

module.exports = {
  isServerless,
  DATA_DIR,
  UPLOADS_DIR,
  CACHE_DIR,
  TEMP_UPLOAD_DIR,
  ALLOWED_STORAGE_ROOTS,
  TMP_ROOT,
  isInsideRoot,
  isSafePath,
};
