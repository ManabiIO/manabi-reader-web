<script lang="ts">
  import { onMount } from 'svelte';
  import { base } from '$app/paths';
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
  import { offlineMediaProfile } from '$lib/manabi/media-profile';
  import { VideoWorkspace } from '$lib/media/workspace';
  import { chooseCloudVideo } from '$lib/media/cloud-browser';
  import { ProfileLifetime } from '$lib/media/profile-lifetime';
  import type { WorkspaceConnection } from '$lib/media/workspace';
  import '$lib/media/media.css';

  let host: HTMLDivElement;
  let appearanceOpen = false;
  let appearanceTrigger: HTMLElement | undefined;
  let workspace: VideoWorkspace | undefined;
  onMount(() => {
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
    const lifetime = new ProfileLifetime<WorkspaceConnection>(
      offlineMediaProfile,
      (scope, connection) =>
        (workspace = new VideoWorkspace(host, {
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
        })),
      (error) => {
        host.textContent = error instanceof Error ? error.message : String(error);
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
          transport,
          chooseConnected: (open, signal) => chooseCloudVideo(transport, open, signal)
        };
      }
      void lifetime.update({
        status: state.status,
        userId: state.session?.user?.id ?? null,
        connection
      });
    });
    return () => {
      stop();
      typography.unsubscribe();
      background.unsubscribe();
      stopFonts();
      workspace = undefined;
      void lifetime.stop();
    };
  });
</script>

<svelte:head><title>Videos — Manabi Reader</title></svelte:head>
<div bind:this={host}></div>

<ReaderAppearance
  bind:open={appearanceOpen}
  showLayout={false}
  returnFocus={appearanceTrigger}
  description="Adjust transcript text and appearance. These are the same settings used by your ebooks."
  on:settingsClick={() => goto(`${base}/settings`)}
/>
