/**
 * URL policy for SecureWebView.
 *
 * This module is the single specification of the library's navigation policy:
 *
 *   allowed http(s) origin  → load
 *   disallowed http(s)      → block + 'origin_not_allowed'
 *   allow-listed scheme     → block navigation + deep-link event
 *   unknown scheme          → block + 'scheme_not_allowed'
 *   unparseable URL         → block + 'invalid_url'
 *
 * Everything defaults to deny. Parsing is intentionally strict: anything
 * ambiguous (embedded credentials, backslashes, control characters, non-ASCII
 * hosts, trailing-dot FQDNs) is rejected rather than interpreted, because
 * lenient parsing is exactly where allowlist bypasses live.
 *
 * The JS side canonicalizes the developer-provided allowlist once (see
 * `SecureWebView.tsx`); native code canonicalizes each navigation URL with the
 * same rules (ios/SecureWebViewPolicy.mm, android UrlPolicy.kt) and performs
 * an exact string comparison. Keep the three implementations in sync — this
 * file is the reference and carries the exhaustive test suite.
 */
import type { SecurityViolationType } from './types';

export type PolicyDecision =
  | { action: 'load' }
  | { action: 'deep_link'; scheme: string }
  | { action: 'block'; violation: SecurityViolationType };

/**
 * Schemes that may never appear in `allowedSchemes`. They are either handled
 * by the http(s) origin policy or would reintroduce the exact capabilities
 * this component exists to remove (script execution, local content, opaque
 * platform intents).
 */
const FORBIDDEN_CUSTOM_SCHEMES: ReadonlySet<string> = new Set([
  'http',
  'https',
  'javascript',
  'data',
  'blob',
  'file',
  'filesystem',
  'about',
  'ws',
  'wss',
  'content',
  'intent',
]);

const SCHEME_RE = /^([a-zA-Z][a-zA-Z0-9+.-]*):/;
const HOST_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)*$/;
const IPV6_HOST_RE = /^\[[0-9a-f:.]+\]$/;
const PORT_RE = /^[0-9]{1,5}$/;
const CUSTOM_SCHEME_RE = /^[a-z][a-z0-9+.-]*$/;

/** True if the string contains characters we refuse to interpret in any URL. */
function hasForbiddenChars(url: string): boolean {
  // C0 controls, space, DEL, backslash (browsers treat '\' as '/', attackers
  // use it to confuse authority parsing), and any non-ASCII (homograph risk;
  // punycode-encode IDNs before configuring them).
  for (let i = 0; i < url.length; i++) {
    const c = url.charCodeAt(i);
    if (c <= 0x20 || c === 0x7f || c > 0x7e || c === 0x5c /* \ */) {
      return true;
    }
  }
  return url.length === 0;
}

/** Extract the lowercase scheme, or null if the URL has no valid scheme. */
export function parseScheme(url: string): string | null {
  if (hasForbiddenChars(url)) {
    return null;
  }
  const match = SCHEME_RE.exec(url);
  return match?.[1] ? match[1].toLowerCase() : null;
}

export interface ParsedHttpOrigin {
  scheme: 'http' | 'https';
  host: string;
  /** Effective port: explicit port, or 80/443 by scheme. */
  port: number;
  /** Substring after the authority ('' | '/...' | '?...' | '#...'). */
  rest: string;
}

/**
 * Parse the origin of an http(s) URL. Returns null — meaning "block" — for
 * anything that is not unambiguously `scheme://host[:port]`.
 */
export function parseHttpOrigin(url: string): ParsedHttpOrigin | null {
  const scheme = parseScheme(url);
  if (scheme !== 'http' && scheme !== 'https') {
    return null;
  }

  const afterScheme = url.slice(scheme.length + 1);
  if (!afterScheme.startsWith('//')) {
    return null;
  }

  let authority = afterScheme.slice(2);
  let rest = '';
  for (let i = 0; i < authority.length; i++) {
    const ch = authority[i];
    if (ch === '/' || ch === '?' || ch === '#') {
      rest = authority.slice(i);
      authority = authority.slice(0, i);
      break;
    }
  }

  // Reject embedded credentials outright ("https://good.com@evil.com").
  if (authority.includes('@')) {
    return null;
  }

  let host: string;
  let portStr: string | undefined;

  if (authority.startsWith('[')) {
    // IPv6 literal. Matched textually; we do not normalize equivalent forms.
    const close = authority.indexOf(']');
    if (close === -1) {
      return null;
    }
    host = authority.slice(0, close + 1).toLowerCase();
    const afterHost = authority.slice(close + 1);
    if (afterHost.startsWith(':')) {
      portStr = afterHost.slice(1);
    } else if (afterHost !== '') {
      return null;
    }
    if (!IPV6_HOST_RE.test(host)) {
      return null;
    }
  } else {
    const colon = authority.indexOf(':');
    if (colon !== -1) {
      // A second colon in a non-bracketed authority is malformed.
      if (authority.indexOf(':', colon + 1) !== -1) {
        return null;
      }
      host = authority.slice(0, colon).toLowerCase();
      portStr = authority.slice(colon + 1);
    } else {
      host = authority.toLowerCase();
    }
    // Strict host: ASCII letters/digits/hyphen labels joined by single dots.
    // Rejects empty hosts, empty labels ("a..b"), leading/trailing dots
    // ("example.com." is a distinct FQDN often used to bypass allowlists).
    if (!HOST_RE.test(host)) {
      return null;
    }
  }

  let port: number;
  if (portStr !== undefined) {
    if (!PORT_RE.test(portStr)) {
      return null;
    }
    port = parseInt(portStr, 10);
    if (port < 1 || port > 65535) {
      return null;
    }
  } else {
    port = scheme === 'https' ? 443 : 80;
  }

  return { scheme, host, port, rest };
}

/** "https://checkout.example.com" → "https://checkout.example.com:443". */
export function canonicalOrigin(parsed: ParsedHttpOrigin): string {
  return `${parsed.scheme}://${parsed.host}:${parsed.port}`;
}

/**
 * Canonicalize one developer-provided allowlist entry.
 * Entries must be bare origins — a path (other than "/"), query, or fragment
 * indicates a misunderstanding of the matching model, so the entry is
 * rejected rather than silently truncated.
 */
export function canonicalizeAllowedOrigin(entry: string): string | null {
  const parsed = parseHttpOrigin(entry);
  if (parsed === null) {
    return null;
  }
  if (parsed.rest !== '' && parsed.rest !== '/') {
    return null;
  }
  return canonicalOrigin(parsed);
}

export interface CanonicalizedList {
  accepted: string[];
  rejected: string[];
}

/** Canonicalize the full allowlist, deduplicating and dropping invalid entries. */
export function canonicalizeAllowedOrigins(
  entries: ReadonlyArray<string>
): CanonicalizedList {
  const accepted: string[] = [];
  const rejected: string[] = [];
  for (const entry of entries) {
    const canonical = canonicalizeAllowedOrigin(entry);
    if (canonical === null) {
      rejected.push(entry);
    } else if (!accepted.includes(canonical)) {
      accepted.push(canonical);
    }
  }
  return { accepted, rejected };
}

/** Lowercase, validate, and deduplicate the custom-scheme allowlist. */
export function sanitizeAllowedSchemes(
  schemes: ReadonlyArray<string>
): CanonicalizedList {
  const accepted: string[] = [];
  const rejected: string[] = [];
  for (const scheme of schemes) {
    const lower = scheme.toLowerCase();
    if (!CUSTOM_SCHEME_RE.test(lower) || FORBIDDEN_CUSTOM_SCHEMES.has(lower)) {
      rejected.push(scheme);
    } else if (!accepted.includes(lower)) {
      accepted.push(lower);
    }
  }
  return { accepted, rejected };
}

/**
 * The navigation decision. `allowedOrigins` must already be canonical (the
 * output of `canonicalizeAllowedOrigins`) and `allowedSchemes` sanitized.
 *
 * Mirrored natively in ios/SecureWebViewPolicy.mm and android UrlPolicy.kt.
 */
export function decideNavigation(
  url: string,
  allowedOrigins: ReadonlyArray<string>,
  allowedSchemes: ReadonlyArray<string>
): PolicyDecision {
  // The initial blank document is inert and required for view setup/teardown.
  if (url === 'about:blank') {
    return { action: 'load' };
  }

  const scheme = parseScheme(url);
  if (scheme === null) {
    return { action: 'block', violation: 'invalid_url' };
  }

  if (scheme === 'http' || scheme === 'https') {
    const parsed = parseHttpOrigin(url);
    if (parsed === null) {
      return { action: 'block', violation: 'invalid_url' };
    }
    return allowedOrigins.includes(canonicalOrigin(parsed))
      ? { action: 'load' }
      : { action: 'block', violation: 'origin_not_allowed' };
  }

  if (
    !FORBIDDEN_CUSTOM_SCHEMES.has(scheme) &&
    allowedSchemes.includes(scheme)
  ) {
    return { action: 'deep_link', scheme };
  }

  return { action: 'block', violation: 'scheme_not_allowed' };
}
