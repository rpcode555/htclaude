const fs = require('fs');
const path = require('path');
const { getSetting, setSetting, db, detectCategory } = require('../db');
const { TelegramClient, Api } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { CustomFile } = require('telegram/client/uploads');
const { NewMessage } = require('telegram/events');

const { UPLOADS_DIR, CACHE_DIR, DATA_DIR, isSafePath } = require('../config/paths');

try {
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
} catch (e) {}

class TelegramService {
  constructor() {
    this.client = null;
    this.authType = 'saved_messages';
    this.tempClient = null;
    this.tempPhoneCodeHash = null;
    this.tempPhoneNumber = null;
    this.listenerAttached = false;
    this._initPromise = null;
  }

  /**
   * Initializes the Telegram MTProto client for Saved Messages using stored session
   */
  async init() {
    try {
      const isManualDisconnected = (await getSetting('manual_disconnect')) === true;
      if (isManualDisconnected) {
        this.client = null;
        this.authType = 'demo';
        return;
      }

      this.authType = 'saved_messages';

      const apiId = parseInt(await getSetting('api_id'));
      const apiHash = await getSetting('api_hash');
      const sessionString = (await getSetting('session_string')) || '';

      if (apiId && apiHash && sessionString) {
        const stringSession = new StringSession(sessionString.trim());
        this.client = new TelegramClient(stringSession, apiId, apiHash.trim(), {
          connectionRetries: 5,
          useWSS: false,
        });

        await this.client.connect();
        const isAuth = await this.client.checkAuthorization();
        if (isAuth) {
          const me = await this.client.getMe();
          console.log(`[Telegram] Connected to Telegram Saved Messages as ${me.firstName || 'User'} (@${me.username || me.id})`);
          this.setupSavedMessagesListener();
        } else {
          console.warn('[Telegram] Session string is invalid or expired.');
          this.client = null;
        }
      } else {
        console.log('[Telegram] No saved session found. Storage running in Sandbox/Demo mode until Telegram account is linked.');
      }
    } catch (err) {
      console.error('[Telegram] Init error:', err.message);
    }
  }

  /**
   * Lazily ensures TelegramClient is connected (essential for Vercel / serverless runtimes)
   */
  async ensureClient() {
    const isManualDisconnected = (await getSetting('manual_disconnect')) === true;
    if (isManualDisconnected) {
      this.client = null;
      this.authType = 'demo';
      return null;
    }

    if (this.client) {
      try {
        if (this.client.connected) {
          return this.client;
        }
        await this.client.connect();
        return this.client;
      } catch (e) {
        console.warn('[Telegram] Reconnection failed, resetting client:', e.message);
        this.client = null;
      }
    }

    if (this._initPromise) {
      return this._initPromise;
    }

    this._initPromise = (async () => {
      await this.init();
      return this.client;
    })();

    try {
      return await this._initPromise;
    } finally {
      this._initPromise = null;
    }
  }

  /**
   * Real-time sync: Listens for files sent to "Saved Messages" in any Telegram client
   */
  setupSavedMessagesListener() {
    if (!this.client || this.listenerAttached) return;
    const { isServerless } = require('../config/paths');
    if (isServerless) return;

    try {
      this.client.addEventHandler(async (event) => {
        try {
          const msg = event.message;
          if (!msg || !msg.media) return;

          const me = await this.client.getMe();
          if (!me) return;

          // Verify that this message was sent to Saved Messages ('me')
          const peerId = msg.peerId?.userId?.toString();
          if (peerId && peerId === me.id.toString()) {
            await this.handleSavedMessageMedia(msg);
          }
        } catch (err) {
          console.warn('[Telegram Saved Messages] Event handler notice:', err.message);
        }
      }, new NewMessage({}));

      this.listenerAttached = true;
      console.log('[Telegram] Real-time listener active for Saved Messages');
    } catch (e) {
      console.warn('[Telegram] Could not attach real-time listener:', e.message);
    }
  }

  /**
   * Handle incoming media sent directly to Telegram Saved Messages
   */
  async handleSavedMessageMedia(msg) {
    let fileName = '';
    let mimeType = 'application/octet-stream';
    let fileSize = 0;

    if (msg.media.document) {
      const doc = msg.media.document;
      fileSize = Number(doc.size) || 0;
      mimeType = doc.mimeType || 'application/octet-stream';
      if (Array.isArray(doc.attributes)) {
        for (const attr of doc.attributes) {
          if (attr.fileName) {
            fileName = attr.fileName;
            break;
          }
        }
      }
      if (!fileName) fileName = `document_${Date.now()}`;
    } else if (msg.media.photo) {
      fileName = `photo_${Date.now()}.jpg`;
      mimeType = 'image/jpeg';
      fileSize = 0;
    }

    if (fileName) {
      const category = detectCategory(mimeType, fileName);
      await db.insertFile({
        name: fileName,
        original_name: fileName,
        mime_type: mimeType,
        size: fileSize,
        category,
        telegram_msg_id: msg.id,
        telegram_chat_id: 'me',
        storage_type: 'telegram',
      });
      console.log(`[Telegram Saved Messages] Indexed new media: ${fileName}`);
    }
  }

  /**
   * Get current connection status and details (without leaking secrets)
   */
  async getStatus() {
    const isManualDisconnected = (await getSetting('manual_disconnect')) === true;
    if (!isManualDisconnected) {
      await this.ensureClient();
    }

    const apiId = await getSetting('api_id');
    const sessionString = await getSetting('session_string');
    const hasSession = !!sessionString && !isManualDisconnected;

    let userDetails = null;

    if (this.client && !isManualDisconnected) {
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
    }

    return {
      connected: !!userDetails,
      authType: userDetails ? 'saved_messages' : 'demo',
      configuredType: 'saved_messages',
      user: userDetails || {
        firstName: isManualDisconnected ? 'Disconnected' : 'Guest User',
        username: '',
        target: 'Saved Messages (Offline / Sandbox)',
      },
      hasCredentials: {
        hasApiId: !!apiId,
        hasSession,
      },
      manualDisconnect: isManualDisconnected,
    };
  }

  /**
   * Send phone login OTP code to Telegram app / SMS
   */
  async sendPhoneCode(apiId, apiHash, phoneNumber) {
    const cleanApiId = parseInt(apiId || (await getSetting('api_id')));
    const cleanApiHash = (apiHash || (await getSetting('api_hash')) || '').trim();

    if (!cleanApiId || !cleanApiHash) {
      throw new Error('Telegram API ID and API Hash are required.');
    }

    if (!phoneNumber) {
      throw new Error('Phone number is required.');
    }

    let cleanPhone = phoneNumber.trim().replace(/[\s\-()]/g, '');
    if (!cleanPhone.startsWith('+')) {
      cleanPhone = '+' + cleanPhone;
    }

    const stringSession = new StringSession('');
    const client = new TelegramClient(stringSession, cleanApiId, cleanApiHash, {
      connectionRetries: 5,
      useWSS: false,
    });

    await client.connect();

    const { phoneCodeHash, isCodeViaApp } = await client.sendCode(
      {
        apiId: cleanApiId,
        apiHash: cleanApiHash,
      },
      cleanPhone
    );

    // CRITICAL: Persist the MTProto AuthKey session so verifyPhoneCode can reuse the exact same session
    const tempSessionString = client.session.save();
    await setSetting('temp_auth_session', tempSessionString);
    await setSetting('api_id', cleanApiId.toString());
    await setSetting('api_hash', cleanApiHash);
    await setSetting('phone_number', cleanPhone);
    await setSetting('phone_code_hash', phoneCodeHash);

    this.tempClient = client;
    this.tempPhoneCodeHash = phoneCodeHash;
    this.tempPhoneNumber = cleanPhone;

    return {
      success: true,
      phoneCodeHash,
      isCodeViaApp,
      message: isCodeViaApp
        ? `Verification code sent to your Telegram app for ${cleanPhone}!`
        : `Verification code sent via SMS for ${cleanPhone}!`,
    };
  }

  /**
   * Verify phone OTP code and complete MTProto login to Saved Messages
   */
  async verifyPhoneCode(code, password = '', passedPhoneCodeHash = null, passedPhoneNumber = null) {
    const apiId = parseInt(await getSetting('api_id'));
    const apiHash = await getSetting('api_hash');
    const phoneNumber = (passedPhoneNumber || this.tempPhoneNumber || (await getSetting('phone_number')) || '').trim();
    const phoneCodeHash = (passedPhoneCodeHash || this.tempPhoneCodeHash || (await getSetting('phone_code_hash')) || '').trim();
    const tempAuthSession = await getSetting('temp_auth_session');

    if (!phoneNumber) {
      throw new Error('Phone number is missing. Please click Back and request a new code.');
    }
    if (!phoneCodeHash) {
      throw new Error('Verification session expired or phoneCodeHash missing. Please click Back and request a new code.');
    }

    let client = this.tempClient;
    if (!client) {
      // Reconstitute client with the exact same AuthKey from sendPhoneCode
      const stringSession = new StringSession(tempAuthSession || '');
      client = new TelegramClient(stringSession, apiId, apiHash, {
        connectionRetries: 5,
        useWSS: false,
      });
      await client.connect();
    }

    const cleanCode = (code || '').trim().replace(/[\s\-]/g, '');

    try {
      await client.invoke(
        new Api.auth.SignIn({
          phoneNumber,
          phoneCodeHash,
          phoneCode: cleanCode,
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
    await setSetting('manual_disconnect', false);
    await setSetting('session_string', sessionString);
    await setSetting('auth_type', 'saved_messages');
    await setSetting('chat_id', 'me');

    // Clear temporary auth data
    await setSetting('temp_auth_session', '');
    await setSetting('phone_code_hash', '');

    this.client = client;
    this.authType = 'saved_messages';
    this.tempClient = null;
    this.tempPhoneCodeHash = null;
    this.tempPhoneNumber = null;
    this.setupSavedMessagesListener();

    const me = await client.getMe();
    return {
      success: true,
      user: {
        id: me.id.toString(),
        firstName: me.firstName,
        username: me.username,
        phone: me.phone,
        target: 'Saved Messages (me)',
      },
    };
  }

  /**
   * Direct login using an existing GramJS MTProto Session String
   */
  async connectSessionString(apiId, apiHash, sessionString) {
    const cleanApiId = parseInt(apiId || (await getSetting('api_id')));
    const cleanApiHash = (apiHash || (await getSetting('api_hash')) || '').trim();
    if (!cleanApiId || !cleanApiHash || !sessionString) {
      throw new Error('API ID, API Hash, and Session String are all required.');
    }

    const stringSession = new StringSession(sessionString.trim());
    const client = new TelegramClient(stringSession, cleanApiId, apiHash.trim(), {
      connectionRetries: 5,
      useWSS: false,
    });

    await client.connect();
    const isAuth = await client.checkAuthorization();
    if (!isAuth) {
      throw new Error('Invalid or expired Telegram Session String.');
    }

    await setSetting('manual_disconnect', false);
    await setSetting('api_id', cleanApiId.toString());
    await setSetting('api_hash', apiHash.trim());
    await setSetting('session_string', sessionString.trim());
    await setSetting('auth_type', 'saved_messages');
    await setSetting('chat_id', 'me');

    this.client = client;
    this.authType = 'saved_messages';
    this.setupSavedMessagesListener();

    const me = await client.getMe();
    return {
      success: true,
      user: {
        id: me.id.toString(),
        firstName: me.firstName || '',
        lastName: me.lastName || '',
        username: me.username || '',
        phone: me.phone || '',
        target: 'Saved Messages (me)',
      },
    };
  }

  /**
   * Disconnect current session & revert to sandbox demo mode
   */
  async disconnect() {
    if (this.client) {
      try {
        await this.client.disconnect();
      } catch (e) {}
      this.client = null;
    }

    this.listenerAttached = false;
    this.authType = 'demo';

    await setSetting('manual_disconnect', true);
    await setSetting('session_string', '');
    await setSetting('auth_type', 'demo');

    // Clear from in-memory process.env so it cannot resurrect
    delete process.env.TELEGRAM_SESSION_STRING;
    process.env.TELEGRAM_AUTH_TYPE = 'demo';

    return { success: true };
  }

  /**
   * Upload file directly to Telegram Saved Messages ('me') or local sandbox.
   * Supports UNLIMITED file sizes by automatically chunking files exceeding 1.9GB.
   */
  async uploadFile({ originalName, buffer, mimeType, size, filePath = null }) {
    await this.ensureClient();
    const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const localCachedDest = path.join(CACHE_DIR, `${Date.now()}_${safeName}`);
    const MAX_TELEGRAM_SINGLE_FILE = 1900 * 1024 * 1024; // 1.9 GB safe ceiling for MTProto single document

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

    // 1. Saved Messages MTProto Upload (supports unlimited size via automatic chunking)
    if (this.client) {
      try {
        // Case A: File exceeds 1.9GB -> Automatic Multi-Part Chunking for Unlimited Size
        if (size > MAX_TELEGRAM_SINGLE_FILE && filePath && fs.existsSync(filePath)) {
          const totalParts = Math.ceil(size / MAX_TELEGRAM_SINGLE_FILE);
          const chunkMsgIds = [];
          console.log(`[Telegram Saved Messages] File ${originalName} (${(size / 1024 / 1024 / 1024).toFixed(2)} GB) exceeds 1.9GB Telegram limit. Automatically chunking into ${totalParts} parts...`);

          for (let partIdx = 0; partIdx < totalParts; partIdx++) {
            const start = partIdx * MAX_TELEGRAM_SINGLE_FILE;
            const end = Math.min(size - 1, (partIdx + 1) * MAX_TELEGRAM_SINGLE_FILE - 1);
            const partSize = end - start + 1;
            const tempChunkPath = path.join(CACHE_DIR, `temp_chunk_${Date.now()}_${partIdx}_${safeName}`);

            // Stream slice chunk to disk to keep RAM usage minimal
            await new Promise((resolve, reject) => {
              const rs = fs.createReadStream(filePath, { start, end });
              const ws = fs.createWriteStream(tempChunkPath);
              rs.pipe(ws);
              ws.on('finish', resolve);
              ws.on('error', reject);
            });

            const customFile = new CustomFile(
              `${originalName}.part${String(partIdx + 1).padStart(3, '0')}`,
              partSize,
              tempChunkPath,
              undefined
            );

            const result = await this.client.sendFile('me', {
              file: customFile,
              caption: `📁 Hightech Claude [Part ${partIdx + 1}/${totalParts}]: ${originalName}`,
              forceDocument: true,
              workers: 8,
            });

            chunkMsgIds.push(result.id);
            console.log(`[Telegram Saved Messages] Uploaded chunk ${partIdx + 1}/${totalParts} (msg_id: ${result.id})`);

            // Clean up temporary chunk file
            try { fs.unlinkSync(tempChunkPath); } catch (e) {}
          }

          return {
            storageType: 'telegram',
            telegramMsgId: chunkMsgIds[0],
            telegramChunkIds: chunkMsgIds,
            telegramChatId: 'me',
            isChunked: true,
            totalParts,
            localPath: fs.existsSync(localCachedDest) ? localCachedDest : null,
            size: size,
          };
        }

        // Case B: Single File Upload (< 1.9GB)
        const fileContent = buffer || (filePath && fs.existsSync(filePath) && size < 10 * 1024 * 1024 ? fs.readFileSync(filePath) : undefined);
        const customFile = new CustomFile(
          originalName,
          size,
          filePath || '',
          fileContent
        );

        const result = await this.client.sendFile('me', {
          file: customFile,
          caption: `📁 Hightech Claude: ${originalName} (${(size / 1024 / 1024).toFixed(2)} MB)`,
          forceDocument: true,
          workers: 8,
        });

        console.log(`[Telegram Saved Messages] Uploaded ${originalName} (${size} bytes, msg_id: ${result.id})`);

        return {
          storageType: 'telegram',
          telegramMsgId: result.id,
          telegramChunkIds: [result.id],
          telegramChatId: 'me',
          isChunked: false,
          totalParts: 1,
          localPath: fs.existsSync(localCachedDest) ? localCachedDest : null,
          size: size,
        };
      } catch (err) {
        console.error('[Telegram Saved Messages] MTProto upload failed:', err.message);
      }
    }

    // 2. Fallback: Local Storage (Sandbox mode when Telegram is disconnected)
    const localFileName = `${Date.now()}_${safeName}`;
    const localDest = path.join(UPLOADS_DIR, localFileName);

    if (filePath && fs.existsSync(filePath)) {
      try {
        fs.copyFileSync(filePath, localDest);
      } catch (e) {
        console.error('[Storage] Error copying to local uploads:', e.message);
      }
    } else if (buffer) {
      try {
        fs.writeFileSync(localDest, buffer);
      } catch (e) {
        console.error('[Storage] Error writing buffer to local uploads:', e.message);
      }
    }

    return {
      storageType: 'local',
      localPath: localDest,
      telegramMsgId: null,
      telegramChunkIds: null,
      telegramChatId: null,
      size: size,
    };
  }

  /**
   * Download / Stream a file from Telegram Saved Messages with multi-part chunk reconstruction and local cache
   */
  async getFileStream(fileRecord) {
    await this.ensureClient();
    const safeName = (fileRecord.name || fileRecord.original_name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_');
    const cacheKey = fileRecord.telegram_msg_id || fileRecord.id;
    const cacheFilePath = path.join(CACHE_DIR, `${fileRecord.id}_${cacheKey}_${safeName}`);

    // 0. High-Speed Local Cache Hit (0ms - Instant disk stream)
    if (fs.existsSync(cacheFilePath)) {
      try {
        const stat = fs.statSync(cacheFilePath);
        if (stat.size > 0 && (!fileRecord.size || stat.size === fileRecord.size)) {
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

    // 1. If local_path exists and is valid on disk within safe directories
    if (fileRecord.local_path && fs.existsSync(fileRecord.local_path) && isSafePath(fileRecord.local_path)) {
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

    // 2. Telegram Saved Messages (MTProto) Download & Chunk Assembly
    const chunkIds = Array.isArray(fileRecord.telegram_chunk_ids) && fileRecord.telegram_chunk_ids.length > 0
      ? fileRecord.telegram_chunk_ids
      : (fileRecord.telegram_msg_id ? [fileRecord.telegram_msg_id] : []);

    if (fileRecord.storage_type === 'telegram' && this.client && chunkIds.length > 0) {
      try {
        // Multi-Part Chunk Reassembly
        if (chunkIds.length > 1) {
          console.log(`[Telegram Saved Messages] Reassembling ${chunkIds.length} chunks for ${fileRecord.name}...`);
          const writeStream = fs.createWriteStream(cacheFilePath);

          for (let i = 0; i < chunkIds.length; i++) {
            const chunkMsgId = chunkIds[i];
            const messages = await this.client.getMessages(fileRecord.telegram_chat_id || 'me', {
              ids: [chunkMsgId],
            });
            if (messages && messages.length > 0 && messages[0].media) {
              const chunkBuf = await this.client.downloadMedia(messages[0].media, { workers: 8 });
              if (chunkBuf) {
                await new Promise((resolve) => writeStream.write(chunkBuf, resolve));
              }
            }
          }
          writeStream.end();
          await new Promise((resolve) => writeStream.on('finish', resolve));

          const stat = fs.statSync(cacheFilePath);
          return {
            type: 'stream',
            stream: fs.createReadStream(cacheFilePath),
            size: stat.size,
            mimeType: fileRecord.mime_type,
            localPath: cacheFilePath,
          };
        } else {
          // Single Document Download
          const messages = await this.client.getMessages(fileRecord.telegram_chat_id || 'me', {
            ids: [chunkIds[0]],
          });

          if (messages && messages.length > 0 && messages[0].media) {
            const buffer = await this.client.downloadMedia(messages[0].media, {
              workers: 8,
            });

            if (buffer) {
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
          }
        }
      } catch (err) {
        console.error('[Telegram Saved Messages] MTProto download error:', err.message);
      }
    }

    // 3. Fallback file in UPLOADS_DIR
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

    throw new Error('File could not be downloaded from Telegram Saved Messages or local cache.');
  }

  /**
   * Delete message or array of chunk messages from Telegram Saved Messages
   */
  async deleteTelegramMessage(msgIdsOrRecord, telegramChatId = 'me') {
    if (!msgIdsOrRecord) return;
    await this.ensureClient();

    let ids = [];
    if (Array.isArray(msgIdsOrRecord)) {
      ids = msgIdsOrRecord;
    } else if (typeof msgIdsOrRecord === 'object' && msgIdsOrRecord !== null) {
      if (Array.isArray(msgIdsOrRecord.telegram_chunk_ids) && msgIdsOrRecord.telegram_chunk_ids.length > 0) {
        ids = msgIdsOrRecord.telegram_chunk_ids;
      } else if (msgIdsOrRecord.telegram_msg_id) {
        ids = [msgIdsOrRecord.telegram_msg_id];
      }
    } else {
      ids = [msgIdsOrRecord];
    }

    if (this.client && ids.length > 0) {
      try {
        await this.client.deleteMessages(telegramChatId || 'me', ids, {
          revoke: true,
        });
        console.log(`[Telegram Saved Messages] Deleted ${ids.length} message(s) from Saved Messages`);
      } catch (err) {
        console.warn('[Telegram Saved Messages] Delete message notice:', err.message);
      }
    }
  }

  /**
   * Backup the database JSON directly into Telegram Saved Messages
   */
  async backupDatabaseToSavedMessages() {
    await this.ensureClient();
    if (!this.client) {
      return { success: false, error: 'Telegram MTProto client is not connected' };
    }

    const dbPath = path.join(DATA_DIR, 'telecloud_db.json');
    if (!fs.existsSync(dbPath)) {
      return { success: false, error: 'Database JSON file not found on disk' };
    }

    try {
      const fileContent = fs.readFileSync(dbPath);
      const customFile = new CustomFile(
        `telecloud_db_backup_${Date.now()}.json`,
        fileContent.length,
        dbPath,
        fileContent
      );

      const result = await this.client.sendFile('me', {
        file: customFile,
        caption: `📦 Hightech Claude DB Backup - ${new Date().toISOString()}`,
        forceDocument: true,
      });

      return {
        success: true,
        messageId: result.id,
        timestamp: new Date().toISOString(),
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
}

const telegramService = new TelegramService();
module.exports = telegramService;
