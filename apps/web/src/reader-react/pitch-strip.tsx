/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import React from 'react';
import { useReaderController } from './controller';
import { Dom, ReaderScope, useLatest, useReaderBindings, type ReaderViewProps } from './dom';
import { createPitchStrip, type PitchStripProps } from './pitch-strip-controller';
import { PITCH_GUIDES } from '../lib/features/whispersync/pitch/model';

export function PitchStrip(props: Partial<PitchStripProps> & ReaderViewProps) {
  const latest = useLatest(props);
  const c = useReaderController(
    () =>
      createPitchStrip(props as PitchStripProps, (name, detail) =>
        latest.current.events?.[name]?.({ detail })
      ),
    props
  );
  useReaderBindings(c, props);
  if (!c) return null;
  return (
    <ReaderScope name="react-reader-pitch-strip">
      <Dom
        as="div"
        data-testid={'voice-pitch'}
        className={['voice-pitch', c.state.enabled && 'enabled'].filter(Boolean).join(' ')}
      >
        <Dom as="div" className={['heading'].filter(Boolean).join(' ')}>
          <Dom
            as="svg"
            viewBox={'0 0 24 24'}
            aria-hidden={'true'}
            className={['heading-icon'].filter(Boolean).join(' ')}
          >
            <Dom as="path" d={'M3 10v4m4-8v12m5-15v18m5-15v12m4-8v4'}></Dom>
          </Dom>
          <Dom as="div" className={['heading-copy'].filter(Boolean).join(' ')}>
            <Dom as="span" className={['label'].filter(Boolean).join(' ')}>
              {'Voice pitch'}
            </Dom>
            <Dom as="p" className={['subtitle'].filter(Boolean).join(' ')}>
              {c.subtitle}
            </Dom>
          </Dom>
          <Dom
            as="button"
            type={'button'}
            aria-label={c.state.enabled ? 'Hide voice pitch' : 'Show voice pitch'}
            aria-expanded={c.state.enabled}
            aria-controls={`${c.id}-content`}
            disabled={!c.available && !c.state.enabled}
            className={['toggle'].filter(Boolean).join(' ')}
            events={{ click: c.onToggle }}
          >
            {c.state.enabled ? 'Hide' : 'Show'}
          </Dom>
        </Dom>
        <Dom as="div" id={`${c.id}-content`} hidden={!c.state.enabled}>
          {c.state.enabled ? (
            <>
              <Dom as="div" className={['visualization'].filter(Boolean).join(' ')}>
                {c.state.status === 'loading' ? (
                  <>
                    <Dom
                      as="div"
                      role={'status'}
                      className={['feedback'].filter(Boolean).join(' ')}
                    >
                      <Dom
                        as="span"
                        aria-hidden={'true'}
                        className={['spinner'].filter(Boolean).join(' ')}
                      ></Dom>
                      <Dom as="span">{c.state.message}</Dom>
                    </Dom>
                  </>
                ) : (
                  <>
                    {' '}
                    {c.state.status === 'error' ? (
                      <>
                        <Dom as="div" className={['feedback error'].filter(Boolean).join(' ')}>
                          <Dom as="p" role={'status'}>
                            {c.state.message}
                          </Dom>
                          <Dom as="button" type={'button'} events={{ click: c.onRetry }}>
                            {'Retry'}
                          </Dom>
                        </Dom>
                      </>
                    ) : (
                      <>
                        {' '}
                        <Dom
                          as="div"
                          className={['chart', !c.state.points.length && 'empty']
                            .filter(Boolean)
                            .join(' ')}
                        >
                          <Dom
                            as="div"
                            aria-hidden={'true'}
                            className={['frequency-scale'].filter(Boolean).join(' ')}
                          >
                            <Dom as="span" className={['unit'].filter(Boolean).join(' ')}>
                              {'Hz'}
                            </Dom>
                            {(PITCH_GUIDES ?? []).map((guide, _index0) => (
                              <React.Fragment key={guide.hz}>
                                <Dom
                                  as="span"
                                  className={['frequency'].filter(Boolean).join(' ')}
                                  style={{ top: `${(guide.y / 112) * 100}%` }}
                                >
                                  {guide.hz}
                                </Dom>
                              </React.Fragment>
                            ))}
                          </Dom>
                          <Dom
                            as="svg"
                            viewBox={'0 0 640 112'}
                            preserveAspectRatio={'none'}
                            role={'img'}
                            aria-label={
                              'Audio waveform and yellow estimated voice pitch. Higher lines mean a higher voice. The most recent audio is on the right.'
                            }
                            className={['trace'].filter(Boolean).join(' ')}
                          >
                            {(PITCH_GUIDES ?? []).map((guide, _index1) => (
                              <React.Fragment key={guide.hz}>
                                <Dom
                                  as="path"
                                  d={`M8 ${guide.y}H624`}
                                  className={['pitch-grid'].filter(Boolean).join(' ')}
                                ></Dom>
                              </React.Fragment>
                            ))}
                            <Dom
                              as="path"
                              d={'M8 52H624'}
                              className={['baseline'].filter(Boolean).join(' ')}
                            ></Dom>
                            <Dom
                              as="path"
                              d={c.paths.waveform}
                              className={['waveform'].filter(Boolean).join(' ')}
                            ></Dom>
                            <Dom
                              as="path"
                              d={c.paths.pitch}
                              className={['pitch-halo'].filter(Boolean).join(' ')}
                            ></Dom>
                            <Dom
                              as="path"
                              d={c.paths.pitch}
                              className={['pitch'].filter(Boolean).join(' ')}
                            ></Dom>
                            <Dom
                              as="path"
                              d={'M624 8V98'}
                              className={['playhead'].filter(Boolean).join(' ')}
                            ></Dom>
                            {c.paths.marker ? (
                              <>
                                <Dom
                                  as="path"
                                  d={`M${c.paths.marker.x} ${c.paths.marker.y}h0.01`}
                                  className={['tip'].filter(Boolean).join(' ')}
                                ></Dom>
                              </>
                            ) : null}
                          </Dom>
                          {!c.state.points.length ? (
                            <>
                              <Dom
                                as="p"
                                role={'status'}
                                className={['empty-label'].filter(Boolean).join(' ')}
                              >
                                {!c.available
                                  ? 'Choose an audio file to see pitch'
                                  : c.state.activity === 'playing'
                                    ? 'Listening for the voice…'
                                    : c.state.activity === 'buffering'
                                      ? 'Waiting for audio…'
                                      : 'Press Play to follow the voice'}
                              </Dom>
                            </>
                          ) : null}
                        </Dom>
                        <Dom
                          as="div"
                          aria-hidden={'true'}
                          className={['time-scale'].filter(Boolean).join(' ')}
                        >
                          <Dom as="span">{'−8 s'}</Dom>
                          <Dom as="span">{'−4 s'}</Dom>
                          <Dom as="span">{'Now'}</Dom>
                        </Dom>
                      </>
                    )}
                  </>
                )}
              </Dom>
              <Dom as="details">
                <Dom as="summary">{'About this view'}</Dom>
                <Dom as="p">
                  {
                    ' Yellow follows the voice’s estimated pitch; the shaded waveform shows its volume. Pausing holds the trace. Seeking starts a new one. Gaps can mean silence, unvoiced speech, or a pitch outside 85–520 Hz. This is a listening aid, not a pitch-accent score. Audio stays on your device. '
                  }
                </Dom>
              </Dom>
            </>
          ) : null}
        </Dom>
      </Dom>
    </ReaderScope>
  );
}
