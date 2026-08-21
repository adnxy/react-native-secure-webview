# Security model

This document describes what `react-native-secure-webview` protects against, how,
and — just as importantly — what it does **not** protect against.

## Goals

The library is built for flows where you know exactly which web origins are
legitimate (your checkout, your identity provider, a 3-D Secure ACS) and want the
WebView to refuse everything else. Concretely:

1. **Top-level navigation control.** Every top-level navigation — link taps,
   `location` changes, HTTP redirects, history navigations — is validated
   *natively* against the `allowedOrigins` allowlist before it loads. Redirects
   never reach JS, which is why enforcement cannot live in the JS layer.
2. **Deep-link interception.** Custom-scheme URLs (OAuth/3DS return URLs like
   `myapp://…`) are never handed to the WebView or the OS. If the scheme is
   allow-listed, the URL is reported via `onDeepLink`; otherwise it is blocked
   with a violation. Sub-frames can never trigger deep links.
3. **Minimal bridge surface.** The only Web→RN channel is
   `window.ReactNativeSecureWebView.postMessage(string)`. Messages are accepted
   only from the **main frame**, only from **allow-listed origins**, and only if
   the payload is a **string**. There is no RN→Web channel and no JS injection.
4. **Fail closed.** Invalid allowlist entries are dropped (never widened),
   unparseable URLs are blocked, and unsupported features produce structured
   errors instead of silently degrading (see Android `ephemeral` below).

## URL policy details

The reference implementation is `src/policy.ts` (extensively unit-tested in
`src/__tests__/policy.test.ts`); iOS (`ios/SecureWebViewPolicy.mm`) and Android
(`android/src/main/java/com/securewebview/UrlPolicy.kt`) are deliberately small
mirrors of the same rules:

- URLs are **parsed**, never substring-matched. `https://checkout.example.com.evil.com`
  and `https://evil.com/checkout.example.com` do not match
  `https://checkout.example.com`.
- Origins are canonicalized to `scheme://host:port` with lowercase scheme/host
  and an explicit effective port (`443`/`80` when omitted). Matching is exact
  string equality. No wildcard or subdomain matching exists.
- URLs containing credentials (`user@host`), whitespace, control characters,
  backslashes, or non-ASCII bytes are rejected as `invalid_url`. IDN hosts must
  be provided in punycode form.
- Hosts with empty labels or trailing dots (`example.com.`) are rejected —
  `https://example.com.` would otherwise be a same-site cookie / allowlist
  bypass ambiguity.
- `allowedSchemes` refuses `http`, `https`, `javascript`, `data`, `blob`,
  `file`, `filesystem`, `about`, `ws`, `wss`, `content`, and `intent` even if
  explicitly listed.

## Platform hardening defaults

Both platforms:

- Mixed content disabled (`MIXED_CONTENT_NEVER_ALLOW` on Android; WebKit default
  on iOS).
- Popups / `window.open` blocked (`setSupportMultipleWindows(false)`;
  `WKUIDelegate` returns `nil` for new-window requests, and navigations without
  a target frame are cancelled).
- No file, content, or filesystem access (`allowFileAccess = false`,
  `allowContentAccess = false`; the `file:` scheme is unnavigable by policy).
- Sub-frames (e.g. 3-D Secure ACS iframes) may load http(s) content, but any
  non-http(s) scheme inside a sub-frame is blocked and can never surface as a
  deep link.
- No geolocation, no media-capture grants, no downloads.

### Sessions

- **iOS**: `session="ephemeral"` uses `WKWebsiteDataStore.nonPersistentDataStore`
  — cookies/storage are scoped to the web view instance and discarded with it.
- **Android**: the cookie store (`CookieManager`) is **process-wide**. There is
  no honest way to give one WebView an isolated session without either lying
  (cookies actually persist) or destructively clearing cookies shared with every
  other WebView in your app. `session="ephemeral"` therefore **fails closed** on
  Android with error code `ephemeral_not_supported`. If your flow requires true
  ephemerality on Android, use Custom Tabs in incognito mode or an OS-level
  auth session instead.

## What this library does NOT protect against

Be explicit with yourself about the threat model. This library does **not**
defend against:

- **Compromised or malicious allow-listed origins.** If
  `https://checkout.example.com` itself serves hostile JavaScript (XSS, supply
  chain compromise), that code runs with full access to the page, the session,
  and the `postMessage` bridge. The allowlist bounds *where* the WebView can
  navigate, not *what* allow-listed pages do.
- **Content inside allow-listed pages.** Sub-resources (scripts, images, XHR,
  iframes) of an allowed page are not filtered beyond platform defaults. An
  allowed page can embed an iframe from any https origin — required for 3DS —
  and that iframe's content is not policy-checked.
- **A compromised device or app process.** Root/jailbreak, hooking frameworks,
  or malicious code inside your own app can read anything the WebView can.
- **TLS interception the OS accepts.** Certificate validation is delegated to
  the platform. No certificate pinning is performed in v0.1.
- **Phishing within allowed origins.** Path/query are intentionally not matched;
  any page on an allowed origin can be navigated to.
- **Message authenticity beyond origin.** `onMessage` guarantees the string came
  from the main frame of an allow-listed origin — nothing more. Treat the
  payload as untrusted input: validate and parse it defensively.
- **Data at rest.** Persistent sessions use the platform's default cookie/storage
  stores with the platform's default protections.

## Reporting a vulnerability

Please open a private security advisory (or contact the maintainers directly)
rather than filing a public issue for anything exploitable.
