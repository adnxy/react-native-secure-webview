/**
 * Fabric component spec for SecureWebView.
 *
 * ── Fabric concept: "component spec" ─────────────────────────────────────────
 * This file is the input to React Native Codegen. At build time Codegen parses
 * the `NativeProps` interface and the `codegenNativeCommands` call and emits:
 *
 *   - C++ `SecureWebViewProps`            (shared, used by the ShadowNode)
 *   - C++ `SecureWebViewEventEmitter`     (shared, typed event dispatch)
 *   - C++ `SecureWebViewComponentDescriptor` + `SecureWebViewShadowNode`
 *   - iOS   `RCTSecureWebViewViewProtocol` + `RCTSecureWebViewHandleCommand`
 *   - Android `SecureWebViewManagerInterface` + `SecureWebViewManagerDelegate`
 *
 * Anything not expressible in this file cannot cross the JS ↔ native boundary.
 * Keep this the *minimal* wire format; the ergonomic public API lives in
 * `SecureWebView.tsx`.
 */
import {
  codegenNativeCommands,
  codegenNativeComponent,
  type CodegenTypes,
  type HostComponent,
  type ViewProps,
} from 'react-native';
import type * as React from 'react';

/**
 * Wire format for navigation state updates.
 * Mirrors the public `NavigationEvent` type in `types.ts`.
 */
type NativeNavigationEvent = Readonly<{
  url: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
}>;

/** Wire format for an intercepted, allow-listed custom-scheme navigation. */
type NativeDeepLinkEvent = Readonly<{
  url: string;
  scheme: string;
}>;

/** Wire format for a `window.ReactNativeSecureWebView.postMessage(...)` call. */
type NativeMessageEvent = Readonly<{
  data: string;
}>;

/**
 * Wire format for load failures.
 * `url` is an empty string when the failing URL is unknown; the public wrapper
 * converts that to `undefined`. (Codegen event payloads cannot be optional on
 * all supported RN versions, so the wire format uses a sentinel.)
 */
type NativeErrorEvent = Readonly<{
  code: string;
  message: string;
  url: string;
}>;

/**
 * Wire format for policy violations.
 * `type` is one of 'origin_not_allowed' | 'scheme_not_allowed' | 'invalid_url';
 * codegen event payloads do not support string-literal unions, so the wire
 * type is `string` and the public wrapper narrows it.
 */
type NativeSecurityViolationEvent = Readonly<{
  type: string;
  url: string;
}>;

/**
 * ── Fabric concept: "Props" ──────────────────────────────────────────────────
 * Each field below becomes a member of the generated C++ `SecureWebViewProps`
 * class. Fabric diffs old/new props on the JS→shadow-tree commit and native
 * receives both in `updateProps:` (iOS) / the ManagerDelegate (Android).
 *
 * `allowedOrigins` entries arrive already *canonicalized* by the JS layer
 * (lowercase scheme/host, explicit port — e.g. "https://checkout.example.com:443"),
 * so native code only needs exact string comparison after canonicalizing the
 * navigation URL the same way. See `src/policy.ts`.
 */
interface NativeProps extends ViewProps {
  /** Remote HTTP(S) URL to load. Flat string keeps the wire format trivial. */
  sourceUri?: string;

  /** Canonical origins ("scheme://host:port") allowed to load in the view. */
  allowedOrigins?: ReadonlyArray<string>;

  /** Lowercase custom schemes that should surface as deep-link events. */
  allowedSchemes?: ReadonlyArray<string>;

  /**
   * Cookie/storage behavior. iOS: WKWebsiteDataStore (persistent vs
   * non-persistent). Android: best-effort — see SECURITY.md for differences.
   */
  session?: CodegenTypes.WithDefault<'persistent' | 'ephemeral', 'persistent'>;

  /**
   * ── Fabric concept: "EventEmitter" ─────────────────────────────────────────
   * Each handler becomes a method on the generated C++
   * `SecureWebViewEventEmitter`. Native calls it (any thread); Fabric delivers
   * the payload to the JS handler prop.
   */
  onNavigation?: CodegenTypes.DirectEventHandler<NativeNavigationEvent>;
  onDeepLink?: CodegenTypes.DirectEventHandler<NativeDeepLinkEvent>;
  onMessage?: CodegenTypes.DirectEventHandler<NativeMessageEvent>;
  onError?: CodegenTypes.DirectEventHandler<NativeErrorEvent>;
  onSecurityViolation?: CodegenTypes.DirectEventHandler<NativeSecurityViolationEvent>;
}

type SecureWebViewComponent = HostComponent<NativeProps>;

/**
 * ── Fabric concept: "Codegen commands" ───────────────────────────────────────
 * Imperative calls dispatched *to* a specific native view instance.
 * Codegen emits `RCTSecureWebViewHandleCommand` (iOS) and command cases on the
 * `SecureWebViewManagerDelegate` (Android). The public wrapper exposes these
 * through the `SecureWebViewRef` returned by `ref`.
 */
interface NativeCommands {
  reload: (viewRef: React.ElementRef<SecureWebViewComponent>) => void;
  goBack: (viewRef: React.ElementRef<SecureWebViewComponent>) => void;
  goForward: (viewRef: React.ElementRef<SecureWebViewComponent>) => void;
  stopLoading: (viewRef: React.ElementRef<SecureWebViewComponent>) => void;
}

export const Commands: NativeCommands = codegenNativeCommands<NativeCommands>({
  supportedCommands: ['reload', 'goBack', 'goForward', 'stopLoading'],
});

/**
 * The registered Fabric component name. Native registers the same name:
 * `SecureWebViewComponentDescriptor` (iOS) / `SecureWebViewManager.NAME`
 * (Android). Fabric's ComponentDescriptor registry keys on this string.
 */
export default codegenNativeComponent<NativeProps>('SecureWebView');
