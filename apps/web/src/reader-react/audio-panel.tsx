/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import React from 'react';
import { useReaderController } from './controller';
import {
  Dom,
  ReaderScope,
  CloseButton,
  Sheet,
  useLatest,
  useReaderBindings,
  type ReaderViewProps
} from './dom';
import { createAudioPanel, type AudioPanelProps } from './audio-panel-controller';
import { asset } from '../runtime/paths';
import { cueAudioBounds } from '../lib/features/whispersync/subtitles';
import { toTimeString } from '../lib/features/whispersync/upstream';
import { PitchStrip } from './pitch-strip';

export function AudiobookPanel(props: Partial<AudioPanelProps> & ReaderViewProps) {
  const latest = useLatest(props);
  const c = useReaderController(
    () =>
      createAudioPanel(props as AudioPanelProps, (name, detail) =>
        latest.current.events?.[name]?.({ detail })
      ),
    props
  );
  useReaderBindings(c, props);
  if (!c) return null;
  return (
    <ReaderScope name="react-reader-audio-panel">
      <Dom
        as="div"
        data-ui-overlay={'audiobook-controls'}
        className={['audio-bar', !c.snapshot.file && !c.storageError && !c.matchError && 'inactive']
          .filter(Boolean)
          .join(' ')}
      >
        <Dom as="div" className={['audio-heading'].filter(Boolean).join(' ')}>
          <Dom
            as="button"
            elementRef={(value) => {
              c.audioBarOpenButton = value;
            }}
            type={'button'}
            events={{
              click: () => {
                c.open = true;
              }
            }}
          >
            {'Audiobook'}
          </Dom>
          <Dom
            as="span"
            title={c.snapshot.file?.name}
            className={['audio-title'].filter(Boolean).join(' ')}
          >
            {c.snapshot.file?.name}
          </Dom>
          {c.snapshot.file ? (
            <>
              <Dom
                as="button"
                type={'button'}
                disabled={c.snapshot.paused}
                events={{ click: () => void c.pauseFromBar() }}
              >
                {'Pause'}
              </Dom>
              <Dom
                as="button"
                type={'button'}
                aria-label={'Close audio playback'}
                events={{ click: () => void c.closeAudio() }}
              >
                {'×'}
              </Dom>
            </>
          ) : null}
        </Dom>
        <Dom
          as="div"
          elementRef={(value) => {
            c.audioHost = value;
          }}
        ></Dom>
        {c.activeCue ? (
          <>
            <Dom as="p" className={['now-playing'].filter(Boolean).join(' ')}>
              {c.activeCue.text}
            </Dom>
          </>
        ) : null}
        {!c.open && (c.storageError || c.matchError) ? (
          <>
            <Dom as="p" role={'status'} className={['audio-notice'].filter(Boolean).join(' ')}>
              {c.storageError
                ? 'Audiobook changes are not being saved.'
                : 'Audiobook following needs attention.'}
              <Dom
                as="button"
                type={'button'}
                events={{
                  click: () => {
                    c.open = true;
                  }
                }}
              >
                {'View details'}
              </Dom>
            </Dom>
          </>
        ) : null}
        {c.snapshot.error ? (
          <>
            <Dom as="p" role={'alert'}>
              {c.snapshot.error}
            </Dom>
          </>
        ) : null}
      </Dom>
      <Sheet.Root
        open={c.open}
        bindings={{
          open: (value) => {
            c.open = value;
          }
        }}
      >
        <Sheet.Content
          side={'bottom'}
          showCloseButton={false}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            c.returnFocus();
          }}
          className={[
            'audiobook-sheet max-h-[85dvh] overflow-hidden p-0 [writing-mode:horizontal-tb]'
          ]
            .filter(Boolean)
            .join(' ')}
        >
          <Dom as="div" className={['audiobook-header'].filter(Boolean).join(' ')}>
            <Sheet.Title>{'Audiobook'}</Sheet.Title>
            <CloseButton
              aria-label={'Close audiobook'}
              onClick={() => (c.open = false)}
            ></CloseButton>
          </Dom>
          <Dom as="div" className={['audiobook-scroll'].filter(Boolean).join(' ')}>
            <Sheet.Description>
              {'Listen alongside '}
              {c.bookTitle}
              {
                ' using local audio and timed subtitles. Files are not uploaded. Following resumes after this panel closes.'
              }
            </Sheet.Description>
            <Dom
              as="div"
              data-ui-overlay={'audiobook-panel'}
              className={['panel'].filter(Boolean).join(' ')}
            >
              {!c.ready ? (
                <>
                  <Dom as="p" role={'status'}>
                    {'Loading saved audiobook settings…'}
                  </Dom>
                </>
              ) : null}
              <Dom as="div" className={['file-fields'].filter(Boolean).join(' ')}>
                <Dom as="label">
                  {'Audio file '}
                  <Dom
                    as="input"
                    type={'file'}
                    accept={'audio/*,.mp3,.m4a,.m4b,.ogg,.wav,.flac'}
                    disabled={!c.ready || c.clearing}
                    events={{ change: c.selectAudio }}
                  />
                </Dom>
                <Dom as="label">
                  {'Subtitles (.srt or .vtt; .txt also accepted) '}
                  <Dom
                    as="input"
                    type={'file'}
                    accept={'.srt,.vtt,.txt,text/vtt,application/x-subrip,text/plain'}
                    disabled={!c.ready || c.clearing}
                    events={{ change: c.selectSubtitles }}
                  />
                </Dom>
              </Dom>
              <Dom as="p" className={['hint'].filter(Boolean).join(' ')}>
                {
                  ' Select the same audio file again after reopening the book to resume. Audio is not stored; subtitles, settings, and position are saved only in this browser. Codec support depends on your browser. '
                }
              </Dom>
              {c.subtitleLoading ? (
                <>
                  <Dom as="p" role={'status'}>
                    {'Reading subtitles…'}
                  </Dom>
                </>
              ) : null}
              {c.subtitleName ? (
                <>
                  <Dom as="p">
                    {c.subtitleName}
                    {' · '}
                    {c.cues.length.toLocaleString()}
                    {' cues'}
                  </Dom>
                </>
              ) : null}
              {c.error ? (
                <>
                  <Dom as="p" role={'alert'}>
                    {c.error}
                  </Dom>
                </>
              ) : null}
              {c.storageError ? (
                <>
                  <Dom as="p" role={'status'}>
                    {c.storageError}
                  </Dom>
                </>
              ) : null}
              {c.snapshot.error ? (
                <>
                  <Dom as="p" role={'alert'}>
                    {c.snapshot.error}
                  </Dom>
                </>
              ) : null}
              {c.snapshot.file ? (
                <>
                  <Dom as="div" className={['actions'].filter(Boolean).join(' ')}>
                    <Dom
                      as="button"
                      type={'button'}
                      disabled={!c.snapshot.ready}
                      events={{
                        click: () => (c.snapshot.paused ? void c.player.play() : c.player.pause())
                      }}
                    >
                      {c.snapshot.paused ? 'Play' : 'Pause'}
                    </Dom>
                    <Dom
                      as="button"
                      type={'button'}
                      disabled={!c.snapshot.ready}
                      events={{ click: () => c.player.seek(c.snapshot.time - 10) }}
                    >
                      {'−10 seconds'}
                    </Dom>
                    <Dom
                      as="button"
                      type={'button'}
                      disabled={!c.snapshot.ready}
                      events={{ click: () => c.player.seek(c.snapshot.time + 10) }}
                    >
                      {'+10 seconds'}
                    </Dom>
                    <Dom as="label">
                      {'Speed '}
                      <Dom
                        as="input"
                        type={'number'}
                        min={'0.5'}
                        max={'3'}
                        step={'0.05'}
                        value={c.snapshot.rate}
                        events={{
                          change: (event) => c.player.setRate(event.currentTarget.valueAsNumber)
                        }}
                      />
                      {'× '}
                    </Dom>
                    <Dom as="span">
                      {toTimeString(c.snapshot.time)}
                      {' / '}
                      {toTimeString(c.snapshot.duration)}
                    </Dom>
                  </Dom>
                </>
              ) : null}
              {c.cues.length ? (
                <>
                  <Dom as="div" className={['actions'].filter(Boolean).join(' ')}>
                    <Dom
                      as="button"
                      type={'button'}
                      disabled={!c.snapshot.ready}
                      events={{ click: () => c.moveCue(-1) }}
                    >
                      {'Previous cue'}
                    </Dom>
                    <Dom
                      as="button"
                      type={'button'}
                      disabled={!c.snapshot.ready || !c.activeCue}
                      events={{ click: () => c.selectCue(c.current, true) }}
                    >
                      {'Replay cue'}
                    </Dom>
                    <Dom
                      as="button"
                      type={'button'}
                      disabled={!c.snapshot.ready}
                      events={{ click: () => c.moveCue(1) }}
                    >
                      {'Next cue'}
                    </Dom>
                    <Dom
                      as="button"
                      type={'button'}
                      disabled={!c.snapshot.ready || (!c.activeCue && !c.snapshot.loop)}
                      aria-pressed={!!c.snapshot.loop}
                      events={{ click: c.toggleLoop }}
                    >
                      {c.snapshot.loop ? 'Stop looping' : 'Loop cue'}
                    </Dom>
                  </Dom>
                  <Dom as="label">
                    {'Subtitle delay (seconds) '}
                    <Dom
                      as="input"
                      type={'number'}
                      min={'-3600'}
                      max={'3600'}
                      step={'0.1'}
                      value={c.delay}
                      events={{ change: c.changeDelay }}
                    />
                  </Dom>
                  <Dom as="p" className={['hint'].filter(Boolean).join(' ')}>
                    {
                      ' Positive delay means the spoken audio comes later than the subtitle timestamp. '
                    }
                  </Dom>
                  <Dom as="div" className={['matching'].filter(Boolean).join(' ')}>
                    <Dom as="label">
                      <Dom
                        as="input"
                        type={'checkbox'}
                        checked={c.follow}
                        events={{ change: c.changeFollow }}
                      />
                      {' Follow matched text while playing'}
                    </Dom>
                    <Dom as="label">
                      <Dom
                        as="input"
                        type={'checkbox'}
                        checked={c.approximate}
                        disabled={c.matching}
                        events={{ change: c.changeApproximate }}
                      />
                      {' Allow approximate matches (review highlighted text)'}
                    </Dom>
                    <Dom as="div" className={['actions'].filter(Boolean).join(' ')}>
                      <Dom
                        as="button"
                        type={'button'}
                        disabled={c.matching || c.subtitleLoading}
                        events={{ click: c.matchBook }}
                      >
                        {'Match book'}
                      </Dom>
                      {c.matching ? (
                        <>
                          <Dom as="button" type={'button'} events={{ click: c.cancelMatch }}>
                            {'Cancel'}
                          </Dom>
                          <Dom as="span" role={'status'}>
                            {c.matchProgress}
                            {'% processed'}
                          </Dom>
                        </>
                      ) : null}
                      {c.hasMatched ? (
                        <>
                          <Dom as="span" role={'status'}>
                            {c.matchedCount}
                            {' / '}
                            {c.cues.length}
                            {' matched'}
                            {c.approximateCount ? ` (${c.approximateCount} approximate)` : ''}
                          </Dom>
                        </>
                      ) : null}
                    </Dom>
                    <Dom as="p" className={['hint'].filter(Boolean).join(' ')}>
                      {c.selectionHint
                        ? 'Matching starts at the selected book text.'
                        : 'Matching starts at the beginning of the book.'}
                      {c.selectionHint ? (
                        <>
                          <Dom
                            as="button"
                            type={'button'}
                            disabled={c.matching}
                            events={{
                              click: () => {
                                c.selectionHint = undefined;
                                c.invalidateMatches(
                                  'Starting point changed. Select “Match book” to apply it.'
                                );
                              }
                            }}
                          >
                            {'Clear starting selection'}
                          </Dom>
                        </>
                      ) : null}
                    </Dom>
                    <Dom as="p" className={['hint'].filter(Boolean).join(' ')}>
                      {
                        ' Matching does not edit the book. For a chapter-only recording, select its starting text in the book first. Unmatched cues still play. Matches span the whole book, including chapters not currently displayed. Chapters are opened using the reader’s normal navigation. '
                      }
                    </Dom>
                    {!c.highlightSupported ? (
                      <>
                        <Dom as="p">
                          {
                            ' Inline highlighting is unavailable in this browser. Transcript playback and matched-text navigation still work. '
                          }
                        </Dom>
                      </>
                    ) : null}
                    {c.matchError ? (
                      <>
                        <Dom as="p" role={'status'}>
                          {c.matchError}
                        </Dom>
                      </>
                    ) : null}
                  </Dom>
                  <Dom as="section" aria-label={'Audiobook transcript'}>
                    <PitchStrip
                      state={c.pitchState}
                      available={c.snapshot.ready}
                      onToggle={() => c.pitch.setEnabled(!c.pitchState.enabled)}
                      onRetry={() => c.pitch.retry()}
                    ></PitchStrip>
                    <Dom as="div" className={['actions'].filter(Boolean).join(' ')}>
                      <Dom as="h3">{'Transcript'}</Dom>
                      <Dom
                        as="button"
                        type={'button'}
                        disabled={c.current < 0}
                        events={{
                          click: () => {
                            c.transcriptPage = Math.floor(c.current / c.pageSize);
                          }
                        }}
                      >
                        {'Show current cue'}
                      </Dom>
                      <Dom
                        as="button"
                        elementRef={(value) => {
                          c.previousTranscriptPage = value;
                        }}
                        type={'button'}
                        disabled={c.transcriptPage === 0}
                        events={{ click: () => void c.pageTranscript(-1) }}
                      >
                        {'Previous 30'}
                      </Dom>
                      <Dom as="span" role={'status'} aria-live={'polite'}>
                        {'Page '}
                        {c.transcriptPage + 1}
                        {' / '}
                        {c.pageCount}
                      </Dom>
                      <Dom
                        as="button"
                        elementRef={(value) => {
                          c.nextTranscriptPage = value;
                        }}
                        type={'button'}
                        disabled={c.transcriptPage + 1 >= c.pageCount}
                        events={{ click: () => void c.pageTranscript(1) }}
                      >
                        {'Next 30'}
                      </Dom>
                    </Dom>
                    <Dom as="ol" start={c.transcriptPage * c.pageSize + 1}>
                      {(c.visibleCues ?? []).map((cue, offset) => (
                        <React.Fragment key={cue.id}>
                          {(() => {
                            const cueIndex = c.transcriptPage * c.pageSize + offset;
                            return (
                              <>
                                <Dom
                                  as="li"
                                  className={[cueIndex === c.current && 'active']
                                    .filter(Boolean)
                                    .join(' ')}
                                >
                                  <Dom
                                    as="button"
                                    type={'button'}
                                    disabled={
                                      !c.snapshot.ready ||
                                      !cueAudioBounds(cue, c.delay, c.snapshot.duration)
                                    }
                                    aria-current={cueIndex === c.current ? 'true' : undefined}
                                    events={{ click: () => c.selectCue(cueIndex, true) }}
                                  >
                                    <Dom as="time">{toTimeString(cue.start + c.delay)}</Dom>
                                    {cue.text}
                                  </Dom>
                                  {c.matches[cueIndex] ? (
                                    <>
                                      <Dom
                                        as="button"
                                        type={'button'}
                                        aria-label={`Show cue ${cueIndex + 1} in book`}
                                        className={['locate'].filter(Boolean).join(' ')}
                                        events={{ click: () => c.showInBook(cueIndex) }}
                                      >
                                        {c.matches[cueIndex]!.approximate
                                          ? 'Approximate location'
                                          : 'Show in book'}
                                      </Dom>
                                    </>
                                  ) : null}
                                </Dom>
                              </>
                            );
                          })()}
                        </React.Fragment>
                      ))}
                    </Dom>
                  </Dom>
                </>
              ) : null}
              <Dom as="div" className={['actions'].filter(Boolean).join(' ')}>
                <Dom
                  as="button"
                  type={'button'}
                  disabled={!c.ready || c.clearing}
                  events={{
                    click: () => {
                      c.confirmClear = true;
                    }
                  }}
                >
                  {'Remove saved audiobook data'}
                </Dom>
                {c.confirmClear ? (
                  <>
                    <Dom as="span">{'Remove captions and resume position for this book?'}</Dom>
                    <Dom
                      as="button"
                      type={'button'}
                      disabled={c.clearing}
                      events={{ click: c.removeSaved }}
                    >
                      {'Remove'}
                    </Dom>
                    <Dom
                      as="button"
                      type={'button'}
                      events={{
                        click: () => {
                          c.confirmClear = false;
                        }
                      }}
                    >
                      {'Cancel'}
                    </Dom>
                  </>
                ) : null}
              </Dom>
              <Dom as="p" className={['credits'].filter(Boolean).join(' ')}>
                {' Adapted from '}
                <Dom
                  as="a"
                  href={'https://github.com/4890A/ttu-whispersync'}
                  target={'_blank'}
                  rel={'noopener noreferrer'}
                >
                  {'4890A/ttu-whispersync'}
                </Dom>
                {', originally by '}
                <Dom
                  as="a"
                  href={'https://github.com/Renji-XD/ttu-whispersync'}
                  target={'_blank'}
                  rel={'noopener noreferrer'}
                >
                  {'Renji-XD'}
                </Dom>
                {'. '}
                <Dom
                  as="a"
                  href={asset('/licenses/ttu-whispersync.txt')}
                  target={'_blank'}
                  rel={'noopener noreferrer'}
                >
                  {'MIT license'}
                </Dom>
                {'. This built-in player does not require their userscript or Anki. '}
              </Dom>
            </Dom>
          </Dom>
        </Sheet.Content>
      </Sheet.Root>
    </ReaderScope>
  );
}
