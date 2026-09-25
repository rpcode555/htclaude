// In-memory Real-time Upload Progress Tracker for High-Speed & Large File Uploads
//
// Safety rules enforced here:
//  - every public method is total (never throws) so progress reporting can never
//    break an upload request;
//  - the store is hard-bounded (MAX_TRACKED_UPLOADS) and pruned, so a flood of
//    client supplied upload ids cannot exhaust memory on a long-lived process;
//  - progress ratios/sizes are coerced to finite numbers and clamped, so
//    NaN/negative/huge client input cannot poison the JSON response;
//  - entries may optionally be bound to an owner id; a mismatched owner cannot
//    read another uploader's progress (see get()).

const MAX_TRACKED_UPLOADS = 200;
const STALE_AFTER_MS = 5 * 60 * 1000;
const FINISHED_AFTER_MS = 2 * 60 * 1000;
const MAX_UPLOAD_ID_LENGTH = 200;
const MAX_FILE_NAME_LENGTH = 255;
const PRUNE_INTERVAL_MS = 60000;

class UploadTracker {
  constructor() {
    this.uploads = new Map();
    // Periodically prune stale upload entries. `unref()` keeps the process from
    // being held open by the timer and does not exist in some bundled runtimes.
    this.pruneTimer = null;
    try {
      this.pruneTimer = setInterval(() => this.pruneStale(), PRUNE_INTERVAL_MS);
      if (this.pruneTimer && typeof this.pruneTimer.unref === 'function') {
        this.pruneTimer.unref();
      }
    } catch (e) {
      this.pruneTimer = null;
    }
  }

  /**
   * Normalize an untrusted upload id. Returns null when the id is unusable.
   */
  normalizeUploadId(uploadId) {
    if (typeof uploadId !== 'string') return null;
    const id = uploadId.trim();
    if (!id || id.length > MAX_UPLOAD_ID_LENGTH) return null;
    return id;
  }

  /**
   * Coerce an untrusted size into a finite, non-negative number.
   */
  normalizeSize(totalSize) {
    const size = Number(totalSize);
    if (!Number.isFinite(size) || size < 0) return 0;
    return size;
  }

  /**
   * Coerce an untrusted progress ratio into the 0..1 range.
   * Returns null when the value cannot be used.
   */
  normalizeRatio(progressRatio) {
    if (progressRatio && typeof progressRatio === 'object' && 'progress' in progressRatio) {
        progressRatio = progressRatio.progress;
    }
    const ratio = Number(progressRatio);
    if (!Number.isFinite(ratio)) return null;
    return Math.min(1, Math.max(0, ratio));
  }

  sanitizeFileName(fileName) {
    const raw = typeof fileName === 'string' ? fileName : String(fileName ?? '');
    // Strip control characters (log/JSON injection) and cap the length.
    const clean = raw.replace(/[\u0000-\u001f\u007f]/g, '').trim();
    return (clean || 'unnamed_file').slice(0, MAX_FILE_NAME_LENGTH);
  }

  /**
   * Make room for a new entry. Returns false when the store is full and nothing
   * could be evicted (in that case the upload simply proceeds untracked).
   */
  makeRoom() {
    if (this.uploads.size < MAX_TRACKED_UPLOADS) return true;
    this.pruneStale();

    if (this.uploads.size < MAX_TRACKED_UPLOADS) return true;

    // Evict the oldest entry (Map preserves insertion order).
    const oldestKey = this.uploads.keys().next().value;
    if (oldestKey !== undefined) {
      this.uploads.delete(oldestKey);
      return true;
    }
    return false;
  }

  /**
   * Initialize a new upload tracking session.
   * `meta.ownerId` (optional) binds the entry so only the same owner can read it.
   */
  init(uploadId, fileName, totalSize, meta = {}) {
    try {
      const id = this.normalizeUploadId(uploadId);
      if (!id) return false;
      if (!this.makeRoom()) return false;

      const now = Date.now();
      const ownerId =
        meta && meta.ownerId !== undefined && meta.ownerId !== null && meta.ownerId !== ''
          ? String(meta.ownerId)
          : null;

      this.uploads.set(id, {
        uploadId: id,
        ownerId,
        fileName: this.sanitizeFileName(fileName),
        totalSize: this.normalizeSize(totalSize),
        stage: 'server', // 'server' | 'telegram' | 'finalizing' | 'completed' | 'error'
        stageText: 'Receiving file on server...',
        serverPercent: 100,
        cloudPercent: 0,
        overallPercent: 10,
        loadedBytes: 0,
        speed: 0, // bytes/second
        timeRemaining: null, // estimated seconds remaining
        startTime: now,
        cloudStartTime: null,
        updatedAt: now,
        error: null,
      });
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * Update Telegram MTProto cloud upload progress (progressRatio: 0.0 to 1.0)
   */
  updateCloudProgress(uploadId, progressRatio) {
    try {
      const id = this.normalizeUploadId(uploadId);
      if (!id) return false;
      const item = this.uploads.get(id);
      if (!item) return false;
      // Never resurrect a finished upload.
      if (item.stage === 'completed' || item.stage === 'error') return false;

      const ratio = this.normalizeRatio(progressRatio);
      if (ratio === null) return false;

      const now = Date.now();
      if (!item.cloudStartTime) {
        item.cloudStartTime = now;
      }

      const cloudPercent = Math.min(100, Math.max(0, Math.round(ratio * 100)));
      const loadedBytes = Math.min(item.totalSize || 0, Math.round(item.totalSize * ratio));
      const elapsedSec = Math.max(0.1, (now - item.cloudStartTime) / 1000);
      const speed = Math.max(0, Math.round(loadedBytes / elapsedSec));

      const remainingBytes = Math.max(0, (item.totalSize || 0) - loadedBytes);
      const timeRemaining = speed > 0 ? Math.round(remainingBytes / speed) : null;

      // Scale overall progress: 10% (server received) -> 98% (cloud upload finishing)
      const overallPercent = Math.min(99, Math.round(10 + cloudPercent * 0.88));

      // Progress must never move backwards for the same stage.
      if (cloudPercent >= item.cloudPercent) {
        item.stage = 'telegram';
        item.stageText = `Syncing to Telegram Cloud (${cloudPercent}%)`;
        item.cloudPercent = cloudPercent;
        item.overallPercent = Math.max(item.overallPercent, overallPercent);
        item.loadedBytes = Math.max(item.loadedBytes, loadedBytes);
        item.speed = speed;
        item.timeRemaining = timeRemaining;
      }
      item.updatedAt = now;
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * Mark upload as finalizing (database insertion)
   */
  finalizing(uploadId) {
    try {
      const id = this.normalizeUploadId(uploadId);
      if (!id) return false;
      const item = this.uploads.get(id);
      if (!item) return false;
      if (item.stage === 'error') return false;

      item.stage = 'finalizing';
      item.stageText = 'Finalizing file record...';
      item.cloudPercent = 100;
      item.overallPercent = Math.max(item.overallPercent, 99);
      item.loadedBytes = item.totalSize;
      item.speed = 0;
      item.timeRemaining = null;
      item.updatedAt = Date.now();
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * Mark upload as successfully completed
   */
  complete(uploadId) {
    try {
      const id = this.normalizeUploadId(uploadId);
      if (!id) return false;
      const item = this.uploads.get(id);
      if (!item) return false;

      item.stage = 'completed';
      item.stageText = 'Upload completed!';
      item.cloudPercent = 100;
      item.overallPercent = 100;
      item.loadedBytes = item.totalSize;
      item.speed = 0;
      item.timeRemaining = 0;
      item.error = null;
      item.updatedAt = Date.now();

      // Clean up record after 2 minutes
      this.scheduleRemoval(id, 120000);
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * Mark upload as failed
   */
  error(uploadId, errorMsg) {
    try {
      const id = this.normalizeUploadId(uploadId);
      if (!id) return false;
      const item = this.uploads.get(id);
      if (!item) return false;

      item.stage = 'error';
      item.stageText = 'Upload failed';
      item.error = this.sanitizeFileName(errorMsg || 'An unknown error occurred during upload');
      item.overallPercent = Math.min(item.overallPercent, 99);
      item.speed = 0;
      item.timeRemaining = null;
      item.updatedAt = Date.now();

      this.scheduleRemoval(id, 120000);
      return true;
    } catch (e) {
      return false;
    }
  }

  scheduleRemoval(uploadId, delay) {
    try {
      const timer = setTimeout(() => {
        this.uploads.delete(uploadId);
      }, delay);
      if (timer && typeof timer.unref === 'function') timer.unref();
    } catch (e) {
      /* best effort */
    }
  }

  /**
   * Get progress for a specific upload.
   * Returns an immutable snapshot (never the live internal object).
   * When `ownerId` is supplied it must match the owner the entry was created with.
   */
  get(uploadId, ownerId = null) {
    try {
      const id = this.normalizeUploadId(uploadId);
      if (!id) return null;
      const item = this.uploads.get(id);
      if (!item) return null;

      if (item.ownerId && ownerId !== null && ownerId !== undefined) {
        if (String(ownerId) !== item.ownerId) return null;
      }

      const snapshot = { ...item };
      // The owner id is internal bookkeeping - never leak it to the client.
      delete snapshot.ownerId;
      return snapshot;
    } catch (e) {
      return null;
    }
  }

  /**
   * Prune stale entries (and long-finished ones)
   */
  pruneStale() {
    try {
      const now = Date.now();
      const staleCutoff = now - STALE_AFTER_MS;
      const finishedCutoff = now - FINISHED_AFTER_MS;

      for (const [id, item] of this.uploads.entries()) {
        const isFinished = item.stage === 'completed' || item.stage === 'error';
        if (item.updatedAt < (isFinished ? Math.max(staleCutoff, finishedCutoff) : staleCutoff)) {
          this.uploads.delete(id);
        }
      }
      return this.uploads.size;
    } catch (e) {
      return this.uploads.size;
    }
  }

  /**
   * Number of tracked uploads (diagnostics / tests)
   */
  size() {
    return this.uploads.size;
  }

  /**
   * Stop the prune timer (used by tests and graceful shutdown).
   */
  stop() {
    if (this.pruneTimer) {
      try {
        clearInterval(this.pruneTimer);
      } catch (e) {}
      this.pruneTimer = null;
    }
  }
}

module.exports = new UploadTracker();
module.exports.UploadTracker = UploadTracker;
