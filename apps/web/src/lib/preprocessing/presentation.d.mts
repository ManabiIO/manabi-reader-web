import type { PreparedChapter } from './index.d.mts';
import type { BookPreprocessingSession } from './session.mjs';
export interface ChapterStage {
  root: HTMLElement;
  prepare?(context: { signal: AbortSignal; index: number; revision: number }): Promise<void>;
  commit(): void;
  rollback(): void;
}
export class ChapterOpeningController {
  constructor(options: {
    session: BookPreprocessingSession;
    stage: (
      result: PreparedChapter,
      context: { index: number; revision: number; signal: AbortSignal }
    ) => Promise<ChapterStage>;
    ready?: (context: { index: number; revision: number; hasAnnotations: boolean }) => void;
    report?: (event: Record<string, unknown>) => void;
    isVisible?: () => boolean;
  });
  open(index: number): Promise<PreparedChapter>;
  dispose(): void;
}
export function chapterForResume(sectionCounts: number[], exploredCharCount: number): number;
