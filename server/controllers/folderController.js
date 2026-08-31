const { db } = require('../db');

exports.getFolders = async (req, res) => {
  try {
    const folders = await db.getFolders();
    res.json({ success: true, folders });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.createFolder = async (req, res) => {
  try {
    const { name, parent_id, color, icon } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, error: 'Folder name is required.' });
    }

    const folder = await db.createFolder({
      name: name.trim(),
      parent_id: parent_id || null,
      color: color || '#3b82f6',
      icon: icon || 'folder',
    });

    res.status(201).json({ success: true, folder });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.updateFolder = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, parent_id, color, icon } = req.body;

    const updates = {};
    if (name !== undefined) updates.name = name.trim();
    if (parent_id !== undefined) updates.parent_id = parent_id || null;
    if (color !== undefined) updates.color = color;
    if (icon !== undefined) updates.icon = icon;

    const updated = await db.updateFolder(id, updates);
    if (!updated) {
      return res.status(404).json({ success: false, error: 'Folder not found.' });
    }

    res.json({ success: true, folder: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.deleteFolder = async (req, res) => {
  try {
    const { id } = req.params;
    const permanent = req.query.permanent === 'true';

    await db.deleteFolder(id, permanent);
    res.json({ success: true, message: permanent ? 'Folder deleted permanently.' : 'Folder moved to trash.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.restoreFolder = async (req, res) => {
  try {
    const { id } = req.params;
    const restored = await db.restoreFolder(id);
    res.json({ success: true, folder: restored });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};
