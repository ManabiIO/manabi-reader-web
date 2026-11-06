/** @license BSD-3-Clause */
import { createManabitanDictionaryProvider } from './dictionary-providers/manabitan.mjs';
import { readerEdition } from '../config/reader-editions.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export async function selectedDictionaryProvider(root) {
  const edition = readerEdition();
  if (edition.provider === 'manabitan') {
    if (process.env.READER_PROVIDER_MODULE || process.env.READER_PROVIDER_ENTRY)
      throw new Error('The public edition cannot load a private provider.');
    return createManabitanDictionaryProvider(root);
  }
  const configured = process.env.READER_PROVIDER_MODULE;
  if (!configured || !path.isAbsolute(configured))
    throw new Error('The private edition requires an absolute build-provider module.');
  const modulePath = await fs.realpath(configured);
  if (modulePath.startsWith(path.resolve(root) + path.sep))
    throw new Error('The private build provider must be outside the public Reader checkout.');
  const module = await import(pathToFileURL(modulePath).href);
  if (typeof module.createDictionaryProvider !== 'function')
    throw new Error('The configured provider must export createDictionaryProvider.');
  const provider = await module.createDictionaryProvider(root);
  if (provider.id !== edition.id)
    throw new Error('The selected provider does not match this edition.');
  return provider;
}
