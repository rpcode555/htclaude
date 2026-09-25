// ─────────────────────────────────────────────────────────────────────────────
// Centralized API base configuration.
//
// Every client-side request and every generated media/document URL is built from
// this single module so the backend location is defined in exactly one place
// (VITE_API_BASE). Components must never hardcode "/api" again.
//
// Supported VITE_API_BASE values:
//   • relative → "/api"                 (same origin: host rewrite or dev proxy)
//   • absolute → "https://host.tld/api"  (backend served from another origin)
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_API_BASE = '/api';

/** Trim stray whitespace + trailing slashes; never resolve to an empty base. */
function normalizeApiBase(value) {
  const cleaned = String(value ?? '').trim().replace(/\s+/g, '').replace(/\/+$/, '');
  return cleaned || DEFAULT_API_BASE;
}

/** Normalized API base, e.g. "/api" or "https://host.tld/api" (no trailing slash). */
export const API_BASE = normalizeApiBase(import.meta.env.VITE_API_BASE);

/** True when the API lives on another origin than the frontend. */
export const IS_ABSOLUTE_API_BASE = /^https?:\/\//i.test(API_BASE);

/**
 * Join a path onto the configured API base.
 * Guarantees exactly one slash between base and path.
 * Already-absolute paths are returned untouched.
 */
export function apiUrl(path = '') {
  if (!path) return API_BASE;
  if (/^https?:\/\//i.test(path)) return path;
  return `${API_BASE}${path.startsWith('/') ? '' : '/'}${path}`;
}

function safeOrigin(value) {
  try {
    return new URL(value).origin;
  } catch (e) {
    return '';
  }
}

/**
 * Absolute origin that serves the backend. Used for public, copy-paste friendly
 * URLs (developer snippets, direct file links) where a relative "/api" path would
 * be useless outside the dashboard.
 */
export function getServerOrigin() {
  if (IS_ABSOLUTE_API_BASE) {
    return safeOrigin(API_BASE) || (typeof window !== 'undefined' ? window.location.origin : '');
  }
  if (typeof window === 'undefined') return '';
  // Dev: Vite serves the SPA on :3000 and proxies /api to the API server on :5000.
  if (import.meta.env.DEV && window.location.port === '3000') {
    return `${window.location.protocol}//${window.location.hostname}:5000`;
  }
  return window.location.origin;
}

/** Absolute URL of an API endpoint (always includes the API base). */
export function publicApiUrl(path = '') {
  if (/^https?:\/\//i.test(path)) return path;
  if (IS_ABSOLUTE_API_BASE) return apiUrl(path);
  const origin = getServerOrigin();
  return origin ? `${origin}${apiUrl(path)}` : apiUrl(path);
}

/**
 * Turn user supplied "target domain" text into a usable API base.
 * Accepts "example.com", "https://example.com" and "https://example.com/api".
 */
export function toApiBase(domainInput) {
  const raw = String(domainInput || '').trim();
  if (!raw) return '';
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  const withoutTrailingSlash = withProtocol.replace(/\/+$/, '');
  return /\/api$/i.test(withoutTrailingSlash) ? withoutTrailingSlash : `${withoutTrailingSlash}/api`;
}
