// In-memory Real-time Upload Progress Tracker for High-Speed & Large File Uploads

class UploadTracker {
  constructor() {
    this.uploads = new Map();
    // Periodically prune stale upload entries (older than 5 minutes)
    setInterval(() => this.pruneStale(), 60000).unref();
  }

  /**
   * Initialize a new upload tracking session
   */
  init(uploadId, fileName, totalSize) {
    if (!uploadId) return;
    const now = Date.now();
    this.uploads.set(uploadId, {
      uploadId,
      fileName: fileName || 'unnamed_file',
      totalSize: Number(totalSize) || 0,
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
  }

  /**
   * Update Telegram MTProto cloud upload progress (progressRatio: 0.0 to 1.0)
   */
  updateCloudProgress(uploadId, progressRatio) {
    if (!uploadId) return;
    const item = this.uploads.get(uploadId);
    if (!item) return;

    const now = Date.now();
    if (!item.cloudStartTime) {
      item.cloudStartTime = now;
    }

    const cloudPercent = Math.min(100, Math.max(0, Math.round(progressRatio * 100)));
    const loadedBytes = Math.round(item.totalSize * progressRatio);
    const elapsedSec = Math.max(0.1, (now - item.cloudStartTime) / 1000);
    const speed = Math.round(loadedBytes / elapsedSec);

    const remainingBytes = Math.max(0, item.totalSize - loadedBytes);
    const timeRemaining = speed > 0 ? Math.round(remainingBytes / speed) : null;

    // Scale overall progress: 10% (server received) -> 98% (cloud upload finishing)
    const overallPercent = Math.min(99, Math.round(10 + (cloudPercent * 0.88)));

    item.stage = 'telegram';
    item.stageText = `Syncing to Telegram Cloud (${cloudPercent}%)`;
    item.cloudPercent = cloudPercent;
    item.overallPercent = overallPercent;
    item.loadedBytes = loadedBytes;
    item.speed = speed;
    item.timeRemaining = timeRemaining;
    item.updatedAt = now;
  }

  /**
   * Mark upload as finalizing (database insertion)
   */
  finalizing(uploadId) {
    if (!uploadId) return;
    const item = this.uploads.get(uploadId);
    if (!item) return;

    item.stage = 'finalizing';
    item.stageText = 'Finalizing file record...';
    item.cloudPercent = 100;
    item.overallPercent = 99;
    item.updatedAt = Date.now();
  }

  /**
   * Mark upload as successfully completed
   */
  complete(uploadId) {
    if (!uploadId) return;
    const item = this.uploads.get(uploadId);
    if (!item) return;

    item.stage = 'completed';
    item.stageText = 'Upload completed!';
    item.cloudPercent = 100;
    item.overallPercent = 100;
    item.loadedBytes = item.totalSize;
    item.timeRemaining = 0;
    item.updatedAt = Date.now();

    // Clean up record after 2 minutes
    setTimeout(() => {
      this.uploads.delete(uploadId);
    }, 120000).unref();
  }

  /**
   * Mark upload as failed
   */
  error(uploadId, errorMsg) {
    if (!uploadId) return;
    const item = this.uploads.get(uploadId);
    if (!item) return;

    item.stage = 'error';
    item.stageText = 'Upload failed';
    item.error = errorMsg || 'An unknown error occurred during upload';
    item.updatedAt = Date.now();

    setTimeout(() => {
      this.uploads.delete(uploadId);
    }, 120000).unref();
  }

  /**
   * Get progress for a specific upload
   */
  get(uploadId) {
    if (!uploadId) return null;
    return this.uploads.get(uploadId) || null;
  }

  /**
   * Prune stale entries
   */
  pruneStale() {
    const cutoff = Date.now() - 5 * 60 * 1000;
    for (const [id, item] of this.uploads.entries()) {
      if (item.updatedAt < cutoff) {
        this.uploads.delete(id);
      }
    }
  }
}

module.exports = new UploadTracker();
