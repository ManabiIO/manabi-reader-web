/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { useEffect, useLayoutEffect, useRef } from 'react';
import { useStore } from '$runtime/use-store';
import { storageSource$ } from '$lib/data/storage/storage-view';
import { StorageKey } from '$lib/data/storage/storage-types';
import { account } from '$lib/manabi/client';
import { allLinkedBooks } from '$lib/manabi/books';
import { isMobile$ } from '$lib/functions/utils';
import { getDropEventFiles } from '$lib/functions/file-dom/get-drop-event-files';
import { formatPageTitle } from '$lib/functions/format-page-title';
import { videoLearningEnabled } from '$lib/media/feature';

import { LibraryController } from './library-controller';
import { WorkspaceController } from './workspace-controller';
import { HeaderController } from './header-controller';
import { HeaderView } from './header';
import { LibraryTabs } from './navigation';
import { WorkspaceView } from './workspace';
import { useController } from './use-controller';
import { LegacyBookList } from './legacy-book-list';
import { Button, Dialog } from './primitives';
import { EditorsPicks } from './editors-picks';
import './library.css';
import '$lib/library/library-menu.css';
export interface LibraryScreenProps {
  /** Optional host navigation boundary; the default uses the shared route adapter. */
  onOpenBook?: (id: number, searchToken?: string) => Promise<void>;
  onReady?: (library: LibraryController, workspace: WorkspaceController) => void;
}
export function LibraryScreen({ onOpenBook, onReady }: LibraryScreenProps = {}) {
  const source = useStore(storageSource$),
    accountState = useStore(account),
    ownership = useStore(allLinkedBooks),
    mobile = useStore(isMobile$);
  const modern = source === StorageKey.BROWSER;
  const m = useController(() => new LibraryController());
  const w = useController(() => new WorkspaceController(), modern);
  const h = useController(() => new HeaderController());
  const toolbar = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    m.libraryWorkspace = w;
    m.bookManagerHeader = h;
    if (onOpenBook) m.gotoBook = onOpenBook;
    h.dispatch = (event, payload) => {
      switch (event) {
        case 'filesChange':
          void m.onFilesChange(payload as FileList);
          break;
        case 'importBackup':
          void m.onImportBackup(payload as File);
          break;
        case 'selectAllClick':
          m.onSelectAllBooks();
          break;
        case 'removeClick':
          void m.confirmSelectedRemoval();
          break;
        case 'domainHintClick':
          m.onDomainHintClick();
          break;
        case 'bugReportClick':
          m.onBugReportClick();
          break;
        case 'backToBookClick':
          m.backToCurrentBook();
          break;
        case 'selectionToStatistics':
          void m.openSelectedStatistics();
          break;
        case 'deleteStatistics':
          void m.onDeleteStatistics();
          break;
        case 'replicateData':
          m.onReplicateData();
          break;
        case 'collectionsClick':
          w.collectionsOpen = true;
          break;
        case 'editorsPicksClick':
          m.editorsPicksOpen = true;
          break;
        case 'cancelReplication':
          m.cancelToken.abort();
          m.pickDownload?.abort();
          m.replicationProgressRemaining = 'Canceling ...';
          break;
      }
    };
    w.onPrepareBook = ({ prepare, locator }) => {
      void m.onBookClick(undefined, prepare, locator);
    };
    w.onRemoveBook = (id) => {
      void m.removeBooks([id]);
    };
    w.onSelectionCancel = () => {
      m.selectMode = false;
    };
    w.onSelectionChange = (selection) => {
      if (!selection.ids.length && !selection.previews.length && !m.selectMode) return;
      m.selectMode = true;
      m.selectedBookIds = new Set(selection.ids.filter((id) => w.selectableBookIds.includes(id)));
      m.selectedPreviewKeys = new Set(
        selection.previews.filter((key) => w.selectablePreviewKeys.includes(key))
      );
    };
    w.onEligibilityChange = (eligibility) => {
      m.selectionEligibility = eligibility;
      m.reconcile();
    };
    let eligibilitySignature = '';
    const syncWorkspace = () => {
      const eligibility = w.selectionEligibility,
        signature = JSON.stringify(eligibility);
      if (signature !== eligibilitySignature) {
        eligibilitySignature = signature;
        m.selectionEligibility = eligibility;
      }
      m.destinationTitle = w.destinationTitle;
      m.libraryMenu = w.menu;
    };
    const stopWorkspace = w.subscribe(syncWorkspace);
    const stopHeader = h.subscribe(() => {
      if (h.selectMode !== m.selectMode) m.selectMode = h.selectMode;
    });
    syncWorkspace();
    onReady?.(m, w);
    return () => {
      stopWorkspace();
      stopHeader();
    };
  }, [m, w, h, onOpenBook, onReady]);
  useLayoutEffect(() => {
    if (modern) {
      w.bookCards = m.bookCards;
      w.currentBookId = m.currentBookAvailable ? m.currentBookId : undefined;
      w.selectedBookIds = m.selectedBookIds;
      w.selectedPreviewKeys = m.selectedPreviewKeys;
      w.selectMode = m.selectMode;
    }
    h.modernLibrary = modern;
    h.title = m.destinationTitle;
    h.libraryMenu = modern ? m.libraryMenu : undefined;
    h.collectionsExpanded = w.collectionsOpen;
    h.hasBookOpened = m.currentBookAvailable;
    h.selectedCount = m.selectedBookIds.size + m.selectedPreviewKeys.size;
    h.hasBooks = modern
      ? !!(m.selectableBookIds.length || m.selectablePreviewKeys.length)
      : !!m.bookCards.length;
    h.cancelTooltip = m.cancelTooltip;
    h.replicationProgress = m.replicationProgress;
    h.replicationToProgress = m.replicationToProgress;
    h.replicationProgressRemaining = m.replicationProgressRemaining;
    h.selectMode = m.selectMode;
  }, [m.getSnapshot(), w.getSnapshot(), modern, h, m, w]);
  useEffect(() => {
    document.title = formatPageTitle('Library');
    const scroll = () => {
      m.libraryScrollY = window.scrollY;
    };
    const hide = () => m.pickDownload?.abort();
    window.addEventListener('scroll', scroll, { passive: true });
    window.addEventListener('pagehide', hide);
    const resize = new ResizeObserver(() => {
      if (toolbar.current) m.libraryHeaderHeight = toolbar.current.clientHeight;
    });
    if (toolbar.current) resize.observe(toolbar.current);
    return () => {
      window.removeEventListener('scroll', scroll);
      window.removeEventListener('pagehide', hide);
      resize.disconnect();
    };
  }, [m]);
  const empty = (
    <section
      data-slot="library-empty-state"
      className="mx-auto mt-6 max-w-4xl min-w-0 rounded-3xl border border-border bg-card p-[20px] text-left shadow-sm sm:mt-10 sm:p-8"
    >
      <h2 className="text-xl font-semibold">Make room for a good book</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Add your own books, connect a library, or open one of our picks.
      </p>
      <div className="mt-7 grid min-w-0 grid-cols-[minmax(0,1fr)] gap-7 sm:grid-cols-2">
        <section aria-labelledby="add-books-heading">
          <h3 id="add-books-heading" className="text-base font-semibold">
            Add books
          </h3>
          <div className="mt-3 grid gap-2">
            <Button onClick={h.openFilePicker}>Import File(s)</Button>
            {!mobile && (
              <Button variant="outline" onClick={h.openFolderPicker}>
                Import Folder(s)
              </Button>
            )}
            <Button variant="outline" onClick={h.openBackupPicker}>
              Import Backup
            </Button>
            <Button variant="link" href="/import-ttu">
              Import from Ttu Ebook Reader
            </Button>
            <Button variant="link" href="/import-ttu?source=yatsu">
              Import from Yatsu Reader
            </Button>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">You can also drop ebook files here.</p>
        </section>
        <section aria-labelledby="connect-library-heading">
          <h3 id="connect-library-heading" className="text-base font-semibold">
            Connect a library
          </h3>
          <div className="mt-3 grid gap-2">
            {['Local folder', 'Google Drive', 'Dropbox', 'OneDrive'].map((name, index) => (
              <Button
                key={name}
                variant="secondary"
                href={`/connections#${index ? 'cloud' : 'local'}-heading`}
              >
                {name}
              </Button>
            ))}
          </div>
        </section>
      </div>
      {(!modern ||
        (ownership !== null &&
          accountState.status !== 'loading' &&
          !m.activeLibraryCards.length)) && (
        <div className="mt-8">
          <EditorsPicks
            embedded
            headingId="editors-picks-empty-heading"
            openingId={m.openingPickId}
            onOpen={m.openEditorsPick}
          />
        </div>
      )}
    </section>
  );
  return (
    <div className="library-react min-h-full">
      <div
        ref={toolbar}
        className={`sticky top-0 z-10 ${modern ? 'library-nav-shell' : ''} ${m.libraryScrollY > 8 ? 'scrolled' : ''}`}
      >
        <HeaderView c={h} />
        {videoLearningEnabled && modern && (
          <div className="library-section-switcher">
            <LibraryTabs />
          </div>
        )}
      </div>
      <div
        role="region"
        aria-label="Book library"
        style={{ '--library-header-height': `${m.libraryHeaderHeight}px` } as React.CSSProperties}
        className="min-h-full"
        onDragEnter={(e) => e.preventDefault()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          void getDropEventFiles(e.nativeEvent).then(m.onFilesChange);
        }}
      >
        {m.loading ? (
          <p role="status">Loading...</p>
        ) : modern ? (
          <WorkspaceView c={w}>{empty}</WorkspaceView>
        ) : m.bookCards.length ? (
          <LegacyBookList
            bookCards={m.bookCards}
            currentBookId={m.currentBookId}
            selectedBookIds={m.selectedBookIds}
            onOpen={(id) => void m.onBookClick(id)}
            onRemove={(id) => void m.removeBooks([id])}
          />
        ) : (
          empty
        )}
      </div>
      <Dialog.Root
        open={m.editorsPicksOpen}
        onOpenChange={(open: boolean) => {
          m.editorsPicksOpen = open;
        }}
      >
        <Dialog.Content className="sm:max-w-2xl">
          <Dialog.Title>Editor's Picks</Dialog.Title>
          <Dialog.Description>Open a book selected by Manabi.</Dialog.Description>
          <EditorsPicks
            headingId="editors-picks-dialog-heading"
            openingId={m.openingPickId}
            onOpen={m.openEditorsPick}
          />
        </Dialog.Content>
      </Dialog.Root>
    </div>
  );
}
