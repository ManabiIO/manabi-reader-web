<script lang="ts">
  import { onMount } from 'svelte';
  import { videoLearningEnabled } from '$lib/media/feature';
  import { base, resolve } from '$app/paths';
  import { goto } from '$app/navigation';
  import { combineLatest, Observable } from 'rxjs';
  import ReaderAppearance from '$lib/components/book-reader/reader-appearance.svelte';
  import {
    fontFamilyGroupOne$,
    fontFamilyGroupTwo$,
    fontWeight$,
    fontSize$,
    lineHeight$,
    yuKyokashoAvailable$
  } from '$lib/data/store';
  import { resolveReaderFont, effectivePrimaryReaderFont } from '$lib/data/reader-typography';
  import { observeReaderFontLayout } from '$lib/functions/reader-font-layout';
  import { backgrounds, type BackgroundState } from '$lib/appearance/backgrounds';
  import { resolvedMode$, readerBackgroundOptions$ } from '$lib/appearance/state';
  import { account, accountScope, currentUser, request } from '$lib/manabi/client';
  import type { VideoWorkspace, WorkspaceConnection } from '$lib/media/workspace';
  import { isContentKey, isUUID, LIMITS } from '$lib/media/contracts';
  import '$lib/media/media.css';

  let host: HTMLDivElement;
  let appearanceOpen = false;
  let lifetimeError = '';
  let appearanceTrigger: HTMLElement | undefined;
  let workspace: VideoWorkspace | undefined;

  function requestedSearchResult() {
    const params = new URLSearchParams(location.search);
    const media = params.get('media');
    if (!isContentKey(media)) return undefined;
    const rawTime = params.get('time');
    const time = rawTime === null ? 0 : Number(rawTime);
    if (!Number.isFinite(time) || time < 0 || time > LIMITS.duration) return undefined;
    const candidate = params.get('track');
    const track = candidate && isUUID(candidate) ? candidate : undefined;
    return { media, time, track };
  }

  function openRequestedSearchResult(target: VideoWorkspace) {
    const result = requestedSearchResult();
    if (!result) return;
    void target.openSearchResult(result.media, result.time, result.track).catch(() => {
      // VideoWorkspace owns the user-visible error. A missing/revoked source
      // must not replace the rest of the video library route.
    });
  }
  onMount(() => {
    if (!videoLearningEnabled) return;
    let disposed = false;
    let cleanup: () => void = () => {};
    void Promise.all([
      import('$lib/media/workspace'),
      import('$lib/media/cloud-browser'),
      import('$lib/media/profile-lifetime'),
      import('$lib/manabi/media-profile')
    ])
      .then(([workspaceModule, cloudModule, lifetimeModule, profileModule]) => {
        if (disposed) return;
        const typography = combineLatest([
          fontFamilyGroupOne$,
          fontFamilyGroupTwo$,
          fontWeight$,
          fontSize$,
          lineHeight$,
          yuKyokashoAvailable$
        ]).subscribe(([font, sans, weight, size, spacing, available]) => {
          host.style.setProperty(
            '--transcript-font-family',
            resolveReaderFont(effectivePrimaryReaderFont(font, available), false)
          );
          host.style.setProperty('--transcript-sans-family', resolveReaderFont(sans, false, true));
          host.style.setProperty('--transcript-font-weight', String(weight ?? 400));
          host.style.setProperty('--transcript-font-size', `${size}px`);
          host.style.setProperty('--transcript-line-height', String(spacing));
          workspace?.refreshDisplay();
        });
        const background = combineLatest([
          new Observable<Record<'reader' | 'library', BackgroundState>>((subscriber) =>
            backgrounds.subscribe((value) => subscriber.next(value))
          ),
          resolvedMode$,
          readerBackgroundOptions$
        ]).subscribe(([images, mode, options]) => {
          const url = images.reader[mode].url;
          // The shared background store has already validated/decoded these local images.
          host.style.setProperty(
            '--transcript-background-image',
            url ? `url(${JSON.stringify(url)})` : 'none'
          );
          host.style.setProperty(
            '--transcript-background-fade',
            String(options.fade ? options.amount / 100 : 0)
          );
        });
        const stopFonts = observeReaderFontLayout(host, () => workspace?.refreshDisplay());
        const lifetime = new lifetimeModule.ProfileLifetime<WorkspaceConnection>(
          profileModule.offlineMediaProfile,
          (scope, connection) => {
            lifetimeError = '';
            const target = new workspaceModule.VideoWorkspace(host, {
              scope,
              booksURL: `${base}/manage`,
              runtimeBase: `${base}/moss`,
              onAppearance: (trigger) => {
                appearanceTrigger = trigger;
                appearanceOpen = true;
              },
              // Checked against the actual installed dependency by the full app typecheck.
              loadBunny: () =>
                import('$lib/manabi/media-runtime').then((module) => module.mediaRuntime),
              ...connection
            });
            workspace = target;
            openRequestedSearchResult(target);
            return target;
          },
          (error) => {
            lifetimeError = error instanceof Error ? error.message : String(error);
          }
        );
        const stop = account.subscribe((state) => {
          let connection: WorkspaceConnection | undefined;
          if (state.status === 'available' && state.session?.user) {
            const admitted = accountScope();
            const transport = {
              userId: admitted.userId,
              isCurrent: () => {
                try {
                  return (
                    currentUser()?.id === admitted.userId &&
                    accountScope().generation === admitted.generation
                  );
                } catch {
                  return false;
                }
              },
              request
            };
            connection = {
              connectionKey: `${admitted.userId}:${admitted.generation}`,
              transport,
              chooseConnected: (open, signal) =>
                cloudModule.chooseCloudVideo(transport, open, signal)
            };
          }
          void lifetime.update({
            status: state.status,
            userId: state.session?.user?.id ?? null,
            connection
          });
        });
        cleanup = () => {
          stop();
          typography.unsubscribe();
          background.unsubscribe();
          stopFonts();
          workspace = undefined;
          void lifetime.stop();
        };
        if (disposed) cleanup();
      })
      .catch((error) => {
        if (!disposed) lifetimeError = error instanceof Error ? error.message : String(error);
      });
    return () => {
      disposed = true;
      cleanup();
    };
  });
</script>

<svelte:head
  ><title>{videoLearningEnabled ? 'Videos' : 'Page not found'} — Manabi Reader</title></svelte:head
>
{#if videoLearningEnabled}
  {#if lifetimeError}<p role="alert">{lifetimeError}</p>{/if}
  <div bind:this={host}></div>
  <ReaderAppearance
    bind:open={appearanceOpen}
    showLayout={false}
    returnFocus={appearanceTrigger}
    description="Adjust transcript text and appearance. These are the same settings used by your ebooks."
    on:settingsClick={() => goto(resolve('/settings'))}
  />
{:else}
  <main>
    <h1>Page not found</h1>
    <a href={resolve('/manage')}>Back to library</a>
  </main>
{/if}
