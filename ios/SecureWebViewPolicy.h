#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/// Mirror of the navigation policy specified in `src/policy.ts`.
/// Keep the two implementations (and android/UrlPolicy.kt) in sync; the
/// TypeScript module is the reference and carries the exhaustive test suite.
typedef NS_ENUM(NSInteger, SWVPolicyDecision) {
  SWVPolicyDecisionLoad,
  SWVPolicyDecisionDeepLink,
  SWVPolicyDecisionBlockOriginNotAllowed,
  SWVPolicyDecisionBlockSchemeNotAllowed,
  SWVPolicyDecisionBlockInvalidURL,
};

@interface SecureWebViewPolicy : NSObject

/// Canonical "scheme://host:port" (lowercase, explicit effective port) for an
/// http(s) URL, or nil when the URL is not unambiguously parseable. nil means
/// "block".
+ (nullable NSString *)canonicalHTTPOriginForURL:(nullable NSURL *)url;

/// Canonicalizes origin components as reported by WKSecurityOrigin, where a
/// port of 0 means "default for the scheme".
+ (nullable NSString *)canonicalOriginForScheme:(NSString *)scheme
                                           host:(NSString *)host
                                           port:(NSInteger)port;

/// The navigation decision for a top-level navigation. `allowedOrigins` must
/// contain canonical origins (the JS layer guarantees this for props).
+ (SWVPolicyDecision)decideForURL:(nullable NSURL *)url
                   allowedOrigins:(NSSet<NSString *> *)allowedOrigins
                   allowedSchemes:(NSSet<NSString *> *)allowedSchemes;

@end

NS_ASSUME_NONNULL_END
