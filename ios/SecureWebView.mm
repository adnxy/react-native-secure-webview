#import "SecureWebView.h"

#import <WebKit/WebKit.h>

#import <react/renderer/components/SecureWebViewSpec/ComponentDescriptors.h>
#import <react/renderer/components/SecureWebViewSpec/EventEmitters.h>
#import <react/renderer/components/SecureWebViewSpec/Props.h>
#import <react/renderer/components/SecureWebViewSpec/RCTComponentViewHelpers.h>

#import "SecureWebViewPolicy.h"

using namespace facebook::react;

/// Name of the WKScriptMessageHandler backing the Web → RN bridge.
static NSString *const SWVMessageHandlerName = @"secureWebView";

/// The only script this library ever injects: a fixed shim that exposes
/// `window.ReactNativeSecureWebView.postMessage(string)` (the same API the
/// Android JavascriptInterface provides) and nothing else. Installed in the
/// main frame only; the message handler additionally validates the sender
/// frame and its origin.
static NSString *const SWVBridgeScript =
    @"(function () {"
     "  'use strict';"
     "  if (window.ReactNativeSecureWebView) { return; }"
     "  var handler = window.webkit.messageHandlers.secureWebView;"
     "  Object.defineProperty(window, 'ReactNativeSecureWebView', {"
     "    value: Object.freeze({"
     "      postMessage: function (data) {"
     "        if (typeof data !== 'string') {"
     "          throw new TypeError('ReactNativeSecureWebView.postMessage: data must be a string');"
     "        }"
     "        handler.postMessage(data);"
     "      }"
     "    }),"
     "    writable: false,"
     "    configurable: false,"
     "    enumerable: true"
     "  });"
     "})();";

static std::string SWVStdString(NSString *_Nullable string)
{
  return string == nil ? "" : std::string(string.UTF8String ?: "");
}

static NSString *SWVViolationTypeString(SWVPolicyDecision decision)
{
  switch (decision) {
    case SWVPolicyDecisionBlockOriginNotAllowed:
      return @"origin_not_allowed";
    case SWVPolicyDecisionBlockSchemeNotAllowed:
      return @"scheme_not_allowed";
    default:
      return @"invalid_url";
  }
}

#pragma mark - SWVWeakScriptMessageHandler

/// WKUserContentController retains its script message handlers strongly, and
/// the WKWebView (retained by this component) retains the controller. Handing
/// `self` to WebKit directly would therefore create a retain cycle
/// (view → webView → controller → view). This proxy breaks the cycle.
@interface SWVWeakScriptMessageHandler : NSObject <WKScriptMessageHandler>
@property (nonatomic, weak, nullable) id<WKScriptMessageHandler> delegate;
@end

@implementation SWVWeakScriptMessageHandler

- (void)userContentController:(WKUserContentController *)userContentController
      didReceiveScriptMessage:(WKScriptMessage *)message
{
  [self.delegate userContentController:userContentController didReceiveScriptMessage:message];
}

@end

#pragma mark - SecureWebView

@interface SecureWebView () <WKNavigationDelegate,
                             WKUIDelegate,
                             WKScriptMessageHandler,
                             RCTSecureWebViewViewProtocol>
@end

@implementation SecureWebView {
  WKWebView *_Nullable _webView;
  SWVWeakScriptMessageHandler *_Nullable _messageProxy;
  NSSet<NSString *> *_allowedOrigins;
  NSSet<NSString *> *_allowedSchemes;
  NSString *_sourceUri;
  BOOL _ephemeralSession;
  BOOL _webViewCreated;
}

+ (ComponentDescriptorProvider)componentDescriptorProvider
{
  return concreteComponentDescriptorProvider<SecureWebViewComponentDescriptor>();
}

- (instancetype)initWithFrame:(CGRect)frame
{
  if (self = [super initWithFrame:frame]) {
    static const auto defaultProps = std::make_shared<const SecureWebViewProps>();
    _props = defaultProps;
    _allowedOrigins = [NSSet set];
    _allowedSchemes = [NSSet set];
    _sourceUri = @"";
  }
  return self;
}

#pragma mark - Props (Fabric → native)

- (void)updateProps:(Props::Shared const &)props oldProps:(Props::Shared const &)oldProps
{
  const auto &newProps = *std::static_pointer_cast<const SecureWebViewProps>(props);

  NSMutableSet<NSString *> *origins = [NSMutableSet new];
  for (const auto &origin : newProps.allowedOrigins) {
    [origins addObject:[NSString stringWithUTF8String:origin.c_str()]];
  }
  _allowedOrigins = origins;

  NSMutableSet<NSString *> *schemes = [NSMutableSet new];
  for (const auto &scheme : newProps.allowedSchemes) {
    [schemes addObject:[NSString stringWithUTF8String:scheme.c_str()]];
  }
  _allowedSchemes = schemes;

  BOOL ephemeral = newProps.session == SecureWebViewSession::Ephemeral;
  NSString *sourceUri = [NSString stringWithUTF8String:newProps.sourceUri.c_str()];

  // The website data store can only be chosen at WKWebView creation time, so
  // a session change requires a fresh WKWebView (navigation state is lost —
  // that is the point of switching stores).
  BOOL needsFreshWebView = !_webViewCreated || ephemeral != _ephemeralSession;
  _ephemeralSession = ephemeral;
  if (needsFreshWebView) {
    [self destroyWebView];
    [self createWebView];
  }

  BOOL sourceChanged = ![sourceUri isEqualToString:_sourceUri];
  _sourceUri = sourceUri;
  if ((needsFreshWebView || sourceChanged) && _sourceUri.length > 0) {
    [self loadSourceUri];
  }

  [super updateProps:props oldProps:oldProps];
}

#pragma mark - WKWebView lifecycle

- (void)createWebView
{
  WKWebViewConfiguration *configuration = [WKWebViewConfiguration new];
  configuration.websiteDataStore = _ephemeralSession
      ? [WKWebsiteDataStore nonPersistentDataStore]
      : [WKWebsiteDataStore defaultDataStore];

  WKUserContentController *contentController = [WKUserContentController new];
  _messageProxy = [SWVWeakScriptMessageHandler new];
  _messageProxy.delegate = self;
  [contentController addScriptMessageHandler:_messageProxy name:SWVMessageHandlerName];
  [contentController addUserScript:[[WKUserScript alloc] initWithSource:SWVBridgeScript
                                                          injectionTime:WKUserScriptInjectionTimeAtDocumentStart
                                                       forMainFrameOnly:YES]];
  configuration.userContentController = contentController;

  WKWebView *webView = [[WKWebView alloc] initWithFrame:self.bounds configuration:configuration];
  webView.navigationDelegate = self; // held weakly by WKWebView
  webView.UIDelegate = self;         // held weakly by WKWebView
  webView.allowsLinkPreview = NO;
  webView.allowsBackForwardNavigationGestures = NO;

  _webView = webView;
  _webViewCreated = YES;
  self.contentView = webView;
}

- (void)destroyWebView
{
  if (_webView == nil) {
    _messageProxy = nil;
    return;
  }
  [_webView stopLoading];
  [_webView.configuration.userContentController removeScriptMessageHandlerForName:SWVMessageHandlerName];
  [_webView.configuration.userContentController removeAllUserScripts];
  _webView.navigationDelegate = nil;
  _webView.UIDelegate = nil;
  _messageProxy.delegate = nil;
  _messageProxy = nil;
  self.contentView = nil;
  [_webView removeFromSuperview];
  _webView = nil;
  _webViewCreated = NO;
}

/// Fabric recycles ComponentViews. A recycled view must carry no state —
/// especially not a live WKWebView with another screen's session/history.
- (void)prepareForRecycle
{
  [super prepareForRecycle];
  [self destroyWebView];
  _allowedOrigins = [NSSet set];
  _allowedSchemes = [NSSet set];
  _sourceUri = @"";
  _ephemeralSession = NO;
}

#pragma mark - Loading

- (void)loadSourceUri
{
  NSURL *url = [NSURL URLWithString:_sourceUri];
  SWVPolicyDecision decision = [SecureWebViewPolicy decideForURL:url
                                                  allowedOrigins:_allowedOrigins
                                                  allowedSchemes:_allowedSchemes];
  switch (decision) {
    case SWVPolicyDecisionLoad:
      [_webView loadRequest:[NSURLRequest requestWithURL:url]];
      break;
    case SWVPolicyDecisionDeepLink:
      [self emitDeepLinkForURL:url];
      break;
    default:
      [self emitSecurityViolation:decision urlString:_sourceUri];
      break;
  }
}

#pragma mark - Events (native → React)

- (const SecureWebViewEventEmitter *)eventEmitter
{
  return static_cast<const SecureWebViewEventEmitter *>(_eventEmitter.get());
}

- (void)emitNavigationStateWithLoading:(BOOL)loading
{
  const auto *emitter = [self eventEmitter];
  if (emitter == nullptr || _webView == nil) {
    return;
  }
  emitter->onNavigation({
      .url = SWVStdString(_webView.URL.absoluteString),
      .loading = static_cast<bool>(loading),
      .canGoBack = static_cast<bool>(_webView.canGoBack),
      .canGoForward = static_cast<bool>(_webView.canGoForward),
  });
}

- (void)emitDeepLinkForURL:(NSURL *)url
{
  const auto *emitter = [self eventEmitter];
  if (emitter == nullptr) {
    return;
  }
  emitter->onDeepLink({
      .url = SWVStdString(url.absoluteString),
      .scheme = SWVStdString(url.scheme.lowercaseString),
  });
}

- (void)emitSecurityViolation:(SWVPolicyDecision)decision urlString:(NSString *)urlString
{
  const auto *emitter = [self eventEmitter];
  if (emitter == nullptr) {
    return;
  }
  emitter->onSecurityViolation({
      .type = SWVStdString(SWVViolationTypeString(decision)),
      .url = SWVStdString(urlString),
  });
}

#pragma mark - WKNavigationDelegate

- (void)webView:(WKWebView *)webView
    decidePolicyForNavigationAction:(WKNavigationAction *)navigationAction
                    decisionHandler:(void (^)(WKNavigationActionPolicy))decisionHandler
{
  NSURL *url = navigationAction.request.URL;

  // targetFrame == nil means "open in a new window" (window.open or
  // target=_blank). Popups are out of scope and always blocked; see also
  // -webView:createWebViewWithConfiguration:....
  if (navigationAction.targetFrame == nil) {
    decisionHandler(WKNavigationActionPolicyCancel);
    return;
  }

  // Subframe navigations (e.g. a 3DS challenge iframe on the issuer's ACS
  // origin) are page *content*, governed by the trusted page and its CSP —
  // restricting them to `allowedOrigins` would break exactly the flows this
  // component targets. Non-http(s) schemes are still blocked in subframes,
  // so an embedded frame can never trigger a deep link.
  if (!navigationAction.targetFrame.isMainFrame) {
    NSString *scheme = url.scheme.lowercaseString;
    BOOL isHttp = [scheme isEqualToString:@"http"] || [scheme isEqualToString:@"https"];
    decisionHandler(isHttp ? WKNavigationActionPolicyAllow : WKNavigationActionPolicyCancel);
    return;
  }

  // Every top-level navigation — including every server redirect hop — passes
  // through here and is validated against the allowlist.
  SWVPolicyDecision decision = [SecureWebViewPolicy decideForURL:url
                                                  allowedOrigins:_allowedOrigins
                                                  allowedSchemes:_allowedSchemes];
  switch (decision) {
    case SWVPolicyDecisionLoad:
      decisionHandler(WKNavigationActionPolicyAllow);
      break;
    case SWVPolicyDecisionDeepLink:
      decisionHandler(WKNavigationActionPolicyCancel);
      [self emitDeepLinkForURL:url];
      break;
    default:
      decisionHandler(WKNavigationActionPolicyCancel);
      [self emitSecurityViolation:decision urlString:url.absoluteString ?: @""];
      break;
  }
}

- (void)webView:(WKWebView *)webView didStartProvisionalNavigation:(WKNavigation *)navigation
{
  [self emitNavigationStateWithLoading:YES];
}

- (void)webView:(WKWebView *)webView didCommitNavigation:(WKNavigation *)navigation
{
  [self emitNavigationStateWithLoading:YES];
}

- (void)webView:(WKWebView *)webView didFinishNavigation:(WKNavigation *)navigation
{
  [self emitNavigationStateWithLoading:NO];
}

- (void)webView:(WKWebView *)webView
    didFailProvisionalNavigation:(WKNavigation *)navigation
                       withError:(NSError *)error
{
  [self handleLoadError:error];
}

- (void)webView:(WKWebView *)webView didFailNavigation:(WKNavigation *)navigation withError:(NSError *)error
{
  [self handleLoadError:error];
}

- (void)handleLoadError:(NSError *)error
{
  // NSURLErrorCancelled fires for stopLoading and superseded loads;
  // WKErrorFrameLoadInterruptedByPolicyChange (102) fires for our own policy
  // cancellations, which already emitted onDeepLink/onSecurityViolation.
  if ([error.domain isEqualToString:NSURLErrorDomain] && error.code == NSURLErrorCancelled) {
    return;
  }
  if ([error.domain isEqualToString:@"WebKitErrorDomain"] && error.code == 102) {
    return;
  }

  const auto *emitter = [self eventEmitter];
  if (emitter != nullptr) {
    NSString *failingUrl = error.userInfo[NSURLErrorFailingURLStringErrorKey] ?: @"";
    emitter->onError({
        .code = SWVStdString([NSString stringWithFormat:@"ios_%ld", (long)error.code]),
        .message = SWVStdString(error.localizedDescription),
        .url = SWVStdString(failingUrl),
    });
  }
  [self emitNavigationStateWithLoading:NO];
}

/// The web content process died (crash or OS termination under memory
/// pressure). WKWebView shows a blank view afterwards; surface a structured
/// error so the app can decide to reload().
- (void)webViewWebContentProcessDidTerminate:(WKWebView *)webView
{
  const auto *emitter = [self eventEmitter];
  if (emitter != nullptr) {
    emitter->onError({
        .code = "ios_content_process_terminated",
        .message = "The web content process was terminated (crash or memory pressure).",
        .url = SWVStdString(webView.URL.absoluteString),
    });
  }
  [self emitNavigationStateWithLoading:NO];
}

#pragma mark - WKUIDelegate

/// Blocks popups/new windows: returning nil refuses to create the child
/// WKWebView. Content that needs multi-window browsing is out of scope.
- (nullable WKWebView *)webView:(WKWebView *)webView
    createWebViewWithConfiguration:(WKWebViewConfiguration *)configuration
               forNavigationAction:(WKNavigationAction *)navigationAction
                    windowFeatures:(WKWindowFeatures *)windowFeatures
{
  return nil;
}

#pragma mark - WKScriptMessageHandler (Web → RN)

- (void)userContentController:(WKUserContentController *)userContentController
      didReceiveScriptMessage:(WKScriptMessage *)message
{
  if (![message.name isEqualToString:SWVMessageHandlerName]) {
    return;
  }
  // The shim is main-frame-only, but `window.webkit.messageHandlers` is
  // reachable from subframes too — so the sender frame and its origin are
  // validated here rather than trusting the shim.
  if (!message.frameInfo.isMainFrame) {
    return;
  }
  WKSecurityOrigin *origin = message.frameInfo.securityOrigin;
  NSString *canonical = [SecureWebViewPolicy canonicalOriginForScheme:origin.protocol
                                                                 host:origin.host
                                                                 port:origin.port];
  if (canonical == nil || ![_allowedOrigins containsObject:canonical]) {
    return;
  }
  if (![message.body isKindOfClass:[NSString class]]) {
    return;
  }
  const auto *emitter = [self eventEmitter];
  if (emitter != nullptr) {
    emitter->onMessage({.data = SWVStdString((NSString *)message.body)});
  }
}

#pragma mark - Commands (React → native)

- (void)handleCommand:(const NSString *)commandName args:(const NSArray *)args
{
  RCTSecureWebViewHandleCommand(self, commandName, args);
}

- (void)reload
{
  if (_webView == nil) {
    return;
  }
  if (_webView.URL == nil) {
    // Nothing ever loaded (or the initial load was blocked): retry the source.
    if (_sourceUri.length > 0) {
      [self loadSourceUri];
    }
    return;
  }
  [_webView reload];
}

- (void)goBack
{
  // Back/forward navigations re-enter decidePolicyForNavigationAction and are
  // re-validated, so history entries cannot bypass an updated allowlist.
  if (_webView.canGoBack) {
    [_webView goBack];
  }
}

- (void)goForward
{
  if (_webView.canGoForward) {
    [_webView goForward];
  }
}

- (void)stopLoading
{
  [_webView stopLoading];
}

@end
