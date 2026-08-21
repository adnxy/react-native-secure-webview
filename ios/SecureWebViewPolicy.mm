#import "SecureWebViewPolicy.h"

/// Schemes that may never be allow-listed as custom schemes. Mirrors
/// FORBIDDEN_CUSTOM_SCHEMES in src/policy.ts.
static NSSet<NSString *> *SWVForbiddenSchemes(void)
{
  static NSSet<NSString *> *set;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    set = [NSSet setWithArray:@[
      @"http", @"https", @"javascript", @"data", @"blob", @"file",
      @"filesystem", @"about", @"ws", @"wss", @"content", @"intent"
    ]];
  });
  return set;
}

/// Strict ASCII hostname: [a-z0-9-] labels joined by single dots. Rejects
/// empty labels, leading/trailing dots (trailing-dot FQDNs are a classic
/// allowlist bypass), and any non-ASCII (IDNs must be punycode-encoded).
static BOOL SWVIsValidAsciiHost(NSString *host)
{
  if (host.length == 0) {
    return NO;
  }
  unichar prev = '.';
  for (NSUInteger i = 0; i < host.length; i++) {
    unichar c = [host characterAtIndex:i];
    BOOL valid = (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-' || c == '.';
    if (!valid) {
      return NO;
    }
    if (c == '.' && prev == '.') {
      return NO; // empty label, including a leading dot
    }
    prev = c;
  }
  return prev != '.'; // no trailing dot
}

/// IPv6 literal body (without brackets): hex digits, ':' and '.'.
/// Matched textually — equivalent spellings are not normalized, so configure
/// the allowlist with the exact form the platform reports.
static BOOL SWVIsValidIPv6HostBody(NSString *host)
{
  if (host.length == 0) {
    return NO;
  }
  BOOL hasColon = NO;
  for (NSUInteger i = 0; i < host.length; i++) {
    unichar c = [host characterAtIndex:i];
    BOOL valid = (c >= 'a' && c <= 'f') || (c >= '0' && c <= '9') || c == ':' || c == '.';
    if (!valid) {
      return NO;
    }
    hasColon = hasColon || c == ':';
  }
  return hasColon;
}

@implementation SecureWebViewPolicy

+ (nullable NSString *)canonicalHTTPOriginForURL:(nullable NSURL *)url
{
  if (url == nil) {
    return nil;
  }
  // Reject embedded credentials outright ("https://good.com@evil.com").
  if (url.user != nil || url.password != nil) {
    return nil;
  }
  NSString *scheme = url.scheme.lowercaseString;
  NSString *host = url.host.lowercaseString;
  if (scheme == nil || host == nil) {
    return nil;
  }
  return [self canonicalOriginForScheme:scheme
                                   host:host
                                   port:url.port ? url.port.integerValue : 0];
}

+ (nullable NSString *)canonicalOriginForScheme:(NSString *)scheme
                                           host:(NSString *)host
                                           port:(NSInteger)port
{
  NSString *lowerScheme = scheme.lowercaseString;
  BOOL isHttp = [lowerScheme isEqualToString:@"http"];
  BOOL isHttps = [lowerScheme isEqualToString:@"https"];
  if (!isHttp && !isHttps) {
    return nil;
  }

  NSString *lowerHost = host.lowercaseString;
  NSString *canonicalHost;
  if ([lowerHost containsString:@":"]) {
    // IPv6: NSURL.host and WKSecurityOrigin.host report it without brackets;
    // the canonical form (matching src/policy.ts) is bracketed.
    NSString *body = lowerHost;
    if ([body hasPrefix:@"["] && [body hasSuffix:@"]"]) {
      body = [body substringWithRange:NSMakeRange(1, body.length - 2)];
    }
    if (!SWVIsValidIPv6HostBody(body)) {
      return nil;
    }
    canonicalHost = [NSString stringWithFormat:@"[%@]", body];
  } else {
    if (!SWVIsValidAsciiHost(lowerHost)) {
      return nil;
    }
    canonicalHost = lowerHost;
  }

  NSInteger effectivePort = port != 0 ? port : (isHttps ? 443 : 80);
  if (effectivePort < 1 || effectivePort > 65535) {
    return nil;
  }

  return [NSString stringWithFormat:@"%@://%@:%ld", lowerScheme, canonicalHost, (long)effectivePort];
}

+ (SWVPolicyDecision)decideForURL:(nullable NSURL *)url
                   allowedOrigins:(NSSet<NSString *> *)allowedOrigins
                   allowedSchemes:(NSSet<NSString *> *)allowedSchemes
{
  if (url == nil || url.absoluteString.length == 0) {
    return SWVPolicyDecisionBlockInvalidURL;
  }
  // The initial blank document is inert and required for view setup/teardown.
  if ([url.absoluteString isEqualToString:@"about:blank"]) {
    return SWVPolicyDecisionLoad;
  }

  NSString *scheme = url.scheme.lowercaseString;
  if (scheme.length == 0) {
    return SWVPolicyDecisionBlockInvalidURL;
  }

  if ([scheme isEqualToString:@"http"] || [scheme isEqualToString:@"https"]) {
    NSString *origin = [self canonicalHTTPOriginForURL:url];
    if (origin == nil) {
      return SWVPolicyDecisionBlockInvalidURL;
    }
    return [allowedOrigins containsObject:origin]
        ? SWVPolicyDecisionLoad
        : SWVPolicyDecisionBlockOriginNotAllowed;
  }

  if (![SWVForbiddenSchemes() containsObject:scheme] &&
      [allowedSchemes containsObject:scheme]) {
    return SWVPolicyDecisionDeepLink;
  }

  return SWVPolicyDecisionBlockSchemeNotAllowed;
}

@end
