/**
 * SecureWebView example app.
 *
 * A single screen with preset scenarios, one per library behavior:
 * allowed/blocked navigation, deep-link interception, blocked schemes,
 * Web→RN messaging, imperative commands, session modes, and structured
 * errors. Every callback is appended to the on-screen event log.
 */
import { useRef, useState } from 'react';
import {
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  SecureWebView,
  type SecureWebViewProps,
  type SecureWebViewRef,
} from 'react-native-secure-webview';

// The local demo page (deep links, blocked schemes, Web→RN messages).
// Start it with `yarn demo-page` from the example/ directory.
const DEMO_HOST = Platform.select({
  android: 'http://10.0.2.2:8087', // emulator loopback to the host machine
  default: 'http://localhost:8087',
});

type Preset = {
  key: string;
  title: string;
  description: string;
  props: Pick<
    SecureWebViewProps,
    'source' | 'allowedOrigins' | 'allowedSchemes' | 'session'
  >;
};

const PRESETS: Preset[] = [
  {
    key: 'allowed',
    title: 'Allowed',
    description:
      'Same-origin browsing works; tapping an external link is blocked ' +
      'with an origin_not_allowed violation.',
    props: {
      source: { uri: 'https://reactnative.dev' },
      allowedOrigins: ['https://reactnative.dev'],
    },
  },
  {
    key: 'blocked',
    title: 'Blocked origin',
    description:
      'The source origin is not allow-listed, so nothing loads and a ' +
      'violation is reported (fail closed).',
    props: {
      source: { uri: 'https://example.com' },
      allowedOrigins: ['https://reactnative.dev'],
    },
  },
  {
    key: 'demo',
    title: 'Demo page',
    description:
      `Local page at ${DEMO_HOST} (run \`yarn demo-page\`): deep links, ` +
      'blocked schemes, and Web→RN messages.',
    props: {
      source: { uri: `${DEMO_HOST}/` },
      allowedOrigins: [DEMO_HOST],
      allowedSchemes: ['myapp'],
    },
  },
  {
    key: 'ephemeral',
    title: 'Ephemeral',
    description:
      'iOS: non-persistent cookie/storage session. Android cannot isolate ' +
      'sessions, so it fails closed with an ephemeral_not_supported error.',
    props: {
      source: { uri: 'https://reactnative.dev' },
      allowedOrigins: ['https://reactnative.dev'],
      session: 'ephemeral',
    },
  },
  {
    key: 'error',
    title: 'Load error',
    description:
      'An allow-listed but unresolvable host produces a structured, ' +
      'platform-prefixed error code.',
    props: {
      source: { uri: 'https://does-not-exist.invalid' },
      allowedOrigins: ['https://does-not-exist.invalid'],
    },
  },
];

type LogEntry = { id: number; kind: string; text: string };

let nextLogId = 1;

export default function App() {
  const webViewRef = useRef<SecureWebViewRef>(null);
  const [preset, setPreset] = useState<Preset>(PRESETS[0]!);
  const [log, setLog] = useState<LogEntry[]>([]);

  const append = (kind: string, text: string) => {
    setLog((entries) =>
      [{ id: nextLogId++, kind, text }, ...entries].slice(0, 40)
    );
  };

  const selectPreset = (next: Preset) => {
    setPreset(next);
    setLog([]);
    append('info', next.description);
  };

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.tabs}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {PRESETS.map((p) => (
            <Pressable
              key={p.key}
              onPress={() => selectPreset(p)}
              style={[styles.tab, p.key === preset.key && styles.tabActive]}
            >
              <Text
                style={[
                  styles.tabText,
                  p.key === preset.key && styles.tabTextActive,
                ]}
              >
                {p.title}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      <SecureWebView
        // Remount per preset so each scenario starts from a fresh web view.
        key={preset.key}
        ref={webViewRef}
        style={styles.webView}
        {...preset.props}
        onNavigation={(e) =>
          append(
            'nav',
            `${e.loading ? 'loading' : 'done'} ${e.url} ` +
              `(back:${e.canGoBack ? 'y' : 'n'} fwd:${e.canGoForward ? 'y' : 'n'})`
          )
        }
        onDeepLink={(e) => append('deeplink', `${e.scheme} → ${e.url}`)}
        onMessage={(e) => append('message', e.data)}
        onError={(e) => append('error', `${e.code}: ${e.message}`)}
        onSecurityViolation={(e) => append('violation', `${e.type} ${e.url}`)}
      />

      <View style={styles.commands}>
        {(
          [
            ['Reload', () => webViewRef.current?.reload()],
            ['Back', () => webViewRef.current?.goBack()],
            ['Fwd', () => webViewRef.current?.goForward()],
            ['Stop', () => webViewRef.current?.stopLoading()],
          ] as const
        ).map(([label, run]) => (
          <Pressable key={label} onPress={run} style={styles.command}>
            <Text style={styles.commandText}>{label}</Text>
          </Pressable>
        ))}
      </View>

      <ScrollView style={styles.log}>
        {log.map((entry) => (
          <Text key={entry.id} style={styles.logLine}>
            <Text style={[styles.logKind, kindStyle(entry.kind)]}>
              {entry.kind}
            </Text>{' '}
            {entry.text}
          </Text>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

function kindStyle(kind: string) {
  switch (kind) {
    case 'violation':
    case 'error':
      return styles.kindBad;
    case 'deeplink':
    case 'message':
      return styles.kindGood;
    default:
      return null;
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#1c1c27' },
  tabs: { paddingVertical: 8, paddingHorizontal: 6 },
  tab: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    marginHorizontal: 4,
    borderRadius: 16,
    backgroundColor: '#33334a',
  },
  tabActive: { backgroundColor: '#e6e6f0' },
  tabText: { color: '#cfcfe0', fontSize: 13, fontWeight: '600' },
  tabTextActive: { color: '#1c1c27' },
  webView: { flex: 1 },
  commands: {
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    paddingVertical: 6,
  },
  command: { paddingVertical: 6, paddingHorizontal: 16 },
  commandText: { color: '#8ab4ff', fontSize: 14, fontWeight: '600' },
  log: { height: 140, flexGrow: 0, paddingHorizontal: 10, paddingTop: 4 },
  logLine: { color: '#cfcfe0', fontSize: 11, marginBottom: 3 },
  logKind: { fontWeight: '700', color: '#9a9ab0' },
  kindBad: { color: '#ff7b72' },
  kindGood: { color: '#7ee787' },
});
