const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { getSetting, setSetting, db, detectCategory, normalizeMessageId, normalizeMessageIds } = require('../db');
const { TelegramClient, Api } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { CustomFile } = require('telegram/client/uploads');
const { NewMessage } = require('telegram/events');
const QRCode = require('qrcode');

const { UPLOADS_DIR, CACHE_DIR, DATA_DIR } = require('../config/paths');

try {
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
} catch (e) {}

// --- Local path safety ------------------------------------------------------
// Every generated local path is built from sanitized components and verified to
// stay inside the managed directories, so a hostile file name can never escape.

const LOCAL_ROOTS_RESOLVED = [UPLOADS_DIR, CACHE_DIR, DATA_DIR, os.tmpdir()]
  .filter(Boolean)
  .map((root) => path.resolve(root));
const LOCAL_ROOTS_REAL = LOCAL_ROOTS_RESOLVED.map((root) => {
  try {
    return fs.realpathSync(root);
  } catch (e) {
    return root;
  }
});

function isContainedInRoot(root, target) {
  if (target === root) return true;
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  return target.startsWith(prefix);
}

function isSafeLocalPath(candidate) {
  if (!candidate || typeof candidate !== 'string' || candidate.includes('\0')) return false;
  let resolved;
  try {
    resolved = path.resolve(candidate);
  } catch (e) {
    return false;
  }
  if (!LOCAL_ROOTS_RESOLVED.some((root) => isContainedInRoot(root, resolved))) return false;
  try {
    const real = fs.realpathSync(resolved);
    return LOCAL_ROOTS_REAL.some((root) => isContainedInRoot(root, real));
  } catch (e) {
    return true; // not created yet
  }
}

/** Sanitize one path component so it can never contain separators or traversal. */
function safePathPart(value, fallback = 'file', maxLength = 120) {
  const cleaned = String(value === undefined || value === null ? '' : value)
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/^\.+/, '_')
    .slice(0, maxLength);
  return cleaned || fallback;
}

function buildSafeLocalPath(rootDir, ...parts) {
  const base = path.resolve(rootDir);
  const target = path.resolve(base, ...parts.map((part, index) => safePathPart(part, index === 0 ? 'file' : `part${index}`)));
  if (!isContainedInRoot(base, target) || !isSafeLocalPath(target)) {
    return null;
  }
  return target;
}

const APP_CAPTION_MARKER = 'Hightech Claude';
const BACKUP_FILE_PREFIX = 'telecloud_db_backup_';
const DEFAULT_SYNC_WINDOW = 500;
const FULL_SYNC_WINDOW = 20000;
const MSG_ID_VERIFY_BATCH = 50;

class TelegramService {
  constructor() {
    this.client = null;
    this.authType = 'saved_messages';
    this.tempClient = null;
    this.tempPhoneCodeHash = null;
    this.tempPhoneNumber = null;
    this.listenerAttached = false;
    this.qrClient = null;
    this._initPromise = null;
    this._hasLoggedNoSession = false;
    this._cachedUserDetails = null;
    this._lastStatusCheck = 0;
    this._activeSessionFingerprint = null;
    this._listenerClient = null;
    this._savedMessagesHandler = null;
    this._lastTelegramSync = 0;
  }

  // --- Client lifecycle ----------------------------------------------------

  _normalizeSession(session) {
    return String(session || '').trim();
  }

  /**
   * Stable fingerprint of a GramJS session string. Comparing fingerprints (and
   * not raw strings) avoids rebuilding the client when the very same session is
   * re-sent in a slightly different but equivalent form.
   */
  _sessionFingerprint(session) {
    const raw = this._normalizeSession(session);
    if (!raw) return null;
    try {
      const parsed = new StringSession(raw);
      const key = parsed._key && parsed._key.length
        ? parsed._key
        : parsed.authKey && typeof parsed.authKey.getKey === 'function'
          ? parsed.authKey.getKey()
          : null;
      if (key && key.length) {
        return crypto.createHash('sha256').update(Buffer.concat([Buffer.from([parsed.dcId || 0]), Buffer.from(key)])).digest('hex');
      }
    } catch (e) {
      // fall through to the raw-string fingerprint
    }
    return crypto.createHash('sha256').update(raw).digest('hex');
  }

  _currentClientFingerprint() {
    if (!this.client) return null;
    try {
      const saved = typeof this.client.session?.save === 'function' ? this.client.session.save() : '';
      return this._sessionFingerprint(saved) || this._activeSessionFingerprint;
    } catch (e) {
      return this._activeSessionFingerprint;
    }
  }

  /** True when the running client is already using exactly this session. */
  _clientMatchesSession(session) {
    const raw = this._normalizeSession(session);
    if (!raw) return true; // nothing explicit to compare
    if (!this.client) return false;
    const current = this._currentClientFingerprint();
    if (!current) return true; // unknown -> do not churn the connection
    return current === this._sessionFingerprint(raw);
  }

  _detachSavedMessagesListener() {
    if (this._savedMessagesHandler && this._listenerClient) {
      try {
        this._listenerClient.removeEventHandler(this._savedMessagesHandler);
      } catch (e) {}
    }
    this._savedMessagesHandler = null;
    this._listenerClient = null;
    this.listenerAttached = false;
  }

  /** Fully reset the active client (explicit session change / disconnect). */
  async _teardownClient(reason = 'replaced') {
    const client = this.client;
    this._detachSavedMessagesListener();
    if (client) {
      try {
        await client.disconnect();
      } catch (e) {}
    }
    if (this.client === client) this.client = null;
    this._activeSessionFingerprint = null;
    this._cachedUserDetails = null;
    this._lastStatusCheck = 0;
    this._initPromise = null;
    console.log(`[Telegram] Active client reset (${reason}).`);
  }

  /**
   * Initializes the Telegram MTProto client for Saved Messages using stored session
   */
  async init(explicitSession = null) {
    try {
      const isManualDisconnected = (await getSetting('manual_disconnect')) === true;
      if (isManualDisconnected) {
        if (this.client) {
          await this._teardownClient('manual disconnect');
        }
        this.authType = 'demo';
        return;
      }

      this.authType = 'saved_messages';

      const apiId = parseInt(await getSetting('api_id')) || 39504238;
      const apiHash = (await getSetting('api_hash')) || '39268a286a89e430e14728116cfe0680';
      const rawSession = explicitSession || (await getSetting('session_string')) || process.env.TELEGRAM_SESSION_STRING || '';
      const sessionString = this._normalizeSession(rawSession);

      if (apiId && apiHash && sessionString) {
        // An explicit session that differs from the running client must always
        // replace it - otherwise uploads keep going to the previous account.
        if (this.client && !this._clientMatchesSession(explicitSession)) {
          await this._teardownClient('explicit session change');
        }

        // If client already exists and is authorized, keep it!
        if (this.client) {
          try {
            if (!this.client.connected) {
              await this.client.connect();
            }
            const isAuth = await this.client.checkAuthorization();
            if (isAuth) {
              this._activeSessionFingerprint = this._currentClientFingerprint() || this._sessionFingerprint(sessionString);
              this.setupSavedMessagesListener();
              return;
            }
          } catch (e) {}
          // Session is disconnected or unauthorized; cleanly disconnect old client first
          await this._teardownClient('unauthorized session');
        }

        const stringSession = new StringSession(sessionString);
        const client = new TelegramClient(stringSession, apiId, String(apiHash).trim(), {
          connectionRetries: 5,
          useWSS: false,
        });

        await client.connect();
        const isAuth = await client.checkAuthorization();
        if (isAuth) {
          this.client = client;
          this._hasLoggedNoSession = false;
          this._cachedUserDetails = null;
          this._activeSessionFingerprint = this._sessionFingerprint(sessionString);
          this._detachSavedMessagesListener();
          const me = await this.client.getMe();
          if (me) {
            this._cachedUserDetails = {
              id: me.id.toString(),
              firstName: me.firstName || '',
              lastName: me.lastName || '',
              username: me.username || '',
              phone: me.phone || '',
              isPremium: me.premium || false,
              target: 'Saved Messages (me)',
            };
            this._lastStatusCheck = Date.now();
          }
          console.log(`[Telegram] Connected to Telegram Saved Messages as ${me.firstName || 'User'} (@${me.username || me.id})`);
          this.setupSavedMessagesListener();
        } else {
          console.warn('[Telegram] Session string is invalid or expired.');
          try { await client.disconnect(); } catch (e) {}
          this.client = null;
          this._activeSessionFingerprint = null;
        }
      } else {
        if (!this._hasLoggedNoSession) {
          console.log('[Telegram] Storage running in Sandbox/Demo mode until Telegram account is linked.');
          this._hasLoggedNoSession = true;
        }
      }
    } catch (err) {
      console.error('[Telegram] Init notice:', err.message);
      this.client = null;
      this._activeSessionFingerprint = null;
    }
  }

  /**
   * Lazily ensures TelegramClient is connected and authorized
   */
  async ensureClient(explicitSession = null) {
    const isManualDisconnected = (await getSetting('manual_disconnect')) === true;
    if (isManualDisconnected) {
      if (this.client) {
        await this._teardownClient('manual disconnect');
      }
      this.authType = 'demo';
      return null;
    }

    // If no session is provided and no session is saved in settings, don't attempt init
    const sessionString = this._normalizeSession(
      explicitSession || (await getSetting('session_string')) || process.env.TELEGRAM_SESSION_STRING || ''
    );
    if (!sessionString) {
      if (this.client) {
        await this._teardownClient('no session available');
      }
      this.authType = 'demo';
      return null;
    }

    // An explicitly supplied session always wins over the running client.
    if (this.client && explicitSession && !this._clientMatchesSession(explicitSession)) {
      console.log('[Telegram] Requested session differs from the active one - replacing client.');
      await this._teardownClient('explicit session change');
    }

    // If client is already connected and authorized, check if session is active
    if (this.client) {
      try {
        if (!this.client.connected) {
          await this.client.connect();
        }
        const isAuth = await this.client.checkAuthorization();
        if (isAuth) {
          this._activeSessionFingerprint = this._currentClientFingerprint() || this._activeSessionFingerprint;
          this.setupSavedMessagesListener();
          return this.client;
        }
        // If authorization failed, clean up old client
        await this._teardownClient('authorization failed');
      } catch (e) {
        console.warn('[Telegram] Reconnection check notice:', e.message);
      }
    }

    if (!this._initPromise) {
      this._initPromise = (async () => {
        await this.init(explicitSession);
        return this.client;
      })();
    }

    let client;
    try {
      client = await this._initPromise;
    } finally {
      this._initPromise = null;
    }

    // A concurrent init may have installed a different account: re-init once.
    if (explicitSession && client && !this._clientMatchesSession(explicitSession)) {
      await this._teardownClient('session mismatch after init');
      return this.ensureClient(explicitSession);
    }

    return client || null;
  }

  /**
   * Real-time sync: Listens for files sent to "Saved Messages" in any Telegram client
   */
  setupSavedMessagesListener() {
    if (!this.client || this.listenerAttached) return;
    const { isServerless } = require('../config/paths');
    if (isServerless) return;

    try {
      this._savedMessagesHandler = async (event) => {
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
      };

      this.client.addEventHandler(this._savedMessagesHandler, new NewMessage({}));

      this.listenerAttached = true;
      this._listenerClient = this.client;
      console.log('[Telegram] Real-time listener active for Saved Messages');
    } catch (e) {
      this._savedMessagesHandler = null;
      this._listenerClient = null;
      this.listenerAttached = false;
      console.warn('[Telegram] Could not attach real-time listener:', e.message);
    }
  }

  /** The app's own outgoing uploads are already indexed by the request handler. */
  _isOwnOutgoingUpload(msg) {
    if (!msg) return false;
    const caption = String(msg.message || '');
    if (!caption.includes(APP_CAPTION_MARKER)) return false;
    return msg.out === true || msg.out === 1;
  }

  _isBackupMessage(msg) {
    if (!msg) return false;
    const fileName = this._extractFileMetadata(msg).fileName;
    if (fileName && fileName.startsWith(BACKUP_FILE_PREFIX)) return true;
    return String(msg.message || '').includes('DB Backup');
  }

  _extractFileMetadata(msg) {
    let fileName = '';
    let mimeType = 'application/octet-stream';
    let fileSize = 0;

    if (msg && msg.media && msg.media.document) {
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
      if (!fileName) fileName = `document_${normalizeMessageId(msg.id) || Date.now()}`;
    } else if (msg && msg.media && msg.media.photo) {
      fileName = `photo_${normalizeMessageId(msg.id) || Date.now()}.jpg`;
      mimeType = 'image/jpeg';
      fileSize = 0;
    }

    // Recover the user facing name from the caption the app writes on upload.
    if (fileName && msg && msg.message && String(msg.message).includes(APP_CAPTION_MARKER)) {
      const match = String(msg.message).match(/Hightech Claude(?: \[Part \d+\/\d+\])?: (.+?)(?: \([\d.]+ [KMGT]?B\))?$/m);
      if (match && match[1]) fileName = match[1].trim();
    }

    return { fileName, mimeType, fileSize };
  }

  async _isMessageAlreadyIndexed(msgId) {
    const id = normalizeMessageId(msgId);
    if (id === null) return true;
    try {
      return !!(await db.getFileByTelegramMsgId(id));
    } catch (e) {
      // If the lookup fails we must not create a duplicate record.
      return true;
    }
  }

  /**
   * Handle incoming media sent directly to Telegram Saved Messages
   */
  async handleSavedMessageMedia(msg) {
    try {
      if (!msg || !msg.media) return;
      if (this._isOwnOutgoingUpload(msg)) return; // already indexed by the uploader
      if (this._isBackupMessage(msg)) return; // DB snapshots are not files

      const msgId = normalizeMessageId(msg.id);
      if (msgId === null) return;
      if (await this._isMessageAlreadyIndexed(msgId)) return;

      const { fileName, mimeType, fileSize } = this._extractFileMetadata(msg);
      if (!fileName) return;

      const category = detectCategory(mimeType, fileName);
      const record = await db.insertFile({
        name: fileName,
        original_name: fileName,
        mime_type: mimeType,
        size: fileSize,
        category,
        telegram_msg_id: msgId,
        telegram_chunk_ids: [msgId],
        is_chunked: false,
        total_parts: 1,
        telegram_chat_id: 'me',
        storage_type: 'telegram',
        local_path: null,
        created_at: new Date(msg.date ? msg.date * 1000 : Date.now()).toISOString(),
      });
      console.log(`[Telegram Saved Messages] Indexed new media: ${fileName} (msg_id: ${msgId}, record: ${record.id})`);
    } catch (err) {
      console.warn('[Telegram Saved Messages] Index media notice:', err.message);
    }
  }

  /**
   * Get current connection status and details (without leaking secrets)
   */
  async getStatus(explicitSession = null) {
    const isManualDisconnected = (await getSetting('manual_disconnect')) === true;
    if (isManualDisconnected) {
      return {
        connected: false,
        authType: 'demo',
        configuredType: 'saved_messages',
        sessionString: '',
        user: {
          firstName: 'Disconnected',
          username: '',
          target: 'Saved Messages (Offline / Sandbox)',
        },
        hasCredentials: { hasApiId: false, hasSession: false },
        manualDisconnect: true,
      };
    }

    const sessionString = this._normalizeSession(
      explicitSession || (await getSetting('session_string')) || process.env.TELEGRAM_SESSION_STRING || ''
    );
    const hasSession = !!sessionString;
    const now = Date.now();

    // Fast memory-cached response (TTL: 45 seconds) to avoid hammering Telegram DC with getMe() MTProto requests
    if (this.client && this._cachedUserDetails && (now - this._lastStatusCheck < 45000)) {
      const activeSession = (this.client?.session?.save?.() || sessionString);
      return {
        connected: true,
        authType: 'saved_messages',
        configuredType: 'saved_messages',
        sessionString: activeSession,
        user: this._cachedUserDetails,
        hasCredentials: {
          hasApiId: true,
          hasSession: true,
        },
        manualDisconnect: false,
      };
    }

    if (!isManualDisconnected && hasSession) {
      if (!this.client || !this.client.connected) {
        try {
          await this.ensureClient(sessionString);
        } catch (e) {
          console.warn('[Telegram] Client ensure notice:', e.message);
        }
      }
    }

    const apiId = await getSetting('api_id');
    let userDetails = this._cachedUserDetails;

    if (this.client && !isManualDisconnected) {
      try {
        if (!userDetails || (now - this._lastStatusCheck >= 45000)) {
          // 4-second timeout safeguard on getMe so cold-starts or network delays never freeze the response
          const me = await Promise.race([
            this.client.getMe(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('getMe timeout')), 4000)),
          ]);
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
            this._cachedUserDetails = userDetails;
            this._lastStatusCheck = Date.now();
          }
        }
      } catch (err) {
        console.warn('[Telegram] Transient error getting user details:', err.message);
      }
    }

    const activeSession = this.client?.session?.save?.() || sessionString || '';
    const isConnected = !isManualDisconnected && !!this.client && (!!userDetails || this.client.connected);

    return {
      connected: isConnected,
      authType: isConnected ? 'saved_messages' : 'demo',
      configuredType: 'saved_messages',
      sessionString: isConnected ? activeSession : '',
      user: userDetails || this._cachedUserDetails || {
        firstName: isManualDisconnected ? 'Disconnected' : 'Telegram User',
        username: '',
        target: 'Saved Messages (me)',
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
      tempSession: tempSessionString,
      isCodeViaApp,
      message: isCodeViaApp
        ? `Verification code sent to your Telegram app for ${cleanPhone}!`
        : `Verification code sent via SMS for ${cleanPhone}!`,
    };
  }

  /**
   * Verify phone OTP code and complete MTProto login to Saved Messages
   */
  async verifyPhoneCode(code, password = '', passedPhoneCodeHash = null, passedPhoneNumber = null, passedTempSession = null) {
    const apiId = parseInt(await getSetting('api_id')) || 39504238;
    const rawApiHash = (await getSetting('api_hash')) || '39268a286a89e430e14728116cfe0680';
    const cleanApiHash = String(rawApiHash).trim();

    if (!cleanApiHash) {
      throw new Error('Telegram API Hash is missing. Please configure your API credentials.');
    }

    const phoneNumber = this._normalizeSession(passedPhoneNumber || this.tempPhoneNumber || (await getSetting('phone_number')));
    const phoneCodeHash = this._normalizeSession(passedPhoneCodeHash || this.tempPhoneCodeHash || (await getSetting('phone_code_hash')));
    const tempAuthSession = this._normalizeSession(passedTempSession || (await getSetting('temp_auth_session')));

    if (!phoneNumber) {
      throw new Error('Phone number is missing. Please click Back and request a new code.');
    }
    if (!phoneCodeHash) {
      throw new Error('Verification session expired or phoneCodeHash missing. Please click Back and request a new code.');
    }

    let client = this.tempClient;
    if (!client || (passedTempSession && client.session.save() !== passedTempSession)) {
      if (!tempAuthSession) {
        throw new Error('Authentication session lost. Please click Back and request a fresh code.');
      }
      // Reconstitute client with the exact DC and AuthKey from sendPhoneCode
      const stringSession = new StringSession(tempAuthSession);
      client = new TelegramClient(stringSession, apiId, cleanApiHash, {
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
        try {
          const { computeCheck } = require('telegram/Password');
          const passwordSrp = await client.invoke(new Api.account.GetPassword());
          const passwordSrpCheck = await computeCheck(passwordSrp, password);
          await client.invoke(
            new Api.auth.CheckPassword({
              password: passwordSrpCheck,
            })
          );
        } catch (pwErr) {
          if (pwErr.errorMessage === 'PASSWORD_HASH_INVALID') {
            throw new Error('Incorrect Two-Step Verification (2FA) password. Please check your password and try again.');
          }
          throw pwErr;
        }
      } else if (err.errorMessage === 'PHONE_CODE_EXPIRED') {
        throw new Error('Verification code has expired. Please click Back and send a fresh code.');
      } else if (err.errorMessage === 'PHONE_CODE_INVALID') {
        throw new Error('Invalid verification code. Please check the code in your Telegram app and try again.');
      } else {
        throw err;
      }
    }

    return await this._finalizeSessionLogin(client);
  }

  /**
   * Finalize login and persist session for MTProto authentication (used by OTP and QR login)
   */
  async _finalizeSessionLogin(client) {
    const sessionString = client.session.save();
    await setSetting('manual_disconnect', false);
    await setSetting('session_string', sessionString);
    await setSetting('auth_type', 'saved_messages');
    await setSetting('chat_id', 'me');

    // Clear temporary auth data
    await setSetting('temp_auth_session', '');
    await setSetting('phone_code_hash', '');

    // The account is switching: drop the previous client and its listener first.
    if (this.client && this.client !== client) {
      await this._teardownClient('account changed');
    }

    this.client = client;
    this.authType = 'saved_messages';
    this.tempClient = null;
    this.qrClient = null;
    this.tempPhoneCodeHash = null;
    this.tempPhoneNumber = null;
    this._activeSessionFingerprint = this._sessionFingerprint(sessionString);
    this._cachedUserDetails = null;
    this._detachSavedMessagesListener();
    this.setupSavedMessagesListener();

    const me = await client.getMe();
    if (me) {
      this._cachedUserDetails = {
        id: me.id.toString(),
        firstName: me.firstName || '',
        lastName: me.lastName || '',
        username: me.username || '',
        phone: me.phone || '',
        isPremium: me.premium || false,
        target: 'Saved Messages (me)',
      };
      this._lastStatusCheck = Date.now();
    }
    return {
      status: 'success',
      success: true,
      sessionString,
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
   * Generate Telegram QR code for instant login via mobile Telegram app (Settings > Devices > Link Desktop)
   */
  async getQrCode(apiId = null, apiHash = null) {
    const cleanApiId = parseInt(apiId || (await getSetting('api_id')));
    const cleanApiHash = (apiHash || (await getSetting('api_hash')) || '').trim();

    if (!cleanApiId || !cleanApiHash) {
      throw new Error('Telegram API ID and API Hash are required.');
    }

    const stringSession = new StringSession('');
    const client = new TelegramClient(stringSession, cleanApiId, cleanApiHash, {
      connectionRetries: 5,
      useWSS: false,
    });

    await client.connect();

    const res = await client.invoke(
      new Api.auth.ExportLoginToken({
        apiId: cleanApiId,
        apiHash: cleanApiHash,
        exceptIds: [],
      })
    );

    if (!(res instanceof Api.auth.LoginToken)) {
      throw new Error(`Unexpected response from Telegram: ${res.className}`);
    }

    const tokenBase64 = Buffer.from(res.token).toString('base64url');
    const loginUrl = `tg://login?token=${tokenBase64}`;
    const qrDataUrl = await QRCode.toDataURL(loginUrl, {
      margin: 2,
      scale: 8,
      color: { dark: '#000000', light: '#ffffff' },
    });

    this.qrClient = client;

    return {
      success: true,
      token: tokenBase64,
      loginUrl,
      qrDataUrl,
      expires: res.expires,
      tempSession: client.session.save(),
    };
  }

  /**
   * Check status of QR code scan (polling) and complete login when user confirms on phone
   */
  async checkQrCode(tempSession, password = '', apiId = null, apiHash = null) {
    const cleanApiId = parseInt(apiId || (await getSetting('api_id')));
    const cleanApiHash = (apiHash || (await getSetting('api_hash')) || '').trim();

    if (!tempSession) {
      throw new Error('QR session is missing. Please refresh the QR code.');
    }

    let client = this.qrClient;
    if (!client || !client.connected || (tempSession && client.session.save() !== tempSession)) {
      const stringSession = new StringSession(tempSession);
      client = new TelegramClient(stringSession, cleanApiId, cleanApiHash, {
        connectionRetries: 3,
        useWSS: false,
      });
      await client.connect();
      this.qrClient = client;
    }

    let result;
    try {
      result = await client.invoke(
        new Api.auth.ExportLoginToken({
          apiId: cleanApiId,
          apiHash: cleanApiHash,
          exceptIds: [],
        })
      );
    } catch (err) {
      if (err.errorMessage === 'SESSION_PASSWORD_NEEDED') {
        if (!password) {
          return {
            status: 'requires2FA',
            message: 'Two-Step Verification password is required.',
            tempSession: client.session.save(),
          };
        }
        try {
          const { computeCheck } = require('telegram/Password');
          const passwordSrp = await client.invoke(new Api.account.GetPassword());
          const passwordSrpCheck = await computeCheck(passwordSrp, password);
          await client.invoke(
            new Api.auth.CheckPassword({
              password: passwordSrpCheck,
            })
          );
          return await this._finalizeSessionLogin(client);
        } catch (pwErr) {
          if (pwErr.errorMessage === 'PASSWORD_HASH_INVALID') {
            throw new Error('Incorrect Two-Step Verification (2FA) password.');
          }
          throw pwErr;
        }
      }
      throw err;
    }

    if (result instanceof Api.auth.LoginToken) {
      // Still waiting to be scanned or token refreshed
      const tokenBase64 = Buffer.from(result.token).toString('base64url');
      const loginUrl = `tg://login?token=${tokenBase64}`;
      const qrDataUrl = await QRCode.toDataURL(loginUrl, {
        margin: 2,
        scale: 8,
        color: { dark: '#000000', light: '#ffffff' },
      });
      return {
        status: 'waiting',
        expires: result.expires,
        token: tokenBase64,
        loginUrl,
        qrDataUrl,
        tempSession: client.session.save(),
      };
    }

    if (result instanceof Api.auth.LoginTokenMigrateTo) {
      await client._switchDC(result.dcId);
      const migrated = await client.invoke(
        new Api.auth.ImportLoginToken({
          token: result.token,
        })
      );
      if (migrated instanceof Api.auth.LoginTokenSuccess) {
        return await this._finalizeSessionLogin(client);
      }
      throw new Error(`Unexpected migrated result: ${migrated.className}`);
    }

    if (result instanceof Api.auth.LoginTokenSuccess) {
      return await this._finalizeSessionLogin(client);
    }

    throw new Error(`Unknown QR state: ${result.className}`);
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

    const targetSession = this._normalizeSession(sessionString);
    const targetFingerprint = this._sessionFingerprint(targetSession);

    // Reuse the client only when it is already authorized with THIS session.
    if (this.client && this._clientMatchesSession(targetSession)) {
      try {
        if (!this.client.connected) {
          await this.client.connect();
        }
        const isAuth = await this.client.checkAuthorization();
        if (isAuth) {
          const me = await this.client.getMe();
          if (me) {
            this._cachedUserDetails = {
              id: me.id.toString(),
              firstName: me.firstName || '',
              lastName: me.lastName || '',
              username: me.username || '',
              phone: me.phone || '',
              isPremium: me.premium || false,
              target: 'Saved Messages (me)',
            };
            this._lastStatusCheck = Date.now();
            this._activeSessionFingerprint = this._currentClientFingerprint() || targetFingerprint;
            this.setupSavedMessagesListener();
            return {
              success: true,
              sessionString: this.client.session?.save?.() || targetSession,
              user: this._cachedUserDetails,
            };
          }
        }
      } catch (e) {}
    }

    // Always start from a clean slate: the account may be different.
    if (this.client) {
      await this._teardownClient('session string connect');
    }

    const stringSession = new StringSession(targetSession);
    const client = new TelegramClient(stringSession, cleanApiId, cleanApiHash, {
      connectionRetries: 5,
      useWSS: false,
    });

    await client.connect();
    const isAuth = await client.checkAuthorization();
    if (!isAuth) {
      try { await client.disconnect(); } catch (e) {}
      throw new Error('Invalid or expired Telegram Session String.');
    }

    await setSetting('manual_disconnect', false);
    await setSetting('api_id', cleanApiId.toString());
    await setSetting('api_hash', cleanApiHash);
    await setSetting('session_string', targetSession);
    await setSetting('auth_type', 'saved_messages');
    await setSetting('chat_id', 'me');

    this.client = client;
    this.authType = 'saved_messages';
    this._activeSessionFingerprint = targetFingerprint;
    this._cachedUserDetails = null;
    this._detachSavedMessagesListener();
    this.setupSavedMessagesListener();

    const me = await client.getMe();
    if (me) {
      this._cachedUserDetails = {
        id: me.id.toString(),
        firstName: me.firstName || '',
        lastName: me.lastName || '',
        username: me.username || '',
        phone: me.phone || '',
        isPremium: me.premium || false,
        target: 'Saved Messages (me)',
      };
      this._lastStatusCheck = Date.now();
    }
    return {
      success: true,
      sessionString: targetSession,
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
   * Disconnect current session & revert to sandbox demo mode
   */
  async disconnect() {
    await this._teardownClient('manual disconnect');

    this.authType = 'demo';
    this._cachedUserDetails = null;
    this._lastStatusCheck = 0;
    this._hasLoggedNoSession = true;

    await setSetting('manual_disconnect', true);
    await setSetting('session_string', '');
    await setSetting('auth_type', 'demo');

    // Clear from in-memory process.env so it cannot resurrect
    delete process.env.TELEGRAM_SESSION_STRING;
    process.env.TELEGRAM_AUTH_TYPE = 'demo';

    return { success: true };
  }

  /**
   * Upload file directly to Telegram Saved Messages ('me').
   * Supports UNLIMITED file sizes by automatically chunking files exceeding 1.9GB.
   */
  async uploadFile({ originalName, buffer, filePath = null, sessionString = null, onProgress = null }) {
    await this.ensureClient(sessionString);
    if (!this.client) {
      throw new Error('Telegram client is not connected. Connect your Telegram account first.');
    }

    const safeName = safePathPart(originalName, 'file');
    const MAX_TELEGRAM_SINGLE_FILE = 1900 * 1024 * 1024; // 1.9 GB safe ceiling for MTProto single document

    const contentLength = buffer ? buffer.length : (Number(filePath && fs.existsSync(filePath) ? fs.statSync(filePath).size : 0) || 0);
    const size = Number.isFinite(Number(size)) && Number(size) > 0 ? Number(size) : contentLength;

    // Case A: File exceeds 1.9GB -> Automatic Multi-Part Chunking for Unlimited Size
    if (size > MAX_TELEGRAM_SINGLE_FILE && filePath && fs.existsSync(filePath)) {
      const totalParts = Math.ceil(size / MAX_TELEGRAM_SINGLE_FILE);
      const chunkMsgIds = [];
      const tempChunkPaths = [];
      console.log(`[Telegram Saved Messages] File ${originalName} (${(size / 1024 / 1024 / 1024).toFixed(2)} GB) exceeds 1.9GB Telegram limit. Automatically chunking into ${totalParts} parts...`);

      try {
        for (let partIdx = 0; partIdx < totalParts; partIdx++) {
          const start = partIdx * MAX_TELEGRAM_SINGLE_FILE;
          const end = Math.min(size - 1, (partIdx + 1) * MAX_TELEGRAM_SINGLE_FILE - 1);
          const partSize = end - start + 1;
          const tempChunkPath = buildSafeLocalPath(
            CACHE_DIR,
            `temp_chunk_${Date.now()}_${partIdx}_${safeName}`
          );
          if (!tempChunkPath) {
            throw new Error('Could not create a safe temporary chunk path.');
          }
          tempChunkPaths.push(tempChunkPath);

          // Stream slice chunk to disk to keep RAM usage minimal
          await new Promise((resolve, reject) => {
            const rs = fs.createReadStream(filePath, { start, end });
            const ws = fs.createWriteStream(tempChunkPath);
            let settled = false;
            const fail = (err) => {
              if (settled) return;
              settled = true;
              try { ws.destroy(); } catch (e) {}
              try { rs.destroy(); } catch (e) {}
              reject(err);
            };
            rs.on('error', fail);
            ws.on('error', fail);
            ws.on('finish', () => {
              if (settled) return;
              settled = true;
              resolve();
            });
            rs.pipe(ws);
          });

          const customFile = new CustomFile(
            `${originalName}.part${String(partIdx + 1).padStart(3, '0')}`,
            partSize,
            tempChunkPath,
            undefined
          );

          const result = await this.client.sendFile('me', {
            file: customFile,
            caption: `📁 ${APP_CAPTION_MARKER} [Part ${partIdx + 1}/${totalParts}]: ${originalName}`,
            forceDocument: true,
            workers: 3,
            progressCallback: (partProgress) => {
              if (typeof onProgress === 'function') {
                const overallRatio = (partIdx + partProgress) / totalParts;
                onProgress(overallRatio);
              }
            },
          });

          const msgId = normalizeMessageId(result && result.id);
          if (msgId === null) {
            throw new Error(`Telegram did not return a message id for chunk ${partIdx + 1}.`);
          }
          chunkMsgIds.push(msgId);
          console.log(`[Telegram Saved Messages] Uploaded chunk ${partIdx + 1}/${totalParts} (msg_id: ${msgId})`);
        }
      } finally {
        // Temporary chunk slices must never be left behind on disk.
        for (const tempPath of tempChunkPaths) {
          try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch (e) {}
        }
      }

      if (typeof onProgress === 'function') onProgress(1.0);
      this.scheduleAutoBackup();

      return {
        storageType: 'telegram',
        telegramMsgId: chunkMsgIds[0],
        telegramChunkIds: chunkMsgIds,
        telegramChatId: 'me',
        isChunked: true,
        totalParts,
        localPath: null,
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
      caption: `📁 ${APP_CAPTION_MARKER}: ${originalName} (${(size / 1024 / 1024).toFixed(2)} MB)`,
      forceDocument: true,
      workers: 3,
      progressCallback: (progress) => {
        if (typeof onProgress === 'function') {
          onProgress(progress);
        }
      },
    });

    const msgId = normalizeMessageId(result && result.id);
    if (msgId === null) {
      throw new Error('Telegram did not return a message id for the upload.');
    }

    if (typeof onProgress === 'function') onProgress(1.0);

    console.log(`[Telegram Saved Messages] Uploaded ${originalName} (${size} bytes, msg_id: ${msgId})`);
    this.scheduleAutoBackup();

    return {
      storageType: 'telegram',
      telegramMsgId: msgId,
      telegramChunkIds: [msgId],
      telegramChatId: 'me',
      isChunked: false,
      totalParts: 1,
      localPath: null,
      size: size,
    };
  }

  // --- Local cache helpers -------------------------------------------------

  /** Safe, generated cache location for a file record (never derived from raw names). */
  getCachePathForRecord(fileRecord) {
    if (!fileRecord) return null;
    const idPart = safePathPart(fileRecord.id, 'file');
    const msgPart = safePathPart(normalizeMessageId(fileRecord.telegram_msg_id) || 'nomsg', 'nomsg', 32);
    const namePart = safePathPart(fileRecord.name || fileRecord.original_name || 'file', 'file', 80);
    return buildSafeLocalPath(CACHE_DIR, `${idPart}_${msgPart}_${namePart}`);
  }

  /** Remove the cached copy of a file (used when its content is replaced or deleted). */
  removeLocalCache(fileRecord) {
    const cachePath = this.getCachePathForRecord(fileRecord);
    if (!cachePath || !isSafeLocalPath(cachePath)) return null;
    try {
      if (fs.existsSync(cachePath)) {
        fs.unlinkSync(cachePath);
        return cachePath;
      }
    } catch (e) {}
    return null;
  }

  _legacyUploadsPathForRecord(fileRecord) {
    if (!fileRecord) return null;
    return buildSafeLocalPath(UPLOADS_DIR, `${fileRecord.id}_${fileRecord.original_name || fileRecord.name || 'file'}`);
  }

  /**
   * Download / Stream a file from Telegram Saved Messages with multi-part chunk reconstruction and local cache
   */
  async getFileStream(fileRecord, explicitSession = null) {
    if (!fileRecord) {
      throw new Error('No file record provided.');
    }

    await this.ensureClient(explicitSession);

    const cacheFilePath = this.getCachePathForRecord(fileRecord);
    const expectedSize = Number(fileRecord.size) || 0;

    // 0. High-Speed Local Cache Hit (0ms - instant disk stream). Zero-byte files
    //    are valid, so a 0 length cache file is accepted for 0 length records.
    if (cacheFilePath && fs.existsSync(cacheFilePath)) {
      try {
        const stat = fs.statSync(cacheFilePath);
        // Unknown / zero-byte record size: any cached copy is acceptable (e.g. photos).
        const sizeMatches = !expectedSize || stat.size === expectedSize;
        if (stat.isFile() && sizeMatches) {
          return {
            type: 'stream',
            stream: fs.createReadStream(cacheFilePath),
            size: stat.size,
            mimeType: fileRecord.mime_type,
            localPath: cacheFilePath,
            fromCache: true,
          };
        }
      } catch (e) {}
    }

    // 1. Legacy local_path (only honoured when it resolves inside a managed dir)
    if (fileRecord.local_path && isSafeLocalPath(fileRecord.local_path) && fs.existsSync(fileRecord.local_path)) {
      try {
        const stat = fs.statSync(fileRecord.local_path);
        if (stat.isFile() && (stat.size > 0 || expectedSize === 0)) {
          return {
            type: 'stream',
            stream: fs.createReadStream(fileRecord.local_path),
            size: stat.size,
            mimeType: fileRecord.mime_type,
            localPath: fileRecord.local_path,
            fromCache: true,
          };
        }
      } catch (e) {}
    }

    // 2. Telegram Saved Messages (MTProto) download, streamed straight to disk
    const chunkIds = Array.isArray(fileRecord.telegram_chunk_ids) && fileRecord.telegram_chunk_ids.length > 0
      ? fileRecord.telegram_chunk_ids
      : (fileRecord.telegram_msg_id ? [fileRecord.telegram_msg_id] : []);
    const chatId = fileRecord.telegram_chat_id || 'me';

    if (fileRecord.storage_type === 'telegram' && this.client && chunkIds.length > 0 && cacheFilePath) {
      const partPaths = [];
      try {
        if (chunkIds.length > 1) {
          console.log(`[Telegram Saved Messages] Reassembling ${chunkIds.length} chunks for ${fileRecord.name}...`);

          for (let i = 0; i < chunkIds.length; i++) {
            const chunkMsgId = chunkIds[i];
            const partPath = buildSafeLocalPath(CACHE_DIR, `${path.basename(cacheFilePath)}.part${i}`);
            if (!partPath) throw new Error('Could not create a safe temporary chunk path.');

            const media = await this._fetchMedia(chatId, chunkMsgId);
            if (!media) throw new Error(`Telegram chunk message ${chunkMsgId} is missing.`);

            const out = await this.client.downloadMedia(media, { outputFile: partPath });
            const written = typeof out === 'string' && fs.existsSync(out) ? out : (fs.existsSync(partPath) ? partPath : null);
            if (!written) throw new Error(`Failed to download chunk ${chunkMsgId}.`);
            partPaths.push(written);
          }

          await this._concatFiles(partPaths, cacheFilePath);
        } else {
          const media = await this._fetchMedia(chatId, chunkIds[0]);
          if (!media) throw new Error(`Telegram message ${chunkIds[0]} is missing.`);
          const out = await this.client.downloadMedia(media, { outputFile: cacheFilePath });
          if (typeof out !== 'string' && !fs.existsSync(cacheFilePath)) {
            throw new Error(`Failed to download message ${chunkIds[0]}.`);
          }
        }

        const stat = fs.statSync(cacheFilePath);
        return {
          type: 'stream',
          stream: fs.createReadStream(cacheFilePath),
          size: stat.size,
          mimeType: fileRecord.mime_type,
          localPath: cacheFilePath,
          fromCache: false,
        };
      } catch (err) {
        console.error('[Telegram Saved Messages] MTProto download error:', err.message);
        // Never serve a partially written cache file.
        try { if (fs.existsSync(cacheFilePath)) fs.unlinkSync(cacheFilePath); } catch (e) {}
        // A valid zero-byte file must still be servable.
        if (expectedSize === 0) {
          try {
            fs.writeFileSync(cacheFilePath, Buffer.alloc(0));
            return {
              type: 'stream',
              stream: fs.createReadStream(cacheFilePath),
              size: 0,
              mimeType: fileRecord.mime_type,
              localPath: cacheFilePath,
              fromCache: false,
            };
          } catch (e) {}
        }
      } finally {
        for (const partPath of partPaths) {
          try { if (fs.existsSync(partPath)) fs.unlinkSync(partPath); } catch (e) {}
        }
      }
    }

    // 3. Legacy fallback file in UPLOADS_DIR (path is generated & verified)
    const fallbackPath = this._legacyUploadsPathForRecord(fileRecord);
    if (fallbackPath && isSafeLocalPath(fallbackPath) && fs.existsSync(fallbackPath)) {
      try {
        const stat = fs.statSync(fallbackPath);
        if (stat.isFile()) {
          return {
            type: 'stream',
            stream: fs.createReadStream(fallbackPath),
            size: stat.size,
            mimeType: fileRecord.mime_type,
            localPath: fallbackPath,
            fromCache: true,
          };
        }
      } catch (e) {}
    }

    throw new Error('File could not be downloaded from Telegram Saved Messages or local cache.');
  }

  async _fetchMedia(chatId, msgId) {
    const id = normalizeMessageId(msgId);
    if (id === null) return null;
    const messages = await this.client.getMessages(chatId, { ids: [id] });
    const message = messages && messages[0];
    if (!message || !message.media) return null;
    if (message.className === 'MessageEmpty') return null;
    return message.media;
  }

  /** Concatenate files sequentially without buffering them in memory. */
  _concatFiles(sourcePaths, targetPath) {
    return new Promise((resolve, reject) => {
      const out = fs.createWriteStream(targetPath);
      let index = 0;
      let settled = false;

      const fail = (err) => {
        if (settled) return;
        settled = true;
        try { out.destroy(); } catch (e) {}
        reject(err);
      };

      const next = () => {
        if (settled) return;
        if (index >= sourcePaths.length) {
          out.end();
          return;
        }
        const input = fs.createReadStream(sourcePaths[index++]);
        input.on('error', fail);
        input.on('end', next);
        input.pipe(out, { end: false });
      };

      out.on('error', fail);
      out.on('finish', () => {
        if (settled) return;
        settled = true;
        resolve();
      });

      next();
    });
  }

  /**
   * Delete message or array of chunk messages from Telegram Saved Messages
   */
  async deleteTelegramMessage(msgIdsOrRecord, telegramChatId = 'me') {
    if (!msgIdsOrRecord) return { deleted: 0 };
    await this.ensureClient();

    let ids = [];
    let chatId = telegramChatId || 'me';
    if (Array.isArray(msgIdsOrRecord)) {
      ids = msgIdsOrRecord;
    } else if (typeof msgIdsOrRecord === 'object') {
      const chunkIds = normalizeMessageIds(msgIdsOrRecord.telegram_chunk_ids);
      const primary = normalizeMessageId(msgIdsOrRecord.telegram_msg_id);
      ids = [...chunkIds];
      if (primary && !ids.includes(primary)) ids.push(primary);
      chatId = msgIdsOrRecord.telegram_chat_id || chatId;
    } else {
      ids = [msgIdsOrRecord];
    }

    ids = normalizeMessageIds(ids);
    if (!this.client || ids.length === 0) return { deleted: 0 };

    let deleted = 0;
    // Telegram caps deleteMessages requests, so chunk large deletions.
    for (let i = 0; i < ids.length; i += 100) {
      const batch = ids.slice(i, i + 100);
      try {
        await this.client.deleteMessages(chatId, batch, { revoke: true });
        deleted += batch.length;
      } catch (err) {
        console.warn('[Telegram Saved Messages] Delete message notice:', err.message);
      }
    }
    if (deleted > 0) {
      console.log(`[Telegram Saved Messages] Deleted ${deleted} message(s) from Saved Messages`);
    }
    return { deleted };
  }

  /**
   * Backup the database JSON directly into Telegram Saved Messages
   */
  async backupDatabaseToSavedMessages(explicitSession = null) {
    await this.ensureClient(explicitSession);
    if (!this.client) {
      return { success: false, error: 'Telegram MTProto client is not connected' };
    }

    try {
      // Flush pending writes first so the backup can never read a stale file.
      if (typeof db.flushData === 'function') {
        db.flushData();
      } else {
        db.saveData(db.data, true);
      }

      const dbPath = path.join(DATA_DIR, 'telecloud_db.json');
      let fileContent;
      if (fs.existsSync(dbPath)) {
        fileContent = fs.readFileSync(dbPath);
      } else {
        fileContent = Buffer.from(JSON.stringify(db.data || {}, null, 2), 'utf-8');
      }

      // The MTProto session is never restored from a backup, so it must not be
      // copied into a chat message.
      fileContent = this._redactBackupSecrets(fileContent);

      const backupFileName = `${BACKUP_FILE_PREFIX}${Date.now()}.json`;
      const customFile = new CustomFile(
        backupFileName,
        fileContent.length,
        dbPath,
        fileContent
      );

      const result = await this.client.sendFile('me', {
        file: customFile,
        caption: `📦 ${APP_CAPTION_MARKER} DB Backup - ${new Date().toISOString()}`,
        forceDocument: true,
      });

      const messageId = normalizeMessageId(result && result.id);
      console.log(`[Telegram Backup] Database snapshot saved to Saved Messages (msg_id: ${messageId})`);
      return {
        success: true,
        messageId,
        timestamp: new Date().toISOString(),
      };
    } catch (err) {
      console.warn('[Telegram Backup] Backup error:', err.message);
      return { success: false, error: err.message };
    }
  }

  _redactBackupSecrets(buffer) {
    const secretKeys = ['session_string', 'temp_auth_session', 'phone_number', 'phone_code_hash'];
    try {
      const parsed = JSON.parse(buffer.toString('utf-8'));
      if (parsed && parsed.settings && typeof parsed.settings === 'object') {
        for (const key of secretKeys) {
          if (key in parsed.settings) parsed.settings[key] = '';
        }
      }
      return Buffer.from(JSON.stringify(parsed, null, 2), 'utf-8');
    } catch (e) {
      return buffer;
    }
  }

  /**
   * Debounced auto-backup after file uploads or changes
   */
  scheduleAutoBackup() {
    if (this._backupTimer) clearTimeout(this._backupTimer);
    this._backupTimer = setTimeout(() => {
      this._backupTimer = null;
      if (!this.client) return;
      this.backupDatabaseToSavedMessages().catch((e) => {
        console.warn('[Telegram Auto-Backup] Notice:', e.message);
      });
    }, 4000);
    if (typeof this._backupTimer.unref === 'function') this._backupTimer.unref();
  }

  // --- Telegram scan / sync -------------------------------------------------

  /**
   * Walk Saved Messages and collect every message that carries media.
   * `complete` is only true when the whole history was walked - partial scans
   * must never be used to delete metadata.
   */
  async _scanSavedMessages({ maxMessages = DEFAULT_SYNC_WINDOW } = {}) {
    const result = { messages: new Map(), complete: false, scannedCount: 0, oldestId: null, newestId: null, error: null };
    if (!this.client) return result;

    try {
      let count = 0;
      for await (const msg of this.client.iterMessages('me', { limit: maxMessages })) {
        count += 1;
        const id = normalizeMessageId(msg && msg.id);
        if (id !== null && msg && msg.media) {
          result.messages.set(id, msg);
          if (result.oldestId === null || id < result.oldestId) result.oldestId = id;
          if (result.newestId === null || id > result.newestId) result.newestId = id;
        }
        if (count >= maxMessages) break;
      }
      result.scannedCount = count;
      result.complete = count < maxMessages;
    } catch (err) {
      result.error = err.message;
      result.complete = false;
      result.scannedCount = result.messages.size;
    }

    return result;
  }

  /** Authoritative existence check for specific message ids. */
  async _findMissingMessageIds(chatId, ids) {
    const missing = new Set();
    const list = normalizeMessageIds(ids);
    for (let i = 0; i < list.length; i += MSG_ID_VERIFY_BATCH) {
      const batch = list.slice(i, i + MSG_ID_VERIFY_BATCH);
      const messages = await this.client.getMessages(chatId, { ids: batch });
      const found = new Set();
      for (const message of messages || []) {
        const id = normalizeMessageId(message && message.id);
        if (id !== null && message.className !== 'MessageEmpty') found.add(id);
      }
      for (const id of batch) {
        if (!found.has(id)) missing.add(id);
      }
    }
    return missing;
  }

  /**
   * Scan and restore database & files from Telegram Saved Messages ('me')
   */
  async syncFromTelegramSavedMessages(explicitSession = null, options = {}) {
    await this.ensureClient(explicitSession);
    if (!this.client) {
      return { success: false, error: 'Telegram client is not connected. Please connect your Telegram account first.' };
    }

    const maxMessages = options.full
      ? (options.maxMessages || FULL_SYNC_WINDOW)
      : (options.maxMessages || DEFAULT_SYNC_WINDOW);

    try {
      console.log(`[Telegram Sync] Synchronizing files and folders from Telegram Saved Messages (window: ${maxMessages})...`);

      const scan = await this._scanSavedMessages({ maxMessages });
      if (scan.error) {
        console.warn(`[Telegram Sync] Scan incomplete: ${scan.error}`);
      }
      if (scan.scannedCount === 0 && !scan.complete) {
        return { success: false, error: `Telegram scan failed: ${scan.error || 'no messages returned'}` };
      }

      let restoredFromBackup = false;
      let newlyIndexedCount = 0;

      // 1. Restore state from the newest database backup snapshot in the scan.
      let newestBackupId = null;
      for (const [msgId, msg] of scan.messages.entries()) {
        if (!this._isBackupMessage(msg)) continue;
        if (newestBackupId === null || msgId > newestBackupId) newestBackupId = msgId;
      }

      if (newestBackupId !== null) {
        const backupMsg = scan.messages.get(newestBackupId);
        try {
          console.log(`[Telegram Sync] Found cloud backup in message ${newestBackupId}, downloading...`);
          const media = backupMsg.media;
          const buffer = await this.client.downloadMedia(media);
          if (buffer && buffer.length > 0) {
            const parsed = JSON.parse(buffer.toString('utf-8'));
            if (parsed && typeof parsed === 'object') {
              const merge = db.mergeSnapshot(parsed);
              restoredFromBackup = !!merge.restored;
              console.log(`[Telegram Sync] Merged cloud snapshot: ${merge.folders} folders, ${merge.files} files, ${merge.api_keys} api keys`);
            }
          }
        } catch (err) {
          console.warn('[Telegram Sync] Notice while parsing backup snapshot:', err.message);
        }
      }

      // 2. Index any media message that is not tracked yet (unique per message id).
      const existingMsgIds = new Set();
      for (const f of db.data.files || []) {
        const primary = normalizeMessageId(f.telegram_msg_id);
        if (primary !== null) existingMsgIds.add(primary);
        for (const chunkId of normalizeMessageIds(f.telegram_chunk_ids)) existingMsgIds.add(chunkId);
      }

      const newIds = Array.from(scan.messages.keys()).sort((a, b) => a - b);
      for (const msgId of newIds) {
        if (existingMsgIds.has(msgId)) continue;
        const msg = scan.messages.get(msgId);
        if (this._isBackupMessage(msg)) continue;

        const { fileName, mimeType, fileSize } = this._extractFileMetadata(msg);
        if (!fileName) continue;

        const createdAt = new Date(msg.date ? msg.date * 1000 : Date.now()).toISOString();
        await db.insertFile({
          folder_id: null,
          name: fileName,
          original_name: fileName,
          mime_type: mimeType,
          size: fileSize,
          category: detectCategory(mimeType, fileName),
          telegram_msg_id: msgId,
          telegram_chunk_ids: [msgId],
          is_chunked: false,
          total_parts: 1,
          telegram_chat_id: 'me',
          file_hash: null,
          storage_type: 'telegram',
          local_path: null,
          thumbnail_path: null,
          api_key_id: null,
          tags: ['telegram_synced'],
          is_starred: 0,
          is_trash: 0,
          is_shared: 0,
          created_at: createdAt,
        });
        existingMsgIds.add(msgId);
        newlyIndexedCount++;
      }

      // 3. Purge stale metadata ONLY from an authoritative scan.
      //    - complete scan  -> anything missing is really gone
      //    - partial scan   -> verify the candidates by explicit id lookup first
      const candidates = (db.data.files || []).filter((f) => {
        const ids = normalizeMessageIds(f.telegram_chunk_ids);
        const primary = normalizeMessageId(f.telegram_msg_id);
        if (primary !== null && !ids.includes(primary)) ids.push(primary);
        if (ids.length === 0) return false; // non-Telegram metadata is never purged here
        return !ids.some((id) => scan.messages.has(id));
      });

      let purgedIds = [];
      let purgeMode = scan.complete ? 'authoritative-scan' : 'verified';
      if (candidates.length > 0) {
        if (scan.complete) {
          purgedIds = db.purgeMissingTelegramFiles(candidates.map((f) => f.id));
        } else {
          try {
            const candidateIds = new Set();
            for (const file of candidates) {
              for (const id of normalizeMessageIds(file.telegram_chunk_ids)) candidateIds.add(id);
              const primary = normalizeMessageId(file.telegram_msg_id);
              if (primary !== null) candidateIds.add(primary);
            }
            const missing = await this._findMissingMessageIds('me', Array.from(candidateIds));
            purgedIds = db.purgeMissingTelegramFiles(
              candidates
                .filter((file) => {
                  const ids = normalizeMessageIds(file.telegram_chunk_ids);
                  const primary = normalizeMessageId(file.telegram_msg_id);
                  if (primary !== null && !ids.includes(primary)) ids.push(primary);
                  return ids.every((id) => missing.has(id));
                })
                .map((f) => f.id)
            );
          } catch (err) {
            // Verification failed -> keep every record, never guess.
            purgeMode = 'skipped-verification-failed';
            console.warn('[Telegram Sync] Skipped purge (verification failed):', err.message);
          }
        }
      }

      this._lastTelegramSync = Date.now();
      db.saveData();
      console.log(
        `[Telegram Sync] Complete (${purgeMode}). Total folders: ${(db.data.folders || []).length}, ` +
        `Total files: ${(db.data.files || []).length} (${newlyIndexedCount} newly indexed, ${purgedIds.length} purged)`
      );

      return {
        success: true,
        restoredFromBackup,
        newlyIndexedCount,
        purgedCount: purgedIds.length,
        scanComplete: scan.complete,
        scannedCount: scan.scannedCount,
        purgeMode,
        foldersCount: (db.data.folders || []).length,
        filesCount: (db.data.files || []).length,
        folders: db.data.folders || [],
        files: db.data.files || [],
      };
    } catch (err) {
      console.error('[Telegram Sync] Execution error:', err);
      return { success: false, error: err.message };
    }
  }
}

const telegramService = new TelegramService();
module.exports = telegramService;
module.exports.internalHelpers = { isSafeLocalPath, buildSafeLocalPath, safePathPart };
