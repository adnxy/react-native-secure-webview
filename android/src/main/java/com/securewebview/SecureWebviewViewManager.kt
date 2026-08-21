package com.securewebview

import android.graphics.Color
import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.ViewManagerDelegate
import com.facebook.react.uimanager.annotations.ReactProp
import com.facebook.react.viewmanagers.SecureWebviewViewManagerInterface
import com.facebook.react.viewmanagers.SecureWebviewViewManagerDelegate

@ReactModule(name = SecureWebviewViewManager.NAME)
class SecureWebviewViewManager : SimpleViewManager<SecureWebviewView>(),
  SecureWebviewViewManagerInterface<SecureWebviewView> {
  private val mDelegate: ViewManagerDelegate<SecureWebviewView>

  init {
    mDelegate = SecureWebviewViewManagerDelegate(this)
  }

  override fun getDelegate(): ViewManagerDelegate<SecureWebviewView>? {
    return mDelegate
  }

  override fun getName(): String {
    return NAME
  }

  public override fun createViewInstance(context: ThemedReactContext): SecureWebviewView {
    return SecureWebviewView(context)
  }

  @ReactProp(name = "color")
  override fun setColor(view: SecureWebviewView?, color: Int?) {
    view?.setBackgroundColor(color ?: Color.TRANSPARENT)
  }

  companion object {
    const val NAME = "SecureWebviewView"
  }
}
