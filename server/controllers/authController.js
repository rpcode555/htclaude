const telegramService = require('../services/telegramService');
const { getSetting, setSetting, getAllSettings } = require('../db');

exports.getStatus = async (req, res) => {
  try {
    const status = await telegramService.getStatus();
    const settings = await getAllSettings();

    // Redact sensitive keys
    const safeSettings = {
      auth_type: status.authType,
      api_id: settings.api_id ? '******' + settings.api_id.slice(-3) : '',
      phone_number: settings.phone_number ? '******' + settings.phone_number.slice(-4) : '',
      has_session: !!(process.env.TELEGRAM_SESSION_STRING || settings.session_string),
      chat_id: 'me',
      auto_backup: settings.auto_backup || '1',
    };

    res.json({
      success: true,
      ...status,
      settings: safeSettings,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.sendCode = async (req, res) => {
  try {
    let { apiId, apiHash, phoneNumber } = req.body;
    if (!apiId) {
      apiId = await getSetting('api_id');
    }
    if (!apiHash) {
      apiHash = await getSetting('api_hash');
    }

    if (!phoneNumber) {
      return res.status(400).json({
        success: false,
        error: 'Phone number is required (e.g. +91 9876543210).',
      });
    }

    if (!apiId || !apiHash) {
      return res.status(400).json({
        success: false,
        error: 'Telegram API credentials not configured. Please provide API ID & API Hash or set TELEGRAM_API_ID and TELEGRAM_API_HASH in server environment.',
      });
    }

    const result = await telegramService.sendPhoneCode(apiId, apiHash, phoneNumber);
    res.json(result);
  } catch (err) {
    console.error('[Auth] sendCode error:', err);
    res.status(400).json({ success: false, error: err.message || 'Failed to send login code.' });
  }
};

exports.verifyCode = async (req, res) => {
  try {
    const { code, password, phoneCodeHash, phoneNumber, tempSession } = req.body;
    if (!code) {
      return res.status(400).json({ success: false, error: 'Verification code is required.' });
    }

    const result = await telegramService.verifyPhoneCode(code, password, phoneCodeHash, phoneNumber, tempSession);
    res.json(result);
  } catch (err) {
    console.error('[Auth] verifyCode error:', err);
    res.status(400).json({ success: false, error: err.message || 'Failed to verify code.' });
  }
};

exports.connectSessionString = async (req, res) => {
  try {
    let { apiId, apiHash, sessionString } = req.body;
    if (!apiId) apiId = await getSetting('api_id');
    if (!apiHash) apiHash = await getSetting('api_hash');

    if (!sessionString) {
      return res.status(400).json({
        success: false,
        error: 'Telegram Session String is required.',
      });
    }
    if (!apiId || !apiHash) {
      return res.status(400).json({
        success: false,
        error: 'Telegram API ID & API Hash are missing.',
      });
    }

    const result = await telegramService.connectSessionString(apiId, apiHash, sessionString);
    res.json(result);
  } catch (err) {
    console.error('[Auth] connectSessionString error:', err);
    res.status(400).json({ success: false, error: err.message || 'Failed to connect with session string.' });
  }
};

exports.getQrCode = async (req, res) => {
  try {
    let { apiId, apiHash } = req.body || {};
    if (!apiId) apiId = await getSetting('api_id');
    if (!apiHash) apiHash = await getSetting('api_hash');

    const result = await telegramService.getQrCode(apiId, apiHash);
    res.json(result);
  } catch (err) {
    console.error('[Auth] getQrCode error:', err);
    res.status(400).json({ success: false, error: err.message || 'Failed to generate QR code.' });
  }
};

exports.checkQrCode = async (req, res) => {
  try {
    let { tempSession, password, apiId, apiHash } = req.body || {};
    if (!tempSession) {
      return res.status(400).json({ success: false, error: 'QR session is required.' });
    }
    if (!apiId) apiId = await getSetting('api_id');
    if (!apiHash) apiHash = await getSetting('api_hash');

    const result = await telegramService.checkQrCode(tempSession, password, apiId, apiHash);
    res.json(result);
  } catch (err) {
    console.error('[Auth] checkQrCode error:', err);
    res.status(400).json({ success: false, error: err.message || 'Failed to check QR login status.' });
  }
};

exports.backupDatabase = async (req, res) => {
  try {
    const result = await telegramService.backupDatabaseToSavedMessages();
    if (!result.success) {
      return res.status(400).json(result);
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.disconnect = async (req, res) => {
  try {
    const result = await telegramService.disconnect();
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.updateSettings = async (req, res) => {
  try {
    const { auth_type, chat_id, auto_backup } = req.body;
    if (auth_type !== undefined) await setSetting('auth_type', auth_type);
    if (chat_id !== undefined) await setSetting('chat_id', chat_id);
    if (auto_backup !== undefined) await setSetting('auto_backup', auto_backup);

    res.json({ success: true, message: 'Settings updated successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.getMe = async (req, res) => {
  try {
    res.json({
      success: true,
      user: {
        uid: req.user?.uid || req.user?.localId,
        email: req.user?.email,
        isAdmin: true,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};
