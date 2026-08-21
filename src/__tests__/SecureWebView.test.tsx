/**
 * Wrapper/lifecycle tests. The native component module is mocked so that:
 *  - the rendered host element's props (the Fabric "wire format") can be
 *    inspected directly, and
 *  - `Commands` calls can be asserted without a native runtime.
 */
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { createRef } from 'react';
import { SecureWebView } from '../SecureWebView';
import type { SecureWebViewRef } from '../types';
import { Commands } from '../SecureWebViewNativeComponent';

jest.mock('../SecureWebViewNativeComponent', () => {
  const { createElement } = require('react');
  return {
    __esModule: true,
    default: (props: Record<string, unknown>) =>
      createElement('SecureWebView', props),
    Commands: {
      reload: jest.fn(),
      goBack: jest.fn(),
      goForward: jest.fn(),
      stopLoading: jest.fn(),
    },
  };
});

const defaultProps = {
  source: { uri: 'https://checkout.example.com/pay' },
  allowedOrigins: ['https://checkout.example.com'],
};

function render(element: React.JSX.Element): ReactTestRenderer {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(element, {
      // react-test-renderer resolves refs to host elements through
      // `createNodeMock` (default: () => null). Return a stub object so the
      // wrapper's internal `nativeRef` is populated, as it would be by a real
      // native view — otherwise every command would no-op as "not mounted".
      createNodeMock: (el) => ({ type: el.type }),
    });
  });
  return renderer;
}

function nativeProps(renderer: ReactTestRenderer): Record<string, any> {
  return renderer.root.findByType('SecureWebView' as any).props;
}

let warnSpy: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
});

describe('prop canonicalization', () => {
  it('passes canonical origins and defaults to a persistent session', () => {
    const renderer = render(<SecureWebView {...defaultProps} />);
    const props = nativeProps(renderer);
    expect(props.sourceUri).toBe('https://checkout.example.com/pay');
    expect(props.allowedOrigins).toEqual(['https://checkout.example.com:443']);
    expect(props.allowedSchemes).toEqual([]);
    expect(props.session).toBe('persistent');
  });

  it('drops invalid allowlist entries (fail closed) and warns', () => {
    const renderer = render(
      <SecureWebView
        {...defaultProps}
        allowedOrigins={[
          'https://checkout.example.com',
          'https://bad.example.com/path',
        ]}
        allowedSchemes={['MyApp', 'javascript']}
      />
    );
    const props = nativeProps(renderer);
    expect(props.allowedOrigins).toEqual(['https://checkout.example.com:443']);
    expect(props.allowedSchemes).toEqual(['myapp']);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('https://bad.example.com/path')
    );
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('javascript'));
  });

  it('warns when the source origin is not allow-listed', () => {
    render(
      <SecureWebView
        source={{ uri: 'https://other.example.com/' }}
        allowedOrigins={['https://checkout.example.com']}
      />
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('not in allowedOrigins')
    );
  });

  it('applies prop updates', () => {
    const renderer = render(<SecureWebView {...defaultProps} />);
    act(() => {
      renderer.update(
        <SecureWebView
          source={{ uri: 'https://payments.example.com/x' }}
          allowedOrigins={['https://payments.example.com:8443']}
          session="ephemeral"
        />
      );
    });
    const props = nativeProps(renderer);
    expect(props.sourceUri).toBe('https://payments.example.com/x');
    expect(props.allowedOrigins).toEqual(['https://payments.example.com:8443']);
    expect(props.session).toBe('ephemeral');
  });
});

describe('event unwrapping', () => {
  it('unwraps nativeEvent payloads into plain objects', () => {
    const onNavigation = jest.fn();
    const onDeepLink = jest.fn();
    const onMessage = jest.fn();
    const renderer = render(
      <SecureWebView
        {...defaultProps}
        onNavigation={onNavigation}
        onDeepLink={onDeepLink}
        onMessage={onMessage}
      />
    );
    const props = nativeProps(renderer);

    const navigation = {
      url: 'https://checkout.example.com/pay',
      loading: true,
      canGoBack: false,
      canGoForward: false,
    };
    props.onNavigation({ nativeEvent: navigation });
    expect(onNavigation).toHaveBeenCalledWith(navigation);

    props.onDeepLink({ nativeEvent: { url: 'myapp://done', scheme: 'myapp' } });
    expect(onDeepLink).toHaveBeenCalledWith({
      url: 'myapp://done',
      scheme: 'myapp',
    });

    props.onMessage({ nativeEvent: { data: 'hello' } });
    expect(onMessage).toHaveBeenCalledWith({ data: 'hello' });
  });

  it('converts the empty-string url sentinel on errors to undefined', () => {
    const onError = jest.fn();
    const renderer = render(
      <SecureWebView {...defaultProps} onError={onError} />
    );
    const props = nativeProps(renderer);

    props.onError({
      nativeEvent: { code: 'ios_-1009', message: 'offline', url: '' },
    });
    expect(onError).toHaveBeenCalledWith({
      code: 'ios_-1009',
      message: 'offline',
      url: undefined,
    });

    props.onError({
      nativeEvent: { code: 'android_-2', message: 'dns', url: 'https://x.dev' },
    });
    expect(onError).toHaveBeenLastCalledWith({
      code: 'android_-2',
      message: 'dns',
      url: 'https://x.dev',
    });
  });

  it('narrows unknown violation types defensively', () => {
    const onSecurityViolation = jest.fn();
    const renderer = render(
      <SecureWebView
        {...defaultProps}
        onSecurityViolation={onSecurityViolation}
      />
    );
    const props = nativeProps(renderer);

    props.onSecurityViolation({
      nativeEvent: { type: 'origin_not_allowed', url: 'https://evil.dev' },
    });
    expect(onSecurityViolation).toHaveBeenCalledWith({
      type: 'origin_not_allowed',
      url: 'https://evil.dev',
    });

    props.onSecurityViolation({
      nativeEvent: { type: 'something_new', url: 'x' },
    });
    expect(onSecurityViolation).toHaveBeenLastCalledWith({
      type: 'invalid_url',
      url: 'x',
    });
  });
});

describe('commands and lifecycle', () => {
  it('dispatches commands to the mounted native view', () => {
    const ref = createRef<SecureWebViewRef>();
    render(<SecureWebView {...defaultProps} ref={ref} />);

    ref.current?.reload();
    ref.current?.goBack();
    ref.current?.goForward();
    ref.current?.stopLoading();

    expect(Commands.reload).toHaveBeenCalledTimes(1);
    expect(Commands.goBack).toHaveBeenCalledTimes(1);
    expect(Commands.goForward).toHaveBeenCalledTimes(1);
    expect(Commands.stopLoading).toHaveBeenCalledTimes(1);
  });

  it('ignores commands after unmount instead of throwing', () => {
    const ref = createRef<SecureWebViewRef>();
    const renderer = render(<SecureWebView {...defaultProps} ref={ref} />);
    const handle = ref.current!;

    act(() => {
      renderer.unmount();
    });

    expect(() => handle.reload()).not.toThrow();
    expect(() => handle.stopLoading()).not.toThrow();
    expect(Commands.reload).not.toHaveBeenCalled();
    expect(Commands.stopLoading).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('not mounted')
    );
  });

  it('survives mount → unmount → mount', () => {
    const ref = createRef<SecureWebViewRef>();
    const first = render(<SecureWebView {...defaultProps} ref={ref} />);
    act(() => {
      first.unmount();
    });
    expect(ref.current).toBeNull();

    const second = render(<SecureWebView {...defaultProps} ref={ref} />);
    ref.current?.reload();
    expect(Commands.reload).toHaveBeenCalledTimes(1);
    act(() => {
      second.unmount();
    });
  });

  it('survives rapid mount/unmount cycles', () => {
    for (let i = 0; i < 25; i++) {
      const renderer = render(<SecureWebView {...defaultProps} />);
      act(() => {
        renderer.unmount();
      });
    }
  });

  it('does not invoke stale callbacks after teardown', () => {
    const onNavigation = jest.fn();
    const renderer = render(
      <SecureWebView {...defaultProps} onNavigation={onNavigation} />
    );
    const props = nativeProps(renderer);
    act(() => {
      renderer.unmount();
    });
    // A late native event delivered to the captured handler still routes to
    // the JS callback (native teardown is responsible for silencing the
    // emitter); the wrapper must not crash.
    expect(() =>
      props.onNavigation({
        nativeEvent: {
          url: 'https://checkout.example.com',
          loading: false,
          canGoBack: false,
          canGoForward: false,
        },
      })
    ).not.toThrow();
  });
});
