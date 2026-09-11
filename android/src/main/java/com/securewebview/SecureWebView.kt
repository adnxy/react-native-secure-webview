package com.securewebview

import android.annotation.SuppressLint
import android.annotation.TargetApi
import android.graphics.Bitmap
import android.net.Uri
import android.os.Build
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableMap
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.UIManagerHelper
import java.io.ByteArrayInputStream

/**
 * Native view backing the "SecureWebView" Fabric component.
 *
 * A FrameLayout hosting an android.webkit.WebView (rather than subclassing
 * WebView directly) so the WebView can be created lazily and destroyed
 * deterministically without touching the Fabric-managed view identity.
 *
 * All policy decisions are made natively via [UrlPolicy]: redirects and
 * page-initiated navigations never surface to JS in time to be blocked there.
 */
class SecureWebView(private val reactContext: ThemedReactContext) : FrameLayout(reactContext) {

  companion object {
    /**
     * The single object this library exposes to page JavaScript, injected via
     * [WebViewCompat.addWebMessageListener] — *only* into main frames whose
     * origin is allow-listed. The name matches the iOS user-script shim so web
     * content is platform-agnostic.
     */
    private const val JS_BRIDGE_NAME = "ReactNativeSecureWebView"

    const val ERROR_EPHEMERAL_NOT_SUPPORTED = "ephemeral_not_supported"
    const val ERROR_MESSAGE_BRIDGE_NOT_SUPPORTED = "message_bridge_not_supported"
    const val ERROR_RENDER_PROCESS_GONE = "android_render_process_gone"
  }

  // Read from the WebView network thread in shouldInterceptRequest.
  @Volatile private var allowedOrigins: Set<String> = emptySet()
  @Volatile private var allowedSchemes: Set<String> = emptySet()

  private var sourceUri: String = ""
  private var session: String = "persistent"
  private var webView: WebView? = null
  private var loadedSourceUri: String? = null
  private var dropped = false
  private var emittedEphemeralError = false

  // ── Props (set by SecureWebViewManager, committed in commitProps) ──────────

  fun setSourceUriProp(value: String?) {
    sourceUri = value ?: ""
  }

  fun setAllowedOriginsProp(value: List<String>) {
    allowedOrigins = value.toSet()
  }

  fun setAllowedSchemesProp(value: List<String>) {
    allowedSchemes = value.toSet()
  }

  fun setSessionProp(value: String?) {
    session = value ?: "persistent"
  }

  /**
   * Called from the manager's onAfterUpdateTransaction so a single render's
   * prop changes (e.g. new sourceUri plus new allowlist) are applied
   * atomically instead of in per-prop setter order.
   */
  fun commitProps() {
    if (dropped) return

    if (session == "ephemeral") {
      // Android's cookie store (android.webkit.CookieManager) is process-wide;
      // there is no honest way to give one WebView an isolated, discardable
      // session. Silently clearing shared cookies would corrupt other
      // WebViews, and pretending isolation exists would be a session-leak
      // bug — so this fails closed. See SECURITY.md.
      tearDownWebView()
      if (!emittedEphemeralError) {
        emittedEphemeralError = true
        emitError(
          ERROR_EPHEMERAL_NOT_SUPPORTED,
          "session=\"ephemeral\" is not supported on Android: the platform " +
            "cookie store is process-wide and cannot be isolated per WebView. " +
            "Nothing was loaded.",
          sourceUri,
        )
      }
      return
    }
    emittedEphemeralError = false

    val view = ensureWebView()
    updateMessageBridge(view)
    if (sourceUri.isNotEmpty() && sourceUri != loadedSourceUri) {
      loadedSourceUri = sourceUri
      loadSource()
    }
  }

  // ── Commands (React → native) ──────────────────────────────────────────────

  fun reload() {
    val view = webView ?: return
    if (view.url == null) {
      // Nothing ever loaded (or the initial load was blocked): retry source.
      if (sourceUri.isNotEmpty()) loadSource()
      return
    }
    view.reload()
  }

  fun goBack() {
    val view = webView ?: return
    if (view.canGoBack()) view.goBack()
  }

  fun goForward() {
    val view = webView ?: return
    if (view.canGoForward()) view.goForward()
  }

  fun stopLoading() {
    webView?.stopLoading()
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  /** Called from the manager's onDropViewInstance. */
  fun onDropped() {
    dropped = true
    tearDownWebView()
  }

  private fun tearDownWebView() {
    val view = webView ?: return
    webView = null
    loadedSourceUri = null
    registeredBridgeRules = null
    view.stopLoading()
    removeView(view)
    view.destroy()
  }

  @SuppressLint("SetJavaScriptEnabled")
  private fun ensureWebView(): WebView {
    webView?.let {
      return it
    }
    val view = WebView(context)
    view.settings.apply {
      // Auth/checkout/OAuth pages require script; this does NOT expose any
      // native surface beyond the origin-restricted message bridge (see
      // updateMessageBridge).
      javaScriptEnabled = true
      domStorageEnabled = true

      // Security defaults — deny everything this component does not need.
      mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
      allowFileAccess = false
      allowContentAccess = false
      setSupportMultipleWindows(false) // no popups/new windows
      javaScriptCanOpenWindowsAutomatically = false
      setGeolocationEnabled(false)
    }
    view.webViewClient = PolicyWebViewClient()
    view.layoutParams = LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT)
    addView(view)
    webView = view
    return view
  }

  private fun loadSource() {
    val view = webView ?: return
    when (val decision = UrlPolicy.decide(sourceUri, allowedOrigins, allowedSchemes)) {
      is UrlPolicy.Decision.Load -> view.loadUrl(sourceUri)
      is UrlPolicy.Decision.DeepLink -> emitDeepLink(sourceUri, decision.scheme)
      is UrlPolicy.Decision.Block -> emitViolation(decision.violation, sourceUri)
    }
  }

  // RN lays out this view from the shadow tree; natively-added children (the
  // WebView) still need the standard measure/layout pass relayed to them.
  private val measureAndLayout = Runnable {
    measure(
      MeasureSpec.makeMeasureSpec(width, MeasureSpec.EXACTLY),
      MeasureSpec.makeMeasureSpec(height, MeasureSpec.EXACTLY),
    )
    layout(left, top, right, bottom)
  }

  override fun requestLayout() {
    super.requestLayout()
    post(measureAndLayout)
  }

  // ── Events (native → React) ────────────────────────────────────────────────

  private fun emit(eventName: String, payload: WritableMap) {
    val dispatcher = UIManagerHelper.getEventDispatcherForReactTag(reactContext, id) ?: return
    val surfaceId = UIManagerHelper.getSurfaceId(reactContext)
    dispatcher.dispatchEvent(SecureWebViewEvent(surfaceId, id, eventName, payload))
  }

  private fun emitNavigation(loading: Boolean) {
    val view = webView ?: return
    emit(
      "topNavigation",
      Arguments.createMap().apply {
        putString("url", view.url ?: "")
        putBoolean("loading", loading)
        putBoolean("canGoBack", view.canGoBack())
        putBoolean("canGoForward", view.canGoForward())
      },
    )
  }

  private fun emitDeepLink(url: String, scheme: String) {
    emit(
      "topDeepLink",
      Arguments.createMap().apply {
        putString("url", url)
        putString("scheme", scheme)
      },
    )
  }

  private fun emitMessage(data: String) {
    emit("topMessage", Arguments.createMap().apply { putString("data", data) })
  }

  private fun emitError(code: String, message: String, url: String) {
    emit(
      "topError",
      Arguments.createMap().apply {
        putString("code", code)
        putString("message", message)
        putString("url", url)
      },
    )
  }

  private fun emitViolation(type: String, url: String) {
    emit(
      "topSecurityViolation",
      Arguments.createMap().apply {
        putString("type", type)
        putString("url", url)
      },
    )
  }

  // ── Web → RN bridge ────────────────────────────────────────────────────────

  /** The origin rules the bridge is currently registered with, or null if none. */
  private var registeredBridgeRules: Set<String>? = null
  private var emittedBridgeUnsupported = false

  /**
   * Web → RN messages arrive through [WebViewCompat.addWebMessageListener],
   * which — unlike addJavascriptInterface — injects the page-side object only
   * into frames whose origin matches the allow-listed rules, and reports the
   * sender's frame and origin for every message. Both are enforced here again
   * (defense in depth), matching the iOS WKScriptMessageHandler checks.
   */
  private val messageListener =
    WebViewCompat.WebMessageListener {
      _: WebView,
      message: WebMessageCompat,
      sourceOrigin: Uri,
      isMainFrame: Boolean,
      _: JavaScriptReplyProxy,
      ->
      if (dropped || !isMainFrame) return@WebMessageListener
      val canonical = UrlPolicy.canonicalHttpOrigin(sourceOrigin.toString())
      if (canonical == null || !allowedOrigins.contains(canonical)) return@WebMessageListener
      if (message.type != WebMessageCompat.TYPE_STRING) return@WebMessageListener
      val data = message.data ?: return@WebMessageListener
      emitMessage(data)
    }

  /**
   * (Re-)register the bridge so its origin rules track [allowedOrigins].
   * Canonical origins ("scheme://host:port") are valid WebMessageListener
   * origin rules. Fails closed: if the platform WebView does not support
   * WEB_MESSAGE_LISTENER, no bridge is installed at all and a structured
   * error is emitted once (see SECURITY.md).
   */
  private fun updateMessageBridge(view: WebView) {
    if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
      if (!emittedBridgeUnsupported) {
        emittedBridgeUnsupported = true
        emitError(
          ERROR_MESSAGE_BRIDGE_NOT_SUPPORTED,
          "The system WebView is too old to support origin-restricted web " +
            "messaging (WebViewFeature.WEB_MESSAGE_LISTENER). The " +
            "ReactNativeSecureWebView bridge was not installed (fail closed); " +
            "page content loads normally but onMessage will never fire.",
          sourceUri,
        )
      }
      return
    }

    val rules = allowedOrigins
    if (rules == registeredBridgeRules) return
    if (registeredBridgeRules != null) {
      WebViewCompat.removeWebMessageListener(view, JS_BRIDGE_NAME)
      registeredBridgeRules = null
    }
    if (rules.isEmpty()) return
    try {
      WebViewCompat.addWebMessageListener(view, JS_BRIDGE_NAME, rules, messageListener)
      registeredBridgeRules = rules
    } catch (e: IllegalArgumentException) {
      // A rule was rejected by the platform. Origins are canonicalized in JS,
      // so this should be unreachable — but if it happens, fail closed.
      emitError(
        ERROR_MESSAGE_BRIDGE_NOT_SUPPORTED,
        "The platform rejected a message-bridge origin rule: ${e.message}. " +
          "The bridge was not installed (fail closed).",
        sourceUri,
      )
    }
  }

  // ── Navigation policy enforcement ──────────────────────────────────────────

  private inner class PolicyWebViewClient : WebViewClient() {

    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
      val url = request.url?.toString() ?: return true
      if (!request.isForMainFrame) {
        // Only non-http(s) subframe navigations reach this callback; they are
        // always blocked, so an embedded frame can never trigger a deep link.
        return true
      }
      return when (val decision = UrlPolicy.decide(url, allowedOrigins, allowedSchemes)) {
        is UrlPolicy.Decision.Load -> false
        is UrlPolicy.Decision.DeepLink -> {
          emitDeepLink(url, decision.scheme)
          true
        }
        is UrlPolicy.Decision.Block -> {
          emitViolation(decision.violation, url)
          true
        }
      }
    }

    /**
     * Safety net for main-frame documents. shouldOverrideUrlLoading is not
     * invoked for every navigation (programmatic loads, some redirect paths,
     * history navigations), so disallowed main-frame http(s) documents are
     * additionally blocked here, at request time. Runs on a network thread —
     * it only touches the volatile allowlists and pure policy code.
     */
    override fun shouldInterceptRequest(
      view: WebView,
      request: WebResourceRequest,
    ): WebResourceResponse? {
      if (!request.isForMainFrame) return null
      val url = request.url?.toString() ?: return blockedResponse()
      val scheme = UrlPolicy.parseScheme(url)
      if (scheme != "http" && scheme != "https") {
        // Non-http(s) main-frame navigations are decided in
        // shouldOverrideUrlLoading and never produce resource requests here.
        return null
      }
      val decision = UrlPolicy.decide(url, allowedOrigins, allowedSchemes)
      if (decision is UrlPolicy.Decision.Load) return null
      val violation =
        (decision as? UrlPolicy.Decision.Block)?.violation ?: UrlPolicy.VIOLATION_INVALID
      post { emitViolation(violation, url) }
      return blockedResponse()
    }

    private fun blockedResponse(): WebResourceResponse =
      WebResourceResponse("text/plain", "utf-8", ByteArrayInputStream(ByteArray(0)))

    override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
      emitNavigation(loading = true)
    }

    override fun onPageFinished(view: WebView, url: String?) {
      emitNavigation(loading = false)
    }

    override fun onReceivedError(
      view: WebView,
      request: WebResourceRequest,
      error: WebResourceError,
    ) {
      if (!request.isForMainFrame) return
      emitError(
        "android_${error.errorCode}",
        error.description?.toString() ?: "",
        request.url?.toString() ?: "",
      )
      emitNavigation(loading = false)
    }

    /**
     * The WebView renderer died (crash or OS kill under memory pressure).
     * Returning false — the default — kills the entire app process. Instead,
     * the dead WebView is torn down, a fresh (blank) one is created, and a
     * structured error is emitted; calling reload() re-loads the source.
     */
    @TargetApi(Build.VERSION_CODES.O) // callback only fires on API 26+
    override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
      val failedUrl = view.url ?: sourceUri
      tearDownWebView()
      if (!dropped) {
        val fresh = ensureWebView()
        updateMessageBridge(fresh)
        emitError(
          ERROR_RENDER_PROCESS_GONE,
          if (detail.didCrash()) {
            "The WebView renderer process crashed."
          } else {
            "The WebView renderer process was killed by the system " +
              "(likely memory pressure)."
          },
          failedUrl,
        )
      }
      return true
    }
  }
}
