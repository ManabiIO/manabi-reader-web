import type {PreparedChapter} from './index.d.mts';
import type {ChapterStage} from './presentation.mjs';
export interface StageContext {signal: AbortSignal; index: number; revision: number; result: PreparedChapter;}
export function createDOMChapterStage(options: {
 container: HTMLElement;
 sanitize(html: string): string;
 configure?(root: HTMLElement, context: {index: number; revision: number}): void;
 bindResources?(root: HTMLElement, context: StageContext): Promise<() => void>;
 restore?(root: HTMLElement, context: StageContext): Promise<void>;
 report?(event: Record<string, unknown>): void;
}): (result: PreparedChapter, context: Omit<StageContext, 'result'>) => Promise<ChapterStage>;
