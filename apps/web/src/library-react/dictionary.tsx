/** @license BSD-3-Clause; Copyright (c) 2026, ッツ Reader Authors */
import { Fragment, type ReactNode, type CSSProperties } from 'react';
/** @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors. All rights reserved.
 * React/controller port of lib/search/dictionary-search.svelte; transactions retain their original guards.
 */
import { queryTask, type SearchState } from '$lib/search/query-task.mjs';
import { dictionaryLease, type DictionaryResult, type DictionaryRuntime, type DictionaryStatus, type RecommendedDictionary } from '$lib/search/dictionary-runtime';
import { DictionaryController } from './dictionary-controller';
import { readStore, tick } from './observable-controller';
import { Action, Button, Dialog, Menu, Sheet, CloseButton, Icon } from './primitives';
import { BookOpen, BookmarkSimple, Books, CalendarBlank, CheckCircle as CircleCheck, DotsThree as MoreHorizontal, DownloadSimple, FolderOpen, ImageSquare, Info, List, PencilSimple, Plus, Trash, CaretRight, FileText, Video } from '@phosphor-icons/react';
export function DictionaryView({ c, children }: {
    c: DictionaryController;
    children?: ReactNode;
}) {
    return <>
    <section aria-labelledby={"dictionary-search-heading"} aria-busy={c.state.state === 'loading' || c.installing || c.statusLoading || !!c.managing}>
    <header>
    <h2 id={"dictionary-search-heading"}>{"Dictionary"}</h2>
    {!c.full ? <><button type={"button"} onClick={c.expand}>{"See all dictionary results "}<span aria-hidden={"true"}>{"→"}</span></button></> : null}
    </header>
        {c.state.state === 'loading' ? <>
        <p role={"status"} className={["note"].filter(Boolean).join(" ")}>
        <span aria-hidden={"true"} className={["spinner"].filter(Boolean).join(" ")}/>{"Searching dictionary… "}</p>
        </> : <>{c.state.state === 'error' ? <>
            <p role={"status"} className={["note"].filter(Boolean).join(" ")}>
            {c.state.error}{c.retryableError ? <>
                <button type={"button"} onClick={c.retry}>{"Retry dictionary"}</button>
                </> : null}
            </p>
            </> : <>{c.state.value ? <>
                    {c.state.value.dictionaryCount === 0 ? <>
                    <p className={["note"].filter(Boolean).join(" ")}>{" No enabled local dictionary yet. "}{!c.full ? <><button type={"button"} onClick={c.expand}>{"Set up dictionary"}</button></> : null}
                    </p>
                    </> : <>
                        {c.state.value.prefix ? <><p className={["note"].filter(Boolean).join(" ")}>{" Showing prefix matches for "}<span lang={"ja"}>{c.state.value.matchedQuery}</span>
                        </p></> : <>{c.state.value.matchedQuery !== c.query.trim() ? <><p className={["note"].filter(Boolean).join(" ")}>{" Showing matches for "}<span lang={"ja"}>{c.state.value.matchedQuery}</span>
                            </p></> : null}</>}
                        {c.full && c.state.value.lookup ? <>
                        <Fragment key={`${c.signature}:${c.state.value?.matchedQuery}:${c.state.value?.dictionaryCount}`}><Action className={["full-dictionary"].filter(Boolean).join(" ")} as={"div"} action={c.definitions} options={c.state.value}/></Fragment>
                        </> : <>
                        <ul aria-label={"Dictionary previews"}>
                            {(c.state.value.preview.items).map((item, __index) => <Fragment key={item.id}>
                            <li>
                            <button type={"button"} onClick={c.expand} className={["preview"].filter(Boolean).join(" ")}>
                            <span lang={"ja"} className={["headword"].filter(Boolean).join(" ")}>{item.term}</span>{item.reading !== item.term ? <><span lang={"ja"} className={["reading"].filter(Boolean).join(" ")}>{item.reading}</span></> : null}
                                {(item.senses.slice(0, 1)).map((sense, __index) => <Fragment key={__index}><span className={["sense"].filter(Boolean).join(" ")}>{sense.text}<small>{sense.source}{sense.tags.length
                                        ? ` · ${sense.tags.join(' · ')}`
                                        : ''}</small></span></Fragment>)}
                            {!item.senses.length ? <><span className={["note"].filter(Boolean).join(" ")}>{"Open full definition"}</span></> : null}
                            </button>
                            </li>
                            </Fragment>)}
                        </ul>
                        {!c.state.value.preview.items.length ? <><p className={["note"].filter(Boolean).join(" ")}>{" No dictionary matches. Keep typing, try kana or another spelling, or use a trailing * for an explicit prefix search. "}</p></> : null}
                        </>}
                    </>}
                </> : null}</>}</>}
        {c.full ? <>
        <details open={c.setupOpen} onToggle={(event: any) => { c.setupOpen = event.currentTarget.open; }} className={["setup"].filter(Boolean).join(" ")}>
        <summary>{"Local dictionaries"}</summary>
        <p className={["note"].filter(Boolean).join(" ")}>{" These dictionaries stay in this browser and are separate from your extension’s dictionaries. Import your existing Yomitan ZIPs or install Jitendex. Nothing installs automatically. "}</p>
            {c.statusLoading ? <>
            <p role={"status"} className={["note"].filter(Boolean).join(" ")}>{"Loading installed dictionaries…"}</p>
            </> : <>{c.statusError ? <>
                <p role={"status"} className={["note"].filter(Boolean).join(" ")}>
                {c.statusError}
                <button type={"button"} onClick={() => void c.refreshStatus()}>{"Retry list"}</button>
                </p>
                </> : <>{c.dictionaryStatus?.dictionaries.length ? <>
                    <ul aria-label={"Installed local dictionaries"} className={["dictionary-list"].filter(Boolean).join(" ")}>
                        {(c.dictionaryStatus.dictionaries).map((dictionary, __index) => <Fragment key={dictionary.title}>
                        <li className={["dictionary-row"].filter(Boolean).join(" ")}>
                        <span className={["dictionary-copy"].filter(Boolean).join(" ")}><strong>{dictionary.title}</strong><small>{c.disabledTitles.has(dictionary.title) ? 'Disabled' : 'Enabled'}{dictionary.revision
                                ? ` · ${dictionary.revision}`
                                : ''}</small>{dictionary.author ? <><small>{dictionary.author}</small></> : null}</span>
                        <span className={["dictionary-actions"].filter(Boolean).join(" ")}>
                        <button type={"button"} disabled={c.installing || c.statusLoading || !!c.managing} aria-label={`${c.disabledTitles.has(dictionary.title) ? 'Enable' : 'Disable'} ${dictionary.title}`} onClick={() => void c.toggleDictionary(dictionary.title, c.disabledTitles.has(dictionary.title))}>{c.disabledTitles.has(dictionary.title) ? 'Enable' : 'Disable'}</button>
                            {c.pendingDelete === dictionary.title ? <>
                            <span role={"group"} aria-label={`Delete ${dictionary.title}`} className={["delete-confirm"].filter(Boolean).join(" ")}>
                            <span>{"Delete this dictionary?"}</span>
                            <button type={"button"} disabled={c.installing || c.statusLoading || !!c.managing} aria-label={`Confirm delete ${dictionary.title}`} onClick={() => void c.deleteDictionary(dictionary.title)}>{"Delete"}</button>
                            <button type={"button"} disabled={c.installing || c.statusLoading || !!c.managing} aria-label={`Cancel deleting ${dictionary.title}`} onClick={() => (c.pendingDelete = '')}>{"Cancel"}</button>
                            </span>
                            </> : <>
                            <button type={"button"} disabled={c.installing || c.statusLoading || !!c.managing} aria-label={`Delete ${dictionary.title}`} onClick={() => (c.pendingDelete = dictionary.title)}>{"Delete…"}</button>
                            </>}
                        </span>
                        </li>
                        </Fragment>)}
                    </ul>
                    </> : <>{c.dictionaryStatus ? <>
                        <p className={["note"].filter(Boolean).join(" ")}>{"No local dictionaries are installed."}</p>
                        </> : null}</>}</>}</>}
        <div className={["setup-actions"].filter(Boolean).join(" ")}>
        <button type={"button"} disabled={c.installing || c.statusLoading || !!c.managing} onClick={() => void c.install()}>{"Install Jitendex"}</button><label className={["upload"].filter(Boolean).join(" ")}>{"Import dictionary ZIP"}<input type={"file"} accept={".zip,application/zip"} disabled={c.installing || c.statusLoading || !!c.managing} onChange={c.chooseArchive}/></label>{c.installing ? <><button type={"button"} onClick={() => c.installController?.abort()}>{"Cancel installation"}</button></> : null}
        </div>
        <p className={["note"].filter(Boolean).join(" ")}>{" Jitendex by Stephen Kraus · CC BY-SA 4.0. Includes JMdict, Tatoeba and JmdictFurigana data. The full dictionary retains its source labels. "}</p>
        <details onToggle={c.recommendationToggle} className={["recommendations"].filter(Boolean).join(" ")}>
        <summary>{"Recommended dictionaries"}</summary>
        <p className={["note"].filter(Boolean).join(" ")}>{" From Manabitan’s pinned Japanese catalog. Downloads open on their publisher’s site; Reader never downloads or installs them in the background. "}</p>
            {c.recommendationsLoading ? <>
            <p role={"status"} className={["note"].filter(Boolean).join(" ")}>{"Loading recommendations…"}</p>
            </> : <>{c.recommendationsError ? <>
                <p role={"status"} className={["note"].filter(Boolean).join(" ")}>
                {c.recommendationsError}
                <button type={"button"} onClick={() => void c.loadRecommendations()}>{"Retry recommendations"}</button>
                </p>
                </> : <>{c.recommendations ? <>
                    <ul aria-label={"Recommended Japanese dictionaries"} className={["recommendation-list"].filter(Boolean).join(" ")}>
                        {(c.recommendations).map((item, __index) => <Fragment key={`${item.category}:${item.name}`}>
                        <li className={["recommendation-row"].filter(Boolean).join(" ")}>
                        <span className={["dictionary-copy"].filter(Boolean).join(" ")}><strong>{item.name}</strong><small>{item.category}</small><span>{item.description}</span></span>
                        <span className={["dictionary-actions"].filter(Boolean).join(" ")}>
                        <a href={item.homepage} target={"_blank"} rel={"noopener noreferrer"}>{"About"}</a>
                        <a href={item.downloadUrl} target={"_blank"} rel={"noopener noreferrer"}>{"Download ZIP"}</a>
                        </span>
                        </li>
                        </Fragment>)}
                    </ul>
                    </> : null}</>}</>}
        </details>
        </details>
        {c.message ? <><p role={"status"} className={["note"].filter(Boolean).join(" ")}>{c.message}</p></> : null}
        </> : null}
    </section>
    </>;
}
import { useController, useControllerProps } from './use-controller';
export function DictionarySearch(props: Pick<DictionaryController, 'query' | 'full' | 'expand' | 'onquery'>) {
    const c = useController(() => Object.assign(new DictionaryController(), props));
    useControllerProps(c, props);
    return <div className="dictionary-search"><DictionaryView c={c}/></div>;
}

