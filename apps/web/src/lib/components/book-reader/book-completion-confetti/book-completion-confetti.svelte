<script lang="ts">
  import {
    Confetti,
    confettiParams
  } from '$lib/components/book-reader/book-completion-confetti/book-completion-confetti';
  import { onMount, tick } from 'svelte';

  export let confettiWidthModifier: number;
  export let confettiMaxRuns: number;
  export let window: Window;

  let confettiCanvasElement: HTMLCanvasElement;
  let confetiiCanvasContext: CanvasRenderingContext2D | null;
  let confettiContainer = { width: 0, height: 0 };
  let confettiElements: Confetti[] = [];
  let confettiAnimationTimer: number | undefined;
  let addConfettiTimer: number | undefined;
  let confettiRuns = 0;
  let reducedMotion = false;
  let motionReady = false;

  onMount(() => {
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let generation = 0;
    const applyMotionPreference = async (matches: boolean) => {
      const current = ++generation;
      reducedMotion = matches;
      motionReady = false;
      hideConfetti();
      if (matches) return;
      await tick();
      if (current !== generation) return;
      confettiRuns = 0;
      setupCanvas();
      motionReady = true;
      updateConfetti();
      confettiLoop();
    };
    const changed = (event: MediaQueryListEvent) => void applyMotionPreference(event.matches);

    motion.addEventListener('change', changed);
    void applyMotionPreference(motion.matches);

    return () => {
      generation++;
      motion.removeEventListener('change', changed);
      motionReady = false;
      hideConfetti();
    };
  });

  function setupCanvas() {
    confettiContainer = {
      width: confettiCanvasElement.clientWidth,
      height: confettiCanvasElement.clientHeight
    };

    confettiCanvasElement.width = confettiContainer.width;
    confettiCanvasElement.height = confettiContainer.height;

    if (!confetiiCanvasContext) {
      confetiiCanvasContext = confettiCanvasElement.getContext('2d');
    }
  }

  function updateConfetti() {
    if (!confetiiCanvasContext) {
      return;
    }

    confetiiCanvasContext.clearRect(0, 0, confettiContainer.width, confettiContainer.height);

    for (let index = 0, { length } = confettiElements; index < length; index += 1) {
      const confettiElement = confettiElements[index];

      confettiElement.update();
      confetiiCanvasContext.translate(confettiElement.position.x, confettiElement.position.y);
      confetiiCanvasContext.rotate(confettiElement.rotation);

      const width = confettiElement.dimensions.x * confettiElement.scale.x;
      const height = confettiElement.dimensions.y * confettiElement.scale.y;

      confetiiCanvasContext.fillStyle = confettiElement.color;
      confetiiCanvasContext.fillRect(-0.5 * width, -0.5 * height, width, height);
      confetiiCanvasContext.setTransform(1, 0, 0, 1, 0, 0);
    }

    if (confettiAnimationTimer) {
      window.cancelAnimationFrame(confettiAnimationTimer);
    }

    confettiAnimationTimer = window.requestAnimationFrame(updateConfetti);
  }

  function addConfetti() {
    if (!confettiCanvasElement) {
      return;
    }

    const canvasBox = confettiCanvasElement.getBoundingClientRect();
    const position = [canvasBox.width * Math.random(), canvasBox.height * Math.random()];

    for (let i = 0; i < confettiParams.number; i += 1) {
      confettiElements.push(new Confetti(position, confettiContainer.height));
    }
  }

  function confettiLoop() {
    if (confettiMaxRuns && confettiRuns > confettiMaxRuns) {
      return;
    }

    confettiRuns += 1;
    addConfetti();
    addConfettiTimer = window.setTimeout(confettiLoop, 700 + Math.random() * 1700);
  }

  function hideConfetti() {
    if (addConfettiTimer) {
      clearTimeout(addConfettiTimer);
    }

    if (confettiAnimationTimer) {
      window.cancelAnimationFrame(confettiAnimationTimer);
    }

    confettiElements = [];
    confettiAnimationTimer = undefined;
    addConfettiTimer = undefined;
  }
</script>

<canvas
  data-book-completion-confetti
  class:hidden={reducedMotion}
  class="flex fixed top-0 right-0 h-full w-full"
  style={`max-width: calc(100vw - ${confettiWidthModifier}rem);`}
  bind:this={confettiCanvasElement}
></canvas>
<svelte:window
  on:resize={() => {
    if (reducedMotion || !motionReady) return;
    hideConfetti();
    setupCanvas();
    updateConfetti();
    confettiLoop();
  }}
/>
