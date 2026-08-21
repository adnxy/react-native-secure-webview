#import <React/RCTViewComponentView.h>
#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

/// Fabric ComponentView for the "SecureWebView" component. Hosts a WKWebView
/// and enforces the origin/scheme navigation policy natively (redirects never
/// reach JS, so enforcement cannot live there).
@interface SecureWebView : RCTViewComponentView

@end

NS_ASSUME_NONNULL_END
