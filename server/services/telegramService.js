const fs = require('fs');
const path = require('path');
const { getSetting, setSetting, db, detectCategory } = require('../db');
const { TelegramClient, Api } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { CustomFile } = require('telegram/client/uploads');

const { UPLOADS_DIR, CACHE_DIR } = require('../config/paths');

try {
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
} catch (e) {}

function normalizeChannelId(chatId) {
  if (!chatId) return '';
  let idStr = chatId.toString().trim();
  if (idStr === 'me') return 'me';
  if (idStr.startsWith('@')) return idStr;
  if (!idStr.startsWith('-')) {
    if (idStr.startsWith('100')) {
      return `-${idStr}`;
    }
    return `-100${idStr}`;
  }
  return idStr;
}

class TelegramService {
  constructor() {
    this.client = null;
    this.authType = 'bot';
    this.botPollingActive = false;
    this.lastUpdateId = 0;
    this.botInfo = null;
  }

  /**
   * Helper to retrieve bot token securely from backend env / db
   */
  async getBotToken() {
    return process.env.TELEGRAM_BOT_TOKEN || (await getSetting('bot_token')) || '';
  }

  /**
   * Helper to retrieve channel ID securely from backend env / db
   */
  async getChannelId() {
    const rawId = process.env.TELEGRAM_CHANNEL_ID || (await getSetting('chat_id')) || '';
    return normalizeChannelId(rawId);
  }

  /**
   * Initializes the Telegram client or bot using stored settings
   */
  async init() {
    try {
      const authType = (await getSetting('auth_type')) || process.env.TELEGRAM_AUTH_TYPE || 'bot';
      this.authType = authType;

      if (authType === 'saved_messages') {
        const apiId = parseInt(process.env.TELEGRAM_API_ID || (await getSetting('api_id')));
        const apiHash = process.env.TELEGRAM_API_HASH || (await getSetting('api_hash'));
        const sessionString = process.env.TELEGRAM_SESSION_STRING || (await getSetting('session_string')) || '';

        if (apiId && apiHash && sessionString) {
          const stringSession = new StringSession(sessionString);
          this.client = new TelegramClient(stringSession, apiId, apiHash, {
            connectionRetries: 5,
            useWSS: false,
          });

          await this.client.connect();
          const isAuth = await this.client.checkAuthorization();
          if (isAuth) {
            console.log('[Telegram] Connected to Telegram Saved Messages (MTProto)');
          } else {
            console.warn('[Telegram] Session string is invalid or expired.');
            this.client = null;
          }
        }
      }

      // Check Bot configuration
      const botToken = await this.getBotToken();
      const channelId = await this.getChannelId();

      if (botToken) {
        const botRes = await this.getBotInfo(botToken);
        if (botRes && botRes.ok) {
          this.botInfo = botRes.result;
          this.authType = 'bot';
          console.log(`[Telegram] Connected as Bot @${this.botInfo.username} (${this.botInfo.first_name})`);
          if (channelId) {
            console.log(`[Telegram] Secure Storage Channel target: ${channelId}`);
          }

          // Start Telegram Bot Polling in background for real-time sync
          this.startBotPolling(botToken);
        } else {
          console.warn('[Telegram] Bot token verification failed:', botRes);
        }
      }
    } catch (err) {
      console.error('[Telegram] Init error:', err.message);
    }
  }

  /**
   * Starts background long polling for bot messages & uploaded files
   */
  async startBotPolling(botToken) {
    if (this.botPollingActive) return;
    this.botPollingActive = true;

    const poll = async () => {
      if (!this.botPollingActive) return;

      try {
        const url = `https://api.telegram.org/bot${botToken}/getUpdates?offset=${this.lastUpdateId + 1}&timeout=20`;
        const res = await fetch(url);
        const data = await res.json();

        if (data.ok && data.result && data.result.length > 0) {
          for (const update of data.result) {
            this.lastUpdateId = Math.max(this.lastUpdateId, update.update_id);
            await this.handleTelegramUpdate(botToken, update);
          }
        }
      } catch (err) {
        // Suppress network jitter in background polling
      }

      if (this.botPollingActive) {
        setTimeout(poll, 1500);
      }
    };

    poll();
  }

  /**
   * Handle incoming messages, /start, and files sent to the bot
   */
  async handleTelegramUpdate(botToken, update) {
    const msg = update.message || update.channel_post;
    if (!msg || !msg.chat) return;

    const chatId = msg.chat.id.toString();

    // Handle /start command
    if (msg.text && msg.text.startsWith('/start')) {
      await this.sendTextMessage(
        botToken,
        chatId,
        `⚡ *Welcome to Hightech Claude Storage!*\n\n` +
          `Your Telegram bot is securely connected to your cloud drive.\n\n` +
          `📤 *Send any file, photo, video, or document here*, and it will instantly appear in your Hightech Claude web dashboard!\n\n` +
          `🌐 Web Dashboard: http://localhost:3000`
      );
      return;
    }

    // Handle incoming file/document/photo/video from Telegram
    let fileObj = null;
    let fileName = '';
    let mimeType = 'application/octet-stream';
    let fileSize = 0;

    if (msg.document) {
      fileObj = msg.document;
      fileName = fileObj.file_name || `document_${Date.now()}`;
      mimeType = fileObj.mime_type || 'application/octet-stream';
      fileSize = fileObj.file_size || 0;
    } else if (msg.photo && msg.photo.length > 0) {
      fileObj = msg.photo[msg.photo.length - 1];
      fileName = `photo_${Date.now()}.jpg`;
      mimeType = 'image/jpeg';
      fileSize = fileObj.file_size || 0;
    } else if (msg.video) {
      fileObj = msg.video;
      fileName = fileObj.file_name || `video_${Date.now()}.mp4`;
      mimeType = fileObj.mime_type || 'video/mp4';
      fileSize = fileObj.file_size || 0;
    } else if (msg.audio) {
      fileObj = msg.audio;
      fileName = fileObj.file_name || fileObj.title || `audio_${Date.now()}.mp3`;
      mimeType = fileObj.mime_type || 'audio/mpeg';
      fileSize = fileObj.file_size || 0;
    }

    if (fileObj) {
      const category = detectCategory(mimeType, fileName);

      // Save to files database
      await db.insertFile({
        name: fileName,
        original_name: fileName,
        mime_type: mimeType,
        size: fileSize,
        category,
        telegram_msg_id: msg.message_id,
        telegram_chat_id: chatId,
        file_hash: fileObj.file_id,
        storage_type: 'telegram',
      });

      console.log(`[Telegram] Received and indexed file: ${fileName} (${fileSize} bytes)`);

      // Reply back to user on Telegram
      await this.sendTextMessage(
        botToken,
        chatId,
        `✅ *Saved to Hightech Claude!*\n📁 \`${fileName}\`\n📊 Category: *${category}*`
      );
    }
  }

  async sendTextMessage(botToken, chatId, text) {
    try {
      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: text,
          parse_mode: 'Markdown',
        }),
      });
    } catch (e) {}
  }

  /**
   * Get current connection status and details (without leaking secrets)
   */
  async getStatus() {
    const authType = (await getSetting('auth_type')) || process.env.TELEGRAM_AUTH_TYPE || 'bot';
    const apiId = process.env.TELEGRAM_API_ID || (await getSetting('api_id'));
    const hasSession = !!(process.env.TELEGRAM_SESSION_STRING || (await getSetting('session_string')));
    const botToken = await this.getBotToken();
    const channelId = await this.getChannelId();

    let userDetails = null;

    if (authType === 'saved_messages' && this.client) {
      try {
        const me = await this.client.getMe();
        if (me) {
          userDetails = {
            id: me.id.toString(),
            firstName: me.firstName || '',
            lastName: me.lastName || '',
            username: me.username || '',
            phone: me.phone || '',
            isPremium: me.premium || false,
            target: 'Saved Messages (me)',
          };
        }
      } catch (err) {
        console.error('[Telegram] Error getting user details:', err.message);
      }
    } else if (botToken) {
      const botRes = await this.getBotInfo(botToken);
      if (botRes && botRes.ok) {
        this.botInfo = botRes.result;
        userDetails = {
          id: botRes.result.id.toString(),
          firstName: 'Hightech Claude',
          username: botRes.result.username,
          target: channelId ? `Channel (${channelId})` : `@${botRes.result.username}`,
        };
      }
    }

    return {
      connected: !!userDetails || authType === 'demo',
      authType: userDetails ? (authType === 'saved_messages' ? 'saved_messages' : 'bot') : 'demo',
      configuredType: authType,
      user: userDetails || {
        firstName: 'Hightech Claude',
        username: 'claudestorage_bot',
        target: 'Telegram Bot Cloud Storage',
      },
      hasCredentials: {
        hasApiId: !!apiId,
        hasSession,
        hasBotToken: !!botToken,
        hasChannelId: !!channelId,
      },
      channelConfigured: !!channelId,
    };
  }

  /**
   * Send phone login OTP code
   */
  async sendPhoneCode(apiId, apiHash, phoneNumber) {
    const stringSession = new StringSession('');
    const client = new TelegramClient(stringSession, parseInt(apiId), apiHash, {
      connectionRetries: 5,
    });

    await client.connect();

    const { phoneCodeHash, isCodeViaApp } = await client.sendCode(
      {
        apiId: parseInt(apiId),
        apiHash,
      },
      phoneNumber
    );

    await setSetting('api_id', apiId.toString());
    await setSetting('api_hash', apiHash);
    await setSetting('phone_number', phoneNumber);
    await setSetting('phone_code_hash', phoneCodeHash);

    this.tempClient = client;
    this.tempPhoneCodeHash = phoneCodeHash;
    this.tempPhoneNumber = phoneNumber;

    return {
      success: true,
      phoneCodeHash,
      isCodeViaApp,
      message: isCodeViaApp
        ? 'Verification code sent to your Telegram app!'
        : 'Verification code sent via SMS!',
    };
  }

  /**
   * Verify phone OTP code and complete MTProto login
   */
  async verifyPhoneCode(code, password = '') {
    const apiId = parseInt(await getSetting('api_id'));
    const apiHash = await getSetting('api_hash');
    const phoneNumber = await getSetting('phone_number');
    const phoneCodeHash = this.tempPhoneCodeHash || (await getSetting('phone_code_hash'));

    let client = this.tempClient;
    if (!client) {
      const stringSession = new StringSession('');
      client = new TelegramClient(stringSession, apiId, apiHash, {
        connectionRetries: 5,
      });
      await client.connect();
    }

    try {
      await client.invoke(
        new Api.auth.SignIn({
          phoneNumber,
          phoneCodeHash,
          phoneCode: code,
        })
      );
    } catch (err) {
      if (err.errorMessage === 'SESSION_PASSWORD_NEEDED') {
        if (!password) {
          return {
            requires2FA: true,
            message: 'Two-Step Verification password is required.',
          };
        }
        const passwordSrp = await client.invoke(new Api.account.GetPassword());
        const { computeHash } = require('telegram/Password');
        const passwordHash = await computeHash(passwordSrp, password);
        await client.invoke(
          new Api.auth.CheckPassword({
            password: passwordHash,
          })
        );
      } else {
        throw err;
      }
    }

    const sessionString = client.session.save();
    await setSetting('session_string', sessionString);
    await setSetting('auth_type', 'saved_messages');
    await setSetting('chat_id', 'me');

    this.client = client;
    this.authType = 'saved_messages';
    this.tempClient = null;

    const me = await client.getMe();
    return {
      success: true,
      user: {
        id: me.id.toString(),
        firstName: me.firstName,
        username: me.username,
      },
    };
  }

  /**
   * Connect via Telegram Bot
   */
  async connectBot(botToken, chatId = '') {
    const normalizedChatId = normalizeChannelId(chatId);
    const botInfo = await this.getBotInfo(botToken);
    if (!botInfo || !botInfo.ok) {
      throw new Error(botInfo?.description || 'Invalid Telegram Bot Token');
    }

    await setSetting('bot_token', botToken);
    if (normalizedChatId) await setSetting('chat_id', normalizedChatId);
    await setSetting('auth_type', 'bot');

    this.authType = 'bot';
    this.botInfo = botInfo.result;

    this.startBotPolling(botToken);

    return {
      success: true,
      bot: botInfo.result,
    };
  }

  /**
   * Helper: call Bot API getMe
   */
  async getBotInfo(botToken) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
      return await res.json();
    } catch (err) {
      return { ok: false, description: err.message };
    }
  }

  /**
   * Disconnect current session & revert to demo mode
   */
  async disconnect() {
    this.botPollingActive = false;
    if (this.client) {
      try {
        await this.client.disconnect();
      } catch (e) {}
      this.client = null;
    }

    await setSetting('session_string', '');
    await setSetting('auth_type', 'demo');
    this.authType = 'demo';

    return { success: true };
  }

  /**
   * Upload file to Telegram (Saved Messages or Storage Channel) or Local Sandbox
   */
  async uploadFile({ originalName, buffer, mimeType, size, filePath = null }) {
    const authType = (await getSetting('auth_type')) || process.env.TELEGRAM_AUTH_TYPE || 'bot';
    const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const localCachedDest = path.join(CACHE_DIR, `${Date.now()}_${safeName}`);

    // Pre-cache uploaded buffer or file for instant 0ms preview right after upload
    if (filePath && fs.existsSync(filePath)) {
      try {
        fs.copyFileSync(filePath, localCachedDest);
      } catch (e) {}
    } else if (buffer) {
      try {
        fs.writeFileSync(localCachedDest, buffer);
      } catch (e) {}
    }

    // 1. Saved Messages MTProto Mode
    if (authType === 'saved_messages' && this.client) {
      try {
        const customFile = new CustomFile(
          originalName,
          size,
          filePath || '',
          buffer || (filePath ? fs.readFileSync(filePath) : Buffer.alloc(0))
        );

        const result = await this.client.sendFile('me', {
          file: customFile,
          caption: `📁 Hightech Claude: ${originalName} (${(size / 1024 / 1024).toFixed(2)} MB)`,
          forceDocument: true,
          workers: 8,
        });

        return {
          storageType: 'telegram',
          telegramMsgId: result.id,
          telegramChatId: 'me',
          localPath: fs.existsSync(localCachedDest) ? localCachedDest : null,
          size: size,
        };
      } catch (err) {
        console.error('[Telegram] MTProto upload failed:', err);
      }
    }

    // 2. Telegram Bot Mode (Uploads directly to your Telegram Channel)
    const botToken = await this.getBotToken();
    const channelId = await this.getChannelId();

    if (botToken && channelId && channelId !== 'me') {
      try {
        const fileData = buffer || (filePath ? fs.readFileSync(filePath) : null);
        if (fileData) {
          const fileBlob = new Blob([fileData], { type: mimeType });
          const formData = new FormData();
          formData.append('chat_id', channelId);
          formData.append('document', fileBlob, originalName);
          formData.append('caption', `📁 Hightech Claude: ${originalName}`);

          const response = await fetch(`https://api.telegram.org/bot${botToken}/sendDocument`, {
            method: 'POST',
            body: formData,
          });

          const json = await response.json();
          if (json.ok && json.result.document) {
            console.log(`[Telegram] Uploaded ${originalName} to channel ${channelId} (msg_id: ${json.result.message_id})`);
            return {
              storageType: 'telegram',
              telegramMsgId: json.result.message_id,
              telegramChatId: channelId,
              fileHash: json.result.document.file_id,
              localPath: fs.existsSync(localCachedDest) ? localCachedDest : null,
              size: json.result.document.file_size || size,
            };
          } else {
            console.warn('[Telegram] Channel upload error response:', json);
          }
        }
      } catch (err) {
        console.error('[Telegram] Bot upload to channel error:', err);
      }
    }

    // 3. Fallback / Local Storage
    const localFileName = `${Date.now()}_${safeName}`;
    const localDest = path.join(UPLOADS_DIR, localFileName);

    if (filePath && fs.existsSync(filePath)) {
      fs.copyFileSync(filePath, localDest);
    } else if (buffer) {
      fs.writeFileSync(localDest, buffer);
    }

    return {
      storageType: 'local',
      localPath: localDest,
      telegramMsgId: null,
      telegramChatId: null,
      size: size,
    };
  }

  /**
   * Download / Stream a file with high-speed Multi-Tiered Cache (0ms local hit)
   */
  async getFileStream(fileRecord) {
    const safeName = (fileRecord.name || fileRecord.original_name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_');
    const cacheKey = fileRecord.file_hash || fileRecord.telegram_msg_id || fileRecord.id;
    const cacheFilePath = path.join(CACHE_DIR, `${fileRecord.id}_${cacheKey}_${safeName}`);

    // 0. High-Speed Local Cache Hit (0ms - Instant disk stream)
    if (fs.existsSync(cacheFilePath)) {
      try {
        const stat = fs.statSync(cacheFilePath);
        if (stat.size > 0) {
          return {
            type: 'stream',
            stream: fs.createReadStream(cacheFilePath),
            size: stat.size,
            mimeType: fileRecord.mime_type,
            localPath: cacheFilePath,
          };
        }
      } catch (e) {}
    }

    // 1. If local_path exists and is valid on disk
    if (fileRecord.local_path && fs.existsSync(fileRecord.local_path)) {
      try {
        const stat = fs.statSync(fileRecord.local_path);
        if (stat.size > 0) {
          return {
            type: 'stream',
            stream: fs.createReadStream(fileRecord.local_path),
            size: fileRecord.size,
            mimeType: fileRecord.mime_type,
            localPath: fileRecord.local_path,
          };
        }
      } catch (e) {}
    }

    // 2. Telegram Bot / Channel Download with Fast Async Cache Write
    if (fileRecord.file_hash) {
      const botToken = await this.getBotToken();
      try {
        const fileInfoRes = await fetch(
          `https://api.telegram.org/bot${botToken}/getFile?file_id=${fileRecord.file_hash}`
        );
        const fileInfo = await fileInfoRes.json();
        if (fileInfo.ok && fileInfo.result.file_path) {
          const downloadUrl = `https://api.telegram.org/file/bot${botToken}/${fileInfo.result.file_path}`;
          const fileRes = await fetch(downloadUrl);
          const arrayBuffer = await fileRes.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);

          // Asynchronously persist to fast local cache for instant future loads
          fs.writeFile(cacheFilePath, buffer, (err) => {
            if (err) console.error('[Cache] Failed to write cache:', err.message);
          });

          return {
            type: 'buffer',
            buffer,
            size: buffer.length,
            mimeType: fileRecord.mime_type,
            localPath: cacheFilePath,
          };
        }
      } catch (err) {
        console.error('[Telegram] Bot getFile download error:', err.message);
      }
    }

    // 3. Telegram Saved Messages (MTProto) with Fast Async Cache Write
    if (fileRecord.storage_type === 'telegram' && this.client && fileRecord.telegram_msg_id) {
      try {
        const messages = await this.client.getMessages(fileRecord.telegram_chat_id || 'me', {
          ids: [fileRecord.telegram_msg_id],
        });

        if (messages && messages.length > 0 && messages[0].media) {
          const buffer = await this.client.downloadMedia(messages[0].media, {
            workers: 8,
          });

          // Asynchronously persist to fast local cache
          fs.writeFile(cacheFilePath, buffer, (err) => {
            if (err) console.error('[Cache] Failed to write cache:', err.message);
          });

          return {
            type: 'buffer',
            buffer,
            size: buffer.length,
            mimeType: fileRecord.mime_type,
            localPath: cacheFilePath,
          };
        }
      } catch (err) {
        console.error('[Telegram] MTProto download error:', err.message);
      }
    }

    // 4. Fallback file in UPLOADS_DIR
    const fallbackPath = path.join(UPLOADS_DIR, `${fileRecord.id}_${fileRecord.original_name}`);
    if (fs.existsSync(fallbackPath)) {
      return {
        type: 'stream',
        stream: fs.createReadStream(fallbackPath),
        size: fileRecord.size,
        mimeType: fileRecord.mime_type,
        localPath: fallbackPath,
      };
    }

    throw new Error('File could not be downloaded from Telegram or local cache.');
  }

  /**
   * Delete message from Telegram
   */
  async deleteTelegramMessage(telegramMsgId, telegramChatId) {
    if (!telegramMsgId) return;

    if (this.authType === 'saved_messages' && this.client) {
      try {
        await this.client.deleteMessages(telegramChatId || 'me', [telegramMsgId], {
          revoke: true,
        });
      } catch (err) {}
    } else {
      const botToken = await this.getBotToken();
      if (botToken && telegramChatId) {
        try {
          await fetch(`https://api.telegram.org/bot${botToken}/deleteMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: telegramChatId,
              message_id: telegramMsgId,
            }),
          });
        } catch (e) {}
      }
    }
  }
}

const telegramService = new TelegramService();
module.exports = telegramService;
