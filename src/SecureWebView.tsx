/**
 * Public SecureWebView component.
 *
 * Responsibilities of this wrapper (vs. the raw Fabric component in
 * `SecureWebViewNativeComponent.ts`):
 *
 *  - canonicalize `allowedOrigins` / `allowedSchemes` once, in JS, so native
 *    code only ever performs exact string comparison (see `policy.ts`)
 *  - surface configuration mistakes loudly in development (invalid allowlist
 *    entries are dropped — fail closed — never silently widened)
 *  - unwrap `NativeSyntheticEvent` payloads into plain typed objects
 *  - expose the imperative command API through `ref`, made safe against
 *    calls after unmount
 */
import { useImperativeHandle, useMemo, useRef } from 'react';
import type * as React from 'react';
import NativeSecureWebView, { Commands } from './SecureWebViewNativeComponent';
import {
  canonicalOrigin,
  canonicalizeAllowedOrigins,
  parseHttpOrigin,
  sanitizeAllowedSchemes,
} from './policy';
import type { SecureWebViewProps, SecurityViolationType } from './types';

type NativeComponentRef = React.ComponentRef<typeof NativeSecureWebView>;

function warnDev(message: string): void {
  if (__DEV__) {
    console.warn(`[react-native-secure-webview] ${message}`);
  }
}

export function SecureWebView({
  ref,
  source,
  allowedOrigins,
  allowedSchemes,
  session = 'persistent',
  onNavigation,
  onDeepLink,
  onMessage,
  onError,
  onSecurityViolation,
  ...viewProps
}: SecureWebViewProps): React.JSX.Element {
  const nativeRef = useRef<NativeComponentRef>(null);

  const canonicalOrigins = useMemo(() => {
    const { accepted, rejected } = canonicalizeAllowedOrigins(allowedOrigins);
    for (const entry of rejected) {
      warnDev(
        `Invalid allowedOrigins entry "${entry}" was dropped (fail closed). ` +
          `Entries must be bare http(s) origins like "https://checkout.example.com".`
      );
    }
    return accepted;
  }, [allowedOrigins]);

  const canonicalSchemes = useMemo(() => {
    const { accepted, rejected } = sanitizeAllowedSchemes(allowedSchemes ?? []);
    for (const entry of rejected) {
      warnDev(
        `Invalid allowedSchemes entry "${entry}" was dropped (fail closed). ` +
          `Schemes must be custom (e.g. "myapp") — http(s) and browser-internal ` +
          `schemes are never allowed.`
      );
    }
    return accepted;
  }, [allowedSchemes]);

  if (__DEV__) {
    const parsed = parseHttpOrigin(source.uri);
    if (parsed === null) {
      warnDev(
        `source.uri "${source.uri}" is not a valid http(s) URL; nothing will load.`
      );
    } else if (!canonicalOrigins.includes(canonicalOrigin(parsed))) {
      warnDev(
        `source.uri origin "${canonicalOrigin(parsed)}" is not in allowedOrigins; ` +
          `the load will be blocked (fail closed).`
      );
    }
  }

  useImperativeHandle(ref, () => {
    const withMountedView = (command: (view: NativeComponentRef) => void) => {
      return () => {
        const view = nativeRef.current;
        if (view == null) {
          warnDev('Command ignored: the SecureWebView is not mounted.');
          return;
        }
        command(view);
      };
    };
    return {
      reload: withMountedView((view) => Commands.reload(view)),
      goBack: withMountedView((view) => Commands.goBack(view)),
      goForward: withMountedView((view) => Commands.goForward(view)),
      stopLoading: withMountedView((view) => Commands.stopLoading(view)),
    };
  }, []);

  return (
    <NativeSecureWebView
      {...viewProps}
      ref={nativeRef}
      sourceUri={source.uri}
      allowedOrigins={canonicalOrigins}
      allowedSchemes={canonicalSchemes}
      session={session}
      onNavigation={
        onNavigation && ((event) => onNavigation(event.nativeEvent))
      }
      onDeepLink={onDeepLink && ((event) => onDeepLink(event.nativeEvent))}
      onMessage={onMessage && ((event) => onMessage(event.nativeEvent))}
      onError={
        onError &&
        ((event) => {
          const { code, message, url } = event.nativeEvent;
          onError({ code, message, url: url === '' ? undefined : url });
        })
      }
      onSecurityViolation={
        onSecurityViolation &&
        ((event) => {
          const { type, url } = event.nativeEvent;
          onSecurityViolation({ type: narrowViolationType(type), url });
        })
      }
    />
  );
}

/** The wire format carries `type` as a plain string; narrow it defensively. */
function narrowViolationType(type: string): SecurityViolationType {
  switch (type) {
    case 'origin_not_allowed':
    case 'scheme_not_allowed':
    case 'invalid_url':
      return type;
    default:
      return 'invalid_url';
  }
}
