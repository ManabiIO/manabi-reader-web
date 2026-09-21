/** @license MIT — Manabi Reader adaptations; see docs/whispersync.md. */
import type { BookLocation, BookSource, ReaderNavigator } from './reader-source';

interface NavigationCallbacks {
  highlight: (range: Range) => void;
  error: (message: string) => void;
}

/**
 * Owns the UI side of asynchronous navigation, including already-resolved
 * promises. Canceling the DOM waiter alone cannot retire a queued continuation.
 */
export class ReaderNavigationSession {
  private generation = 0;
  private automatic = false;
  private currentCue = -1;
  private disposed = false;

  constructor(
    private readonly navigator: Pick<ReaderNavigator, 'show' | 'cancel'>,
    private readonly callbacks: NavigationCallbacks
  ) {}

  cancel(): void {
    this.generation += 1;
    this.automatic = false;
    this.navigator.cancel();
  }

  /** Rendering the same cue again is not a new playback/navigation intent. */
  cueChanged(cue: number): void {
    if (cue !== this.currentCue) {
      this.currentCue = cue;
      this.cancelAutomatic();
    }
  }

  /** Cue gaps, unmatched cues and Pause supersede only audio-driven requests. */
  cancelAutomatic(): void {
    if (this.automatic) this.cancel();
  }

  async show(source: BookSource, location: BookLocation, automatic = false): Promise<void> {
    this.cancel();
    if (this.disposed) return;
    const generation = this.generation;
    this.automatic = automatic;
    try {
      const range = await this.navigator.show(source, location);
      if (!this.disposed && generation === this.generation && range)
        this.callbacks.highlight(range);
    } catch (error) {
      if (!this.disposed && generation === this.generation) {
        this.callbacks.error(
          error instanceof Error ? error.message : 'The reader could not locate this passage.'
        );
      }
    } finally {
      if (generation === this.generation) this.automatic = false;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.cancel();
  }
}

interface BookmarkNavigation<Bookmark> {
  formatBookmarkDataByRange: (bookId: number, range: Range) => Bookmark | undefined;
  // The reader's public interface currently says void, but its paginated
  // implementation returns false when the geometry cannot satisfy the scroll.
  scrollToBookmark: (bookmark: Bookmark) => unknown;
}

export function navigateBookmark<Bookmark>(
  manager: BookmarkNavigation<Bookmark> | undefined,
  bookId: number,
  range: Range
): boolean {
  const bookmark = manager?.formatBookmarkDataByRange(bookId, range);
  return bookmark !== undefined && manager!.scrollToBookmark(bookmark) !== false;
}
