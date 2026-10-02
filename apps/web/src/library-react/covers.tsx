/** @license BSD-3-Clause; Copyright (c) 2026, ッツ Reader Authors */
import { useEffect, useState, type CSSProperties } from 'react';
import { createLocalCoverUrl } from '$lib/functions/book-security/local-media';
import { creatorLine } from '$lib/library/book-metadata';
import type { ShelfBook } from '$lib/library/view-model';
import type { PageDirection } from '$lib/library/direction';
import { HardDrive } from '@phosphor-icons/react';
export function BookCover({ imagePath = '', title = '', blurred = false, author = '', identity = '', direction = 'unknown', onWidth }: {
    imagePath?: string | Blob;
    title?: string;
    blurred?: boolean;
    author?: string;
    identity?: string;
    direction?: PageDirection;
    onWidth?: (fraction: number) => void;
}) {
    const [url, setUrl] = useState(''), [ratio, setRatio] = useState(2 / 3);
    useEffect(() => { const value = createLocalCoverUrl(imagePath); setUrl(value); setRatio(2 / 3); onWidth?.(1); return () => { if (value.startsWith('blob:'))
        URL.revokeObjectURL(value); }; }, [imagePath]);
    const palette = [...(identity || title)].reduce((value, character) => (value * 31 + character.codePointAt(0)!) % 360, 211);
    return <div className="cover-stage" data-direction={direction} aria-hidden="true"><div className={`cover-surface ${blurred ? 'blurred' : ''} ${direction === 'rtl' ? 'right-bound' : ''}`} data-cover-blurred={blurred} style={{ aspectRatio: ratio, width: `${Math.min(1, ratio / (2 / 3)) * 100}%` }}>{url ? <img draggable={false} src={url} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onLoad={event => { const image = event.currentTarget; if (image.naturalHeight) {
        const value = image.naturalWidth / image.naturalHeight;
        setRatio(value);
        onWidth?.(Math.min(1, value / (2 / 3)));
    } }} onError={() => { setUrl(''); setRatio(2 / 3); onWidth?.(1); }}/> : <div className="placeholder-cover" style={{ '--cover-hue': `${palette}deg` } as CSSProperties}><span className="placeholder-title">{title}</span>{author && <span className="placeholder-author">{author}</span>}</div>}<span className="binding"/><span className="cover-edge"/></div></div>;
}
export function CoverStack({ books, hero = false }: {
    books: ShelfBook[];
    hero?: boolean;
}) {
    const visible = Array.from(new Map(books.map(book => [book.key, book])).values()).slice(0, hero ? 5 : 2);
    return <div className="cover-stack-container h-full w-full"><div className={`cover-stack ${hero ? 'hero' : ''}`} aria-hidden="true" data-cover-count={visible.length}>{visible.map((book, index) => <div key={book.key} className={`stack-item ${index === 0 ? 'front' : ''}`} style={{ '--index': index } as CSSProperties}><BookCover imagePath={book.imagePath} blurred={book.coverBlur} title={book.title} author={creatorLine(book.creators)} identity={book.key} direction={book.direction}/></div>)}</div></div>;
}
export function SourceIcon({ provider, name = '' }: {
    provider?: string;
    name?: string;
}) {
    if (!provider)
        return null;
    const labels: Record<string, string> = { google: 'Google Drive', dropbox: 'Dropbox', onedrive: 'OneDrive', local: 'Local folder' };
    const label = `${labels[provider] || 'Connected library'}${name && provider === 'local' ? `: ${name}` : ''}`;
    return <span className="inline-flex shrink-0 items-center text-muted-foreground" title={label} aria-label={label} role="img">{provider === 'local' ? <HardDrive className="size-4" aria-hidden="true"/> : <svg className="size-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d={provider === 'google' ? 'M8.3 2h7.4L23 15h-7.4L8.3 2ZM7.1 3.9l3.7 6.4L3.5 23 0 16.6 7.1 3.9ZM7.2 17H22l-3.5 6H3.7l3.5-6Z' : provider === 'dropbox' ? 'm6 2 6 4-6 4-6-4 6-4Zm12 0 6 4-6 4-6-4 6-4ZM6 10l6 4-6 4-6-4 6-4Zm12 0 6 4-6 4-6-4 6-4Zm-6 5 6 4-6 4-6-4 6-4Z' : provider === 'onedrive' ? 'M9 5a6 6 0 0 1 10.8 3.5A5 5 0 0 1 19 18H5a5 5 0 1 1 1.1-9.9A6 6 0 0 1 9 5Z' : 'M3 5h7l2 2h9v13H3V5Zm2 4v9h14V9H5Z'}/></svg>}</span>;
}

