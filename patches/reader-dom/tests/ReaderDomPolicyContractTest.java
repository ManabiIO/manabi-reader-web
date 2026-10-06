// SPDX-License-Identifier: BSD-3-Clause
package expo.modules.webview;

import java.util.Objects;

/** Runs the exact patched JVM URL policy without an Android device or third-party test runtime. */
public final class ReaderDomPolicyContractTest {
  private static final String HASH = "0123456789abcdef0123456789abcdef";
  private static final String FILE = "file:///android_asset/www.bundle/" + HASH + ".html";
  private static final String ROOT = ReaderDomPolicy.ORIGIN + "/www.bundle/" + HASH + ".html";
  private static int assertions;
  private static ReaderDomPolicy reader() {
    ReaderDomPolicy policy = new ReaderDomPolicy(false, null);
    equal(ROOT, policy.setEntry(FILE));
    return policy;
  }
  private static void equal(Object expected, Object actual) {
    assertions++;
    if (!Objects.equals(expected, actual)) throw new AssertionError("Expected " + expected + " but received " + actual);
  }
  private static void reject(Runnable action) {
    assertions++;
    try { action.run(); } catch (IllegalArgumentException expected) { return; }
    throw new AssertionError("Expected a fail-closed rejection");
  }
  public static void main(String[] args) {
    ReaderDomPolicy policy = reader();
    equal(ROOT, reader().getEntry().toString());
    String next = new ReaderDomPolicy(false, null).setEntry(FILE.replace(HASH, "f".repeat(32)));
    equal(ReaderDomPolicy.ORIGIN, ReaderDomPolicy.origin(ReaderDomPolicy.parse(next)));
    equal(true, policy.isEntry(ROOT + "#cfi"));
    equal(false, policy.isEntry(ROOT + "?changed=1"));
    equal(false, policy.isEntry(null));
    reject(() -> policy.setEntry(FILE.replace(HASH, "f".repeat(32))));
    reject(() -> new ReaderDomPolicy(false, "http://localhost:8081"));
    for (String source : new String[] { ROOT, "https://manabi.io/a.html", "http://localhost:8081/_expo/@dom?file=x",
      "file:///data/data/io.manabi.reader/a.html", "file:///android_asset/secrets.html", "file://evil/android_asset/www.bundle/" + HASH + ".html",
      FILE + "?query", FILE + "#hash", FILE.replace(HASH, "%2e%2e/a"), "data:text/html,x", "javascript:alert(1)" }) {
      reject(() -> new ReaderDomPolicy(false, null).setEntry(source));
    }
    String metro = "http://localhost:8081/_expo/@dom/reader?file=file%3A%2F%2F%2Fapp%2Freader.tsx";
    ReaderDomPolicy debug = new ReaderDomPolicy(true, "http://localhost:8081");
    equal(metro, debug.setEntry(metro));
    equal(true, debug.acceptsMessage("http://localhost:8081", true, metro));
    equal(false, debug.acceptsMessage("http://localhost:8082", true, metro));
    reject(() -> new ReaderDomPolicy(true, null).setEntry(metro));
    for (String origin : new String[] { "*", "https://user:secret@localhost:8081", "https://localhost:8081/path",
      ReaderDomPolicy.ORIGIN, "https://localhost:8081?x=1", "file:///tmp", "https://localhost:0", "https://localhost:65536" }) {
      reject(() -> new ReaderDomPolicy(true, origin));
    }
    for (String source : new String[] { "http://localhost:8082/_expo/@dom", "http://evil.test/_expo/@dom", "http://localhost:8081/other" }) {
      reject(() -> new ReaderDomPolicy(true, "http://localhost:8081").setEntry(source));
    }
    for (String asset : new String[] { "_expo/static/js/web/worker-0123.js", "manabitan/revision/worker.mjs",
      "manabitan/revision/sqlite.wasm", "manabitan/revision/corresponding-source.tar.gz", "icons/icon.svg", "fonts/日本語.woff2" }) {
      equal(asset, policy.assetPath(ReaderDomPolicy.ORIGIN + "/www.bundle/" + asset));
    }
    for (String path : new String[] { "../secret", "%2e%2e/secret", "%2E%2E%2Fsecret", "%252e%252e/secret",
      "foo%2f..%2fsecret", "foo%5csecret", "foo%00secret", "/secret", "foo/./bar", "foo//bar", "", "foo/", "foo%7Fbar" }) {
      equal(null, policy.assetPath(ReaderDomPolicy.ORIGIN + "/www.bundle/" + path));
    }
    for (String url : new String[] { ReaderDomPolicy.ORIGIN + "/other/a.js", "https://evil.test/www.bundle/a.js",
      "https://user:secret@appassets.androidplatform.net/www.bundle/a.js", "file:///android_asset/www.bundle/a.js",
      "https://appassets.androidplatform.net:444/www.bundle/a.js", "https://appassets.androidplatform.net.evil.test/www.bundle/a.js" }) {
      equal(null, policy.assetPath(url));
    }
    for (String url : new String[] { ROOT, "http://appassets.androidplatform.net/a", "https://appassets.androidplatform.net:444/a",
      "https://user:secret@appassets.androidplatform.net/a", "https://appassets.androidplatform.net./a" }) equal(true, policy.isAssetHost(url));
    equal(false, policy.isAssetHost("https://appassets.androidplatform.net.evil.test/a"));
    equal(true, policy.acceptsMessage(ReaderDomPolicy.ORIGIN, true, ROOT));
    equal(false, policy.acceptsMessage(ReaderDomPolicy.ORIGIN, false, ROOT));
    equal(false, policy.acceptsMessage("https://evil.test", true, ROOT));
    equal(false, policy.acceptsMessage("null", true, ROOT));
    equal(false, policy.acceptsMessage(ReaderDomPolicy.ORIGIN, true, ReaderDomPolicy.ORIGIN + "/www.bundle/other.html"));
    equal(false, policy.acceptsMessage(ReaderDomPolicy.ORIGIN, true, "https://evil.test"));
    for (String url : new String[] { "https://evil.test", "javascript:alert(1)", "data:text/html,x", "file:///etc/passwd",
      ReaderDomPolicy.ORIGIN + "/www.bundle/other.html" }) equal(false, policy.isEntry(url));
    equal(true, policy.isExternal("https://example.com/a"));
    equal(true, policy.isExternal("http://example.com/a"));
    equal(false, debug.isExternal(metro));
    for (String url : new String[] { "https://user:secret@example.com", "https://@example.com", "javascript:alert(1)",
      "file:///etc/passwd", "intent://example.com", ROOT, "http://appassets.androidplatform.net/a", "https://appassets.androidplatform.net./a", "https://example.com:0" }) {
      equal(false, policy.isExternal(url));
    }
    System.out.println("ReaderDomPolicy: " + assertions + " executable assertions passed");
  }
}
