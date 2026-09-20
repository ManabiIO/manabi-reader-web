/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

export const seriesMetadataFilename = '.Manabi-Reader.yaml';
export function libraryName(value: string): string {
  const name = value.trim();
  // eslint-disable-next-line no-control-regex
  if (!name || name.length > 240 || /[\x00-\x1f\x7f]/.test(name))
    throw new Error('Enter a name of 1–240 characters.');
  return name;
}
export function directoryName(value: string): string {
  const name = libraryName(value);
  if (
    /[\\/:*?"<>|]/.test(name) ||
    /^[. ]|[. ]$/.test(name) ||
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)
  )
    throw new Error(
      'Use a portable folder name without slashes, reserved names, or punctuation such as : or ?.'
    );
  return name;
}
export function encodeSeriesMetadata(name: string): string {
  // JSON-quoted strings are YAML 1.2 scalars; punctuation cannot turn into YAML syntax.
  return `name: ${JSON.stringify(libraryName(name))}\n`;
}
/** Deliberately bounded name-only YAML schema. Never execute tags, aliases, or silently discard unknown fields. */
export function decodeSeriesMetadata(text: string): string {
  if (new TextEncoder().encode(text).length > 4096)
    throw new Error('Series metadata is too large.');
  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((l) => l.trim() && !l.trim().startsWith('#'));
  if (lines[0]?.trim() === '---') lines.shift();
  if (lines.at(-1)?.trim() === '...') lines.pop();
  if (lines.length !== 1 || !/^name:\s+/.test(lines[0]))
    throw new Error('Expected one name field in .Manabi-Reader.yaml.');
  const scalar = lines[0].replace(/^name:\s+/, '').trim();
  let value: unknown;
  if (scalar.startsWith('"')) {
    // A trailing YAML comment is allowed after a complete JSON quoted scalar.
    const match = scalar.match(/^("(?:[^"\\]|\\.)*")(?:\s+#.*)?$/);
    if (!match) throw new Error('Invalid quoted series name.');
    value = JSON.parse(match[1]);
  } else if (scalar.startsWith("'")) {
    const match = scalar.match(/^'((?:[^']|'')*)'(?:\s+#.*)?$/);
    if (!match) throw new Error('Invalid quoted series name.');
    value = match[1].replaceAll("''", "'");
  } else {
    if (/^[!&*{[>|%@`]/.test(scalar) || /:\s/.test(scalar))
      throw new Error('Unsupported YAML series name. Quote the name.');
    value = scalar.replace(/\s+#.*$/, '');
  }
  if (typeof value !== 'string') throw new Error('The series name must be text.');
  return libraryName(value);
}
