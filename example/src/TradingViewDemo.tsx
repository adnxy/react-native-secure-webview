/**
 * TradingView showcase.
 *
 * A realistic fintech "Markets" screen that embeds TradingView's chart widget
 * inside SecureWebView to demonstrate the library's strengths on a
 * production-grade third-party page:
 *
 *  - the web view is origin-locked to a single origin
 *    (https://s.tradingview.com) — the chart is fully interactive, but any
 *    top-level navigation to another origin is blocked and reported
 *  - "Simulate compromise" swaps the source to a hostile URL while the
 *    allowlist stays unchanged: nothing loads (fail closed) and an
 *    `origin_not_allowed` violation appears in the live security monitor
 *  - every navigation, violation, and error is surfaced through typed
 *    callbacks and rendered in the on-screen security monitor
 */
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SecureWebView } from 'react-native-secure-webview';

/** The only origin this screen is allowed to load. */
const TRADINGVIEW_ORIGIN = 'https://s.tradingview.com';

/** Hostile URL used by "Simulate compromise" — never allow-listed. */
const HOSTILE_URI = 'https://evil-payments.example.com/checkout';

const SYMBOLS = [
  { label: 'AAPL', symbol: 'NASDAQ:AAPL' },
  { label: 'NVDA', symbol: 'NASDAQ:NVDA' },
  { label: 'TSLA', symbol: 'NASDAQ:TSLA' },
  { label: 'BTC', symbol: 'BITSTAMP:BTCUSD' },
  { label: 'ETH', symbol: 'BITSTAMP:ETHUSD' },
  { label: 'EUR/USD', symbol: 'FX:EURUSD' },
  { label: 'S&P 500', symbol: 'SP:SPX' },
] as const;

const INTERVALS = [
  { label: '1m', value: '1' },
  { label: '15m', value: '15' },
  { label: '1H', value: '60' },
  { label: '4H', value: '240' },
  { label: '1D', value: 'D' },
] as const;

function widgetUrl(symbol: string, interval: string): string {
  const params = new URLSearchParams({
    symbol,
    interval,
    theme: 'dark',
    style: '1',
    locale: 'en',
    timezone: 'Etc/UTC',
    toolbarbg: '131722',
    hide_side_toolbar: '1',
    allow_symbol_change: '0',
    save_image: '0',
    withdateranges: '1',
  });
  return `${TRADINGVIEW_ORIGIN}/widgetembed/?${params.toString()}`;
}

type FeedKind = 'nav' | 'blocked' | 'error' | 'info';
type FeedEntry = { id: number; kind: FeedKind; text: string };

let nextFeedId = 1;

export default function TradingViewDemo() {
  const [symbol, setSymbol] = useState<(typeof SYMBOLS)[number]>(SYMBOLS[0]!);
  const [chartInterval, setChartInterval] = useState<
    (typeof INTERVALS)[number]
  >(INTERVALS[2]!);
  const [compromised, setCompromised] = useState(false);
  const [blockedCount, setBlockedCount] = useState(0);
  const [feed, setFeed] = useState<FeedEntry[]>([
    {
      id: 0,
      kind: 'info',
      text: `Origin-locked to ${TRADINGVIEW_ORIGIN} — everything else fails closed.`,
    },
  ]);

  const append = (kind: FeedKind, text: string) => {
    setFeed((entries) =>
      [{ id: nextFeedId++, kind, text }, ...entries].slice(0, 30)
    );
  };

  const sourceUri = compromised
    ? HOSTILE_URI
    : widgetUrl(symbol.symbol, chartInterval.value);

  return (
    <View style={styles.root}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.brand}>Atlas Markets</Text>
          <Text style={styles.brandSub}>Charts by TradingView</Text>
        </View>
        <View style={styles.lockBadge}>
          <Text style={styles.lockBadgeTitle}>ORIGIN-LOCKED</Text>
          <Text style={styles.lockBadgeOrigin}>s.tradingview.com</Text>
        </View>
      </View>

      {/* Symbol picker */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.symbolRow}
        contentContainerStyle={styles.symbolRowContent}
      >
        {SYMBOLS.map((s) => (
          <Pressable
            key={s.symbol}
            onPress={() => {
              setSymbol(s);
              append('info', `Chart switched to ${s.symbol}`);
            }}
            style={[
              styles.symbolPill,
              s.symbol === symbol.symbol && styles.symbolPillActive,
            ]}
          >
            <Text
              style={[
                styles.symbolPillText,
                s.symbol === symbol.symbol && styles.symbolPillTextActive,
              ]}
            >
              {s.label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      {/* Chart */}
      <View style={styles.chartFrame}>
        <SecureWebView
          // Remount on any source change so each scenario starts clean.
          key={sourceUri}
          style={styles.chart}
          source={{ uri: sourceUri }}
          // The allowlist never changes — not even during the simulated
          // compromise. That is the point: policy lives in the native layer,
          // not in whatever URL the JS side happens to pass down.
          allowedOrigins={[TRADINGVIEW_ORIGIN]}
          onNavigation={(e) =>
            append('nav', `${e.loading ? 'loading' : 'loaded'} ${e.url}`)
          }
          onSecurityViolation={(e) => {
            setBlockedCount((n) => n + 1);
            append('blocked', `${e.type}: ${e.url}`);
          }}
          onError={(e) => append('error', `${e.code}: ${e.message}`)}
        />
        {compromised && (
          <View style={styles.blockedOverlay}>
            <Text style={styles.blockedTitle}>Navigation blocked</Text>
            <Text style={styles.blockedText}>
              The source was swapped to{'\n'}
              {HOSTILE_URI}
              {'\n\n'}
              The origin is not allow-listed, so SecureWebView refused to load
              it — no request, no pixels, fail closed.
            </Text>
            <Pressable
              style={styles.restoreButton}
              onPress={() => {
                setCompromised(false);
                append('info', 'Source restored to the TradingView widget.');
              }}
            >
              <Text style={styles.restoreButtonText}>Restore chart</Text>
            </Pressable>
          </View>
        )}
      </View>

      {/* Interval picker + compromise trigger */}
      <View style={styles.controls}>
        <View style={styles.intervals}>
          {INTERVALS.map((i) => (
            <Pressable
              key={i.value}
              onPress={() => setChartInterval(i)}
              style={[
                styles.intervalPill,
                i.value === chartInterval.value && styles.intervalPillActive,
              ]}
            >
              <Text
                style={[
                  styles.intervalText,
                  i.value === chartInterval.value && styles.intervalTextActive,
                ]}
              >
                {i.label}
              </Text>
            </Pressable>
          ))}
        </View>
        <Pressable
          style={[styles.attackButton, compromised && styles.attackButtonOff]}
          disabled={compromised}
          onPress={() => {
            setCompromised(true);
            append(
              'info',
              'Compromise simulated: source swapped to a hostile URL.'
            );
          }}
        >
          <Text style={styles.attackButtonText}>Simulate compromise</Text>
        </Pressable>
      </View>

      {/* Security monitor */}
      <View style={styles.monitor}>
        <View style={styles.monitorHeader}>
          <Text style={styles.monitorTitle}>Security monitor</Text>
          <Text style={styles.monitorCounter}>{blockedCount} blocked</Text>
        </View>
        <ScrollView style={styles.monitorFeed}>
          {feed.map((entry) => (
            <Text key={entry.id} style={styles.feedLine} numberOfLines={2}>
              <Text style={[styles.feedKind, kindStyle(entry.kind)]}>
                {entry.kind.toUpperCase()}
              </Text>{' '}
              {entry.text}
            </Text>
          ))}
        </ScrollView>
      </View>
    </View>
  );
}

function kindStyle(kind: FeedKind) {
  switch (kind) {
    case 'blocked':
    case 'error':
      return styles.kindBad;
    case 'nav':
      return styles.kindGood;
    default:
      return null;
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#131722' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  brand: { color: '#f0f3fa', fontSize: 18, fontWeight: '800' },
  brandSub: { color: '#787b86', fontSize: 11, marginTop: 1 },
  lockBadge: {
    alignItems: 'flex-end',
    borderColor: '#2962ff',
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  lockBadgeTitle: {
    color: '#2962ff',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1,
  },
  lockBadgeOrigin: { color: '#787b86', fontSize: 10, marginTop: 1 },
  symbolRow: { flexGrow: 0 },
  symbolRowContent: { paddingHorizontal: 10, paddingBottom: 8 },
  symbolPill: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    marginHorizontal: 3,
    borderRadius: 14,
    backgroundColor: '#1e222d',
  },
  symbolPillActive: { backgroundColor: '#2962ff' },
  symbolPillText: { color: '#b2b5be', fontSize: 12, fontWeight: '700' },
  symbolPillTextActive: { color: '#ffffff' },
  chartFrame: { flex: 1, backgroundColor: '#131722' },
  chart: { flex: 1 },
  blockedOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#131722',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  blockedTitle: {
    color: '#f7525f',
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 10,
  },
  blockedText: {
    color: '#b2b5be',
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
  },
  restoreButton: {
    marginTop: 18,
    backgroundColor: '#2962ff',
    borderRadius: 8,
    paddingVertical: 9,
    paddingHorizontal: 20,
  },
  restoreButtonText: { color: '#ffffff', fontSize: 13, fontWeight: '700' },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  intervals: { flexDirection: 'row' },
  intervalPill: {
    paddingVertical: 5,
    paddingHorizontal: 10,
    marginRight: 4,
    borderRadius: 6,
    backgroundColor: '#1e222d',
  },
  intervalPillActive: { backgroundColor: '#2a2e39' },
  intervalText: { color: '#787b86', fontSize: 12, fontWeight: '600' },
  intervalTextActive: { color: '#f0f3fa' },
  attackButton: {
    borderColor: '#f7525f',
    borderWidth: 1,
    borderRadius: 6,
    paddingVertical: 5,
    paddingHorizontal: 10,
  },
  attackButtonOff: { opacity: 0.4 },
  attackButtonText: { color: '#f7525f', fontSize: 12, fontWeight: '700' },
  monitor: {
    borderTopColor: '#1e222d',
    borderTopWidth: 1,
    paddingHorizontal: 12,
    paddingTop: 6,
    height: 128,
  },
  monitorHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  monitorTitle: {
    color: '#787b86',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  monitorCounter: { color: '#f7525f', fontSize: 10, fontWeight: '700' },
  monitorFeed: { flex: 1 },
  feedLine: { color: '#b2b5be', fontSize: 10, marginBottom: 3 },
  feedKind: { fontWeight: '800', color: '#787b86' },
  kindBad: { color: '#f7525f' },
  kindGood: { color: '#26a69a' },
});
