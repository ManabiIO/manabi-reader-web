/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import React, { useLayoutEffect, useRef } from 'react';
import { consumeImportBootstrap } from '../runtime/import-bootstrap';

interface ImportFilePickerOwner {
  busy: boolean;
  filePicker: HTMLInputElement | null;
  consumeSelection(input: HTMLInputElement): void;
}

/** Keep the browser's original input alive across startup. A native file chooser
 * or automation can finish assigning its FileList after React mounts; replacing
 * that input would silently discard the selection even after an empty claim. */
export function ImportTtuFilePicker({ owner }: { owner: ImportFilePickerOwner }) {
  const host = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const container = host.current!;
    let input = container.querySelector('input');
    const attach = (picker: HTMLInputElement) => {
      input = picker;
      container.append(picker);
    };
    if (!input && !consumeImportBootstrap(attach)) {
      input = document.createElement('input');
      input.type = 'file';
      input.accept = '.zip,application/zip';
      input.multiple = true;
      attach(input);
    }
    const picker = input!;
    const consume = () => owner.consumeSelection(picker);
    picker.addEventListener('change', consume);
    owner.filePicker = picker;
    picker.disabled = owner.busy;
    consume();
    return () => {
      picker.removeEventListener('change', consume);
      if (owner.filePicker === picker) owner.filePicker = null;
    };
  }, [owner]);
  useLayoutEffect(() => {
    if (owner.filePicker) owner.filePicker.disabled = owner.busy;
  }, [owner, owner.busy]);
  return <span ref={host} style={{ display: 'contents' }} />;
}
