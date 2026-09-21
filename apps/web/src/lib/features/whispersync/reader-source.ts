/** @license MIT — Manabi Reader adaptations; see docs/whispersync.md. */
import {
  normalizeText,
  offsetForSelection,
  rangeForMatch,
  type BookIndex,
  type CueMatch
} from './matcher';

interface Address {
  /** A unique source ID, or the whole book's root in continuous layout. */
  id?: string;
  path: number[];
  text: string;
  offset: number;
}
export interface BookLocation {
  start: Address;
  end: Address;
  /** Existing table-of-contents navigation can reveal this source section. */
  sectionId?: string;
  text: string;
}
const ignored = 'rt, rp, script, style, template, noscript, [hidden], [aria-hidden="true"]';
const children = (node: Node): Node[] =>
  Array.from(node.childNodes).filter((child) => child.nodeType !== 8);
function atPath(root: Node, path: readonly number[]): Node | undefined {
  let node: Node | undefined = root;
  for (const offset of path) {
    node = node && children(node)[offset];
    if (!node) return;
  }
  return node;
}
function nodePath(node: Node, root: Node): number[] | undefined {
  const result: number[] = [];
  while (node !== root) {
    const parent = node.parentNode;
    if (!parent) return;
    const offset = children(parent).indexOf(node);
    if (offset < 0) return;
    result.unshift(offset);
    node = parent;
  }
  return result;
}
function idsIn(root: Element): Map<string, Element | undefined> {
  const ids = new Map<string, Element | undefined>();
  for (const element of Array.from(root.querySelectorAll('[id]'))) {
    if (element.id) ids.set(element.id, ids.has(element.id) ? undefined : element);
  }
  return ids;
}
function findId(root: HTMLElement, id: string): Element | undefined {
  const escape = root.ownerDocument.defaultView?.CSS?.escape;
  if (!escape) return;
  const found = Array.from(root.querySelectorAll(`#${escape(id)}`));
  if (root.id === id) found.unshift(root);
  return found.length === 1 ? found[0] : undefined;
}
function readable(range: Range): string {
  const content = range.cloneContents();
  for (const element of Array.from(content.querySelectorAll(ignored))) element.remove();
  return normalizeText(content.textContent ?? '');
}

/** Keeps source coordinates independent of the currently virtualized section. */
export class BookSource {
  private readonly ids: Map<string, Element | undefined>;
  constructor(readonly index: BookIndex) {
    this.ids = idsIn(index.root);
  }

  private address(node: Text, offset: number): Address | undefined {
    let anchor: Element = this.index.root;
    for (
      let parent = node.parentElement;
      parent && parent !== this.index.root;
      parent = parent.parentElement
    ) {
      if (parent.id && this.ids.get(parent.id) === parent) {
        anchor = parent;
        break;
      }
    }
    const path = nodePath(node, anchor);
    return (
      path && {
        id: anchor === this.index.root ? undefined : anchor.id,
        path,
        text: node.data,
        offset
      }
    );
  }

  location(match: CueMatch): BookLocation | undefined {
    const range = rangeForMatch(this.index, match);
    if (!range) return;
    const start = this.address(range.startContainer as Text, range.startOffset);
    const end = this.address(range.endContainer as Text, range.endOffset);
    if (!start || !end) return;
    let section = range.startContainer.parentElement;
    while (section?.parentElement && section.parentElement !== this.index.root)
      section = section.parentElement;
    // Paginated rendering deliberately retains only generated ttu-* section IDs.
    const target =
      section?.id.startsWith('ttu-') && this.ids.get(section.id) === section
        ? section.id
        : start.id;
    // The existing ToC subscriber interpolates IDs into a quoted selector. Do
    // not pass selector-breaking imported IDs to that legacy boundary. Local
    // projection still uses CSS.escape and can work in continuous/current views.
    const sectionId = target && /^[\p{L}\p{N}_.:-]+$/u.test(target) ? target : undefined;
    return { start, end, sectionId, text: this.index.text.slice(match.start, match.end) };
  }

  /** Map a selection captured before the modal opens into immutable source text. */
  selectionOffset(selection: Range, liveRoot: HTMLElement): number | undefined {
    if (
      !this.index.valid() ||
      selection.collapsed ||
      !liveRoot.contains(selection.startContainer) ||
      !liveRoot.contains(selection.endContainer)
    )
      return;
    // Find a nonempty readable span actually INSIDE the selection. comparePoint
    // >= 0 also accepts nodes after its end (e.g. selecting only an illustration).
    const walker = liveRoot.ownerDocument.createTreeWalker(liveRoot, 4);
    let node: Text | undefined;
    let offset = 0;
    let next: Node | null;
    while ((next = walker.nextNode())) {
      // The hint was captured before the drawer hid the reader. Ignore modal
      // visibility on the root/ancestors, but still exclude hidden book text.
      let excluded = false;
      for (
        let parent = next.parentElement;
        parent && parent !== liveRoot;
        parent = parent.parentElement
      ) {
        if (parent.matches(ignored)) {
          excluded = true;
          break;
        }
      }
      if (excluded) continue;
      const text = next as Text;
      const start = text === selection.startContainer ? selection.startOffset : 0;
      const end = text === selection.endContainer ? selection.endOffset : text.length;
      if (
        end <= start ||
        selection.comparePoint(text, start) !== 0 ||
        selection.comparePoint(text, end) !== 0
      )
        continue;
      if (!normalizeText(text.data.slice(start, end))) continue;
      node = text;
      offset = start;
      break;
    }
    if (!node) return;
    let anchor: Element = liveRoot;
    for (
      let parent = node.parentElement;
      parent && parent !== liveRoot;
      parent = parent.parentElement
    ) {
      if (parent.id && this.ids.get(parent.id) && findId(liveRoot, parent.id) === parent) {
        anchor = parent;
        break;
      }
    }
    const sourceAnchor = anchor === liveRoot ? this.index.root : this.ids.get(anchor.id);
    const path = nodePath(node, anchor);
    const sourceNode = sourceAnchor && path && atPath(sourceAnchor, path);
    if (sourceNode?.nodeType !== 3 || sourceNode.textContent !== node.textContent) return;
    const range = this.index.root.ownerDocument.createRange();
    range.setStart(sourceNode, offset);
    range.collapse(true);
    return offsetForSelection(this.index, range);
  }

  resolve(location: BookLocation, liveRoot: HTMLElement): Range | undefined {
    if (
      !this.index.valid() ||
      !liveRoot.isConnected ||
      liveRoot.getAttribute('aria-busy') === 'true'
    )
      return;
    const resolve = (address: Address): Text | undefined => {
      const anchor = address.id ? findId(liveRoot, address.id) : liveRoot;
      const node = anchor && atPath(anchor, address.path);
      if (
        node?.nodeType !== 3 ||
        node.textContent !== address.text ||
        address.offset < 0 ||
        address.offset > address.text.length
      )
        return;
      // Check only within book content; a modal may aria-hide the entire reader.
      for (
        let parent = node.parentElement;
        parent && parent !== liveRoot;
        parent = parent.parentElement
      )
        if (parent.matches(ignored)) return;
      return node as Text;
    };
    const first = resolve(location.start),
      last = resolve(location.end);
    if (!first || !last) return;
    const range = liveRoot.ownerDocument.createRange();
    range.setStart(first, location.start.offset);
    range.setEnd(last, location.end.offset);
    // Reject middle-span changes too, not only changed endpoints. Never highlight
    // or navigate a structurally similar range with different readable text.
    return !range.collapsed && readable(range) === location.text ? range : undefined;
  }

  dispose(): void {
    this.index.dispose();
    this.ids.clear();
  }
}

export interface ReaderNavigatorEnvironment {
  document: Document;
  root: () => HTMLElement | undefined;
  selectSection: (id: string) => void;
  navigate: (range: Range) => boolean;
  timeout?: number;
}

/** Wait for the reader's normal render-ready signal; newer requests supersede old. */
export class ReaderNavigator {
  private pending?: AbortController;
  private disposed = false;
  constructor(private readonly environment: ReaderNavigatorEnvironment) {}

  cancel(): void {
    this.pending?.abort();
    this.pending = undefined;
  }
  dispose(): void {
    this.disposed = true;
    this.cancel();
  }

  async show(source: BookSource, location: BookLocation): Promise<Range | undefined> {
    this.cancel();
    if (this.disposed || !source.index.valid()) return;
    const controller = new AbortController();
    this.pending = controller;
    const { document, root, selectSection, navigate } = this.environment;
    const availableRoot = () => {
      const live = root();
      // Matching may run while a modal hides the reader; navigation must not.
      return live?.isConnected && !live.closest('[hidden], [aria-hidden="true"], [inert]')
        ? live
        : undefined;
    };
    const resolve = () => {
      const live = availableRoot();
      return live && source.resolve(location, live);
    };
    try {
      let range = resolve();
      if (!range) {
        const Observer = document.defaultView?.MutationObserver;
        if (!Observer) throw new Error('Reader navigation is unavailable in this browser');
        range = await new Promise<Range | undefined>((accept, reject) => {
          let finished = false;
          let requestedSection = false;
          const finish = (value?: Range, error?: Error) => {
            if (finished) return;
            finished = true;
            observer.disconnect();
            clearTimeout(timer);
            controller.signal.removeEventListener('abort', abort);
            if (error) reject(error);
            else accept(value);
          };
          const check = () => {
            if (finished || !availableRoot()) return;
            try {
              const next = resolve();
              if (next) {
                finish(next);
                return;
              }
              if (requestedSection) return;
              if (!location.sectionId) {
                finish(
                  undefined,
                  new Error(
                    'This passage has no stable chapter identifier. Use continuous reading mode to locate it.'
                  )
                );
                return;
              }
              requestedSection = true;
              selectSection(location.sectionId);
              const mounted = resolve();
              if (mounted) finish(mounted);
            } catch (error) {
              finish(
                undefined,
                error instanceof Error ? error : new Error('Reader navigation failed')
              );
            }
          };
          const abort = () => finish();
          const observer = new Observer(check);
          observer.observe(document.documentElement, {
            subtree: true,
            childList: true,
            characterData: true,
            attributes: true,
            attributeFilter: ['aria-busy', 'id', 'hidden', 'aria-hidden', 'inert']
          });
          const timer = setTimeout(
            () =>
              finish(
                undefined,
                new Error(
                  'The requested passage did not become ready. Close other dialogs and wait for the chapter to load, then try Show in book again.'
                )
              ),
            this.environment.timeout ?? 5000
          );
          controller.signal.addEventListener('abort', abort, { once: true });
          check();
        });
      }
      if (!range || controller.signal.aborted || this.disposed || this.pending !== controller)
        return;
      // A same-task DOM update may precede its observer callback.
      range = resolve();
      if (!range) return;
      if (!navigate(range))
        throw new Error(
          'The reader is not ready to navigate to this passage. Try Show in book again.'
        );
      return range;
    } finally {
      if (this.pending === controller) this.pending = undefined;
    }
  }
}
