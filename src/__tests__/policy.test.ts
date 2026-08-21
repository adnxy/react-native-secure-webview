import {
  canonicalizeAllowedOrigin,
  canonicalizeAllowedOrigins,
  decideNavigation,
  parseHttpOrigin,
  parseScheme,
  sanitizeAllowedSchemes,
} from '../policy';

describe('parseScheme', () => {
  it('extracts lowercase schemes', () => {
    expect(parseScheme('https://a.com')).toBe('https');
    expect(parseScheme('HTTPS://a.com')).toBe('https');
    expect(parseScheme('MyApp://x')).toBe('myapp');
    expect(parseScheme('a+b.c-d://x')).toBe('a+b.c-d');
  });

  it('rejects strings without a scheme', () => {
    expect(parseScheme('')).toBeNull();
    expect(parseScheme('no-scheme')).toBeNull();
    expect(parseScheme('//example.com')).toBeNull();
    expect(parseScheme('1abc://x')).toBeNull();
  });

  it('rejects forbidden characters anywhere in the URL', () => {
    expect(parseScheme('https://exa mple.com')).toBeNull();
    expect(parseScheme('https://example.com\t.evil.com')).toBeNull();
    expect(parseScheme('https://example.com\n')).toBeNull();
    expect(parseScheme('https://evil.com\\@example.com')).toBeNull();
    expect(parseScheme('https://ex\u0000ample.com')).toBeNull();
    expect(parseScheme('https://exämple.com')).toBeNull();
  });
});

describe('parseHttpOrigin', () => {
  it('applies default ports', () => {
    expect(parseHttpOrigin('https://example.com')).toEqual({
      scheme: 'https',
      host: 'example.com',
      port: 443,
      rest: '',
    });
    expect(parseHttpOrigin('http://example.com')).toMatchObject({ port: 80 });
  });

  it('parses explicit ports, including canonicalizing leading zeros', () => {
    expect(parseHttpOrigin('https://example.com:8443')).toMatchObject({
      port: 8443,
    });
    expect(parseHttpOrigin('https://example.com:0443')).toMatchObject({
      port: 443,
    });
  });

  it('rejects invalid ports', () => {
    expect(parseHttpOrigin('https://example.com:0')).toBeNull();
    expect(parseHttpOrigin('https://example.com:65536')).toBeNull();
    expect(parseHttpOrigin('https://example.com:123456')).toBeNull();
    expect(parseHttpOrigin('https://example.com:port')).toBeNull();
    expect(parseHttpOrigin('https://example.com:')).toBeNull();
    expect(parseHttpOrigin('https://example.com:-1')).toBeNull();
  });

  it('lowercases scheme and host', () => {
    expect(parseHttpOrigin('HTTPS://EXAMPLE.COM/Path')).toMatchObject({
      scheme: 'https',
      host: 'example.com',
    });
  });

  it('rejects embedded credentials', () => {
    expect(parseHttpOrigin('https://user@example.com')).toBeNull();
    expect(parseHttpOrigin('https://user:pass@example.com')).toBeNull();
    expect(
      parseHttpOrigin('https://checkout.example.com@evil.com/')
    ).toBeNull();
  });

  it('rejects non-authority forms', () => {
    expect(parseHttpOrigin('https:example.com')).toBeNull();
    expect(parseHttpOrigin('https:/example.com')).toBeNull();
    expect(parseHttpOrigin('myapp://example.com')).toBeNull();
  });

  it('rejects malformed hosts', () => {
    expect(parseHttpOrigin('https://')).toBeNull();
    expect(parseHttpOrigin('https:///path')).toBeNull();
    expect(parseHttpOrigin('https://example.com.')).toBeNull(); // trailing-dot FQDN
    expect(parseHttpOrigin('https://.example.com')).toBeNull();
    expect(parseHttpOrigin('https://exa..mple.com')).toBeNull();
    expect(parseHttpOrigin('https://exa_mple.com')).toBeNull();
    expect(parseHttpOrigin('https://host:80:80')).toBeNull();
  });

  it('parses bracketed IPv6 literals', () => {
    expect(parseHttpOrigin('https://[::1]:8443')).toEqual({
      scheme: 'https',
      host: '[::1]',
      port: 8443,
      rest: '',
    });
    expect(parseHttpOrigin('http://[::1]')).toMatchObject({
      host: '[::1]',
      port: 80,
    });
    expect(parseHttpOrigin('https://[::1')).toBeNull();
    expect(parseHttpOrigin('https://[::1]junk')).toBeNull();
    expect(parseHttpOrigin('https://[zzz]')).toBeNull();
  });

  it('accepts punycode but rejects raw IDN hosts', () => {
    expect(parseHttpOrigin('https://xn--e1awd7f.com')).toMatchObject({
      host: 'xn--e1awd7f.com',
    });
    expect(parseHttpOrigin('https://пример.com')).toBeNull();
  });

  it('captures the post-authority remainder', () => {
    expect(parseHttpOrigin('https://a.com/path?q=1#f')).toMatchObject({
      rest: '/path?q=1#f',
    });
    expect(parseHttpOrigin('https://a.com?q=1')).toMatchObject({
      rest: '?q=1',
    });
  });
});

describe('canonicalizeAllowedOrigin', () => {
  it('canonicalizes bare origins', () => {
    expect(canonicalizeAllowedOrigin('https://example.com')).toBe(
      'https://example.com:443'
    );
    expect(canonicalizeAllowedOrigin('https://example.com/')).toBe(
      'https://example.com:443'
    );
    expect(canonicalizeAllowedOrigin('HTTP://Example.COM:8080')).toBe(
      'http://example.com:8080'
    );
  });

  it('rejects entries with a path, query, or fragment', () => {
    expect(canonicalizeAllowedOrigin('https://example.com/path')).toBeNull();
    expect(canonicalizeAllowedOrigin('https://example.com?q=1')).toBeNull();
    expect(canonicalizeAllowedOrigin('https://example.com#f')).toBeNull();
    expect(canonicalizeAllowedOrigin('https://example.com//')).toBeNull();
  });
});

describe('canonicalizeAllowedOrigins', () => {
  it('canonicalizes, deduplicates, and reports rejects', () => {
    const { accepted, rejected } = canonicalizeAllowedOrigins([
      'https://example.com',
      'https://example.com:443', // duplicate after canonicalization
      'https://example.com/path', // invalid
      'myapp://x', // invalid
      'http://example.com',
    ]);
    expect(accepted).toEqual([
      'https://example.com:443',
      'http://example.com:80',
    ]);
    expect(rejected).toEqual(['https://example.com/path', 'myapp://x']);
  });
});

describe('sanitizeAllowedSchemes', () => {
  it('lowercases and deduplicates valid custom schemes', () => {
    const { accepted, rejected } = sanitizeAllowedSchemes([
      'myapp',
      'MyApp',
      'my-app',
      'my.app',
      'my+app',
    ]);
    expect(accepted).toEqual(['myapp', 'my-app', 'my.app', 'my+app']);
    expect(rejected).toEqual([]);
  });

  it('rejects forbidden schemes', () => {
    const forbidden = [
      'http',
      'https',
      'javascript',
      'data',
      'blob',
      'file',
      'filesystem',
      'about',
      'ws',
      'wss',
      'content',
      'intent',
      'HTTPS',
    ];
    const { accepted, rejected } = sanitizeAllowedSchemes(forbidden);
    expect(accepted).toEqual([]);
    expect(rejected).toEqual(forbidden);
  });

  it('rejects syntactically invalid schemes', () => {
    const { accepted, rejected } = sanitizeAllowedSchemes([
      '1app',
      'my app',
      'my<app',
      '',
      'app:',
    ]);
    expect(accepted).toEqual([]);
    expect(rejected).toHaveLength(5);
  });
});

describe('decideNavigation', () => {
  const origins = [
    'https://checkout.example.com:443',
    'https://payments.example.com:443',
  ];
  const schemes = ['myapp'];

  const decide = (url: string) => decideNavigation(url, origins, schemes);

  describe('allowed origins', () => {
    it('loads exact-origin URLs regardless of path/query/fragment', () => {
      expect(decide('https://checkout.example.com')).toEqual({
        action: 'load',
      });
      expect(decide('https://checkout.example.com/pay?step=2#card')).toEqual({
        action: 'load',
      });
      expect(decide('HTTPS://CHECKOUT.EXAMPLE.COM/Pay')).toEqual({
        action: 'load',
      });
      expect(decide('https://checkout.example.com:443/x')).toEqual({
        action: 'load',
      });
      expect(decide('https://payments.example.com/redirect')).toEqual({
        action: 'load',
      });
    });

    it('allows about:blank only', () => {
      expect(decide('about:blank')).toEqual({ action: 'load' });
      expect(decide('about:srcdoc')).toEqual({
        action: 'block',
        violation: 'scheme_not_allowed',
      });
    });
  });

  describe('origin violations', () => {
    const blockedOrigin = { action: 'block', violation: 'origin_not_allowed' };

    it('blocks scheme downgrade to http', () => {
      expect(decide('http://checkout.example.com')).toEqual(blockedOrigin);
    });

    it('blocks non-default ports', () => {
      expect(decide('https://checkout.example.com:9999')).toEqual(
        blockedOrigin
      );
      expect(decide('https://checkout.example.com:80')).toEqual(blockedOrigin);
    });

    it('blocks subdomains — no implicit wildcards', () => {
      expect(decide('https://sub.checkout.example.com')).toEqual(blockedOrigin);
      expect(decide('https://example.com')).toEqual(blockedOrigin);
    });

    it('blocks deceptive hostnames', () => {
      expect(decide('https://evil-checkout.example.com.evil.com')).toEqual(
        blockedOrigin
      );
      expect(decide('https://checkout.example.com.evil.com')).toEqual(
        blockedOrigin
      );
      expect(decide('https://checkoutexample.com')).toEqual(blockedOrigin);
      expect(decide('https://checkout-example.com')).toEqual(blockedOrigin);
    });
  });

  describe('invalid URLs', () => {
    const invalid = { action: 'block', violation: 'invalid_url' };

    it('blocks credential-confusion URLs', () => {
      expect(decide('https://checkout.example.com@evil.com/')).toEqual(invalid);
      expect(decide('https://user:pass@checkout.example.com')).toEqual(invalid);
    });

    it('blocks backslash and whitespace tricks', () => {
      expect(decide('https://evil.com\\@checkout.example.com')).toEqual(
        invalid
      );
      expect(decide('https://checkout.example.com\t.evil.com')).toEqual(
        invalid
      );
      expect(decide('https://checkout.example.com evil')).toEqual(invalid);
    });

    it('blocks trailing-dot FQDN bypass', () => {
      expect(decide('https://checkout.example.com.')).toEqual(invalid);
    });

    it('blocks malformed input', () => {
      expect(decide('')).toEqual(invalid);
      expect(decide('not a url')).toEqual(invalid);
      expect(decide('://x')).toEqual(invalid);
      expect(decide('https://')).toEqual(invalid);
      expect(decide('https:checkout.example.com')).toEqual(invalid);
    });
  });

  describe('custom schemes', () => {
    it('intercepts allow-listed schemes as deep links', () => {
      expect(decide('myapp://payment/complete?id=1')).toEqual({
        action: 'deep_link',
        scheme: 'myapp',
      });
      expect(decide('MYAPP://x')).toEqual({
        action: 'deep_link',
        scheme: 'myapp',
      });
    });

    it('blocks unknown schemes', () => {
      expect(decide('otherapp://x')).toEqual({
        action: 'block',
        violation: 'scheme_not_allowed',
      });
      expect(decide('mailto:a@b.com')).toEqual({
        action: 'block',
        violation: 'scheme_not_allowed',
      });
      expect(decide('tel:+1234')).toEqual({
        action: 'block',
        violation: 'scheme_not_allowed',
      });
    });

    it('blocks dangerous schemes even if somehow allow-listed', () => {
      const hostile = ['javascript', 'data', 'file', 'intent', 'about'];
      // eslint-disable-next-line no-script-url -- intentionally hostile input
      expect(decideNavigation('javascript:alert(1)', origins, hostile)).toEqual(
        { action: 'block', violation: 'scheme_not_allowed' }
      );
      expect(
        decideNavigation('data:text/html,<script>1</script>', origins, hostile)
      ).toEqual({ action: 'block', violation: 'scheme_not_allowed' });
      expect(
        decideNavigation('data:text/html;base64,PGI+', origins, hostile)
      ).toEqual({ action: 'block', violation: 'scheme_not_allowed' });
      expect(decideNavigation('file:///etc/passwd', origins, hostile)).toEqual({
        action: 'block',
        violation: 'scheme_not_allowed',
      });
      expect(
        decideNavigation('intent://scan#Intent;end', origins, hostile)
      ).toEqual({ action: 'block', violation: 'scheme_not_allowed' });
    });
  });

  it('denies everything with an empty configuration', () => {
    expect(decideNavigation('https://example.com', [], [])).toEqual({
      action: 'block',
      violation: 'origin_not_allowed',
    });
    expect(decideNavigation('myapp://x', [], [])).toEqual({
      action: 'block',
      violation: 'scheme_not_allowed',
    });
  });
});
