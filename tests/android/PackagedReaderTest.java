/* SPDX-License-Identifier: BSD-3-Clause */
package io.manabi.reader.qualification;

import static org.junit.Assert.*;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Context;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.graphics.Rect;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.net.Uri;
import android.net.ConnectivityManager;
import android.provider.MediaStore;
import android.provider.Settings;
import android.os.Build;
import android.os.Bundle;
import android.os.SystemClock;
import android.util.Log;
import android.view.View;
import android.view.ViewGroup;
import android.view.KeyEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.TextView;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Consumer;
import org.json.JSONArray;
import org.json.JSONObject;
import org.json.JSONTokener;

/** Tests the actual Expo activity's packaged host, never a replacement WebView. */
public final class PackagedReaderTest {
  private static final String ORIGIN = "https://appassets.androidplatform.net";
  private static final String RESULT = "__manabiAndroidQualificationResult";
  private final Instrumentation instrumentation;
  private final Bundle arguments;
  private final JSONObject evidence = new JSONObject();
  private Activity activity;
  private WebView reader;
  private String entry;
  private String probe;
  private JSONObject config;

  public PackagedReaderTest(Instrumentation instrumentation, Bundle arguments) {
    this.instrumentation = instrumentation;
    this.arguments = new Bundle(arguments);
  }

  public void packagedReaderRuntime() throws Exception {
    Context target = instrumentation.getTargetContext();
    assertEquals("io.manabi.reader", target.getPackageName());
    assertEquals("Use the embedded, non-debuggable release APK", 0,
        target.getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE);
    assertTrue("This synthetic-storage qualification is for a disposable emulator only",
        Build.MODEL.contains("sdk_gphone") || Build.MODEL.contains("Emulator")
        || Build.MODEL.contains("Android SDK built for"));
    assertTrue("Qualification requires API 29 or later for test-owned picker images", Build.VERSION.SDK_INT >= 29);
    Bundle args = arguments;
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
      JSONObject offline = new JSONObject().put("beforeLaunch", awaitDeviceOffline());
      evidence.put("nativeOffline", offline);
      Intent intent = target.getPackageManager().getLaunchIntentForPackage(target.getPackageName());
      assertNotNull("The generated Expo launcher activity is missing", intent);
      activity = instrumentation.startActivitySync(intent);
      reader = awaitReader();
      entry = readUrl();
      awaitReady();
      awaitNativeLibraryReply();
      qualifyOfflineNotice();
      offline.put("notice", "native-details-open-and-dismissed").put("webViewOnline", false);
      if (phase.equals("verify")) qualifyNativeFontPicker(phase);
      qualifyNativeFontManager();
      if (!phase.equals("verify")) qualifyNativeFontPicker(phase);
      qualifyNativeBackgrounds(phase);
      evidence.put("nativeBookExport", new PackagedBookExport(instrumentation, new PackagedBookExport.Driver() {
        public String readAsset(String name) throws Exception { return PackagedReaderTest.this.readAsset(name); }
        public String evaluate(String script) throws Exception { return PackagedReaderTest.this.evaluate(script); }
        public void click(String label) throws Exception { clickAccessibleText(label); }
        public void clickDocument(String filename) throws Exception { clickPublishedDocument(filename); }
        public void awaitText(String label) throws Exception { awaitAccessibleText(label); }
        public void awaitPicker() { awaitDocumentPicker(); }
        public void cancelPicker(String purpose) throws Exception { cancelDocumentPicker(purpose); }
      }, id).run(phase));
      offline.put("afterJourneys", awaitDeviceOffline());
      assertEquals("The actual WebView must remain disconnected after local imports and export",
          "false", evaluate("navigator.onLine"));
      evidence.put("entry", entry).put("nativeSettings", nativeSettings());
      if (phase.equals("verify")) {
        evidence.put("afterProcessRestart", runProbe("verify"));
      } else {
        evidence.put("initial", runProbe("seed"));
        // Reload the actual host, retaining both its settings and canonical origin.
        evaluate("window.__manabiDocumentBeforeReload = true; true;");
        instrumentation.runOnMainSync(() -> reader.reload());
        awaitReady(true);
        assertEquals("The actual WebView must remain disconnected after document reload",
            "false", evaluate("navigator.onLine"));
        evidence.put("afterReload", runProbe("verify"));
        if (phase.equals("seed")) evidence.put("nativeFontAfterReload", runFontProbe("selected"));
        evidence.put("navigation", navigationRestrictions());
        preserve = phase.equals("seed");
      }
      offline.put("afterStorageChecks", awaitDeviceOffline());
      evidence.put("passed", true);
    } catch (Throwable failure) {
      evidence.put("passed", false).put("error", failure.toString());
      // Synthetic emulator UI only. Keep bounded failure diagnostics in the job
      // log so a native naming/geometry failure can be repaired without guessing.
      try { evidence.put("nativeUiAtFailure", nativeAccessibilitySnapshot()); }
      catch (Throwable diagnosticFailure) { evidence.put("nativeUiDiagnosticError", diagnosticFailure.toString()); }
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
            closeActivity();
            throw new AssertionError("Test-owned sentinel cleanup failed", cleanupFailure);
          }
        }
      }
      emitEvidence();
      closeActivity();
    }
  }

  /** Observe actual OS connectivity without changing app/WebView security or
   * injecting navigator values. The shell disconnects only the disposable AVD. */
  private JSONObject awaitDeviceOffline() throws Exception {
    Context target = instrumentation.getTargetContext();
    assertEquals("The release app must be able to observe network state",
        PackageManager.PERMISSION_GRANTED,
        target.checkSelfPermission(android.Manifest.permission.ACCESS_NETWORK_STATE));
    ConnectivityManager connectivity = target.getSystemService(ConnectivityManager.class);
    assertNotNull(connectivity);
    long deadline = SystemClock.uptimeMillis() + 20000;
    do {
      boolean airplane = Settings.Global.getInt(target.getContentResolver(), Settings.Global.AIRPLANE_MODE_ON, 0) == 1;
      boolean active = connectivity.getActiveNetwork() != null;
      int networks = connectivity.getAllNetworks().length;
      if (airplane && !active && networks == 0) return new JSONObject()
          .put("airplaneMode", true).put("activeNetwork", false).put("networkCount", 0);
      SystemClock.sleep(100);
    } while (SystemClock.uptimeMillis() < deadline);
    throw new AssertionError("The disposable emulator still has an available network or is not in airplane mode");
  }

  private void qualifyOfflineNotice() throws Exception {
    long deadline = SystemClock.uptimeMillis() + 20000;
    while (!"false".equals(evaluate("navigator.onLine")) && SystemClock.uptimeMillis() < deadline)
      SystemClock.sleep(100);
    assertEquals("WebView must report the real disconnected device", "false", evaluate("navigator.onLine"));
    clickAccessibleText("Offline. Connection details");
    awaitAccessibleText("You’re offline. You can keep reading.");
    awaitAccessibleText("Books already saved on this device are available offline. Books and media you haven’t downloaded need a connection.");
    clickAccessibleText("Close connection details");
    awaitNativeLibraryReply();
  }

  private void onActivity(Consumer<Activity> action) {
    AtomicReference<Throwable> failure = new AtomicReference<>();
    instrumentation.runOnMainSync(() -> {
      try {
        assertNotNull("The actual Expo activity has not launched", activity);
        assertFalse("The actual Expo activity has been destroyed", activity.isDestroyed());
        action.accept(activity);
      } catch (Throwable error) {
        failure.set(error);
      }
    });
    if (failure.get() != null) throw new AssertionError("Activity inspection failed", failure.get());
  }

  private void closeActivity() {
    if (activity == null) return;
    instrumentation.runOnMainSync(() -> activity.finish());
    instrumentation.waitForIdleSync();
    activity = null;
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
      onActivity(activity -> {
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
      onActivity(activity -> collectNativeText(activity.getWindow().getDecorView(), last));
      // Compact Library uses the app title; "Library" is a wide-sidebar heading.
      // The exact pagination still requires a saved-state reply, never a fallback.
      if (last.contains("Manabi Reader") && last.contains("0–0 of 0")
          && last.contains("Import an EPUB, HTMLZ, or text file to start reading.")) {
        evidence.put("nativeRoundTrip", "snapshot-route-and-library-state-reply");
        return;
      }
      SystemClock.sleep(200);
    }
    throw new AssertionError("Native Library never received its empty saved-state reply: " + last);
  }

  /** Product UI smoke on the actual RN/Compose hierarchy. Color mode is changed
   * and restored on this disposable emulator; no real font file is selected. */
  private void qualifyNativeFontManager() throws Exception {
    clickAccessibleText("Manabi Reader actions");
    clickAccessibleText("Settings");
    qualifyNativeChoices();
    qualifyNativeThemeChooser();
    qualifyNativeDimensions();
    clickAccessibleText("Fonts & text");
    qualifyNativeFontPreferences();
    String fontPreferences = evaluate("JSON.stringify([localStorage.getItem('userfonts'), localStorage.getItem('fontFamilyGroupOne'), localStorage.getItem('fontFamilyGroupTwo')])");
    clickAccessibleText("Manage Primary / Serif font files");
    awaitAccessibleText("No custom fonts yet. Add a font file to make it available here.");
    clickAccessibleText("Custom font views: Add font");
    awaitAccessibleText("Choose font file and save");
    clickAccessibleText("Custom font views: Stored fonts");
    awaitAccessibleText("No custom fonts yet. Add a font file to make it available here.");
    clickAccessibleText("Custom font views: Add font");
    awaitAccessibleText("Choose font file and save");
    instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_BACK);
    awaitAccessibleText("Manage Primary / Serif font files");
    clickAccessibleText("Manage Primary / Serif font files");
    awaitAccessibleText("No custom fonts yet. Add a font file to make it available here.");
    clickAccessibleText("Close font manager");
    assertEquals("Font navigation and dismissal must not save a font or change either family", fontPreferences,
        evaluate("JSON.stringify([localStorage.getItem('userfonts'), localStorage.getItem('fontFamilyGroupOne'), localStorage.getItem('fontFamilyGroupTwo')])"));
    clickAccessibleText("Back");
    awaitNativeLibraryReply();
    evidence.put("nativeFontManager", "shared-font-list-add-back-and-close-without-save");
  }

  /** Explicit native font drafts must use the existing local preference owner. */
  private void qualifyNativeFontPreferences() throws Exception {
    for (String[] field : new String[][] {
        {"fontFamilyGroupOne", "Primary / Serif font"},
        {"fontFamilyGroupTwo", "Sans-serif font"}}) {
      String key = field[0], label = field[1];
      String original = evaluate("localStorage.getItem('" + key + "')");
      String initialText = awaitFontInput(label, null);
      String replacement = "\"Native qualification font\", serif";
      assertNotEquals("Disposable fixture must differ from initial preference", initialText, replacement);
      try {
        setFontInput(label, replacement);
        assertEquals("Typing a font must not save it", original, evaluate("localStorage.getItem('" + key + "')"));
        clickAccessibleText("Cancel edit");
        awaitFontInput(label, initialText);
        assertEquals("Cancel must retain the original raw preference", original, evaluate("localStorage.getItem('" + key + "')"));
        setFontInput(label, replacement);
        clickAccessibleText("Apply " + label);
        awaitRawPreference(key, JSONObject.quote(replacement));
        awaitFontInput(label, replacement);
        setFontInput(label, initialText);
        clickAccessibleText("Apply " + label);
        awaitRawPreference(key, JSONObject.quote(initialText));
        awaitFontInput(label, initialText);
      } finally {
        evaluate(original.equals("null") ? "localStorage.removeItem('" + key + "'); true;"
            : "localStorage.setItem('" + key + "', " + original + "); true;");
        assertEquals("Restore exact raw font preference including absence", original, evaluate("localStorage.getItem('" + key + "')"));
      }
    }
    evidence.put("nativeFontPreferences", "explicit-font-draft-cancel-apply-and-exact-restore");
  }

  private void awaitRawPreference(String key, String expected) throws Exception {
    long deadline = SystemClock.uptimeMillis() + 45000;
    while (SystemClock.uptimeMillis() < deadline) {
      if (evaluate("localStorage.getItem('" + key + "')").equals(expected)) return;
      SystemClock.sleep(100);
    }
    throw new AssertionError("Native preference did not reach the local owner: " + key);
  }

  /** Real system picker and ordinary catalog/cache owner. No injected font CSS. */
  private void qualifyNativeFontPicker(String phase) throws Exception {
    String name = "Qualification font " + config.getString("id");
    JSONObject fixture = phase.equals("verify") ? null : runFontProbe("prepare");
    clickAccessibleText("Manabi Reader actions");
    clickAccessibleText("Settings");
    clickAccessibleText("Fonts & text");
    if (phase.equals("verify")) awaitFontInput("Primary / Serif font", name);
    clickAccessibleText("Manage Primary / Serif font files");
    if (!phase.equals("verify")) {
      awaitAccessibleText("No custom fonts yet. Add a font file to make it available here.");
      clickAccessibleText("Custom font views: Add font");
      setFontInput("Font name", name);
      clickAccessibleText("Choose font file and save");
      awaitDocumentPicker();
      cancelDocumentPicker("font");
      awaitFontInput("Font name", name);
      assertTrue(runFontProbe("cancelled").getBoolean("cancelled"));
      pickPackagedFont(fixture);
      awaitAccessibleText("Stored on this device");
      evidence.put("nativeFontImported", runFontProbe("imported"));
      clickAccessibleText("Use " + name);
      awaitFontInput("Primary / Serif font", name);
    } else {
      awaitAccessibleText("Stored on this device · Selected");
      clickAccessibleText("Close font manager");
    }
    JSONObject selected = runFontProbe("selected");
    if (!phase.equals("seed")) {
      clickAccessibleText("Manage Primary / Serif font files");
      clickAccessibleText("Remove " + name);
      awaitAccessibleText("Remove " + name + "?");
      clickAccessibleText("Cancel");
      assertEquals("Cancelling native removal preserves exact saved font", selected.toString(), runFontProbe("selected").toString());
      clickAccessibleText("Remove " + name);
      awaitAccessibleText("Remove " + name + "?");
      clickAccessibleText("Remove");
      awaitAccessibleText("No custom fonts yet. Add a font file to make it available here.");
      evidence.put("nativeFontCleanup", runFontProbe("cleanup"));
      clickAccessibleText("Close font manager");
    }
    clickAccessibleText("Back");
    awaitNativeLibraryReply();
    evidence.put("nativeFontPicker", new JSONObject().put("font", selected)
        .put("picker", phase.equals("verify") ? "retained-from-previous-process" : "system-picker-cancel-import-and-select")
        .put("removed", !phase.equals("seed")));
  }

  private void pickPackagedFont(JSONObject fixture) throws Exception {
    Context target = instrumentation.getTargetContext();
    String assetPath = fixture.getString("assetPath");
    assertTrue("Only the reviewed embedded WOFF2 asset may be copied", assetPath.matches("www\\.bundle/[A-Za-z0-9_./-]+\\.woff2") && !assetPath.contains("/../"));
    ContentValues values = new ContentValues();
    values.put(MediaStore.Downloads.DISPLAY_NAME, fixture.getString("fileName"));
    values.put(MediaStore.Downloads.MIME_TYPE, "font/woff2");
    values.put(MediaStore.Downloads.RELATIVE_PATH, "Download/ManabiQualification");
    values.put(MediaStore.Downloads.IS_PENDING, 1);
    Uri uri = target.getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
    assertNotNull("Cannot create test-owned font picker fixture", uri);
    try {
      try (InputStream source = target.getAssets().open(assetPath);
           OutputStream out = target.getContentResolver().openOutputStream(uri)) {
        assertNotNull(out);
        byte[] buffer = new byte[8192];
        int count, total = 0;
        while ((count = source.read(buffer)) != -1) { out.write(buffer, 0, count); total += count; }
        assertEquals("Copy the entire actual packaged font", fixture.getInt("bytes"), total);
      }
      values.clear();
      values.put(MediaStore.Downloads.IS_PENDING, 0);
      assertEquals(1, target.getContentResolver().update(uri, values, null, null));
      awaitPublishedFixture(uri, fixture.getString("fileName"), "font/woff2");
      clickAccessibleText("Choose font file and save");
      awaitDocumentPicker();
      choosePublishedDocument("Downloads", fixture.getString("fileName"));
      awaitAccessibleText("Stored on this device");
    } finally {
      assertEquals("Clean up only our own source font fixture", 1, target.getContentResolver().delete(uri, null, null));
    }
  }

  private JSONObject runFontProbe(String operation) throws Exception {
    String script = readAsset("font-probe.js").trim();
    if (script.endsWith(";")) script = script.substring(0, script.length() - 1);
    JSONObject input = new JSONObject().put("id", config.getString("id")).put("operation", operation);
    evaluate("window.__manabiFontQualification=null;(" + script + ")(" + input + ")"
        + ".then(value=>window.__manabiFontQualification={value},error=>window.__manabiFontQualification={error:String(error?.stack||error)});true;");
    long deadline = SystemClock.uptimeMillis() + 20000;
    while (SystemClock.uptimeMillis() < deadline) {
      String raw = evaluate("window.__manabiFontQualification");
      if (!raw.equals("null")) {
        JSONObject reply = new JSONObject(raw);
        assertFalse("Font qualification " + operation + " failed: " + reply, reply.has("error"));
        return reply.getJSONObject("value");
      }
      SystemClock.sleep(100);
    }
    throw new AssertionError("Font qualification timed out: " + operation);
  }

  /** Actual document picker -> native chunk transfer -> existing image database ->
   * native decoded image. Seed retains three synthetic slots for the restart phase. */
  private void qualifyNativeBackgrounds(String phase) throws Exception {
    String original = evaluate("localStorage.getItem('appearance')");
    String mode = original.equals("null") ? "system" : (String) new JSONTokener(original).nextValue();
    String prefix = "manabi-background-" + config.getString("id");
    clickAccessibleText("Manabi Reader actions");
    clickAccessibleText("Settings");
    clickAccessibleText("Color mode: Light");
    awaitSelectedChoice("Color mode: Light");
    clickAccessibleText("Manage background images");
    awaitAccessibleText("Images stay on this device and aren’t synced or included in book backups. Keep your originals to use them on another device.");
    try {
      if (!phase.equals("verify")) {
        JSONObject empty = backgroundRecords();
        assertEquals("Fresh emulator must have no background images", 0, empty.length());
        // Cancellation must return to the same usable editor without a save.
        clickAccessibleText("Choose light book browser background");
        awaitDocumentPicker();
        cancelDocumentPicker("background");
        awaitAccessibleText("Refresh saved backgrounds");
        assertEquals("Cancelling the system picker must not save", empty.toString(), backgroundRecords().toString());
        pickBackground("Choose light book browser background", prefix + "-library-light.png", Color.rgb(174, 34, 112));
        pickBackground("Choose dark book browser background", prefix + "-library-dark.png", Color.rgb(28, 148, 102));
        pickBackground("Choose light book reader background", prefix + "-reader-light.png", Color.rgb(44, 92, 182));
      }
      JSONObject saved = backgroundRecords();
      assertEquals("Exactly three independent saved modes", 3, saved.length());
      for (String slot : new String[] {"library-light", "library-dark", "reader-light"}) {
        JSONObject image = saved.getJSONObject(slot);
        assertEquals(prefix + "-" + slot + ".png", image.getString("name"));
        assertTrue("Saved raster has bytes", image.getInt("bytes") > 0);
        assertTrue("Saved bytes have a real SHA-256", image.getString("sha256").matches("[a-f0-9]{64}"));
      }
      assertFalse("Unselected dark reader slot must remain empty", saved.has("reader-dark"));
      clickAccessibleText("Close background images");
      clickAccessibleText("Back");
      awaitNativeLibraryReply();
      awaitNativeBackgroundPixels(Color.rgb(174, 34, 112));
      // Both modes must come from their independent persisted resource.
      clickAccessibleText("Manabi Reader actions");
      clickAccessibleText("Settings");
      clickAccessibleText("Color mode: Dark");
      awaitSelectedChoice("Color mode: Dark");
      clickAccessibleText("Back");
      awaitNativeLibraryReply();
      awaitNativeBackgroundPixels(Color.rgb(28, 148, 102));
      clickAccessibleText("Manabi Reader actions");
      clickAccessibleText("Settings");
      if (!phase.equals("seed")) {
        clickAccessibleText("Manage background images");
        clickAccessibleText("Remove light book browser background");
        JSONObject removed = awaitBackgroundCount(2);
        assertFalse("Remove only the chosen mode", removed.has("library-light"));
        assertEquals(saved.getJSONObject("library-dark").toString(), removed.getJSONObject("library-dark").toString());
        assertEquals(saved.getJSONObject("reader-light").toString(), removed.getJSONObject("reader-light").toString());
        clickAccessibleText("Remove both book browser background images");
        clickAccessibleText("Remove both book reader background images");
        assertEquals("Remove both must clear the saved slots", 0, awaitBackgroundCount(0).length());
        clickAccessibleText("Close background images");
      }
      clickAccessibleText("Color mode: " + Character.toUpperCase(mode.charAt(0)) + mode.substring(1));
      awaitSelectedChoice("Color mode: " + Character.toUpperCase(mode.charAt(0)) + mode.substring(1));
      clickAccessibleText("Back");
      awaitNativeLibraryReply();
      if (!phase.equals("seed")) awaitNoNativeBackground();
      evidence.put("nativeBackgrounds", new JSONObject()
          .put("picker", phase.equals("verify") ? "retained-from-previous-process" : "system-picker-cancel-and-three-imports")
          .put("rendered", "native-light-and-dark-decoded-pixels")
          .put("records", saved)
          .put("removed", !phase.equals("seed")));
    } finally {
      evaluate(original.equals("null") ? "localStorage.removeItem('appearance'); true;"
          : "localStorage.setItem('appearance', " + original + "); true;");
      assertEquals("Restore exact appearance preference", original, evaluate("localStorage.getItem('appearance')"));
    }
  }

  private void awaitDocumentPicker() {
    long deadline = SystemClock.uptimeMillis() + 15000;
    while (SystemClock.uptimeMillis() < deadline) {
      AccessibilityNodeInfo root = instrumentation.getUiAutomation().getRootInActiveWindow();
      if (root != null && root.getPackageName() != null &&
          root.getPackageName().toString().endsWith(".documentsui")) return;
      SystemClock.sleep(100);
    }
    throw new AssertionError("Android system document picker never opened");
  }

  /** DocumentsUI remembers its last directory. Back can first leave that folder;
   * only send another Back after the system picker settles and still owns focus.
   * Never send Back into the returned app or a different system window. */
  private void cancelDocumentPicker(String purpose) throws Exception {
    String targetPackage = instrumentation.getTargetContext().getPackageName();
    int presses = 0;
    long deadline = SystemClock.uptimeMillis() + 20000;
    while (SystemClock.uptimeMillis() < deadline) {
      instrumentation.getUiAutomation().waitForIdle(500, 5000);
      AccessibilityNodeInfo root = instrumentation.getUiAutomation().getRootInActiveWindow();
      if (root == null || root.getPackageName() == null) {
        SystemClock.sleep(100);
        continue;
      }
      String activePackage = root.getPackageName().toString();
      if (targetPackage.equals(activePackage)) {
        assertTrue("Cancellation must send Back to the actual system picker", presses > 0);
        evidence.put("nativePickerCancel-" + purpose, presses);
        return;
      }
      assertTrue("Refuse to cancel an unrelated foreground window: " + activePackage,
          activePackage.endsWith(".documentsui"));
      assertTrue("System picker cancellation exceeded its navigation bound", presses < 8);
      instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_BACK);
      presses++;
    }
    throw new AssertionError("System document picker did not return to the app: " + purpose);
  }

  /** Recent is a cached/aggregated view, not the source fixture's directory.
   * Traverse the actual provider root and folder through the system picker. */
  private void choosePublishedDocument(String root, String name) throws Exception {
    clickAccessibleText("Show roots");
    clickAccessibleText(root);
    clickAccessibleText("ManabiQualification");
    clickPublishedDocument(name);
  }

  /** Grid tiles expose the exact filename followed by size/date in their
   * description. Select only our random fixture in the actual DocumentsUI;
   * never broaden application-control matching or activate a preview child. */
  private void clickPublishedDocument(String filename) throws Exception {
    assertTrue("Only this run's source document may be selected",
        filename.startsWith("manabi-") && filename.contains(config.getString("id"))
        && !filename.contains("/") && !filename.contains(","));
    long deadline = SystemClock.uptimeMillis() + 20000;
    while (SystemClock.uptimeMillis() < deadline) {
      AccessibilityNodeInfo root = instrumentation.getUiAutomation().getRootInActiveWindow();
      if (root != null && root.getPackageName() != null) {
        assertTrue("Refuse to select a document outside the system picker",
            root.getPackageName().toString().endsWith(".documentsui"));
        List<AccessibilityNodeInfo> matches = new ArrayList<>();
        collectDocumentLabels(root, filename, matches);
        for (AccessibilityNodeInfo match : matches) {
          match.performAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_SHOW_ON_SCREEN.getId());
          AccessibilityNodeInfo action = match;
          for (int depth = 0; action != null && depth < 6; depth++, action = action.getParent()) {
            if (nativeControlVisible(action) && action.isEnabled() && action.isClickable()
                && action.performAction(AccessibilityNodeInfo.ACTION_CLICK)) return;
          }
        }
        scrollNativeForward(root);
      }
      SystemClock.sleep(200);
    }
    throw new AssertionError("System picker document was not reachable: " + filename);
  }

  private void collectDocumentLabels(AccessibilityNodeInfo node, String filename,
      List<AccessibilityNodeInfo> matches) {
    if (DocumentPickerLabels.matches(filename, node.getText(), node.getContentDescription())) matches.add(node);
    for (int index = 0; index < node.getChildCount(); index++) {
      AccessibilityNodeInfo child = node.getChild(index);
      if (child != null) collectDocumentLabels(child, filename, matches);
    }
  }

  private void awaitPublishedFixture(Uri uri, String name, String mime) throws Exception {
    long deadline = SystemClock.uptimeMillis() + 15000;
    String observed = "No row";
    do {
      try (Cursor row = instrumentation.getTargetContext().getContentResolver().query(uri,
          new String[] {MediaStore.MediaColumns.DISPLAY_NAME, MediaStore.MediaColumns.MIME_TYPE,
            MediaStore.MediaColumns.SIZE, MediaStore.MediaColumns.IS_PENDING}, null, null, null)) {
        if (row != null && row.moveToFirst()) {
          observed = row.getString(0) + "; " + row.getString(1) + "; bytes=" + row.getLong(2)
              + "; pending=" + row.getInt(3);
          if (name.equals(row.getString(0)) && mime.equals(row.getString(1)) &&
              row.getLong(2) > 0 && row.getInt(3) == 0) return;
        }
      }
      SystemClock.sleep(100);
    } while (SystemClock.uptimeMillis() < deadline);
    throw new AssertionError("Picker fixture was not published: " + observed);
  }

  private void pickBackground(String label, String name, int color) throws Exception {
    int expectedCount = backgroundRecords().length() + 1;
    Context target = instrumentation.getTargetContext();
    ContentValues values = new ContentValues();
    values.put(MediaStore.Images.Media.DISPLAY_NAME, name);
    values.put(MediaStore.Images.Media.MIME_TYPE, "image/png");
    values.put(MediaStore.Images.Media.RELATIVE_PATH, "Pictures/ManabiQualification");
    values.put(MediaStore.Images.Media.IS_PENDING, 1);
    Uri uri = target.getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
    assertNotNull("Cannot create test-owned picker fixture", uri);
    try {
      Bitmap bitmap = Bitmap.createBitmap(128, 96, Bitmap.Config.ARGB_8888);
      try (OutputStream out = target.getContentResolver().openOutputStream(uri)) {
        assertNotNull(out);
        bitmap.eraseColor(color);
        assertTrue(bitmap.compress(Bitmap.CompressFormat.PNG, 100, out));
      } finally { bitmap.recycle(); }
      values.clear();
      values.put(MediaStore.Images.Media.IS_PENDING, 0);
      assertEquals(1, target.getContentResolver().update(uri, values, null, null));
      awaitPublishedFixture(uri, name, "image/png");
      clickAccessibleText(label);
      awaitDocumentPicker();
      choosePublishedDocument("Images", name);
      // Product data changes only after copying, transferring, decoding and saving.
      awaitBackgroundCount(expectedCount);
      awaitBackgroundEditorIdle();
    } finally {
      assertEquals("Clean up only our own picker fixture", 1, target.getContentResolver().delete(uri, null, null));
    }
  }

  private void awaitBackgroundEditorIdle() {
    long deadline = SystemClock.uptimeMillis() + 15000;
    while (SystemClock.uptimeMillis() < deadline) {
      AccessibilityNodeInfo root = instrumentation.getUiAutomation().getRootInActiveWindow();
      if (root != null) for (AccessibilityNodeInfo match : findAccessibleText(root, "Refresh saved backgrounds")) {
        for (int depth = 0; match != null && depth < 6; depth++, match = match.getParent())
          if (match.isEnabled() && match.isClickable()) return;
      }
      SystemClock.sleep(100);
    }
    throw new AssertionError("Background editor did not finish the save");
  }

  /** Read-only inspection of the product's real store; no injected product service. */
  private JSONObject awaitBackgroundCount(int count) throws Exception {
    long deadline = SystemClock.uptimeMillis() + 15000;
    do {
      JSONObject records = backgroundRecords();
      if (records.length() == count) return records;
      SystemClock.sleep(100);
    } while (SystemClock.uptimeMillis() < deadline);
    throw new AssertionError("Background slots did not reach expected count: " + count);
  }

  private JSONObject backgroundRecords() throws Exception {
    evaluate("window.__manabiBackgroundQualification=null;(async()=>{"
        + "const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('manabi-reader-appearance',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});"
        + "try{const tx=db.transaction('backgrounds','readonly');const store=tx.objectStore('backgrounds');"
        + "const read=key=>new Promise((resolve,reject)=>{const r=store.get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});"
        + "const entries=await Promise.all(['library','reader'].map(async target=>[target,await read(target)]));const result={};"
        + "for(const [target,record] of entries)for(const mode of ['light','dark']){const image=record?.[mode];if(!image)continue;"
        + "const bytes=image.dataUrl?Uint8Array.from(atob(image.dataUrl.split(',')[1]),c=>c.charCodeAt(0)):new Uint8Array(await image.blob.arrayBuffer());"
        + "const hash=await crypto.subtle.digest('SHA-256',bytes);result[target+'-'+mode]={name:image.name,bytes:bytes.length,sha256:Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('')};}return result;"
        + "}finally{db.close()}})().then(value=>window.__manabiBackgroundQualification={value},error=>window.__manabiBackgroundQualification={error:String(error)});true;");
    long deadline = SystemClock.uptimeMillis() + 15000;
    while (SystemClock.uptimeMillis() < deadline) {
      String raw = evaluate("window.__manabiBackgroundQualification");
      if (!raw.equals("null")) {
        JSONObject reply = new JSONObject(raw);
        assertFalse("Background database read failed: " + reply, reply.has("error"));
        return reply.getJSONObject("value");
      }
      SystemClock.sleep(100);
    }
    throw new AssertionError("Background database read timed out");
  }

  private View nativeBackgroundView(View view, int tag) {
    if (!view.isShown() || view instanceof WebView) return null;
    if ("library-background-image".equals(view.getTag(tag))) return view;
    if (view instanceof ViewGroup) for (int i = 0; i < ((ViewGroup)view).getChildCount(); i++) {
      View found = nativeBackgroundView(((ViewGroup)view).getChildAt(i), tag);
      if (found != null) return found;
    }
    return null;
  }

  private void awaitNativeBackgroundPixels(int expected) {
    long deadline = SystemClock.uptimeMillis() + 30000;
    AtomicReference<Integer> pixel = new AtomicReference<>(0);
    while (SystemClock.uptimeMillis() < deadline) {
      onActivity(activity -> {
        int tag = activity.getResources().getIdentifier("react_test_id", "id", activity.getPackageName());
        assertTrue("Native test ID resource must exist", tag != 0);
        View view = nativeBackgroundView(activity.getWindow().getDecorView(), tag);
        if (view == null || view.getWidth() < 1 || view.getHeight() < 1) return;
        // Draw the real native image, excluding its intentional fade overlay sibling.
        Bitmap image = Bitmap.createBitmap(view.getWidth(), view.getHeight(), Bitmap.Config.ARGB_8888);
        try { view.draw(new Canvas(image)); pixel.set(image.getPixel(image.getWidth()/2, image.getHeight()/2)); }
        finally { image.recycle(); }
      });
      int actual = pixel.get();
      if (Color.alpha(actual) == 255 && Math.abs(Color.red(actual)-Color.red(expected)) <= 6 &&
          Math.abs(Color.green(actual)-Color.green(expected)) <= 6 && Math.abs(Color.blue(actual)-Color.blue(expected)) <= 6) return;
      SystemClock.sleep(200);
    }
    throw new AssertionError("Native background did not decode expected pixels: " + Integer.toHexString(pixel.get()));
  }

  private void awaitNoNativeBackground() {
    long deadline = SystemClock.uptimeMillis() + 15000;
    while (SystemClock.uptimeMillis() < deadline) {
      AtomicReference<View> found = new AtomicReference<>();
      onActivity(activity -> found.set(nativeBackgroundView(activity.getWindow().getDecorView(),
          activity.getResources().getIdentifier("react_test_id", "id", activity.getPackageName()))));
      if (found.get() == null) return;
      SystemClock.sleep(100);
    }
    throw new AssertionError("Removed native background remains mounted");
  }

  private String awaitFontInput(String label, String expected) throws Exception {
    long deadline = SystemClock.uptimeMillis() + 45000;
    while (SystemClock.uptimeMillis() < deadline) {
      AccessibilityNodeInfo root = instrumentation.getUiAutomation().getRootInActiveWindow();
      if (root != null) {
        for (AccessibilityNodeInfo match : findAccessibleText(root, label)) {
          AccessibilityNodeInfo node = nativeSemanticControl(match, false);
          if (node == null) continue;
          node.performAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_SHOW_ON_SCREEN.getId());
          String value = node.getText() == null ? "" : node.getText().toString();
          if (nativeControlVisible(node) && node.isEnabled() && node.isEditable() && (expected == null || expected.equals(value))) return value;
        }
        scrollNativeForward(root);
      }
      SystemClock.sleep(200);
    }
    throw new AssertionError("Named native font input did not display the expected saved/draft value: " + label);
  }

  private void setFontInput(String label, String value) throws Exception {
    long deadline = SystemClock.uptimeMillis() + 45000;
    while (SystemClock.uptimeMillis() < deadline) {
      AccessibilityNodeInfo root = instrumentation.getUiAutomation().getRootInActiveWindow();
      if (root != null) {
        for (AccessibilityNodeInfo match : findAccessibleText(root, label)) {
          AccessibilityNodeInfo node = nativeSemanticControl(match, false);
          if (node == null) continue;
          node.performAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_SHOW_ON_SCREEN.getId());
          if (!nativeControlVisible(node) || !node.isEnabled() || !node.isEditable()) continue;
          Bundle arguments = new Bundle();
          arguments.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, value);
          assertTrue("The actual Expo text field must accept an accessible edit", node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, arguments));
          awaitFontInput(label, value);
          return;
        }
        scrollNativeForward(root);
      }
      SystemClock.sleep(200);
    }
    throw new AssertionError("Named native font input could not be edited: " + label);
  }

  private void qualifyNativeChoices() throws Exception {
    String original = evaluate("localStorage.getItem('appearance')");
    String mode = original.equals("null") ? "system" : (String) new JSONTokener(original).nextValue();
    assertTrue("Unexpected initial appearance", mode.equals("system") || mode.equals("light") || mode.equals("dark"));
    String replacement = mode.equals("dark") ? "light" : "dark";
    String originalLabel = "Color mode: " + Character.toUpperCase(mode.charAt(0)) + mode.substring(1);
    String replacementLabel = "Color mode: " + Character.toUpperCase(replacement.charAt(0)) + replacement.substring(1);
    try {
      awaitSelectedChoice(originalLabel);
      clickAccessibleText(replacementLabel);
      awaitSelectedChoice(replacementLabel);
      assertEquals("Native selection must reach the local owner", JSONObject.quote(replacement),
          evaluate("localStorage.getItem('appearance')"));
      clickAccessibleText(originalLabel);
      awaitSelectedChoice(originalLabel);
      assertEquals("Restoring through the native control must save", JSONObject.quote(mode),
          evaluate("localStorage.getItem('appearance')"));
    } finally {
      // Preserve the distinction between an implicit system default and a saved
      // preference. This is test cleanup, never an alternative production save.
      evaluate(original.equals("null") ? "localStorage.removeItem('appearance'); true;"
          : "localStorage.setItem('appearance', " + original + "); true;");
      assertEquals("Restore the exact original local value", original,
          evaluate("localStorage.getItem('appearance')"));
    }
    evidence.put("nativeChoices", "color-mode-selection-local-save-and-restore");
  }

  private void qualifyNativeThemeChooser() throws Exception {
    String original = evaluate("localStorage.getItem('customThemes')");
    clickAccessibleText("Add custom theme");
    awaitAccessibleText("New custom theme");
    instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_BACK);
    awaitAccessibleText("Add custom theme");
    assertEquals("Android Back must discard the unsaved theme", original,
        evaluate("localStorage.getItem('customThemes')"));
    clickAccessibleText("Add custom theme");
    awaitAccessibleText("New custom theme");
    clickAccessibleText("Close theme editor");
    awaitAccessibleText("Add custom theme");
    assertEquals("Closing the editor must not save a theme", original,
        evaluate("localStorage.getItem('customThemes')"));
    evidence.put("nativeThemeChooser", "add-dialog-back-and-close-without-save");
  }

  private void qualifyNativeDimensions() throws Exception {
    String original = evaluate("localStorage.getItem('secondDimensionMaxValue')");
    String writingMode = evaluate("localStorage.getItem('writingMode') || 'vertical-rl'");
    boolean vertical = "vertical-rl".equals(new JSONTokener(writingMode).nextValue());
    String dimension = vertical ? "maximum page height" : "maximum page width";
    String label = "Quick size for " + dimension;
    try {
      clickAccessibleText("Page layout");
      float chosen = setAccessibleSizeProgress(label);
      long deadline = SystemClock.uptimeMillis() + 45000;
      String saved = original;
      while (SystemClock.uptimeMillis() < deadline) {
        saved = evaluate("localStorage.getItem('secondDimensionMaxValue')");
        if (!saved.equals(original) && !saved.equals("null")) break;
        SystemClock.sleep(100);
      }
      assertNotEquals("Finishing the actual native slider must save through the local owner", original, saved);
      assertTrue("The percentage choice must save positive pixels", Double.parseDouble((String) new JSONTokener(saved).nextValue()) > 0);
      awaitAccessibleSizeProgress(label, chosen);
      clickAccessibleText("Automatic " + dimension);
      deadline = SystemClock.uptimeMillis() + 45000;
      while (SystemClock.uptimeMillis() < deadline && !evaluate("localStorage.getItem('secondDimensionMaxValue')").equals(JSONObject.quote("0"))) SystemClock.sleep(100);
      assertEquals("Automatic must save the existing zero sentinel", JSONObject.quote("0"), evaluate("localStorage.getItem('secondDimensionMaxValue')"));
    } finally {
      evaluate(original.equals("null") ? "localStorage.removeItem('secondDimensionMaxValue'); true;"
          : "localStorage.setItem('secondDimensionMaxValue', " + original + "); true;");
      assertEquals("Restore the exact original local dimension", original, evaluate("localStorage.getItem('secondDimensionMaxValue')"));
    }
    evidence.put("nativeDimensions", "slider-completion-and-automatic-local-save-with-exact-restore");
  }

  /** Drive the real Compose range semantics, not a synthetic JS callback. */
  private float setAccessibleSizeProgress(String label) throws Exception {
    long deadline = SystemClock.uptimeMillis() + 45000;
    JSONArray firstSnapshot = nativeAccessibilitySnapshot();
    while (SystemClock.uptimeMillis() < deadline) {
      AccessibilityNodeInfo root = instrumentation.getUiAutomation().getRootInActiveWindow();
      if (root != null) {
        for (AccessibilityNodeInfo match : findAccessibleText(root, label)) {
          AccessibilityNodeInfo control = nativeSemanticControl(match, true);
          if (control == null) continue;
          control.performAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_SHOW_ON_SCREEN.getId());
          AccessibilityNodeInfo.RangeInfo range = control.getRangeInfo();
          if (!nativeControlVisible(control) || !control.isEnabled() || range == null) continue;
          assertEquals(50f, range.getMin(), 0.01f);
          assertEquals(95f, range.getMax(), 0.01f);
          float chosen = Math.abs(range.getCurrent() - 50f) < 0.01f ? 75f : 50f;
          Bundle value = new Bundle();
          value.putFloat(AccessibilityNodeInfo.ACTION_ARGUMENT_PROGRESS_VALUE, chosen);
          assertTrue("The named native slider must support accessible progress", control.performAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_SET_PROGRESS.getId(), value));
          return chosen;
        }
        scrollNativeForward(root);
      }
      SystemClock.sleep(200);
    }
    evidence.put("nativeUiBeforeSizeSearch", firstSnapshot);
    throw new AssertionError("Actual native size slider was not reachable: " + label);
  }

  private void awaitAccessibleSizeProgress(String label, float chosen) throws Exception {
    long deadline = SystemClock.uptimeMillis() + 45000;
    while (SystemClock.uptimeMillis() < deadline) {
      AccessibilityNodeInfo root = instrumentation.getUiAutomation().getRootInActiveWindow();
      if (root != null) for (AccessibilityNodeInfo match : findAccessibleText(root, label)) {
        AccessibilityNodeInfo control = nativeSemanticControl(match, true);
        if (control == null) continue;
        AccessibilityNodeInfo.RangeInfo range = control.getRangeInfo();
        if (nativeControlVisible(control) && control.isEnabled() && range != null && Math.abs(range.getCurrent() - chosen) < 0.01f) return;
      }
      SystemClock.sleep(200);
    }
    throw new AssertionError("The saved dimension did not return to the native slider: " + label);
  }

  /** SDK 58 Compose emits a label child under the actual SeekBar/EditText.
   * Follow only that direct semantic owner, never a sibling or arbitrary control. */
  private AccessibilityNodeInfo nativeSemanticControl(AccessibilityNodeInfo label, boolean range) {
    String expectedClass = range ? "android.widget.SeekBar" : "android.widget.EditText";
    for (int depth = 0; label != null && depth < 2; depth++, label = label.getParent()) {
      if (expectedClass.contentEquals(label.getClassName() == null ? "" : label.getClassName()) &&
          (range ? label.getRangeInfo() != null : label.isEditable())) return label;
    }
    return null;
  }

  /** Compose may report visible=true for offscreen virtual descendants. Require
   * real screen/scroll-viewport intersection before exercising their actions. */
  private boolean nativeControlVisible(AccessibilityNodeInfo control) {
    if (!control.isVisibleToUser()) return false;
    Rect clipped = new Rect();
    control.getBoundsInScreen(clipped);
    if (clipped.isEmpty()) return false;
    for (AccessibilityNodeInfo ancestor = control.getParent(); ancestor != null; ancestor = ancestor.getParent()) {
      String kind = String.valueOf(ancestor.getClassName());
      if (ancestor.getParent() == null || kind.equals("android.widget.ScrollView") || kind.equals("android.widget.HorizontalScrollView")) {
        Rect viewport = new Rect();
        ancestor.getBoundsInScreen(viewport);
        if (!ancestor.isVisibleToUser() || !clipped.intersect(viewport)) return false;
      }
    }
    return true;
  }

  private void awaitSelectedChoice(String label) throws Exception {
    long deadline = SystemClock.uptimeMillis() + 45000;
    while (SystemClock.uptimeMillis() < deadline) {
      AccessibilityNodeInfo root = instrumentation.getUiAutomation().getRootInActiveWindow();
      if (root != null) for (AccessibilityNodeInfo match : findAccessibleText(root, label)) {
        if (match.isVisibleToUser() && match.isEnabled() && match.isSelected()) return;
      }
      SystemClock.sleep(200);
    }
    throw new AssertionError("Actual native choice was not selected and enabled: " + label);
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

  private JSONArray nativeAccessibilitySnapshot() throws Exception {
    JSONArray nodes = new JSONArray();
    collectNativeAccessibility(instrumentation.getUiAutomation().getRootInActiveWindow(), nodes, 0, new int[] {0});
    return nodes;
  }

  private void collectNativeAccessibility(AccessibilityNodeInfo node, JSONArray nodes, int depth,
      int[] visited) throws Exception {
    if (node == null || depth > 30 || ++visited[0] > 500 || nodes.length() >= 160 ||
        "android.webkit.WebView".contentEquals(node.getClassName() == null ? "" : node.getClassName())) return;
    CharSequence text = node.getText(), description = node.getContentDescription();
    AccessibilityNodeInfo.RangeInfo range = node.getRangeInfo();
    if (text != null || description != null || range != null || node.isScrollable()) {
      Rect bounds = new Rect();
      node.getBoundsInScreen(bounds);
      JSONObject item = new JSONObject().put("depth", depth).put("class", node.getClassName())
          .put("text", boundedNativeText(text)).put("description", boundedNativeText(description))
          .put("visible", node.isVisibleToUser()).put("enabled", node.isEnabled())
          .put("editable", node.isEditable()).put("scrollable", node.isScrollable())
          .put("bounds", bounds.toShortString());
      if (range != null) item.put("range", new JSONArray(new float[] {range.getMin(), range.getMax(), range.getCurrent()}));
      nodes.put(item);
    }
    for (int index = 0; index < node.getChildCount(); index++)
      collectNativeAccessibility(node.getChild(index), nodes, depth + 1, visited);
  }

  private String boundedNativeText(CharSequence value) {
    String text = value == null ? "" : value.toString();
    return text.length() <= 180 ? text : text.substring(0, 180);
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
    // In-progress output; only the runner reports test completion after cleanup.
    instrumentation.sendStatus(2, status);
  }
}
