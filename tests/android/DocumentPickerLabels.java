/* SPDX-License-Identifier: BSD-3-Clause */
package io.manabi.reader.qualification;

/** DocumentsUI list rows name the file directly; grid tiles append metadata.
 * Keep this matching separate from application controls and preview actions. */
final class DocumentPickerLabels {
  static boolean matches(String filename, CharSequence text, CharSequence description) {
    if (filename == null || filename.isEmpty()) return false;
    if (text != null && filename.contentEquals(text)) return true;
    return description != null && (filename.contentEquals(description)
        || description.toString().startsWith(filename + ", "));
  }
}
