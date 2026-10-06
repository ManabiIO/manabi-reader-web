/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { UserFont } from '../lib/data/fonts';
import { sameUserFont } from '../lib/components/settings/user-font-actions';
import { parseFontImportTarget, type FontFamily, type NativeFontState } from './font-contract';
export interface FontAuthority {
  key: string;
  signal: AbortSignal;
  assertCurrent(): void;
}
export interface NativeFontDependencies {
  catalog(): UserFont[];
  availablePaths(): Promise<Set<string>>;
  hasFile(path: string): Promise<boolean>;
  selected(family: FontFamily): string;
  select(family: FontFamily, name: string, authority: FontAuthority): void;
  remove(font: UserFont, family: FontFamily, authority: FontAuthority): Promise<void>;
  save(name: string, file: File, authority: FontAuthority): Promise<void>;
  token?(): string;
  now?(): number;
}
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
/** Captures metadata privately; callers never supply cache paths or source file URIs. */
export class NativeFontService {
  private generation = 0;
  private lease?: symbol;
  private snapshot?: {
    token: string;
    owner: string;
    expires: number;
    fonts: Map<string, UserFont>;
  };
  constructor(private deps: NativeFontDependencies) {}
  dispose() {
    this.generation++;
    this.snapshot = undefined;
    this.lease = undefined;
  }
  private assert(authority: FontAuthority, generation = this.generation) {
    authority.signal.throwIfAborted();
    authority.assertCurrent();
    if (generation !== this.generation)
      throw new Error('The font manager changed. Refresh stored fonts.');
  }
  private async run<T>(
    authority: FontAuthority,
    work: (generation: number, guarded: FontAuthority) => Promise<T>
  ): Promise<T> {
    this.assert(authority);
    if (this.lease) throw new Error('Wait for the current font operation to finish.');
    const lease = Symbol('font-operation'),
      generation = this.generation;
    this.lease = lease;
    try {
      return await work(generation, {
        ...authority,
        assertCurrent: () => this.assert(authority, generation)
      });
    } finally {
      if (this.lease === lease) this.lease = undefined;
    }
  }
  private async state(authority: FontAuthority, generation: number): Promise<NativeFontState> {
    this.assert(authority, generation);
    const fonts = this.deps.catalog().map((font) => ({ ...font }));
    if (
      fonts.length > 256 ||
      fonts.some(
        (font) =>
          typeof font.name !== 'string' ||
          font.name.length > 1024 ||
          typeof font.fileName !== 'string' ||
          font.fileName.length > 512 ||
          typeof font.path !== 'string' ||
          font.path.length > 2048
      )
    )
      throw new Error(
        'The restored font catalogue cannot be shown safely. Manage these entries on web.'
      );
    const paths = await this.deps.availablePaths();
    this.assert(authority, generation);
    const current = this.deps.catalog();
    if (
      current.length !== fonts.length ||
      !fonts.every((font, index) => sameUserFont(font, current[index]))
    )
      throw new Error('Stored fonts changed while loading. Refresh stored fonts.');
    const token = this.deps.token?.() ?? crypto.randomUUID(),
      captures = new Map<string, UserFont>();
    const rows = fonts.map((font, index) => {
      const key = `font_${index}`;
      captures.set(key, font);
      return { key, name: font.name, fileName: font.fileName, available: paths.has(font.path) };
    });
    this.snapshot = {
      token,
      owner: authority.key,
      expires: (this.deps.now?.() ?? Date.now()) + 300000,
      fonts: captures
    };
    return {
      token,
      fonts: rows,
      selected: {
        primary: this.deps.selected('primary'),
        secondary: this.deps.selected('secondary')
      }
    };
  }
  read(payload: unknown, authority: FontAuthority) {
    if (!record(payload) || Object.keys(payload).length)
      throw new Error('Invalid stored-font request.');
    return this.run(authority, (generation, guarded) => this.state(guarded, generation));
  }
  action(payload: unknown, authority: FontAuthority) {
    return this.run(authority, async (generation, guarded) => {
      if (
        !record(payload) ||
        !exact(payload, ['type', 'token', 'key', 'family']) ||
        (payload.type !== 'select' && payload.type !== 'remove') ||
        (payload.family !== 'primary' && payload.family !== 'secondary') ||
        typeof payload.token !== 'string' ||
        typeof payload.key !== 'string'
      )
        throw new Error('Invalid stored-font action.');
      const target: { type: 'select' | 'remove'; token: string; key: string; family: FontFamily } =
        {
          type: payload.type,
          token: payload.token,
          key: payload.key,
          family: payload.family
        };
      const snapshot = this.snapshot,
        font = snapshot?.fonts.get(target.key);
      if (
        !snapshot ||
        snapshot.token !== target.token ||
        snapshot.owner !== guarded.key ||
        snapshot.expires <= (this.deps.now?.() ?? Date.now()) ||
        !font ||
        !this.deps.catalog().some((item) => sameUserFont(item, font))
      )
        throw new Error('Stored fonts changed. Refresh before choosing or removing a font.');
      this.snapshot = undefined;
      if (target.type === 'select') {
        const available = await this.deps.hasFile(font.path);
        this.assert(guarded, generation);
        if (!available || !this.deps.catalog().some((item) => sameUserFont(item, font)))
          throw new Error('This font file is no longer available. Add it again to use it.');
        this.deps.select(target.family, font.name, guarded);
      } else await this.deps.remove({ ...font }, target.family, guarded);
      this.assert(guarded, generation);
      return this.state(guarded, generation);
    });
  }
  import(target: unknown, file: File, authority: FontAuthority) {
    return this.run(authority, async (generation, guarded) => {
      const { name } = parseFontImportTarget(target);
      this.snapshot = undefined;
      await this.deps.save(name, file, guarded);
      this.assert(guarded, generation);
      return this.state(guarded, generation);
    });
  }
}
