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

module.exports = {
  isServerless,
  DATA_DIR,
  UPLOADS_DIR,
  CACHE_DIR,
  TEMP_UPLOAD_DIR,
  isSafePath: (targetPath) => {
    if (!targetPath) return false;
    const resolved = path.resolve(targetPath);
    return (
      resolved.startsWith(UPLOADS_DIR) ||
      resolved.startsWith(CACHE_DIR) ||
      resolved.startsWith(TEMP_UPLOAD_DIR) ||
      resolved.startsWith(os.tmpdir())
    );
  },
};
