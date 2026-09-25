// Type surface for the pinned Foliate paginator used by the Web adapter.
export class Paginator extends HTMLElement {
  bookDir?: string;
  sections: Array<{ linear?: string }>;
  currentIndex?: number;
  open(book: { sections: unknown[]; dir?: string }): void;
  goTo(
    target: Promise<unknown> | { index: number; anchor?: unknown; select?: boolean }
  ): Promise<unknown>;
  prev(distance?: number): Promise<unknown>;
  next(distance?: number): Promise<unknown>;
  setStyles(styles: string | [string, string]): void;
  getContents(): Array<{ index: number; doc: Document; overlayer?: unknown }>;
  destroy(): void;
}
