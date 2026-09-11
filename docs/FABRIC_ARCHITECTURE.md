# How `<SecureWebView />` becomes a native web view

This document traces a single `<SecureWebView />` element from React render to a
`WKWebView` / `android.webkit.WebView` on screen, using the actual files in this
repository. It is written as a learning aid for the Fabric renderer (React
Native's New Architecture); every section names the concrete artifact involved.

```
<SecureWebView />                        src/SecureWebView.tsx        (public wrapper)
   └─ <NativeSecureWebView />            src/SecureWebViewNativeComponent.ts (Codegen spec)
        │  build time: Codegen emits C++/ObjC/Kotlin interfaces
        ▼
   React commit → C++ ShadowTree         SecureWebViewComponentDescriptor / ShadowNode
        ▼
   Mounting layer creates the view       ios/SecureWebView.mm  (RCTViewComponentView)
                                         android/.../SecureWebViewManager.kt (ViewManager)
        ▼
   Real web view                          WKWebView / android.webkit.WebView
```

## 1. The public wrapper: `src/SecureWebView.tsx`

The component your app renders is a plain function component. It exists to keep
the *wire format* (what actually crosses the JS↔native boundary) minimal and
dumb, while the public API stays ergonomic:

- It canonicalizes `allowedOrigins` / `allowedSchemes` once in JS using
  `src/policy.ts` (e.g. `"https://Checkout.Example.com"` →
  `"https://checkout.example.com:443"`), so native code only ever does exact
  string comparison. Invalid entries are dropped with a dev warning — fail
  closed.
- It unwraps `NativeSyntheticEvent` payloads (`event.nativeEvent`) into plain
  typed objects, converts the empty-string `url` sentinel on errors to
  `undefined`, and defensively narrows the violation `type` string.
- It exposes commands through `ref` (`useImperativeHandle`), guarding each call
  so a command after unmount warns instead of throwing.

It renders the *native component* with the canonical props:

```tsx
<NativeSecureWebView ref={nativeRef} sourceUri={source.uri} allowedOrigins={...} ... />
```

## 2. The Codegen spec: `src/SecureWebViewNativeComponent.ts`

**Fabric concept: component spec.** This file is not executed for its behavior —
it is *parsed* by React Native Codegen at app build time. The
`codegenConfig` in `package.json` points Codegen at `src/`:

```json
"codegenConfig": {
  "name": "SecureWebViewSpec",
  "type": "all",
  "jsSrcsDir": "src",
  "android": { "javaPackageName": "com.securewebview" },
  "ios": { "components": { "SecureWebView": { "className": "SecureWebView" } } }
}
```

From the `NativeProps` interface and the `codegenNativeCommands` call, Codegen
emits (into the *app's* build, e.g. `example/ios/build/generated/ios` and
`example/android/.../generated`):

| Generated artifact | Language | Role |
| --- | --- | --- |
| `SecureWebViewProps` | C++ | Typed prop struct stored on the ShadowNode |
| `SecureWebViewEventEmitter` | C++ | Typed event dispatch (`onNavigation(...)` etc.) |
| `SecureWebViewComponentDescriptor`, `SecureWebViewShadowNode` | C++ | Registry entry + layout node for the component name `"SecureWebView"` |
| `RCTSecureWebViewViewProtocol`, `RCTSecureWebViewHandleCommand` | Obj-C | iOS view contract + command decoding |
| `SecureWebViewManagerInterface`, `SecureWebViewManagerDelegate` | Java | Android manager contract + prop/command routing |

Two wire-format quirks worth noticing in the spec:

- Event payload fields cannot be optional, so `onError`'s `url` uses an empty
  string as a sentinel (the wrapper converts it to `undefined`).
- Event payloads cannot carry string-literal unions, so
  `onSecurityViolation.type` travels as `string` and is narrowed in JS.

`codegenNativeComponent('SecureWebView')` returns a `HostComponent` — a
first-class Fabric element type keyed by the string `"SecureWebView"`. That
string is the contract every layer below keys on.

## 3. Render → ShadowTree → mounting

**Fabric concept: C++ core.** When React commits
`<NativeSecureWebView sourceUri=... />`, Fabric:

1. Looks up the **ComponentDescriptor** registered for `"SecureWebView"` (the
   generated `SecureWebViewComponentDescriptor`). On iOS the app-side generated
   `RCTThirdPartyComponentsProvider` maps `"SecureWebView"` →
   `NSClassFromString(@"SecureWebView")`; on Android the descriptor is
   registered through the generated `SecureWebViewSpec` C++ library and the
   ViewManager name (`SecureWebViewManager.NAME`).
2. Creates/updates a **ShadowNode** carrying a `SecureWebViewProps` instance —
   the C++ struct built from the JS props. Prop diffing happens here, off the
   UI thread.
3. Computes layout (Yoga) for the node.
4. Produces a **mutation list** (create/insert/update/delete) that the mounting
   layer applies on the UI thread.

Nothing in this repo implements step 1–4; that is the point. The generated
descriptor + props + event emitter *are* the component as far as the C++ core is
concerned. The platform view is only involved at mount time.

## 4. iOS mounting: `ios/SecureWebView.mm`

**Fabric concept: ComponentView.** The class registered for the component is a
`RCTViewComponentView` subclass:

- `+componentDescriptorProvider` returns the generated
  `SecureWebViewComponentDescriptor`, closing the loop with the C++ registry.
- `-updateProps:oldProps:` receives the old and new `SecureWebViewProps`
  (`std::shared_ptr<const SecureWebViewProps>`). The implementation converts
  the prop vectors to `NSSet`s, decides whether the `WKWebView` must be
  (re)created — first mount, or a `session` change, since a
  `WKWebsiteDataStore` cannot be swapped on a live web view — and starts a load
  when `sourceUri` changed. Props are applied atomically per transaction.
- The actual `WKWebView` is installed via `self.contentView`, so Fabric's
  layout mutations size it automatically.
- Events go out through the generated emitter, e.g.
  `std::static_pointer_cast<const SecureWebViewEventEmitter>(_eventEmitter)
  ->onNavigation({...})`.
- Commands arrive as `-handleCommand:args:`, decoded by the generated
  `RCTSecureWebViewHandleCommand`, which calls the
  `RCTSecureWebViewViewProtocol` methods (`reload`, `goBack`, …) implemented by
  the view.
- `-prepareForRecycle` fully destroys the web view. Fabric recycles component
  views by default; a WebView carries session/history state that must never
  leak between component instances, so the view resets to a blank state.

Security-relevant iOS details live in the same file: the
`WKNavigationDelegate` policy hook (`decidePolicyForNavigationAction`) calls
`ios/SecureWebViewPolicy.mm` — the native mirror of `src/policy.ts` — for every
top-level navigation *including redirects*, which never reach JS. The
`SWVWeakScriptMessageHandler` proxy breaks the
view → webView → userContentController → handler retain cycle.

## 5. Android mounting: `android/src/main/java/com/securewebview/`

**Fabric concept: ViewManager + generated delegate.** Android keeps the
ViewManager shape from the old architecture, but Fabric drives it through
generated code:

- `SecureWebViewPackage.kt` registers `SecureWebViewManager` (a
  `BaseReactPackage`).
- `SecureWebViewManager.kt` extends `SimpleViewManager<SecureWebView>` and
  implements the generated `SecureWebViewManagerInterface`. Its
  `SecureWebViewManagerDelegate` (also generated) receives prop updates and
  command dispatches from C++ and routes them into the interface methods —
  `setSourceUri`, `setAllowedOrigins`, `reload`, etc.
- Individual `@ReactProp` setters only *stage* values on the view;
  `onAfterUpdateTransaction` calls `view.commitProps()`, giving the same
  atomic-commit semantics as iOS's `updateProps:`.
- `prepareToRecycleView` returns `null` to opt out of view recycling, matching
  the iOS `prepareForRecycle` rationale.
- `SecureWebView.kt` owns the real `android.webkit.WebView`: hardened settings
  (mixed content never allowed, no file/content access, no multiple windows),
  a `WebViewClient` whose `shouldOverrideUrlLoading` +
  `shouldInterceptRequest` (safety net for redirects and history navigations)
  enforce `UrlPolicy.kt`, and an origin-restricted message bridge exposed as
  `window.ReactNativeSecureWebView` via `WebViewCompat.addWebMessageListener`
  (injected only into allow-listed main-frame origins; see SECURITY.md).
- Events are emitted through `UIManagerHelper.getEventDispatcherForReactTag`
  with the Fabric `surfaceId` (`SecureWebViewEvent.kt`), using the `"topX"` →
  `onX` naming convention that the generated event emitter expects.
- Because a `WebView` measures itself but Fabric owns layout, the view relays
  Yoga's size in `requestLayout` via the standard measure-and-layout runnable.

## 6. Events: native → JS

**Fabric concept: typed event emitters.** When the page finishes loading, iOS
calls `eventEmitter->onNavigation({url, loading, canGoBack, canGoForward})`.
The generated C++ emitter serializes the payload, Fabric routes it to the
`onNavigation` prop of the specific React element instance (direct event — no
bubbling), and the wrapper in `SecureWebView.tsx` unwraps `nativeEvent` and
calls your handler with a plain object. The same path carries `onDeepLink`,
`onMessage`, `onError`, and `onSecurityViolation`.

## 7. Commands: JS → native

**Fabric concept: view commands.** `ref.current.reload()` in your app calls the
wrapper's guarded handle, which calls `Commands.reload(view)` from the spec
file. Fabric resolves the native view for that React tag and invokes
`handleCommand("reload")` (iOS) / the delegate's `receiveCommand` (Android)
synchronously with respect to the UI thread queue. Commands are
fire-and-forget: they return nothing and are dropped (with a dev warning, in
this library) if the view is gone.

## 8. Teardown

On unmount, Fabric's mutation list deletes the view:

- iOS: `prepareForRecycle` stops loading, removes the script message handler
  and user scripts, nils delegates, and releases the `WKWebView`.
- Android: `onDropViewInstance` → `SecureWebView.onDropped()` stops loading,
  removes the JS interface, detaches, and calls `WebView.destroy()`.

The JS wrapper independently guards its `ref` handle, so late command calls or
stale event callbacks never crash.

## Where to look next

| Question | File |
| --- | --- |
| What exactly crosses the JS↔native boundary? | `src/SecureWebViewNativeComponent.ts` |
| How are URLs judged? | `src/policy.ts` (+ tests in `src/__tests__/policy.test.ts`) |
| iOS behavior | `ios/SecureWebView.mm`, `ios/SecureWebViewPolicy.mm` |
| Android behavior | `android/src/main/java/com/securewebview/SecureWebView.kt`, `UrlPolicy.kt` |
| Threat model | `../SECURITY.md` |
