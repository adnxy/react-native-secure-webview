package com.securewebview

import com.facebook.react.bridge.WritableMap
import com.facebook.react.uimanager.events.Event

/**
 * A direct event dispatched to Fabric. The event name must use the "topX"
 * convention ("topNavigation" ...); the generated view config maps it to the
 * matching "onX" prop from the Codegen spec.
 */
internal class SecureWebViewEvent(
  surfaceId: Int,
  viewId: Int,
  private val name: String,
  private val payload: WritableMap,
) : Event<SecureWebViewEvent>(surfaceId, viewId) {

  override fun getEventName(): String = name

  override fun getEventData(): WritableMap = payload
}
