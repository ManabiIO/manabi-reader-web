/* SPDX-License-Identifier: BSD-3-Clause */
package io.manabi.reader.qualification;

import static org.junit.Assert.*;

import android.app.Instrumentation;
import android.content.ContentValues;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.UriPermission;
import android.database.Cursor;
import android.net.Uri;
import android.os.SystemClock;
import android.provider.DocumentsContract;
import android.provider.MediaStore;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Random;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import org.json.JSONObject;

/** Exercise the production import/export controls and system SAF destination.
 * Test-only content lives in one randomly named folder on a disposable emulator.
 * The second instrumentation process verifies the same archive before cleanup. */
final class PackagedBookExport {
  interface Driver {
    String readAsset(String name) throws Exception;
    String evaluate(String script) throws Exception;
    void click(String label) throws Exception;
    void awaitText(String label) throws Exception;
    void awaitPicker() throws Exception;
    void cancelPicker(String purpose) throws Exception;
  }

  private static final int MAX_BYTES = 5 * 1024 * 1024;
  private final Context context;
  private final Driver driver;
  private final String id;
  private final String title;
  private final String folder;
  private final String relative;
  private final SharedPreferences metadata;

  PackagedBookExport(Instrumentation instrumentation, Driver driver, String id) {
    assertTrue(id.matches("[a-f0-9]{32}"));
    this.context = instrumentation.getTargetContext();
    this.driver = driver;
    this.id = id;
    this.title = "manabi-export-" + id;
    this.folder = "Export-" + id;
    this.relative = "Download/ManabiQualification/" + folder;
    this.metadata = context.getSharedPreferences("manabi-export-qualification-" + id, Context.MODE_PRIVATE);
  }

  JSONObject run(String phase) throws Exception {
    if (phase.equals("verify")) return verifyRetained();
    assertTrue("This test namespace must be new", metadata.getAll().isEmpty());
    assertTrue(probe("empty").getBoolean("empty"));
    byte[] source = sourceBytes();
    Uri input = createSource(source);
    JSONObject expected;
    boolean sourceDeleted = false;
    try {
      driver.click("Add Books");
      driver.awaitPicker();
      openFixtureFolder();
      driver.click(title + ".txt");
      driver.awaitText("1–1 of 1");
      expected = probe("imported");
      assertEquals("Import must preserve the original document", sha256(source), sha256(read(input)));
      driver.click("Select");
      driver.click("Select page");
      driver.click("Export");
      driver.awaitText("1 selected on this page");
      driver.click("Choose folder and save ZIP");
      driver.awaitPicker();
      driver.cancelPicker("book-export");
      driver.awaitText("No folder selected.");
      assertEquals("Cancelled export must not change the imported data", expected.toString(), probe("imported").toString());
      assertNull("Cancelling must not grant a destination", grantedTree());

      // The same selection must remain usable after cancelling the folder picker.
      driver.click("Choose folder and save ZIP");
      driver.awaitPicker();
      openFixtureFolder();
      driver.click("Use this folder");
      driver.click("Allow");
      driver.awaitText("Saved a verified ZIP to the chosen folder.");
      Uri tree = grantedTree();
      assertNotNull("The real picker must grant the exact test-owned folder", tree);
      Map<String, Document> files = children(tree);
      assertEquals("The source and exactly one ZIP, with no abandoned partial files", 2, files.size());
      Document archive = null, original = null;
      for (Document file : files.values()) {
        if ((title + ".txt").equals(file.name)) original = file;
        else { assertNull(archive); archive = file; }
      }
      assertNotNull("The granted folder must contain this run's source document", original);
      assertEquals(sha256(source), sha256(read(original.uri)));
      assertNotNull(archive);
      assertTrue("Expected the production archive name", archive.name.matches("ttu-reader-export-[0-9-]+-[A-Za-z0-9_-]+\\.zip"));
      assertEquals("application/zip", archive.mime);
      byte[] bytes = read(archive.uri);
      assertEquals("Provider length must match the saved bytes", archive.size, bytes.length);
      assertTrue("The fixture must exercise multiple 256 KiB bridge chunks", bytes.length > 256 * 1024);
      verifyArchive(bytes, expected);
      assertEquals("Export must not change the book or reading position", expected.toString(), probe("imported").toString());

      // Remove through the app, so the retained ZIP is an independent backup.
      driver.click("Selected book actions");
      driver.click("Remove copies");
      driver.awaitText("Remove selected books?");
      driver.click("Remove");
      driver.awaitText("0–0 of 0");
      assertTrue(probe("empty").getBoolean("empty"));

      assertEquals("Remove only the source document created by this run", 1,
          context.getContentResolver().delete(input, null, null));
      sourceDeleted = true;
      assertEquals("Only the completed ZIP remains", 1, children(tree).size());
      JSONObject retained = new JSONObject().put("tree", tree.toString()).put("documentId", archive.id)
          .put("filename", archive.name).put("bytes", bytes.length).put("sha256", sha256(bytes))
          .put("expected", expected);
      assertTrue("Retain test evidence before terminating the first process",
          metadata.edit().putString("archive", retained.toString()).commit());
      if (!phase.equals("seed")) return verifyRetained();
      return evidence(retained, false, "system-picker-cancel-import-export-and-remove");
    } finally {
      if (!sourceDeleted) assertEquals("Clean up only the source document created by this run", 1,
          context.getContentResolver().delete(input, null, null));
    }
  }

  private JSONObject verifyRetained() throws Exception {
    assertTrue(probe("empty").getBoolean("empty"));
    String raw = metadata.getString("archive", null);
    assertNotNull("Archive evidence must survive process termination", raw);
    JSONObject retained = new JSONObject(raw);
    Uri tree = grantedTree();
    assertNotNull("Destination grant must survive process termination", tree);
    assertEquals(retained.getString("tree"), tree.toString());
    Map<String, Document> files = children(tree);
    assertEquals("Only the retained archive may be in the test folder", 1, files.size());
    Document archive = files.get(retained.getString("documentId"));
    assertNotNull("The exact saved document must survive", archive);
    assertEquals(retained.getString("filename"), archive.name);
    byte[] bytes = read(archive.uri);
    assertEquals(retained.getInt("bytes"), bytes.length);
    assertEquals(retained.getString("sha256"), sha256(bytes));
    verifyArchive(bytes, retained.getJSONObject("expected"));
    assertTrue("Delete only this run's verified archive", DocumentsContract.deleteDocument(context.getContentResolver(), archive.uri));
    assertTrue("Do not delete a folder containing another document", children(tree).isEmpty());
    Uri directory = DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
    assertTrue("Remove the empty test-owned folder", DocumentsContract.deleteDocument(context.getContentResolver(), directory));
    context.getContentResolver().releasePersistableUriPermission(tree,
        android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION | android.content.Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
    assertTrue(metadata.edit().remove("archive").commit());
    return evidence(retained, true, "retained-after-process-restart");
  }

  private JSONObject evidence(JSONObject retained, boolean removed, String journey) throws Exception {
    JSONObject expected = retained.getJSONObject("expected");
    return new JSONObject().put("journey", journey).put("removed", removed)
        .put("filename", retained.getString("filename")).put("bytes", retained.getInt("bytes"))
        .put("sha256", retained.getString("sha256")).put("title", title)
        .put("contentHash", expected.getString("contentHash"))
        .put("htmlBytes", expected.getInt("htmlBytes")).put("htmlSha256", expected.getString("htmlSha256"))
        .put("zip", "independent-nested-zip-and-stored-html-verification")
        .put("libraryCopyRemoved", true);
  }

  private void openFixtureFolder() throws Exception {
    driver.click("Show roots");
    driver.click("Downloads");
    driver.click("ManabiQualification");
    driver.click(folder);
  }

  private Uri createSource(byte[] bytes) throws Exception {
    ContentValues values = new ContentValues();
    values.put(MediaStore.Downloads.DISPLAY_NAME, title + ".txt");
    values.put(MediaStore.Downloads.MIME_TYPE, "text/plain");
    values.put(MediaStore.Downloads.RELATIVE_PATH, relative);
    values.put(MediaStore.Downloads.IS_PENDING, 1);
    Uri uri = context.getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
    assertNotNull(uri);
    try {
      try (OutputStream out = context.getContentResolver().openOutputStream(uri)) {
        assertNotNull(out);
        out.write(bytes);
      }
      values.clear();
      values.put(MediaStore.Downloads.IS_PENDING, 0);
      assertEquals(1, context.getContentResolver().update(uri, values, null, null));
      assertEquals(sha256(bytes), sha256(read(uri)));
      return uri;
    } catch (Throwable failure) {
      context.getContentResolver().delete(uri, null, null);
      throw failure;
    }
  }

  private byte[] sourceBytes() {
    StringBuilder source = new StringBuilder("日本語の読書 " + id + "\n");
    String alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
    Random random = new Random(id.hashCode());
    for (int line = 0; line < 8000; line++) {
      for (int index = 0; index < 96; index++) source.append(alphabet.charAt(random.nextInt(alphabet.length())));
      source.append("。\n");
    }
    return source.toString().getBytes(StandardCharsets.UTF_8);
  }

  private Uri grantedTree() throws Exception {
    for (UriPermission permission : context.getContentResolver().getPersistedUriPermissions()) {
      Uri uri = permission.getUri();
      if (!DocumentsContract.isTreeUri(uri)) continue;
      if (!"com.android.externalstorage.documents".equals(uri.getAuthority())
          && !"com.android.providers.downloads.documents".equals(uri.getAuthority())) continue;
      Uri directory = DocumentsContract.buildDocumentUriUsingTree(uri, DocumentsContract.getTreeDocumentId(uri));
      try (Cursor row = context.getContentResolver().query(directory,
          new String[] {DocumentsContract.Document.COLUMN_DISPLAY_NAME, DocumentsContract.Document.COLUMN_MIME_TYPE},
          null, null, null)) {
        if (row != null && row.moveToFirst() && folder.equals(row.getString(0))
            && DocumentsContract.Document.MIME_TYPE_DIR.equals(row.getString(1))) {
          assertTrue(permission.isReadPermission() && permission.isWritePermission());
          return uri;
        }
      }
    }
    return null;
  }

  private static final class Document {
    final String id, name, mime;
    final long size;
    final Uri uri;
    Document(Uri tree, Cursor row) {
      id = row.getString(0); name = row.getString(1); mime = row.getString(2); size = row.getLong(3);
      uri = DocumentsContract.buildDocumentUriUsingTree(tree, id);
    }
  }

  private Map<String, Document> children(Uri tree) throws Exception {
    assertEquals("Inspect only the exact granted test folder", grantedTree(), tree);
    Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
    Map<String, Document> records = new LinkedHashMap<>();
    try (Cursor rows = context.getContentResolver().query(children, new String[] {
        DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME,
        DocumentsContract.Document.COLUMN_MIME_TYPE, DocumentsContract.Document.COLUMN_SIZE}, null, null, null)) {
      assertNotNull(rows);
      while (rows.moveToNext()) {
        assertTrue("Unexpected contents in the test folder", records.size() < 8);
        Document record = new Document(tree, rows);
        assertNull(records.put(record.id, record));
      }
    }
    return records;
  }

  private byte[] read(Uri uri) throws Exception {
    try (InputStream input = context.getContentResolver().openInputStream(uri)) {
      assertNotNull(input);
      return readBounded(input);
    }
  }

  private static byte[] readBounded(InputStream input) throws Exception {
    ByteArrayOutputStream output = new ByteArrayOutputStream();
    byte[] chunk = new byte[8192];
    int count;
    while ((count = input.read(chunk)) != -1) {
      assertTrue("Qualification data exceeded its bound", output.size() + count <= MAX_BYTES);
      output.write(chunk, 0, count);
    }
    return output.toByteArray();
  }

  private static Map<String, byte[]> entries(byte[] bytes) throws Exception {
    Map<String, byte[]> records = new LinkedHashMap<>();
    int total = 0;
    try (ZipInputStream zip = new ZipInputStream(new ByteArrayInputStream(bytes), StandardCharsets.UTF_8)) {
      ZipEntry entry;
      while ((entry = zip.getNextEntry()) != null) {
        assertTrue("Unexpected archive entry count", records.size() < 40);
        assertFalse("Unexpected directory entry", entry.isDirectory());
        byte[] value = readBounded(zip);
        total += value.length;
        assertTrue("Expanded fixture exceeded its bound", total <= MAX_BYTES);
        assertNull("Duplicate archive entry", records.put(entry.getName(), value));
        zip.closeEntry();
      }
    }
    assertFalse("Archive must contain real entries", records.isEmpty());
    return records;
  }

  private void verifyArchive(byte[] bytes, JSONObject expected) throws Exception {
    Map<String, byte[]> outer = entries(bytes);
    byte[] book = null, progress = null;
    for (Map.Entry<String, byte[]> entry : outer.entrySet()) {
      assertTrue("Export escaped the selected book folder", entry.getKey().startsWith(title + "/"));
      String name = entry.getKey().substring(title.length() + 1);
      if (name.startsWith("bookdata_")) { assertNull(book); book = entry.getValue(); }
      else if (name.startsWith("progress_")) { assertNull(progress); progress = entry.getValue(); }
      else assertTrue("Unexpected data in the book-only fixture", name.startsWith("cover_"));
    }
    assertNotNull("The saved archive must contain the real book ZIP", book);
    Map<String, byte[]> inner = entries(book);
    assertNotNull(inner.get("staticdata.json"));
    JSONObject data = new JSONObject(new String(inner.get("staticdata.json"), StandardCharsets.UTF_8));
    assertEquals(title, data.getString("title"));
    assertEquals("txt", data.getString("sourceFormat"));
    assertEquals(expected.getString("contentHash"), data.getString("contentHash"));
    byte[] html = data.getString("elementHtml").getBytes(StandardCharsets.UTF_8);
    assertEquals(expected.getInt("htmlBytes"), html.length);
    assertEquals(expected.getString("htmlSha256"), sha256(html));
    if (expected.isNull("progress")) assertNull(progress);
    else {
      assertNotNull(progress);
      JSONObject saved = new JSONObject(new String(progress, StandardCharsets.UTF_8));
      JSONObject original = expected.getJSONObject("progress");
      assertEquals(original.length(), saved.length());
      for (java.util.Iterator<String> keys = original.keys(); keys.hasNext();) {
        String key = keys.next();
        assertEquals(original.get(key).toString(), saved.get(key).toString());
      }
    }
  }

  private JSONObject probe(String operation) throws Exception {
    String script = driver.readAsset("book-export-probe.js").trim().replaceAll(";\\s*$", "");
    JSONObject config = new JSONObject().put("id", id).put("operation", operation);
    driver.evaluate("window.__manabiBookExportQualification=null;(" + script + ")(" + config + ")"
        + ".then(value=>window.__manabiBookExportQualification={value},error=>window.__manabiBookExportQualification={error:String(error?.stack||error)});true;");
    long deadline = SystemClock.uptimeMillis() + 15000;
    do {
      String raw = driver.evaluate("window.__manabiBookExportQualification");
      if (!raw.equals("null")) {
        JSONObject result = new JSONObject(raw);
        assertFalse("Book export inspection failed: " + result, result.has("error"));
        return result.getJSONObject("value");
      }
      SystemClock.sleep(100);
    } while (SystemClock.uptimeMillis() < deadline);
    throw new AssertionError("Book export inspection timed out: " + operation);
  }

  private static String sha256(byte[] bytes) throws Exception {
    StringBuilder result = new StringBuilder();
    for (byte value : MessageDigest.getInstance("SHA-256").digest(bytes)) result.append(String.format("%02x", value & 0xff));
    return result.toString();
  }
}
