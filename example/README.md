# SecureWebView example

The app in `src/App.tsx` has one preset tab per library behavior: allowed
browsing, blocked origin, deep links + Web→RN messaging, ephemeral session, and
load errors. Every callback is shown in the on-screen event log.

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
