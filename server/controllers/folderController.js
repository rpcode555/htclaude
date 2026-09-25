const { db, getSetting } = require('../db');
const telegramService = require('../services/telegramService');

const MAX_FOLDER_NAME_LENGTH = 120;
const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/**
 * Normalise + validate a folder name coming from the client.
 * Returns { name } or { error }.
 */
function validateFolderName(rawName) {
  if (typeof rawName !== 'string') {
    return { error: 'Folder name must be a string.' };
  }
  // Strip control characters (header/JSON/log injection) before validating.
  const name = rawName.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!name) {
    return { error: 'Folder name is required.' };
  }
  if (name.length > MAX_FOLDER_NAME_LENGTH) {
    return { error: `Folder name must be ${MAX_FOLDER_NAME_LENGTH} characters or fewer.` };
  }
  if (name === '.' || name === '..') {
    return { error: 'Folder name cannot be "." or "..".' };
  }
  return { name };
}

function validateColor(rawColor) {
  if (rawColor === undefined || rawColor === null || rawColor === '') return { color: undefined };
  if (typeof rawColor !== 'string' || !HEX_COLOR_RE.test(rawColor.trim())) {
    return { error: 'Folder color must be a hex color such as #3b82f6.' };
  }
  return { color: rawColor.trim() };
}

function validateIcon(rawIcon) {
  if (rawIcon === undefined || rawIcon === null || rawIcon === '') return { icon: undefined };
  if (typeof rawIcon !== 'string') {
    return { error: 'Folder icon must be a string.' };
  }
  const icon = rawIcon.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (icon.length > 40) {
    return { error: 'Folder icon must be 40 characters or fewer.' };
  }
  return { icon: icon || undefined };
}

/**
 * Walk the `parent_id` chain upwards from `startId` and report whether
 * `targetId` is reached, i.e. whether `startId` IS `targetId` or lives inside
 * it. Moving a folder to such a parent would create a cycle. The walk is guarded
 * by a visited set so a pre-existing cycle in the stored data cannot hang it.
 */
function isSelfOrDescendantOf(startId, targetId, foldersById) {
  const seen = new Set();
  let currentId = startId;

  while (currentId && !seen.has(currentId)) {
    if (currentId === targetId) return true;
    seen.add(currentId);
    const current = foldersById.get(currentId);
    currentId = current ? current.parent_id : null;
  }

  // Ended on an already visited node => the stored data itself is cyclic, so the
  // requested move cannot be proven safe and is refused.
  return currentId !== null && currentId !== undefined;
}

exports.getFolders = async (req, res) => {
  try {
    const isManualDisconnected = (await getSetting('manual_disconnect')) === true;
    const sessionString = String((await getSetting('session_string')) || process.env.TELEGRAM_SESSION_STRING || '').trim();
    const clientSession = String(req.headers?.['x-telegram-session'] || req.query?.session || '').trim();
    const activeSession = sessionString || clientSession;

    // Auto-sync if connected and only default folders exist
    if (!isManualDisconnected && activeSession) {
      const customFolders = (db.data.folders || []).filter(
        (f) => !['root_documents', 'root_media', 'root_photos'].includes(f.id)
      );
      if (customFolders.length === 0) {
        try {
          await telegramService.syncFromTelegramSavedMessages(activeSession);
        } catch (e) {
          // Non-blocking
        }
      }
    }

    const folders = await db.getFolders();
    if (isManualDisconnected || !activeSession) {
      // When disconnected from Telegram, hide custom folders created while connected and zero out counts
      const defaultFolderIds = ['root_documents', 'root_media', 'root_photos'];
      const defaultFolders = (folders || [])
        .filter((f) => defaultFolderIds.includes(f.id))
        .map((f) => ({ ...f, file_count: 0, total_size: 0 }));
      return res.json({ success: true, folders: defaultFolders });
    }

    res.json({ success: true, folders: folders || [] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.createFolder = async (req, res) => {
  try {
    const { parent_id, color, icon } = req.body || {};

    const nameResult = validateFolderName(req.body?.name);
    if (nameResult.error) {
      return res.status(400).json({ success: false, error: nameResult.error });
    }

    const colorResult = validateColor(color);
    if (colorResult.error) {
      return res.status(400).json({ success: false, error: colorResult.error });
    }

    const iconResult = validateIcon(icon);
    if (iconResult.error) {
      return res.status(400).json({ success: false, error: iconResult.error });
    }

    // A brand new folder has no children yet, so only the parent's existence
    // and its state have to be checked here (cycles are impossible by
    // construction, but an unknown/trashed parent would orphan the folder).
    let parentId = null;
    if (parent_id !== undefined && parent_id !== null && parent_id !== '' && parent_id !== 'root') {
      if (typeof parent_id !== 'string') {
        return res.status(400).json({ success: false, error: 'Parent folder id must be a string.' });
      }
      // Read through getFolders() so a folder that only exists in the cloud
      // (not yet pulled into the local cache) is not reported as missing.
      const allFolders = (await db.getFolders()) || [];
      const parent = allFolders.find((f) => f.id === parent_id);
      if (!parent) {
        return res.status(400).json({ success: false, error: 'Parent folder not found.' });
      }
      if (parent.is_trash) {
        return res.status(400).json({ success: false, error: 'Parent folder is in the Recycle Bin. Restore it first.' });
      }
      parentId = parent.id;
    }

    const folder = await db.createFolder({
      name: nameResult.name,
      parent_id: parentId,
      color: colorResult.color || '#3b82f6',
      icon: iconResult.icon || 'folder',
    });

    res.status(201).json({ success: true, folder });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.updateFolder = async (req, res) => {
  try {
    const { id } = req.params;
    const { parent_id, color, icon } = req.body || {};

    // Read through getFolders() so a stale local cache (cloud sync) cannot make
    // a valid folder look missing.
    const allFolders = (await db.getFolders()) || [];
    const existing = allFolders.find((f) => f.id === id);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Folder not found.' });
    }

    const updates = {};

    if (req.body?.name !== undefined) {
      const nameResult = validateFolderName(req.body.name);
      if (nameResult.error) {
        return res.status(400).json({ success: false, error: nameResult.error });
      }
      updates.name = nameResult.name;
    }

    if (color !== undefined) {
      const colorResult = validateColor(color);
      if (colorResult.error) {
        return res.status(400).json({ success: false, error: colorResult.error });
      }
      if (colorResult.color) updates.color = colorResult.color;
    }

    if (icon !== undefined) {
      const iconResult = validateIcon(icon);
      if (iconResult.error) {
        return res.status(400).json({ success: false, error: iconResult.error });
      }
      if (iconResult.icon) updates.icon = iconResult.icon;
    }

    if (parent_id !== undefined) {
      const nextParentId =
        parent_id === null || parent_id === '' || parent_id === 'root' ? null : parent_id;

      if (nextParentId !== null) {
        if (typeof nextParentId !== 'string') {
          return res.status(400).json({ success: false, error: 'Parent folder id must be a string.' });
        }
        if (nextParentId === id) {
          return res.status(400).json({ success: false, error: 'A folder cannot be its own parent.' });
        }

        const parent = allFolders.find((f) => f.id === nextParentId);
        if (!parent) {
          return res.status(400).json({ success: false, error: 'Parent folder not found.' });
        }
        if (parent.is_trash) {
          return res.status(400).json({ success: false, error: 'Parent folder is in the Recycle Bin. Restore it first.' });
        }

        const foldersById = new Map(allFolders.map((f) => [f.id, f]));
        // The new parent must not be the folder itself or one of its children.
        if (isSelfOrDescendantOf(nextParentId, id, foldersById)) {
          return res.status(400).json({ success: false, error: 'Cannot move a folder inside itself or one of its own subfolders.' });
        }
      }

      updates.parent_id = nextParentId;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ success: false, error: 'No valid fields provided to update.' });
    }

    const updated = await db.updateFolder(id, updates);
    if (!updated) {
      return res.status(404).json({ success: false, error: 'Folder not found.' });
    }

    res.json({ success: true, folder: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

/**
 * Collect every descendant of `folderId` (breadth first, cycle safe).
 */
function collectDescendants(folders, folderId) {
  const childrenByParent = new Map();
  for (const folder of folders) {
    if (!folder || !folder.parent_id) continue;
    if (!childrenByParent.has(folder.parent_id)) childrenByParent.set(folder.parent_id, []);
    childrenByParent.get(folder.parent_id).push(folder);
  }

  const descendants = [];
  const seen = new Set([folderId]);
  const queue = [folderId];

  while (queue.length > 0) {
    const currentId = queue.shift();
    for (const child of childrenByParent.get(currentId) || []) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      descendants.push(child);
      queue.push(child.id);
    }
  }

  return descendants;
}

exports.deleteFolder = async (req, res) => {
  try {
    const { id } = req.params;
    const permanent = req.query.permanent === 'true' || req.query.permanent === true;

    const allFolders = (await db.getFolders()) || [];
    const target = allFolders.find((f) => f.id === id);
    if (!target) {
      return res.status(404).json({ success: false, error: 'Folder not found.' });
    }

    // Child folders must follow their parent, otherwise they would be orphaned
    // (invisible in the tree but still holding files / API key bindings).
    const descendants = collectDescendants(allFolders, id);

    let deletedCount = 0;
    await db.deleteFolder(id, permanent);
    deletedCount += 1;

    for (const child of descendants) {
      if (permanent) {
        await db.deleteFolder(child.id, true);
      } else {
        await db.updateFolder(child.id, { is_trash: 1 });
      }
      deletedCount += 1;
    }

    res.json({
      success: true,
      message: permanent
        ? `Folder${deletedCount > 1 ? ` and ${deletedCount - 1} subfolder(s)` : ''} deleted permanently.`
        : `Folder${deletedCount > 1 ? ` and ${deletedCount - 1} subfolder(s)` : ''} moved to trash.`,
      deletedCount,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.restoreFolder = async (req, res) => {
  try {
    const { id } = req.params;

    const allFolders = (await db.getFolders()) || [];
    const target = allFolders.find((f) => f.id === id);
    if (!target) {
      return res.status(404).json({ success: false, error: 'Folder not found.' });
    }

    const restored = await db.restoreFolder(id);
    if (!restored) {
      return res.status(404).json({ success: false, error: 'Folder not found.' });
    }

    // Restore the descendants that were trashed together with this folder, but
    // only while their own parent chain is intact.
    const descendants = collectDescendants(allFolders, id);
    const byId = new Map(allFolders.map((f) => [f.id, f]));
    for (const child of descendants) {
      const parent = byId.get(child.parent_id);
      if (!parent || parent.is_trash) continue;
      await db.updateFolder(child.id, { is_trash: 0 });
    }

    res.json({ success: true, folder: restored });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};
