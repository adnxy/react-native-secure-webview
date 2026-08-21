# react-native-secure-webview

A Fabric-native WebView for controlled web flows: authentication, checkout, OAuth redirects, and 3-D Secure challenges.

Instead of a general purpose browser view, this library gives you a WebView that denies by default. Every top-level navigation is validated natively against an explicit origin allowlist, custom scheme redirects are intercepted and surfaced as events instead of being loaded, and the web-to-native bridge is a single string-only method.

## Highlights

- **New Architecture only.** A real Fabric component (`WKWebView` on iOS, `android.webkit.WebView` on Android), not a wrapper around `react-native-webview`.
- **Exact origin matching.** Scheme, host, and effective port. No wildcards, no substring matching, no "starts with".
- **Native enforcement.** Server redirects never reach JS, so the policy runs in native code on both platforms.
- **Fail closed.** Invalid configuration entries are dropped, unknown URLs are blocked, and unsupported features raise errors instead of silently degrading.

See [SECURITY.md](./SECURITY.md) for the threat model and what this library does not protect against, and [docs/FABRIC_ARCHITECTURE.md](./docs/FABRIC_ARCHITECTURE.md) for a code-level tour of the component.

## Requirements

- React Native 0.85+ with the New Architecture enabled (Fabric). There is no Paper fallback.
- iOS 15.1+, Android minSdk 24.

## Installation

```sh
npm install react-native-secure-webview
cd ios && pod install
```

No manual native setup is required. The Fabric component is registered through Codegen on both platforms.

## Usage

```tsx
import { useRef } from 'react';
import {
  SecureWebView,
  type SecureWebViewRef,
} from 'react-native-secure-webview';

function Checkout() {
  const webView = useRef<SecureWebViewRef>(null);

  return (
    <SecureWebView
      ref={webView}
      style={{ flex: 1 }}
      source={{ uri: 'https://checkout.example.com/pay' }}
      allowedOrigins={[
        'https://checkout.example.com',
        'https://3ds.acs-provider.com',
      ]}
      allowedSchemes={['myapp']}
      onDeepLink={({ url }) => finishCheckout(url)}
      onMessage={({ data }) => console.log('page said:', data)}
      onSecurityViolation={({ type, url }) => report(type, url)}
      onError={({ code, message }) => showRetry(code, message)}
    />
  );
}
```

## API

### Props

| Prop | Type | Description |
| --- | --- | --- |
| `source` | `{ uri: string }` | The http(s) URL to load. Its origin must be covered by `allowedOrigins`, or nothing loads. |
| `allowedOrigins` | `string[]` | Exact origins allowed for top-level navigation, e.g. `"https://checkout.example.com"` or `"https://api.example.com:8443"`. No paths, no wildcards. Invalid entries are dropped with a dev warning. |
| `allowedSchemes` | `string[]?` | Custom schemes (e.g. `"myapp"`) that are intercepted and emitted as `onDeepLink` events. `http`, `https`, `javascript`, `data`, `file`, `intent`, and other browser-internal schemes are never allowed here. |
| `session` | `'persistent' \| 'ephemeral'` | Cookie and storage behavior. Default `'persistent'`. See [sessions](#sessions). |
| `onNavigation` | `(e) => void` | Navigation state changed: `{ url, loading, canGoBack, canGoForward }`. |
| `onDeepLink` | `(e) => void` | An allow-listed custom scheme navigation was intercepted: `{ url, scheme }`. The URL is not loaded. |
| `onMessage` | `(e) => void` | The page called `window.ReactNativeSecureWebView.postMessage(string)`: `{ data }`. Strings only, main frame only, allow-listed origins only. |
| `onError` | `(e) => void` | A load failed: `{ code, message, url? }`. Codes are platform-prefixed (`ios_-1009`, `android_-2`) or library-level (`ephemeral_not_supported`). |
| `onSecurityViolation` | `(e) => void` | A navigation was blocked: `{ type, url }` where `type` is `origin_not_allowed`, `scheme_not_allowed`, or `invalid_url`. |

### Commands (via `ref`)

`reload()`, `goBack()`, `goForward()`, `stopLoading()`. Calls after unmount are no-ops with a dev warning.

### Navigation policy

Every top-level navigation, including server redirects, is decided natively:

| Navigation | Result |
| --- | --- |
| http(s) URL with allow-listed origin | Loaded |
| http(s) URL with any other origin | Blocked, `onSecurityViolation` (`origin_not_allowed`) |
| Allow-listed custom scheme | Blocked, `onDeepLink` |
| Unknown scheme | Blocked, `onSecurityViolation` (`scheme_not_allowed`) |
| Unparseable or hostile URL | Blocked, `onSecurityViolation` (`invalid_url`) |

Origins match exactly after canonicalization (lowercase scheme and host, explicit effective port). `https://checkout.example.com` matches `https://checkout.example.com:443/anything` but not `https://sub.checkout.example.com`, `http://checkout.example.com`, or `https://checkout.example.com:8443`.

### Sessions

- **iOS:** `'persistent'` uses the default `WKWebsiteDataStore`. `'ephemeral'` uses a non-persistent store, so cookies and storage exist only for the lifetime of the web view.
- **Android:** cookies live in the process-wide `CookieManager` and cannot be isolated per WebView. Rather than fake isolation, `session="ephemeral"` fails closed on Android: nothing loads and `onError` fires with `ephemeral_not_supported`.

### Web to RN messaging

Pages loaded from an allow-listed origin can call:

```js
window.ReactNativeSecureWebView.postMessage('a string');
```

That is the entire bridge. No RN-to-web messaging, no JS injection, no typed RPC.

## Example app

`example/` contains a demo app with one preset per behavior (allowed browsing, blocked origin, deep links and messaging, ephemeral session, load errors). The deep-link and messaging preset uses a local demo page:

```sh
cd example
yarn demo-page   # serves demo-page/ on http://localhost:8087
yarn ios         # or: yarn android
```

## Out of scope

JS injection, local files and HTML strings, downloads, popups and `window.open`, media, camera, and geolocation permissions, RN-to-web messaging, cookie APIs, and OAuth or payment SDK integration. Feature requests are welcome as issues, but each is weighed against the security posture above.

## Contributing

See the [contributing guide](CONTRIBUTING.md) and [code of conduct](CODE_OF_CONDUCT.md). To report a vulnerability, see [SECURITY.md](./SECURITY.md#reporting-a-vulnerability).

## License

MIT
