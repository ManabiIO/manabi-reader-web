/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import {
  Confetti,
  confettiParams
} from '$lib/components/book-reader/book-completion-confetti/book-completion-confetti';
import { ReaderController, readerTick } from './controller';

export interface ConfettiProps {
  confettiWidthModifier: number;
  confettiMaxRuns: number;
  window: Window;
}

export function createConfetti(
  props: ConfettiProps,
  emit: (name: string, detail?: unknown) => void = () => {}
) {
  const __readerController = new ReaderController();

  let confettiWidthModifier: number = props.confettiWidthModifier;
  let confettiMaxRuns: number = props.confettiMaxRuns;
  let window: Window = props.window;
  let confettiCanvasElement: HTMLCanvasElement;
  let confetiiCanvasContext: CanvasRenderingContext2D | null;
  let confettiContainer = { width: 0, height: 0 };
  let confettiElements: Confetti[] = [];
  let confettiAnimationTimer: number | undefined;
  let addConfettiTimer: number | undefined;
  let confettiRuns = 0;
  let reducedMotion = false;
  let motionReady = false;
  __readerController.onMount(() => {
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let generation = 0;
    const applyMotionPreference = async (matches: boolean) => {
      const current = ++generation;
      __readerController.changed((reducedMotion = matches));
      __readerController.changed((motionReady = false));
      hideConfetti();
      if (matches) return;
      await readerTick();
      if (current !== generation) return;
      __readerController.changed((confettiRuns = 0));
      setupCanvas();
      __readerController.changed((motionReady = true));
      updateConfetti();
      confettiLoop();
    };
    const changed = (event: MediaQueryListEvent) => void applyMotionPreference(event.matches);
    motion.addEventListener('change', changed);
    void applyMotionPreference(motion.matches);
    return () => {
      generation++;
      motion.removeEventListener('change', changed);
      __readerController.changed((motionReady = false));
      hideConfetti();
    };
  });
  function setupCanvas() {
    __readerController.changed(
      (confettiContainer = {
        width: confettiCanvasElement.clientWidth,
        height: confettiCanvasElement.clientHeight
      })
    );
    __readerController.changed((confettiCanvasElement.width = confettiContainer.width));
    __readerController.changed((confettiCanvasElement.height = confettiContainer.height));
    if (!confetiiCanvasContext) {
      __readerController.changed((confetiiCanvasContext = confettiCanvasElement.getContext('2d')));
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
      __readerController.changed((confetiiCanvasContext.fillStyle = confettiElement.color));
      confetiiCanvasContext.fillRect(-0.5 * width, -0.5 * height, width, height);
      confetiiCanvasContext.setTransform(1, 0, 0, 1, 0, 0);
    }
    if (confettiAnimationTimer) {
      window.cancelAnimationFrame(confettiAnimationTimer);
    }
    __readerController.changed(
      (confettiAnimationTimer = window.requestAnimationFrame(updateConfetti))
    );
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
    __readerController.changed((confettiRuns += 1));
    addConfetti();
    __readerController.changed(
      (addConfettiTimer = window.setTimeout(confettiLoop, 700 + Math.random() * 1700))
    );
  }
  function hideConfetti() {
    if (addConfettiTimer) {
      clearTimeout(addConfettiTimer);
    }
    if (confettiAnimationTimer) {
      window.cancelAnimationFrame(confettiAnimationTimer);
    }
    __readerController.changed((confettiElements = []));
    __readerController.changed((confettiAnimationTimer = undefined));
    __readerController.changed((addConfettiTimer = undefined));
  }

  const api = {
    controller: __readerController,
    setupCanvas,
    updateConfetti,
    addConfetti,
    confettiLoop,
    hideConfetti,
    get confettiWidthModifier() {
      return confettiWidthModifier;
    },
    set confettiWidthModifier(nextValue: typeof confettiWidthModifier) {
      if (Object.is(confettiWidthModifier, nextValue)) return;
      confettiWidthModifier = nextValue;
      __readerController.invalidate();
    },
    get confettiMaxRuns() {
      return confettiMaxRuns;
    },
    set confettiMaxRuns(nextValue: typeof confettiMaxRuns) {
      if (Object.is(confettiMaxRuns, nextValue)) return;
      confettiMaxRuns = nextValue;
      __readerController.invalidate();
    },
    get window() {
      return window;
    },
    set window(nextValue: typeof window) {
      if (Object.is(window, nextValue)) return;
      window = nextValue;
      __readerController.invalidate();
    },
    get confettiCanvasElement() {
      return confettiCanvasElement;
    },
    set confettiCanvasElement(nextValue: typeof confettiCanvasElement) {
      if (Object.is(confettiCanvasElement, nextValue)) return;
      confettiCanvasElement = nextValue;
      __readerController.invalidate();
    },
    get confetiiCanvasContext() {
      return confetiiCanvasContext;
    },
    set confetiiCanvasContext(nextValue: typeof confetiiCanvasContext) {
      if (Object.is(confetiiCanvasContext, nextValue)) return;
      confetiiCanvasContext = nextValue;
      __readerController.invalidate();
    },
    get confettiContainer() {
      return confettiContainer;
    },
    set confettiContainer(nextValue: typeof confettiContainer) {
      if (Object.is(confettiContainer, nextValue)) return;
      confettiContainer = nextValue;
      __readerController.invalidate();
    },
    get confettiElements() {
      return confettiElements;
    },
    set confettiElements(nextValue: typeof confettiElements) {
      if (Object.is(confettiElements, nextValue)) return;
      confettiElements = nextValue;
      __readerController.invalidate();
    },
    get confettiAnimationTimer() {
      return confettiAnimationTimer;
    },
    set confettiAnimationTimer(nextValue: typeof confettiAnimationTimer) {
      if (Object.is(confettiAnimationTimer, nextValue)) return;
      confettiAnimationTimer = nextValue;
      __readerController.invalidate();
    },
    get addConfettiTimer() {
      return addConfettiTimer;
    },
    set addConfettiTimer(nextValue: typeof addConfettiTimer) {
      if (Object.is(addConfettiTimer, nextValue)) return;
      addConfettiTimer = nextValue;
      __readerController.invalidate();
    },
    get confettiRuns() {
      return confettiRuns;
    },
    set confettiRuns(nextValue: typeof confettiRuns) {
      if (Object.is(confettiRuns, nextValue)) return;
      confettiRuns = nextValue;
      __readerController.invalidate();
    },
    get reducedMotion() {
      return reducedMotion;
    },
    set reducedMotion(nextValue: typeof reducedMotion) {
      if (Object.is(reducedMotion, nextValue)) return;
      reducedMotion = nextValue;
      __readerController.invalidate();
    },
    get motionReady() {
      return motionReady;
    },
    set motionReady(nextValue: typeof motionReady) {
      if (Object.is(motionReady, nextValue)) return;
      motionReady = nextValue;
      __readerController.invalidate();
    },
    updateProps(next: Record<string, unknown>) {
      if ('confettiWidthModifier' in next)
        api.confettiWidthModifier = next.confettiWidthModifier as typeof confettiWidthModifier;
      if ('confettiMaxRuns' in next)
        api.confettiMaxRuns = next.confettiMaxRuns as typeof confettiMaxRuns;
      if ('window' in next) api.window = next.window as typeof window;
    }
  };
  return api;
}
