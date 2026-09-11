package com.securewebview

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Parity tests for the Kotlin mirror of `src/policy.ts`. The TypeScript suite
 * (src/__tests__/policy.test.ts) is the reference; every security-relevant
 * vector there must behave identically here. If a case is added on one side,
 * add it on the other.
 */
class UrlPolicyTest {

  private val origins = setOf("https://checkout.example.com:443", "http://localhost:8087")
  private val schemes = setOf("myapp")

  private fun decide(url: String) = UrlPolicy.decide(url, origins, schemes)

  // ── parseScheme ────────────────────────────────────────────────────────────

  @Test
  fun `extracts lowercase schemes`() {
    assertEquals("https", UrlPolicy.parseScheme("https://a.com"))
    assertEquals("https", UrlPolicy.parseScheme("HTTPS://a.com"))
    assertEquals("myapp", UrlPolicy.parseScheme("MyApp://x"))
    assertEquals("a+b.c-d", UrlPolicy.parseScheme("a+b.c-d://x"))
  }

  @Test
  fun `rejects strings without a scheme`() {
    assertNull(UrlPolicy.parseScheme(""))
    assertNull(UrlPolicy.parseScheme("no-scheme"))
    assertNull(UrlPolicy.parseScheme("//example.com"))
    assertNull(UrlPolicy.parseScheme("1abc://x"))
  }

  @Test
  fun `rejects forbidden characters anywhere in the URL`() {
    assertNull(UrlPolicy.parseScheme("https://exa mple.com"))
    assertNull(UrlPolicy.parseScheme("https://example.com\t.evil.com"))
    assertNull(UrlPolicy.parseScheme("https://example.com\n"))
    assertNull(UrlPolicy.parseScheme("https://evil.com\\@example.com"))
    assertNull(UrlPolicy.parseScheme("https://ex\u0000ample.com"))
    assertNull(UrlPolicy.parseScheme("https://ex\u00e4mple.com"))
  }

  // ── canonicalHttpOrigin ────────────────────────────────────────────────────

  @Test
  fun `applies default ports and lowercases`() {
    assertEquals(
      "https://example.com:443",
      UrlPolicy.canonicalHttpOrigin("https://example.com"),
    )
    assertEquals("http://example.com:80", UrlPolicy.canonicalHttpOrigin("http://example.com"))
    assertEquals(
      "https://example.com:443",
      UrlPolicy.canonicalHttpOrigin("HTTPS://EXAMPLE.COM/Path"),
    )
  }

  @Test
  fun `parses explicit ports including leading zeros`() {
    assertEquals(
      "https://example.com:8443",
      UrlPolicy.canonicalHttpOrigin("https://example.com:8443"),
    )
    assertEquals(
      "https://example.com:443",
      UrlPolicy.canonicalHttpOrigin("https://example.com:0443"),
    )
  }

  @Test
  fun `rejects invalid ports`() {
    assertNull(UrlPolicy.canonicalHttpOrigin("https://example.com:0"))
    assertNull(UrlPolicy.canonicalHttpOrigin("https://example.com:65536"))
    assertNull(UrlPolicy.canonicalHttpOrigin("https://example.com:123456"))
    assertNull(UrlPolicy.canonicalHttpOrigin("https://example.com:port"))
    assertNull(UrlPolicy.canonicalHttpOrigin("https://example.com:"))
    assertNull(UrlPolicy.canonicalHttpOrigin("https://example.com:-1"))
  }

  @Test
  fun `rejects embedded credentials`() {
    assertNull(UrlPolicy.canonicalHttpOrigin("https://user@example.com"))
    assertNull(UrlPolicy.canonicalHttpOrigin("https://user:pass@example.com"))
    assertNull(UrlPolicy.canonicalHttpOrigin("https://checkout.example.com@evil.com/"))
  }

  @Test
  fun `rejects non-authority and malformed hosts`() {
    assertNull(UrlPolicy.canonicalHttpOrigin("https:example.com"))
    assertNull(UrlPolicy.canonicalHttpOrigin("https:/example.com"))
    assertNull(UrlPolicy.canonicalHttpOrigin("https://"))
    assertNull(UrlPolicy.canonicalHttpOrigin("https:///path"))
    assertNull(UrlPolicy.canonicalHttpOrigin("https://example..com"))
    assertNull(UrlPolicy.canonicalHttpOrigin("https://.example.com"))
    assertNull(UrlPolicy.canonicalHttpOrigin("https://example.com."))
    assertNull(UrlPolicy.canonicalHttpOrigin("https://example.com.:443"))
    assertNull(UrlPolicy.canonicalHttpOrigin("https://exa_mple.com"))
  }

  @Test
  fun `handles IPv6 literals textually`() {
    assertEquals("https://[::1]:443", UrlPolicy.canonicalHttpOrigin("https://[::1]"))
    assertEquals("https://[::1]:8443", UrlPolicy.canonicalHttpOrigin("https://[::1]:8443"))
    assertNull(UrlPolicy.canonicalHttpOrigin("https://[::1"))
    assertNull(UrlPolicy.canonicalHttpOrigin("https://[zz::1]"))
  }

  // ── decide ─────────────────────────────────────────────────────────────────

  @Test
  fun `loads allow-listed origins with any path`() {
    assertEquals(UrlPolicy.Decision.Load, decide("https://checkout.example.com/pay?x=1#f"))
    assertEquals(UrlPolicy.Decision.Load, decide("https://checkout.example.com:443/"))
    assertEquals(UrlPolicy.Decision.Load, decide("http://localhost:8087/index.html"))
    assertEquals(UrlPolicy.Decision.Load, decide("about:blank"))
  }

  @Test
  fun `blocks other origins`() {
    val block = UrlPolicy.Decision.Block(UrlPolicy.VIOLATION_ORIGIN)
    assertEquals(block, decide("https://evil.com/"))
    assertEquals(block, decide("http://checkout.example.com/")) // scheme downgrade
    assertEquals(block, decide("https://checkout.example.com:8443/")) // other port
    assertEquals(block, decide("https://sub.checkout.example.com/")) // subdomain
    assertEquals(block, decide("https://checkout.example.com.evil.com/")) // suffix trick
    assertEquals(block, decide("https://evil.com/checkout.example.com")) // path trick
  }

  @Test
  fun `blocks lookalike and hostile URLs as invalid`() {
    val invalid = UrlPolicy.Decision.Block(UrlPolicy.VIOLATION_INVALID)
    assertEquals(invalid, decide("https://checkout.example.com@evil.com/"))
    assertEquals(invalid, decide("https://checkout.example.com\\.evil.com"))
    assertEquals(invalid, decide("https://checkout.example.com%00.evil.com"))
    assertEquals(invalid, decide("https://checkout.example.com./"))
    assertEquals(invalid, decide("https:evil.com"))
    assertEquals(invalid, decide(""))
  }

  @Test
  fun `intercepts allow-listed custom schemes as deep links`() {
    assertEquals(UrlPolicy.Decision.DeepLink("myapp"), decide("myapp://payment/complete?id=1"))
    assertEquals(UrlPolicy.Decision.DeepLink("myapp"), decide("MYAPP://x"))
  }

  @Test
  fun `blocks unknown and forbidden schemes`() {
    val block = UrlPolicy.Decision.Block(UrlPolicy.VIOLATION_SCHEME)
    assertEquals(block, decide("otherapp://x"))
    assertEquals(block, decide("javascript:alert(1)"))
    assertEquals(block, decide("data:text/html,hi"))
    assertEquals(block, decide("file:///etc/passwd"))
    assertEquals(block, decide("intent://scan#Intent;scheme=zxing;end"))
    assertEquals(block, decide("about:srcdoc"))
  }

  @Test
  fun `forbidden schemes stay blocked even if allow-listed`() {
    val hostile = setOf("javascript", "data", "file", "intent", "content")
    for (scheme in hostile) {
      val decision = UrlPolicy.decide("$scheme:payload", origins, hostile)
      assertEquals(
        "scheme '$scheme' must never be deep-linkable",
        UrlPolicy.Decision.Block(UrlPolicy.VIOLATION_SCHEME),
        decision,
      )
    }
  }
}
