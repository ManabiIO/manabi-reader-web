import type {
  Preprocessor,
  PreparedChapter,
  SessionOptions,
  VocabularySnapshot
} from './index.d.mts';
export class GenerationChanged extends Error {}
export class BookPreprocessingSession {
  constructor(options: SessionOptions);
  readonly provider: Preprocessor;
  prepare(index: number, signal: AbortSignal): Promise<PreparedChapter>;
  open(index: number): Promise<{ result: PreparedChapter; revision: number; signal: AbortSignal }>;
  admitPresentation(revision: number, result: PreparedChapter): Promise<void>;
  invalidate(): void;
  didPresent(revision: number, options?: { isVisible?: () => boolean }): void;
  vocabulary(): VocabularySnapshot;
  dispose(): void;
}
