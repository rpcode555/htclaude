const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getSetting, setSetting, db, detectCategory } = require('../db');
const { TelegramClient, Api } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { CustomFile } = require('telegram/client/uploads');
const { NewMessage } = require('telegram/events');
const QRCode = require('qrcode');

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
    this.qrClient = null;
    this._initPromise = null;
    this._hasLoggedNoSession = false;
    this._cachedUserDetails = null;
    this._lastStatusCheck = 0;
  }

  /**
   * Initializes the Telegram MTProto client for Saved Messages using stored session
   */
  async init(explicitSession = null) {
    try {
      const isManualDisconnected = (await getSetting('manual_disconnect')) === true;
      if (isManualDisconnected) {
        if (this.client) {
          try { await this.client.disconnect(); } catch (e) {}
          this.client = null;
        }
        this.authType = 'demo';
        return;
      }

      this.authType = 'saved_messages';

      const apiId = parseInt(await getSetting('api_id')) || 39504238;
      const apiHash = (await getSetting('api_hash')) || '39268a286a89e430e14728116cfe0680';
      const rawSession = explicitSession || (await getSetting('session_string')) || process.env.TELEGRAM_SESSION_STRING || '';
      const sessionString = String(rawSession).trim();

      if (apiId && apiHash && sessionString) {
        // If client already exists and is authorized, keep it!
        if (this.client) {
          try {
            if (!this.client.connected) {
              await this.client.connect();
            }
            const isAuth = await this.client.checkAuthorization();
            if (isAuth) {
              return;
            }
          } catch (e) {}
          // Session is disconnected or unauthorized; cleanly disconnect old client first
          try { await this.client.disconnect(); } catch (e) {}
          this.client = null;
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
    }
  }

  /**
   * Lazily ensures TelegramClient is connected and authorized
   */
  async ensureClient(explicitSession = null) {
    const isManualDisconnected = (await getSetting('manual_disconnect')) === true;
    if (isManualDisconnected) {
      this.client = null;
      this.authType = 'demo';
      return null;
    }

    // If no session is provided and no session is saved in settings, don't attempt init
    const sessionString = String(explicitSession || (await getSetting('session_string')) || process.env.TELEGRAM_SESSION_STRING || '').trim();
    if (!sessionString) {
      if (this.client) {
        try { await this.client.disconnect(); } catch (e) {}
        this.client = null;
      }
      this.authType = 'demo';
      return null;
    }

    // If client is already connected and authorized, check if session is active
    if (this.client) {
      try {
        if (!this.client.connected) {
          await this.client.connect();
        }
        const isAuth = await this.client.checkAuthorization();
        if (isAuth) {
          return this.client;
        }
        // If authorization failed, clean up old client
        try { await this.client.disconnect(); } catch (e) {}
        this.client = null;
      } catch (e) {
        console.warn('[Telegram] Reconnection check notice:', e.message);
      }
    }

    if (this._initPromise) {
      return this._initPromise;
    }

    this._initPromise = (async () => {
      await this.init(explicitSession);
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

    const sessionString = String(explicitSession || (await getSetting('session_string')) || process.env.TELEGRAM_SESSION_STRING || '').trim();
    const hasSession = !!sessionString;
    const now = Date.now();

    // Fast memory-cached response (TTL: 45 seconds) to avoid hammering Telegram DC with getMe() MTProto requests
    if (this.client && this._cachedUserDetails && (now - this._lastStatusCheck < 45000)) {
      const activeSession = this.client?.session?.save?.() || sessionString;
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

    const phoneNumber = (passedPhoneNumber || this.tempPhoneNumber || (await getSetting('phone_number')) || '').trim();
    const phoneCodeHash = (passedPhoneCodeHash || this.tempPhoneCodeHash || (await getSetting('phone_code_hash')) || '').trim();
    const tempAuthSession = (passedTempSession || (await getSetting('temp_auth_session')) || '').trim();

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

    this.client = client;
    this.authType = 'saved_messages';
    this.tempClient = null;
    this.qrClient = null;
    this.tempPhoneCodeHash = null;
    this.tempPhoneNumber = null;
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

    const targetSession = sessionString.trim();

    // Check if existing client is already connected and authorized with this exact session
    if (this.client) {
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
              target: 'Saved Messages (me)',
            };
            this._lastStatusCheck = Date.now();
            return {
              success: true,
              sessionString: this.client.session?.save?.() || targetSession,
              user: this._cachedUserDetails,
            };
          }
        }
      } catch (e) {}

      // Cleanly disconnect old client before connecting new one
      try {
        await this.client.disconnect();
      } catch (e) {}
      this.client = null;
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
    this.setupSavedMessagesListener();

    const me = await client.getMe();
    return {
      success: true,
      sessionString: targetSession,
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
    this._cachedUserDetails = null;
    this._lastStatusCheck = 0;

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
  async uploadFile({ originalName, buffer, mimeType, size, filePath = null, sessionString = null, onProgress = null }) {
    await this.ensureClient(sessionString);
    if (!this.client) {
      throw new Error('Telegram client is not connected. Connect your Telegram account first.');
    }
    const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const MAX_TELEGRAM_SINGLE_FILE = 1900 * 1024 * 1024; // 1.9 GB safe ceiling for MTProto single document

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
          workers: 3,
          progressCallback: (partProgress) => {
            if (typeof onProgress === 'function') {
              const overallRatio = (partIdx + partProgress) / totalParts;
              onProgress(overallRatio);
            }
          },
        });

        chunkMsgIds.push(result.id);
        console.log(`[Telegram Saved Messages] Uploaded chunk ${partIdx + 1}/${totalParts} (msg_id: ${result.id})`);

        // Clean up temporary chunk file
        try { fs.unlinkSync(tempChunkPath); } catch (e) {}
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
      caption: `📁 Hightech Claude: ${originalName} (${(size / 1024 / 1024).toFixed(2)} MB)`,
      forceDocument: true,
      workers: 3,
      progressCallback: (progress) => {
        if (typeof onProgress === 'function') {
          onProgress(progress);
        }
      },
    });

    if (typeof onProgress === 'function') onProgress(1.0);

    console.log(`[Telegram Saved Messages] Uploaded ${originalName} (${size} bytes, msg_id: ${result.id})`);
    this.scheduleAutoBackup();

    return {
      storageType: 'telegram',
      telegramMsgId: result.id,
      telegramChunkIds: [result.id],
      telegramChatId: 'me',
      isChunked: false,
      totalParts: 1,
      localPath: null,
      size: size,
    };
  }

  /**
   * Download / Stream a file from Telegram Saved Messages with multi-part chunk reconstruction and local cache
   */
  async getFileStream(fileRecord, explicitSession = null) {
    await this.ensureClient(explicitSession);
    const chunkIds = Array.isArray(fileRecord.telegram_chunk_ids) && fileRecord.telegram_chunk_ids.length > 0
      ? fileRecord.telegram_chunk_ids
      : (fileRecord.telegram_msg_id ? [fileRecord.telegram_msg_id] : []);

    if (fileRecord.storage_type === 'telegram' && this.client && chunkIds.length > 0) {
      try {
        // Multi-Part Chunk Reassembly in memory
        if (chunkIds.length > 1) {
          console.log(`[Telegram Saved Messages] Reassembling ${chunkIds.length} chunks in memory for ${fileRecord.name}...`);
          const chunkBuffers = [];

          for (let i = 0; i < chunkIds.length; i++) {
            const chunkMsgId = chunkIds[i];
            const messages = await this.client.getMessages(fileRecord.telegram_chat_id || 'me', {
              ids: [chunkMsgId],
            });
            if (messages && messages.length > 0 && messages[0].media) {
              const chunkBuf = await this.client.downloadMedia(messages[0].media, { workers: 8 });
              if (chunkBuf) {
                chunkBuffers.push(chunkBuf);
              }
            }
          }
          const fullBuffer = Buffer.concat(chunkBuffers);
          return {
            type: 'buffer',
            buffer: fullBuffer,
            size: fullBuffer.length,
            mimeType: fileRecord.mime_type,
            localPath: null,
          };
        } else {
          // Single Document Download directly in memory
          const messages = await this.client.getMessages(fileRecord.telegram_chat_id || 'me', {
            ids: [chunkIds[0]],
          });

          if (messages && messages.length > 0 && messages[0].media) {
            const buffer = await this.client.downloadMedia(messages[0].media, {
              workers: 8,
            });

            if (buffer) {
              return {
                type: 'buffer',
                buffer,
                size: buffer.length,
                mimeType: fileRecord.mime_type,
                localPath: null,
              };
            }
          }
        }
      } catch (err) {
        console.error('[Telegram Saved Messages] MTProto download error:', err.message);
      }
    }

    throw new Error('File could not be downloaded from Telegram Saved Messages.');
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
  async backupDatabaseToSavedMessages(explicitSession = null) {
    await this.ensureClient(explicitSession);
    if (!this.client) {
      return { success: false, error: 'Telegram MTProto client is not connected' };
    }

    try {
      db.saveData();
      const dbPath = path.join(DATA_DIR, 'telecloud_db.json');
      let fileContent;
      if (fs.existsSync(dbPath)) {
        fileContent = fs.readFileSync(dbPath);
      } else {
        fileContent = Buffer.from(JSON.stringify(db.data || {}, null, 2), 'utf-8');
      }

      const backupFileName = `telecloud_db_backup_${Date.now()}.json`;
      const customFile = new CustomFile(
        backupFileName,
        fileContent.length,
        dbPath,
        fileContent
      );

      const result = await this.client.sendFile('me', {
        file: customFile,
        caption: `📦 Hightech Claude DB Backup - ${new Date().toISOString()}`,
        forceDocument: true,
      });

      console.log(`[Telegram Backup] Database snapshot saved to Saved Messages (msg_id: ${result.id})`);
      return {
        success: true,
        messageId: result.id,
        timestamp: new Date().toISOString(),
      };
    } catch (err) {
      console.warn('[Telegram Backup] Backup error:', err.message);
      return { success: false, error: err.message };
    }
  }

  /**
   * Debounced auto-backup after file uploads or changes
   */
  scheduleAutoBackup() {
    if (this._backupTimer) clearTimeout(this._backupTimer);
    this._backupTimer = setTimeout(() => {
      this.backupDatabaseToSavedMessages().catch((e) => {
        console.warn('[Telegram Auto-Backup] Notice:', e.message);
      });
    }, 4000);
  }

  /**
   * Scan and restore database & files from Telegram Saved Messages ('me')
   */
  async syncFromTelegramSavedMessages(explicitSession = null) {
    await this.ensureClient(explicitSession);
    if (!this.client) {
      return { success: false, error: 'Telegram client is not connected. Please connect your Telegram account first.' };
    }

    try {
      console.log('[Telegram Sync] Synchronizing files and folders from Telegram Saved Messages...');
      const messages = await this.client.getMessages('me', { limit: 100 });
      let restoredFromBackup = false;
      let newlyIndexedCount = 0;

      // 1. First look for the newest database backup snapshot
      for (const msg of messages) {
        if (!msg || !msg.media || !msg.media.document) continue;

        let docFileName = '';
        if (Array.isArray(msg.media.document.attributes)) {
          for (const attr of msg.media.document.attributes) {
            if (attr.fileName) {
              docFileName = attr.fileName;
              break;
            }
          }
        }

        const isBackup = docFileName.startsWith('telecloud_db_backup_') ||
                         (msg.message && msg.message.includes('Hightech Claude DB Backup'));

        if (isBackup) {
          try {
            console.log(`[Telegram Sync] Found cloud backup in message ${msg.id} (${docFileName}), downloading...`);
            const buffer = await this.client.downloadMedia(msg.media);
            if (buffer && buffer.length > 0) {
              const parsed = JSON.parse(buffer.toString('utf-8'));
              if (parsed) {
                // Merge folders safely
                if (Array.isArray(parsed.folders) && parsed.folders.length > 0) {
                  const folderMap = new Map((db.data.folders || []).map((f) => [f.id, f]));
                  for (const f of parsed.folders) {
                    const existing = folderMap.get(f.id);
                    if (!existing || new Date(f.updated_at || f.created_at || 0) >= new Date(existing.updated_at || existing.created_at || 0)) {
                      folderMap.set(f.id, { ...existing, ...f });
                    }
                  }
                  db.data.folders = Array.from(folderMap.values());
                }

                // Merge files safely
                if (Array.isArray(parsed.files) && parsed.files.length > 0) {
                  const fileMap = new Map((db.data.files || []).map((f) => [f.id, f]));
                  for (const f of parsed.files) {
                    const existing = fileMap.get(f.id);
                    if (!existing || new Date(f.updated_at || f.created_at || 0) >= new Date(existing.updated_at || existing.created_at || 0)) {
                      fileMap.set(f.id, { ...existing, ...f });
                    }
                  }
                  db.data.files = Array.from(fileMap.values());
                }

                // Merge API keys
                if (Array.isArray(parsed.api_keys) && parsed.api_keys.length > 0) {
                  const keyMap = new Map((db.data.api_keys || []).map((k) => [k.id, k]));
                  for (const k of parsed.api_keys) {
                    if (!keyMap.has(k.id)) keyMap.set(k.id, k);
                  }
                  db.data.api_keys = Array.from(keyMap.values());
                }

                restoredFromBackup = true;
                console.log(`[Telegram Sync] Restored state from cloud snapshot: ${db.data.folders.length} folders, ${db.data.files.length} files`);
                break;
              }
            }
          } catch (err) {
            console.warn('[Telegram Sync] Notice while parsing backup snapshot:', err.message);
          }
        }
      }

      // 2. Scan all media messages in Saved Messages to index any uploaded files
      const realTelegramMsgMap = new Map();
      for (const msg of messages) {
        if (msg && msg.media) {
          realTelegramMsgMap.set(msg.id, msg);
        }
      }

      // Purge any files that do NOT exist in Telegram Saved Messages or are local files
      db.data.files = (db.data.files || []).filter((f) => {
        if (f.storage_type !== 'telegram' || !f.telegram_msg_id) return false;
        if (Array.isArray(f.telegram_chunk_ids) && f.telegram_chunk_ids.length > 0) {
          return f.telegram_chunk_ids.some((cid) => realTelegramMsgMap.has(cid));
        }
        return realTelegramMsgMap.has(f.telegram_msg_id);
      });

      const existingMsgIds = new Set();
      for (const f of db.data.files) {
        if (f.telegram_msg_id) existingMsgIds.add(f.telegram_msg_id);
        if (Array.isArray(f.telegram_chunk_ids)) {
          f.telegram_chunk_ids.forEach((id) => existingMsgIds.add(id));
        }
      }

      for (const [msgId, msg] of realTelegramMsgMap.entries()) {
        if (existingMsgIds.has(msgId)) continue;

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
        } else if (msg.media.photo) {
          fileName = `photo_${msg.id}.jpg`;
          mimeType = 'image/jpeg';
          fileSize = 0;
        }

        if (!fileName) continue;
        if (fileName.startsWith('telecloud_db_backup_')) continue;

        // Extract original name from caption if present
        if (msg.message && msg.message.includes('Hightech Claude')) {
          const match = msg.message.match(/Hightech Claude(?: \[Part \d+\/\d+\])?: (.+?)(?: \([\d.]+ [KMGT]?B\))?$/m);
          if (match && match[1]) {
            fileName = match[1].trim();
          }
        }

        const category = detectCategory(mimeType, fileName);
        const newFileRecord = {
          id: 'file_' + crypto.randomUUID(),
          folder_id: null,
          name: fileName,
          original_name: fileName,
          mime_type: mimeType,
          size: fileSize,
          category,
          telegram_msg_id: msg.id,
          telegram_chunk_ids: [msg.id],
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
          created_at: new Date(msg.date ? msg.date * 1000 : Date.now()).toISOString(),
          updated_at: new Date(msg.date ? msg.date * 1000 : Date.now()).toISOString(),
        };

        db.data.files.push(newFileRecord);
        existingMsgIds.add(msg.id);
        newlyIndexedCount++;
      }

      this._lastTelegramSync = Date.now();
      db.saveData();
      console.log(`[Telegram Sync] Complete. Total folders: ${db.data.folders.length}, Total files: ${db.data.files.length} (${newlyIndexedCount} newly indexed)`);

      return {
        success: true,
        restoredFromBackup,
        newlyIndexedCount,
        foldersCount: db.data.folders.length,
        filesCount: db.data.files.length,
        folders: db.data.folders,
        files: db.data.files,
      };
    } catch (err) {
      console.error('[Telegram Sync] Execution error:', err);
      return { success: false, error: err.message };
    }
  }
}

const telegramService = new TelegramService();
module.exports = telegramService;
