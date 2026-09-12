// content/settle-watch.ts
// Page stabilization and mutation settle watching.
//
// PROVENANCE: ported from approved reference PravAl2028/SIH26171,
// extension/src/content/settle-watch.ts (author-granted permission).
//
// Observes DOM mutations, transitions, and timers after an agent action to
// ensure the page has stabilized before next capture / re-reading.

export interface SettleOptions {
  /** Quiet period with zero mutations required to declare settled (ms). Default 100ms. */
  quietMs?: number;
  /** Maximum total time to wait for settle before timeout (ms). Default 1500ms. */
  timeoutMs?: number;
}

export interface SettleResult {
  settled: boolean;
  mutationsObserved: number;
  elapsedMs: number;
  timedOut: boolean;
}

/**
 * Waits until DOM mutations cease for `quietMs` milliseconds or `timeoutMs` expires.
 */
export async function waitForPageSettle(
  root: Node = typeof document !== "undefined" ? document.body || document.documentElement : ({} as any),
  options: SettleOptions = {}
): Promise<SettleResult> {
  const quietMs = options.quietMs ?? 100;
  const timeoutMs = options.timeoutMs ?? 1500;
  const start = Date.now();

  if (typeof MutationObserver === "undefined" || !root || typeof (root as any).nodeType === "undefined") {
    // Node / non-browser fallback: simple delay
    await new Promise((r) => setTimeout(r, Math.min(quietMs, 50)));
    return {
      settled: true,
      mutationsObserved: 0,
      elapsedMs: Date.now() - start,
      timedOut: false,
    };
  }

  return new Promise<SettleResult>((resolve) => {
    let mutationCount = 0;
    let quietTimer: any = null;
    let timeoutTimer: any = null;

    const cleanup = () => {
      observer.disconnect();
      if (quietTimer) clearTimeout(quietTimer);
      if (timeoutTimer) clearTimeout(timeoutTimer);
    };

    const done = (timedOut: boolean) => {
      cleanup();
      resolve({
        settled: !timedOut,
        mutationsObserved: mutationCount,
        elapsedMs: Date.now() - start,
        timedOut,
      });
    };

    const resetQuietTimer = () => {
      if (quietTimer) clearTimeout(quietTimer);
      quietTimer = setTimeout(() => done(false), quietMs);
    };

    const observer = new MutationObserver((mutations) => {
      mutationCount += mutations.length;
      resetQuietTimer();
    });

    try {
      observer.observe(root, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true,
      });
    } catch {
      // If observer.observe fails (e.g. invalid root in tests), settle immediately
      return done(false);
    }

    // Start initial quiet timer in case no mutations occur
    resetQuietTimer();

    // Absolute timeout
    timeoutTimer = setTimeout(() => done(true), timeoutMs);
  });
}
