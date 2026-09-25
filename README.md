# Telecloud Storage

A React/Vite frontend and Express backend that stores file metadata locally or in an authenticated cloud metadata service while transferring file bytes through a Telegram Saved Messages account.

## Requirements

- Node.js `^20.19.0` or `>=22.12.0`
- npm 10 or newer
- A Telegram application ID/hash and a Telegram account for production storage
- Firebase Authentication with an explicitly configured admin email
- Optional authenticated Supabase or Firestore persistence for serverless metadata

## Local setup

```powershell
npm install
Copy-Item .env.example .env
npm run dev
```

- Frontend: `http://localhost:3000`
- Backend: `http://localhost:5000`
- Vite proxies `/api` to the backend during local development.

Fill in at least `ADMIN_EMAIL`, the Firebase client configuration, `TELEGRAM_API_ID`, and `TELEGRAM_API_HASH`. Add durable cloud-persistence credentials before relying on a serverless deployment. Never use the placeholder admin address in production.

## Commands

```powershell
npm run dev          # frontend and backend with reload
npm start            # backend only
npm run client       # frontend only
npm run build        # production frontend build
npm test             # Node regression tests
npm run check:syntax # backend/API syntax checks
npm run check        # syntax checks and production build
```

## Configuration

See `.env.example` for all supported variables. Important groups are:

- **Admin auth:** `ADMIN_EMAIL`, `FIREBASE_PROJECT_ID`
- **Telegram server secrets:** `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`, `TELEGRAM_SESSION_STRING`
- **Client-safe Firebase values:** `VITE_FIREBASE_*`
- **API routing:** `VITE_API_BASE`, `VITE_API_TARGET`
- **Cloud metadata:** authenticated server-side Supabase or Firebase service-account credentials

Client-visible variables may be embedded in the browser bundle. Telegram sessions, service-account private keys, service-role keys, and developer API keys are server-only and must never use a `VITE_` prefix.

## Storage behavior

Normal uploads require an active Telegram client. The API fails clearly when Telegram is unavailable instead of reporting a successful upload to ephemeral local disk. Multi-part files retain all Telegram message IDs so downloads and permanent deletion operate on every chunk.

Metadata mutations are written atomically to the runtime JSON database and, when configured, synchronized to the authenticated cloud service. A sanitized seed is safe to track in Git; runtime data and secrets are ignored.

## Deployment

`vercel.json` builds `client/dist` and routes `/api/*` to the Express serverless entry point. Configure all server and client environment variables in the deployment platform. Do not bundle `.env` files or runtime databases with the deployment.

## Security

Read [SECURITY.md](SECURITY.md) before deployment. If a Telegram session, API key, cloud credential, or runtime database has ever been committed, rotate it and coordinate a Git-history cleanup; deleting it only from the latest commit is not sufficient.
