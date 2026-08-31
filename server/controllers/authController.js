const telegramService = require('../services/telegramService');
const { getSetting, setSetting, getAllSettings } = require('../db');

exports.getStatus = async (req, res) => {
  try {
    const status = await telegramService.getStatus();
    const settings = await getAllSettings();

    const hasBotToken = !!(process.env.TELEGRAM_BOT_TOKEN || settings.bot_token);
    const channelId = await telegramService.getChannelId();

    // Redact sensitive keys
    const safeSettings = {
      auth_type: status.authType,
      api_id: settings.api_id ? '******' + settings.api_id.slice(-3) : '',
      phone_number: settings.phone_number ? '******' + settings.phone_number.slice(-4) : '',
      has_session: !!(process.env.TELEGRAM_SESSION_STRING || settings.session_string),
      has_bot_token: hasBotToken,
      chat_id: channelId ? (channelId.length > 6 ? channelId.slice(0, 5) + '***' + channelId.slice(-3) : channelId) : 'me',
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

exports.botConnect = async (req, res) => {
  try {
    const { botToken, chatId } = req.body;
    if (!botToken) {
      return res.status(400).json({ success: false, error: 'Bot Token is required.' });
    }

    const result = await telegramService.connectBot(botToken, chatId);
    res.json(result);
  } catch (err) {
    console.error('[Auth] botConnect error:', err);
    res.status(400).json({ success: false, error: err.message || 'Failed to connect bot.' });
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
