export interface PreparedPageTurn {
  update(progress: number): boolean;
  commit(): boolean;
  cancel(): void;
}

// Type surface for the pinned Foliate paginator used by the Web adapter.
export class Paginator extends HTMLElement {
  bookDir?: string;
  readonly pageTurnDirection: 'ltr' | 'rtl';
  readonly page: number;
  readonly pages: number;
  readonly size: number;
  readonly pageCounts: Array<number | undefined>;
  isPageNumberControlAt(x: number, y: number): boolean;
  setPageNumberDisplay(options: { expanded: boolean; weights?: number[]; color?: string }): void;
  preparePageTurn(direction: -1 | 1): Promise<PreparedPageTurn | null>;
  cancelPageTurn(): void;
  sections: Array<{ linear?: string }>;
  currentIndex?: number;
  open(book: { sections: unknown[]; dir?: string }): void;
  goTo(
    target: Promise<unknown> | { index: number; anchor?: unknown; select?: boolean },
    options?: { signal?: AbortSignal }
  ): Promise<boolean>;
  prev(distance?: number): Promise<unknown>;
  next(distance?: number): Promise<unknown>;
  setStyles(styles: string | [string, string]): void;
  getVisibleRange(): Range | undefined;
  getContents(): Array<{ index: number; doc: Document; overlayer?: unknown }>;
  destroy(): boolean;
}
