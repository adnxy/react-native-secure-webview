package com.securewebview

/**
 * Mirror of the navigation policy specified in `src/policy.ts`. Keep the
 * implementations (and ios/SecureWebViewPolicy.mm) in sync; the TypeScript
 * module is the reference and carries the exhaustive test suite.
 *
 * Parsing is deliberately string-based and strict: anything ambiguous
 * (credentials, backslashes, control characters, non-ASCII hosts, trailing
 * dots) is rejected — blocked — rather than interpreted.
 */
internal object UrlPolicy {

  sealed class Decision {
    object Load : Decision()

    data class DeepLink(val scheme: String) : Decision()

    /** [violation] is the wire value for the onSecurityViolation `type`. */
    data class Block(val violation: String) : Decision()
  }

  const val VIOLATION_ORIGIN = "origin_not_allowed"
  const val VIOLATION_SCHEME = "scheme_not_allowed"
  const val VIOLATION_INVALID = "invalid_url"

  /** Mirrors FORBIDDEN_CUSTOM_SCHEMES in src/policy.ts. */
  private val FORBIDDEN_SCHEMES =
    setOf(
      "http",
      "https",
      "javascript",
      "data",
      "blob",
      "file",
      "filesystem",
      "about",
      "ws",
      "wss",
      "content",
      "intent",
    )

  private val SCHEME_RE = Regex("^([a-zA-Z][a-zA-Z0-9+.-]*):")
  private val HOST_RE = Regex("^[a-z0-9-]+(\\.[a-z0-9-]+)*$")
  private val IPV6_HOST_RE = Regex("^\\[[0-9a-f:.]+]$")
  private val PORT_RE = Regex("^[0-9]{1,5}$")

  private fun hasForbiddenChars(url: String): Boolean {
    if (url.isEmpty()) return true
    return url.any { c ->
      c.code <= 0x20 || c.code == 0x7f || c.code > 0x7e || c == '\\'
    }
  }

  fun parseScheme(url: String): String? {
    if (hasForbiddenChars(url)) return null
    return SCHEME_RE.find(url)?.groupValues?.get(1)?.lowercase()
  }

  /**
   * Canonical "scheme://host:port" for an http(s) URL, or null — meaning
   * "block" — for anything not unambiguously `scheme://host[:port]`.
   */
  fun canonicalHttpOrigin(url: String): String? {
    val scheme = parseScheme(url)
    if (scheme != "http" && scheme != "https") return null

    val afterScheme = url.substring(scheme.length + 1)
    if (!afterScheme.startsWith("//")) return null

    var authority = afterScheme.substring(2)
    val cut = authority.indexOfFirst { it == '/' || it == '?' || it == '#' }
    var rest = ""
    if (cut != -1) {
      rest = authority.substring(cut)
      authority = authority.substring(0, cut)
    }

    // Reject embedded credentials outright ("https://good.com@evil.com").
    if (authority.contains('@')) return null

    val host: String
    var portStr: String? = null

    if (authority.startsWith("[")) {
      // IPv6 literal; matched textually, equivalent spellings not normalized.
      val close = authority.indexOf(']')
      if (close == -1) return null
      host = authority.substring(0, close + 1).lowercase()
      val afterHost = authority.substring(close + 1)
      when {
        afterHost.startsWith(":") -> portStr = afterHost.substring(1)
        afterHost.isNotEmpty() -> return null
      }
      if (!IPV6_HOST_RE.matches(host)) return null
    } else {
      val colon = authority.indexOf(':')
      if (colon != -1) {
        if (authority.indexOf(':', colon + 1) != -1) return null
        host = authority.substring(0, colon).lowercase()
        portStr = authority.substring(colon + 1)
      } else {
        host = authority.lowercase()
      }
      // Strict host; rejects empty labels and leading/trailing dots
      // ("example.com." is a classic allowlist bypass).
      if (!HOST_RE.matches(host)) return null
    }

    val port: Int =
      if (portStr != null) {
        if (!PORT_RE.matches(portStr)) return null
        val parsed = portStr.toInt()
        if (parsed < 1 || parsed > 65535) return null
        parsed
      } else {
        if (scheme == "https") 443 else 80
      }

    // Allowlist-style entries must be bare origins, but navigation URLs may
    // carry a path — callers only receive the canonical origin either way.
    @Suppress("UNUSED_EXPRESSION") rest
    return "$scheme://$host:$port"
  }

  /**
   * The navigation decision for a top-level navigation. [allowedOrigins] must
   * contain canonical origins (the JS layer guarantees this for props).
   */
  fun decide(
    url: String,
    allowedOrigins: Set<String>,
    allowedSchemes: Set<String>,
  ): Decision {
    // The initial blank document is inert and required for setup/teardown.
    if (url == "about:blank") return Decision.Load

    val scheme = parseScheme(url) ?: return Decision.Block(VIOLATION_INVALID)

    if (scheme == "http" || scheme == "https") {
      val origin = canonicalHttpOrigin(url) ?: return Decision.Block(VIOLATION_INVALID)
      return if (allowedOrigins.contains(origin)) {
        Decision.Load
      } else {
        Decision.Block(VIOLATION_ORIGIN)
      }
    }

    if (!FORBIDDEN_SCHEMES.contains(scheme) && allowedSchemes.contains(scheme)) {
      return Decision.DeepLink(scheme)
    }

    return Decision.Block(VIOLATION_SCHEME)
  }
}
