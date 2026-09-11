# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-09-11

Initial release.

### Added

- Fabric-native `SecureWebView` component (`WKWebView` on iOS, `android.webkit.WebView` on Android). New Architecture only; React Native 0.85+, iOS 15.1+, Android minSdk 24.
- Native, deny-by-default navigation policy: every top-level navigation (including server redirects) is validated against an exact-match `allowedOrigins` allowlist in native code on both platforms.
- Deep-link interception via `allowedSchemes`: allow-listed custom-scheme URLs are never loaded and surface through `onDeepLink`; forbidden schemes (`javascript`, `data`, `file`, `intent`, …) can never be allow-listed.
- Strict URL canonicalization shared across JS (`src/policy.ts`), iOS, and Android: rejects embedded credentials, backslashes, control characters, non-ASCII hosts, empty labels, and trailing-dot FQDNs.
- Origin-restricted Web → RN message bridge: `window.ReactNativeSecureWebView.postMessage(string)`, main frame only, allow-listed origins only, strings only. Implemented with `WKScriptMessageHandler` (iOS) and `WebViewCompat.addWebMessageListener` origin rules (Android; fails closed with `message_bridge_not_supported` on WebViews without `WEB_MESSAGE_LISTENER`).
- `session` prop: `'persistent'` (default) or `'ephemeral'` (iOS non-persistent `WKWebsiteDataStore`; fails closed on Android with `ephemeral_not_supported`).
- Events: `onNavigation`, `onDeepLink`, `onMessage`, `onError`, `onSecurityViolation`.
- Commands via `ref`: `reload()`, `goBack()`, `goForward()`, `stopLoading()`.
- Renderer-crash resilience: a dead web content process no longer takes the app down on Android (`android_render_process_gone`) and is surfaced as a structured error on iOS (`ios_content_process_terminated`); recover with `reload()`.
- Hardening defaults: popups/new windows blocked, mixed content blocked, file/content access disabled, no geolocation, subframes restricted to http(s).
