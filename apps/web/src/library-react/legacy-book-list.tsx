/** @license BSD-3-Clause; Copyright (c) 2026, ッツ Reader Authors */
import { useEffect, useState } from 'react';
import { Image as ImageIcon } from '@phosphor-icons/react';
import { createLocalCoverUrl } from '$lib/functions/book-security/local-media';
import type { BookCardProps } from '$lib/components/book-card/book-card-props';
import { ActionMenu } from './navigation';
import { Menu } from './primitives';
function LegacyBookCard({ book, open }: {
    book: BookCardProps;
    open(): void;
}) {
    const [url, setUrl] = useState(''), [loading, setLoading] = useState(true);
    useEffect(() => { const value = createLocalCoverUrl(book.imagePath); setUrl(value); setLoading(true); return () => { if (value.startsWith('blob:'))
        URL.revokeObjectURL(value); }; }, [book.imagePath]);
    return <button type="button" className="relative block aspect-[2/3] w-full overflow-hidden rounded-2xl bg-card text-left outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`Read ${book.title}`} onClick={open}><div className="absolute inset-0"><div className="h-full w-full text-5xl sm:text-7xl">{loading && <ImageIcon className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"/>}{url && <img decoding="async" loading="lazy" referrerPolicy="no-referrer" className={`book-cover relative h-full w-full object-cover transition delay-150 duration-700 ease-out ${loading ? 'blur' : ''}`} src={url} alt={`${book.title}_cover`} onLoad={() => setLoading(false)}/>}</div><div className="absolute inset-x-0 bottom-0"><div className="h-16 bg-card p-0.5 px-1.5 text-justify text-sm text-foreground sm:h-21 sm:p-1.5 sm:text-base"><span className="line-clamp-3">{book.title}</span></div><div className="h-2.5 bg-border"><div className="h-full rounded bg-primary" style={{ width: `${book.progress * 100}%` }}/></div></div></div></button>;
}
export function LegacyBookList({ bookCards, currentBookId, selectedBookIds, onOpen, onRemove }: {
    bookCards: BookCardProps[];
    currentBookId?: number;
    selectedBookIds: ReadonlySet<number>;
    onOpen(id: number): void;
    onRemove(id: number): void;
}) {
    const dateInfo = (time: number) => time ? new Date(time).toLocaleString() : 'No Data';
    return <div className="grid grid-cols-2 gap-4 p-6 pb-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">{bookCards.map(book => <article key={book.id} className={`min-w-0 ${book.isPlaceholder ? 'opacity-60' : ''}`} aria-label={book.title}><div className={`relative rounded-2xl ${selectedBookIds.has(book.id) ? 'ring-2 ring-primary' : ''}`}><LegacyBookCard book={book} open={() => onOpen(book.id)}/>{selectedBookIds.has(book.id) && <span className="pointer-events-none absolute left-2 top-2 rounded-full bg-primary px-2 py-1 text-xs text-primary-foreground">Selected</span>}{book.id === currentBookId && <span className="pointer-events-none absolute right-2 top-2 rounded-full bg-card px-2 py-1 text-xs">Reading</span>}</div><div className="mt-2 flex justify-end"><ActionMenu label="Book actions" title={`Actions for ${book.title}`}><Menu.Item onSelect={() => onOpen(book.id)}>Open or select book</Menu.Item><Menu.Separator /><Menu.Label>Book details</Menu.Label><div className="space-y-2 px-2 py-2 text-xs text-muted-foreground"><p>Characters: {book.characters || 'No Data'}</p><p>Last Read: {dateInfo(book.lastBookOpen)}</p><p>Bookmarked: {dateInfo(book.lastBookmarkModified)}</p><p>Last Update: {dateInfo(book.lastBookModified)}</p></div><Menu.Separator /><Menu.Item variant="destructive" onSelect={() => onRemove(book.id)}>Remove book</Menu.Item></ActionMenu></div></article>)}</div>;
}

