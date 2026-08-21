import type { Ref } from 'react';
import type { ViewProps } from 'react-native';

/** Cookie/storage behavior. See SECURITY.md for exact per-platform semantics. */
export type SessionType = 'persistent' | 'ephemeral';

/** Reason a navigation was blocked. */
export type SecurityViolationType =
  'origin_not_allowed' | 'scheme_not_allowed' | 'invalid_url';

/** Emitted whenever top-level navigation state changes. */
export interface NavigationEvent {
  url: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
}

/** Emitted when navigation to an allow-listed custom scheme was intercepted. */
export interface DeepLinkEvent {
  /** The full URL, e.g. "myapp://payment/complete?id=1". */
  url: string;
  /** The lowercase scheme, e.g. "myapp". */
  scheme: string;
}

/** Emitted when the page calls `window.ReactNativeSecureWebView.postMessage(string)`. */
export interface WebMessageEvent {
  data: string;
}

/** Emitted when a load fails or the component refuses to operate. */
export interface SecureWebViewErrorEvent {
  /**
   * Stable, machine-readable code. Platform load failures use
   * "ios_<NSError code>" / "android_<WebViewClient error code>". Library-level
   * codes: "ephemeral_not_supported" (Android; see SECURITY.md).
   */
  code: string;
  message: string;
  /** The URL that failed, when known. */
  url?: string;
}

/** Emitted when a navigation was blocked by the origin/scheme policy. */
export interface SecurityViolationEvent {
  type: SecurityViolationType;
  /** The URL that was blocked (possibly malformed). */
  url: string;
}

/** Imperative API, available through `ref`. */
export interface SecureWebViewRef {
  reload: () => void;
  goBack: () => void;
  goForward: () => void;
  stopLoading: () => void;
}

export interface SecureWebViewSource {
  /** Remote http(s) URL. Its origin must be included in `allowedOrigins`. */
  uri: string;
}

export interface SecureWebViewProps extends ViewProps {
  ref?: Ref<SecureWebViewRef>;

  source: SecureWebViewSource;

  /**
   * Origins allowed to load, e.g. `['https://checkout.example.com']`.
   * Matching is exact on (scheme, host, effective port) after
   * canonicalization — no subdomain or wildcard matching. Invalid entries are
   * dropped (fail closed) and reported in development.
   */
  allowedOrigins: ReadonlyArray<string>;

  /**
   * Custom schemes (e.g. `['myapp']`) that are intercepted — never loaded —
   * and surfaced through `onDeepLink`. `http`, `https`, `javascript`, `data`,
   * `file`, `blob` and other browser-internal schemes are never allowed here.
   */
  allowedSchemes?: ReadonlyArray<string>;

  /**
   * 'persistent' (default): shared, durable cookies/storage.
   * 'ephemeral': isolated, in-memory storage. iOS only; on Android the view
   * fails closed with an `ephemeral_not_supported` error. See SECURITY.md.
   */
  session?: SessionType;

  onNavigation?: (event: NavigationEvent) => void;
  onDeepLink?: (event: DeepLinkEvent) => void;
  onMessage?: (event: WebMessageEvent) => void;
  onError?: (event: SecureWebViewErrorEvent) => void;
  onSecurityViolation?: (event: SecurityViolationEvent) => void;
}
