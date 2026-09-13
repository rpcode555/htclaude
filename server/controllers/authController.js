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
    const { apiId, apiHash, phoneNumber } = req.body;
    if (!apiId || !apiHash || !phoneNumber) {
      return res.status(400).json({
        success: false,
        error: 'Please provide API ID, API Hash, and Phone Number (with country code).',
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
    const { code, password } = req.body;
    if (!code) {
      return res.status(400).json({ success: false, error: 'Verification code is required.' });
    }

    const result = await telegramService.verifyPhoneCode(code, password);
    res.json(result);
  } catch (err) {
    console.error('[Auth] verifyCode error:', err);
    res.status(400).json({ success: false, error: err.message || 'Failed to verify code.' });
  }
};

exports.connectSessionString = async (req, res) => {
  try {
    const { apiId, apiHash, sessionString } = req.body;
    if (!apiId || !apiHash || !sessionString) {
      return res.status(400).json({
        success: false,
        error: 'API ID, API Hash, and Session String are all required.',
      });
    }

    const result = await telegramService.connectSessionString(apiId, apiHash, sessionString);
    res.json(result);
  } catch (err) {
    console.error('[Auth] connectSessionString error:', err);
    res.status(400).json({ success: false, error: err.message || 'Failed to connect with session string.' });
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
