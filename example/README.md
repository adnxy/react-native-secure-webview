# SecureWebView example

The app has two modes, switchable from the top bar:

## Showcase — TradingView, origin-locked

`src/TradingViewDemo.tsx` is a realistic fintech "Markets" screen that embeds
TradingView's chart widget inside SecureWebView:

- the web view is **origin-locked** to `https://s.tradingview.com` — the chart
  is fully interactive (symbols, intervals, crosshair, panning), but any
  top-level navigation to another origin is blocked and reported through
  `onSecurityViolation`
- **Simulate compromise** swaps the source to a hostile URL while the
  allowlist stays unchanged: nothing loads (fail closed) and an
  `origin_not_allowed` violation appears in the live security monitor
- every navigation, violation, and error is rendered in the on-screen
  security monitor with a running blocked counter

## Playground — one preset per behavior

`src/App.tsx` has one preset tab per library behavior: allowed browsing,
blocked origin, deep links + Web→RN messaging, ephemeral session, and load
errors. Every callback is shown in the on-screen event log.

The **Demo page** preset loads a local page (`demo-page/`) that exercises deep
links, blocked schemes, and `postMessage`. Serve it before selecting that tab:

```sh
yarn demo-page   # http://localhost:8087 (Android emulator: http://10.0.2.2:8087)
```

## Running the app

From the repository root (see the [contributing guide](../CONTRIBUTING.md) for
environment setup):

```sh
yarn                  # install workspace dependencies
yarn example start    # start Metro
yarn example android  # build and run on Android
yarn example ios      # build and run on iOS
```

For iOS, install CocoaPods dependencies first (on first clone and after
native dependency changes):

```sh
cd example
bundle install
bundle exec pod install --project-directory=ios
```

The example is configured to use the local version of the library: JS changes
are reflected via Fast Refresh, native changes require a rebuild. To confirm
the New Architecture is active, look for `"fabric":true` in the Metro logs.
