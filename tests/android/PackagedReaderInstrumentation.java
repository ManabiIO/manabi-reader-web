/* SPDX-License-Identifier: BSD-3-Clause */
package io.manabi.reader.qualification;

import android.app.Activity;
import android.app.Instrumentation;
import android.os.Bundle;
import android.util.Log;

/**
 * Runs the single packaged-host qualification using platform APIs. AndroidX
 * test's shared app dependencies can be absent after production R8 shrinking;
 * the harness must not change the app's keep rules just to retain test helpers.
 */
public final class PackagedReaderInstrumentation extends Instrumentation {
  private Bundle arguments;

  @Override public void onCreate(Bundle arguments) {
    super.onCreate(arguments);
    this.arguments = arguments == null ? new Bundle() : new Bundle(arguments);
    start();
  }

  @Override public void onStart() {
    super.onStart();
    Bundle result = new Bundle();
    Bundle status = new Bundle();
    status.putString("id", "ManabiPackagedReader");
    status.putString("class", PackagedReaderTest.class.getName());
    status.putString("test", "packagedReaderRuntime");
    status.putInt("numtests", 1);
    status.putInt("current", 1);
    boolean started = false;
    int code = Activity.RESULT_CANCELED;
    try {
      String testClass = PackagedReaderTest.class.getName();
      if (!testClass.equals(arguments.getString("class", testClass)))
        throw new IllegalArgumentException("Only the packaged Reader qualification is supported");
      waitForIdleSync();
      sendStatus(1, status);
      started = true;
      new PackagedReaderTest(this, arguments).packagedReaderRuntime();
      // Emit success only after the test and its cleanup have completed.
      sendStatus(0, status);
      result.putString(REPORT_KEY_STREAMRESULT, "\nOK (1 test)\n");
      code = Activity.RESULT_OK;
    } catch (Throwable failure) {
      String stack = Log.getStackTraceString(failure);
      if (started) {
        status.putString("stack", stack);
        sendStatus(-2, status);
      }
      result.putString(REPORT_KEY_STREAMRESULT, "\nFAILURES!!!\n" + stack);
    } finally {
      finish(code, result);
    }
  }
}
