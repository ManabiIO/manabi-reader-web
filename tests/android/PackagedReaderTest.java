/* SPDX-License-Identifier: BSD-3-Clause */
package io.manabi.reader.qualification;

import static org.junit.Assert.*;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.os.Build;
import android.os.Bundle;
import android.os.SystemClock;
import android.util.Log;
import android.view.View;
import android.view.ViewGroup;
import android.view.accessibility.AccessibilityNodeInfo;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.TextView;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONArray;
import org.json.JSONObject;
import org.json.JSONTokener;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Tests the actual Expo activity's packaged host, never a replacement WebView. */
@RunWith(AndroidJUnit4.class)
public final class PackagedReaderTest {
  private static final String ORIGIN = "https://appassets.androidplatform.net";
  private static final String RESULT = "__manabiAndroidQualificationResult";
  private final Instrumentation instrumentation = InstrumentationRegistry.getInstrumentation();
  private final JSONObject evidence = new JSONObject();
  private ActivityScenario<Activity> scenario;
  private WebView reader;
  private String entry;
  private String probe;
  private JSONObject config;

  @Test public void packagedReaderRuntime() throws Exception {
    Context target = instrumentation.getTargetContext();
    assertEquals("io.manabi.reader", target.getPackageName());
    assertEquals("Use the embedded, non-debuggable release APK", 0,
        target.getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE);
    assertTrue("This synthetic-storage qualification is for a disposable emulator only",
        Build.MODEL.contains("sdk_gphone") || Build.MODEL.contains("Emulator")
        || Build.MODEL.contains("Android SDK built for"));
    assertTrue("Qualification requires API 28 or later", Build.VERSION.SDK_INT >= 28);
    Bundle args = InstrumentationRegistry.getArguments();
    String phase = args.getString("qualificationPhase", "full");
    assertTrue("Unknown qualification phase", phase.equals("full") || phase.equals("seed") || phase.equals("verify"));
    String id = args.getString("qualificationId");
    if (id == null && phase.equals("full")) id = UUID.randomUUID().toString().replace("-", "");
    assertTrue("Supply the same 32-hex qualificationId for seed/verify", id != null && id.matches("[a-f0-9]{32}"));
    config = new JSONObject(readAsset("config.json")).put("id", id);
    probe = readAsset("probe.js").trim();
    if (probe.endsWith(";")) probe = probe.substring(0, probe.length() - 1);
    evidence.put("schema", 1).put("phase", phase).put("id", id)
        .put("sdk", Build.VERSION.SDK_INT).put("model", Build.MODEL)
        .put("target", target.getPackageName()).put("targetDebuggable", false)
        .put("processId", android.os.Process.myPid());
    boolean preserve = false;
    try {
      Intent intent = target.getPackageManager().getLaunchIntentForPackage(target.getPackageName());
      assertNotNull("The generated Expo launcher activity is missing", intent);
      scenario = ActivityScenario.launch(intent);
      reader = awaitReader();
      entry = readUrl();
      awaitReady();
      awaitNativeLibraryReply();
      qualifyNativeFontManager();
      evidence.put("entry", entry).put("nativeSettings", nativeSettings());
      if (phase.equals("verify")) {
        evidence.put("afterProcessRestart", runProbe("verify"));
      } else {
        evidence.put("initial", runProbe("seed"));
        // Reload the actual host, retaining both its settings and canonical origin.
        evaluate("window.__manabiDocumentBeforeReload = true; true;");
        instrumentation.runOnMainSync(() -> reader.reload());
        awaitReady(true);
        evidence.put("afterReload", runProbe("verify"));
        evidence.put("navigation", navigationRestrictions());
        preserve = phase.equals("seed");
      }
      evidence.put("passed", true);
    } catch (Throwable failure) {
      evidence.put("passed", false).put("error", failure.toString());
      throw failure;
    } finally {
      if (reader != null && !preserve) {
        try { evidence.put("cleanup", runProbe("cleanup")); }
        catch (Throwable cleanupFailure) {
          evidence.put("cleanupError", cleanupFailure.toString());
          // Report cleanup failure as a test failure, not a silently successful run.
          if (evidence.optBoolean("passed")) {
            evidence.put("passed", false);
            emitEvidence();
            if (scenario != null) scenario.close();
            throw new AssertionError("Test-owned sentinel cleanup failed", cleanupFailure);
          }
        }
      }
      emitEvidence();
      if (scenario != null) scenario.close();
    }
  }

  private String readAsset(String name) throws Exception {
    try (InputStream stream = instrumentation.getContext().getAssets().open("manabi-qualification/" + name);
         ByteArrayOutputStream out = new ByteArrayOutputStream()) {
      byte[] bytes = new byte[8192];
      int length;
      while ((length = stream.read(bytes)) >= 0) out.write(bytes, 0, length);
      return out.toString(StandardCharsets.UTF_8.name());
    }
  }

  private WebView awaitReader() {
    long deadline = SystemClock.uptimeMillis() + 90000;
    List<String> seen = new ArrayList<>();
    while (SystemClock.uptimeMillis() < deadline) {
      AtomicReference<WebView> found = new AtomicReference<>();
      scenario.onActivity(activity -> {
        List<WebView> views = new ArrayList<>();
        collectWebViews(activity.getWindow().getDecorView(), views);
        for (WebView view : views) {
          String url = view.getUrl();
          if (url != null && !seen.contains(url)) seen.add(url);
          if (url != null && url.matches("https://appassets\\.androidplatform\\.net/www\\.bundle/[a-f0-9]{32}\\.html(?:#.*)?")) {
            assertNull("Expected one persistent reader WebView", found.get());
            found.set(view);
          }
        }
      });
      if (found.get() != null) return found.get();
      SystemClock.sleep(200);
    }
    throw new AssertionError("Actual activity never mounted a canonical packaged reader WebView. URLs: " + seen);
  }

  private void collectWebViews(View view, List<WebView> result) {
    if (view instanceof WebView) result.add((WebView) view);
    if (view instanceof ViewGroup) {
      ViewGroup group = (ViewGroup) view;
      for (int index = 0; index < group.getChildCount(); index++) collectWebViews(group.getChildAt(index), result);
    }
  }

  private void awaitReady() throws Exception { awaitReady(false); }

  private void awaitReady(boolean afterReload) throws Exception {
    long deadline = SystemClock.uptimeMillis() + 90000;
    while (SystemClock.uptimeMillis() < deadline) {
      String ready = evaluate("Boolean(" + (afterReload ? "!window.__manabiDocumentBeforeReload && " : "") + "document.readyState === 'complete' && "
          + "document.getElementById('manabi-packaged-fonts') !== null && "
          + "typeof window.ReactNativeWebView?.postMessage === 'function')");
      if ("true".equals(ready)) {
        assertEquals("The trusted root changed", entry, readUrl());
        return;
      }
      SystemClock.sleep(200);
    }
    throw new AssertionError("Actual packaged DOM app/bridge did not become ready. URL=" + readUrl());
  }

  /** Home can reach Library only after onSnapshot crosses into native; its
   * non-fallback pagination text requires a real library.state/onReply roundtrip.
   * Do not infer bridge readiness merely from the JavaScript shim existing.
   */
  private void awaitNativeLibraryReply() throws Exception {
    long deadline = SystemClock.uptimeMillis() + 90000;
    List<String> last = new ArrayList<>();
    while (SystemClock.uptimeMillis() < deadline) {
      last.clear();
      scenario.onActivity(activity -> collectNativeText(activity.getWindow().getDecorView(), last));
      if (last.contains("Library") && last.contains("0–0 of 0")) {
        evidence.put("nativeRoundTrip", "snapshot-route-and-library-state-reply");
        return;
      }
      SystemClock.sleep(200);
    }
    throw new AssertionError("Native Library never received its empty saved-state reply: " + last);
  }

  /** Read-only product UI smoke on the actual RN/Compose hierarchy. No real font
   * file is selected and no built-in preference is changed by this journey. */
  private void qualifyNativeFontManager() throws Exception {
    clickAccessibleText("Settings");
    clickAccessibleText("Fonts & text");
    clickAccessibleText("Manage Primary / Serif font files");
    awaitAccessibleText("No stored custom fonts. Built-in fonts remain available in Settings.");
    clickAccessibleText("Close font manager");
    clickAccessibleText("Library");
    awaitNativeLibraryReply();
    evidence.put("nativeFontManager", "settings-typography-font-cache-read-and-close");
  }

  private void clickAccessibleText(String text) throws Exception {
    long deadline = SystemClock.uptimeMillis() + 45000;
    while (SystemClock.uptimeMillis() < deadline) {
      AccessibilityNodeInfo root = instrumentation.getUiAutomation().getRootInActiveWindow();
      if (root != null) {
        for (AccessibilityNodeInfo match : findAccessibleText(root, text)) {
          if (!text.contentEquals(match.getText() == null ? "" : match.getText()) &&
              !text.contentEquals(match.getContentDescription() == null ? "" : match.getContentDescription())) continue;
          match.performAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_SHOW_ON_SCREEN.getId());
          AccessibilityNodeInfo action = match;
          for (int depth = 0; action != null && depth < 6; depth++, action = action.getParent()) {
            if (action.isVisibleToUser() && action.isEnabled() && action.isClickable() &&
                action.performAction(AccessibilityNodeInfo.ACTION_CLICK)) return;
          }
        }
        scrollNativeForward(root);
      }
      SystemClock.sleep(200);
    }
    throw new AssertionError("Actual native control was not reachable: " + text);
  }

  private void awaitAccessibleText(String text) throws Exception {
    long deadline = SystemClock.uptimeMillis() + 45000;
    while (SystemClock.uptimeMillis() < deadline) {
      AccessibilityNodeInfo root = instrumentation.getUiAutomation().getRootInActiveWindow();
      if (root != null) for (AccessibilityNodeInfo match : findAccessibleText(root, text)) {
        if (match.isVisibleToUser() && text.contentEquals(match.getText() == null ? "" : match.getText())) return;
      }
      SystemClock.sleep(200);
    }
    throw new AssertionError("Actual native state was not displayed: " + text);
  }

  /** Compose exposes virtual semantic children but does not implement the
   * platform provider's findAccessibilityNodeInfosByText query. Traverse the
   * actual hierarchy and still require a visible, enabled ACTION_CLICK owner. */
  private List<AccessibilityNodeInfo> findAccessibleText(AccessibilityNodeInfo root, String text) {
    List<AccessibilityNodeInfo> matches = new ArrayList<>();
    collectAccessibleText(root, text, matches);
    return matches;
  }

  private void collectAccessibleText(AccessibilityNodeInfo node, String text,
      List<AccessibilityNodeInfo> matches) {
    if (text.contentEquals(node.getText() == null ? "" : node.getText()) ||
        text.contentEquals(node.getContentDescription() == null ? "" : node.getContentDescription())) matches.add(node);
    for (int index = 0; index < node.getChildCount(); index++) {
      AccessibilityNodeInfo child = node.getChild(index);
      if (child != null) collectAccessibleText(child, text, matches);
    }
  }

  private boolean scrollNativeForward(AccessibilityNodeInfo node) {
    if (!node.isVisibleToUser() || "android.webkit.WebView".contentEquals(node.getClassName() == null ? "" : node.getClassName())) return false;
    if (node.isScrollable() && node.performAction(AccessibilityNodeInfo.ACTION_SCROLL_FORWARD)) return true;
    for (int i = 0; i < node.getChildCount(); i++) {
      AccessibilityNodeInfo child = node.getChild(i);
      if (child != null && scrollNativeForward(child)) return true;
    }
    return false;
  }

  private void collectNativeText(View view, List<String> text) {
    if (!view.isShown() || view instanceof WebView) return;
    if (view instanceof TextView) text.add(((TextView) view).getText().toString());
    if (view instanceof ViewGroup) {
      ViewGroup group = (ViewGroup) view;
      for (int index = 0; index < group.getChildCount(); index++) collectNativeText(group.getChildAt(index), text);
    }
  }

  private String evaluate(String javascript) throws Exception {
    AtomicReference<String> value = new AtomicReference<>();
    CountDownLatch done = new CountDownLatch(1);
    instrumentation.runOnMainSync(() -> reader.evaluateJavascript(javascript, result -> {
      value.set(result);
      done.countDown();
    }));
    assertTrue("WebView evaluation callback timed out", done.await(10, TimeUnit.SECONDS));
    return value.get();
  }

  private String readUrl() {
    AtomicReference<String> value = new AtomicReference<>();
    instrumentation.runOnMainSync(() -> value.set(reader.getUrl()));
    return value.get();
  }

  @SuppressWarnings("deprecation")
  private JSONObject nativeSettings() throws Exception {
    AtomicReference<JSONObject> value = new AtomicReference<>();
    instrumentation.runOnMainSync(() -> {
      WebSettings settings = reader.getSettings();
      assertTrue("DOM storage disabled", settings.getDomStorageEnabled());
      assertFalse("File access enabled", settings.getAllowFileAccess());
      assertFalse("Content access enabled", settings.getAllowContentAccess());
      assertFalse("File-origin access enabled", settings.getAllowFileAccessFromFileURLs());
      assertFalse("Universal file-origin access enabled", settings.getAllowUniversalAccessFromFileURLs());
      assertEquals(WebSettings.MIXED_CONTENT_NEVER_ALLOW, settings.getMixedContentMode());
      assertFalse("Automatic popups enabled", settings.getJavaScriptCanOpenWindowsAutomatically());
      assertFalse("Multiple windows enabled", settings.supportMultipleWindows());
      PackageInfo webView = WebView.getCurrentWebViewPackage();
      assertNotNull("Cannot identify running WebView provider", webView);
      try {
        value.set(new JSONObject().put("webViewPackage", webView.packageName)
            .put("webViewVersion", webView.versionName).put("domStorage", true)
            .put("fileAccess", false).put("contentAccess", false)
            .put("fileOriginBypass", false).put("mixedContent", false).put("popups", false));
      } catch (Exception error) { throw new AssertionError(error); }
    });
    return value.get();
  }

  private JSONObject runProbe(String operation) throws Exception {
    JSONObject input = new JSONObject(config.toString()).put("operation", operation);
    evaluate("window." + RESULT + " = null; (" + probe + ")(" + input + ")"
        + ".then(value => { window." + RESULT + " = { done: true, ok: true, value }; }, "
        + "error => { window." + RESULT + " = { done: true, ok: false, error: String(error?.stack || error) }; }); true;");
    long deadline = SystemClock.uptimeMillis() + 150000;
    while (SystemClock.uptimeMillis() < deadline) {
      Object decoded = new JSONTokener(evaluate("JSON.stringify(window." + RESULT + ")")).nextValue();
      if (decoded instanceof String && !"null".equals(decoded)) {
        JSONObject result = new JSONObject((String) decoded);
        if (result.optBoolean("done")) {
          assertTrue("Probe " + operation + " failed: " + result.optString("error"), result.optBoolean("ok"));
          return result.getJSONObject("value");
        }
      }
      SystemClock.sleep(100);
    }
    throw new AssertionError("Packaged reader probe timed out: " + operation);
  }

  private JSONArray navigationRestrictions() throws Exception {
    String[] attempts = {
      ORIGIN + "/www.bundle/wrong-root.html",
      entry + "?unexpected=1",
      "https://example.invalid/manabi-qualification",
      "https://reader:synthetic@appassets.androidplatform.net/www.bundle/wrong-root.html",
      ORIGIN + "/www.bundle/%252e%252e/AndroidManifest.xml",
      "file:///android_asset/www.bundle/wrong-root.html",
      "content://io.manabi.reader.qualification/synthetic",
      "data:text/html,synthetic",
      "intent://synthetic/#Intent;scheme=manabi-qualification;end"
    };
    JSONArray result = new JSONArray();
    for (String target : attempts) {
      // A script-driven attempt has no user gesture and must not open an external browser.
      evaluate("window.__manabiNavigationMarker = " + JSONObject.quote(config.getString("id")) + "; "
          + "try { location.assign(" + JSONObject.quote(target) + "); } catch (_) {} true;");
      long deadline = SystemClock.uptimeMillis() + 1000;
      while (SystemClock.uptimeMillis() < deadline) {
        assertEquals("Host navigated to forbidden target " + target, entry, readUrl());
        assertEquals("Trusted document replaced by " + target, JSONObject.quote(config.getString("id")),
            evaluate("window.__manabiNavigationMarker"));
        SystemClock.sleep(100);
      }
      result.put(new JSONObject().put("target", target).put("rootRetained", true));
    }
    return result;
  }

  private void emitEvidence() {
    String line = "MANABI_ANDROID_QUALIFICATION=" + evidence;
    Log.i("ManabiQualification", line);
    Bundle status = new Bundle();
    status.putString("stream", "\n" + line + "\n");
    instrumentation.sendStatus(0, status);
  }
}
