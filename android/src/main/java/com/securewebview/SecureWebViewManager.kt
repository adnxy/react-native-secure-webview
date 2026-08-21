package com.securewebview

import com.facebook.react.bridge.ReadableArray
import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.ViewManagerDelegate
import com.facebook.react.uimanager.annotations.ReactProp
import com.facebook.react.viewmanagers.SecureWebViewManagerDelegate
import com.facebook.react.viewmanagers.SecureWebViewManagerInterface

/**
 * Fabric ViewManager for the "SecureWebView" component.
 *
 * Props and commands arrive through the Codegen-generated
 * [SecureWebViewManagerDelegate], which dispatches into the generated
 * [SecureWebViewManagerInterface] implemented here.
 */
@ReactModule(name = SecureWebViewManager.NAME)
class SecureWebViewManager :
  SimpleViewManager<SecureWebView>(), SecureWebViewManagerInterface<SecureWebView> {

  private val delegate: ViewManagerDelegate<SecureWebView> = SecureWebViewManagerDelegate(this)

  override fun getDelegate(): ViewManagerDelegate<SecureWebView> = delegate

  override fun getName(): String = NAME

  override fun createViewInstance(context: ThemedReactContext): SecureWebView =
    SecureWebView(context)

  /** Apply the transaction's prop changes atomically. */
  override fun onAfterUpdateTransaction(view: SecureWebView) {
    super.onAfterUpdateTransaction(view)
    view.commitProps()
  }

  override fun onDropViewInstance(view: SecureWebView) {
    super.onDropViewInstance(view)
    view.onDropped()
  }

  /**
   * Opt out of Fabric view recycling: a WebView carries heavyweight,
   * security-relevant state (session, history, in-flight loads) that must
   * never leak between component instances.
   */
  override fun prepareToRecycleView(
    reactContext: ThemedReactContext,
    view: SecureWebView,
  ): SecureWebView? = null

  // ── Props ──────────────────────────────────────────────────────────────────

  @ReactProp(name = "sourceUri")
  override fun setSourceUri(view: SecureWebView, value: String?) {
    view.setSourceUriProp(value)
  }

  @ReactProp(name = "allowedOrigins")
  override fun setAllowedOrigins(view: SecureWebView, value: ReadableArray?) {
    view.setAllowedOriginsProp(toStringList(value))
  }

  @ReactProp(name = "allowedSchemes")
  override fun setAllowedSchemes(view: SecureWebView, value: ReadableArray?) {
    view.setAllowedSchemesProp(toStringList(value))
  }

  @ReactProp(name = "session")
  override fun setSession(view: SecureWebView, value: String?) {
    view.setSessionProp(value)
  }

  private fun toStringList(value: ReadableArray?): List<String> {
    if (value == null) return emptyList()
    val result = ArrayList<String>(value.size())
    for (i in 0 until value.size()) {
      value.getString(i)?.let(result::add)
    }
    return result
  }

  // ── Commands ───────────────────────────────────────────────────────────────

  override fun reload(view: SecureWebView) = view.reload()

  override fun goBack(view: SecureWebView) = view.goBack()

  override fun goForward(view: SecureWebView) = view.goForward()

  override fun stopLoading(view: SecureWebView) = view.stopLoading()

  // ── Events ─────────────────────────────────────────────────────────────────

  /** Paper-interop mapping; Fabric uses the static view config from Codegen. */
  override fun getExportedCustomDirectEventTypeConstants(): MutableMap<String, Any> =
    mutableMapOf(
      "topNavigation" to mapOf("registrationName" to "onNavigation"),
      "topDeepLink" to mapOf("registrationName" to "onDeepLink"),
      "topMessage" to mapOf("registrationName" to "onMessage"),
      "topError" to mapOf("registrationName" to "onError"),
      "topSecurityViolation" to mapOf("registrationName" to "onSecurityViolation"),
    )

  companion object {
    const val NAME = "SecureWebView"
  }
}
