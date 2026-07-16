/**
 * Pacing for StepList's `onStep` feed. The ceremony phases behind the
 * checklist often finish in single-digit milliseconds, which turns the
 * done-checkmark cascade into a blink; this wrapper holds every displayed
 * step on screen for a minimum dwell before showing the next one. A phase
 * that genuinely takes longer than the dwell still appears the moment it
 * begins — pacing only ever stretches, never delays real progress signals
 * beyond the dwell of the step before them.
 *
 * Flows should `await settled()` before swapping in their success screen,
 * so queued steps finish playing and the last phase isn't cut short.
 */

export interface PacedStepper<T> {
  /** Feed a step id as it begins — pass this as the flow's `onStep`. */
  step: (id: T) => void;
  /** Resolves once every fed step has been shown for the minimum dwell. */
  settled: () => Promise<void>;
}

export function createPacedStepper<T>(
  emit: (step: T) => void,
  minDwellMs = 200,
): PacedStepper<T> {
  const queue: T[] = [];
  let dwelling = false;
  const waiters: Array<() => void> = [];

  const display = (id: T) => {
    emit(id);
    dwelling = true;
    setTimeout(() => {
      dwelling = false;
      const next = queue.shift();
      if (next !== undefined) {
        display(next);
      } else {
        for (const wake of waiters.splice(0)) wake();
      }
    }, minDwellMs);
  };

  return {
    step: (id: T) => {
      if (dwelling) {
        queue.push(id);
      } else {
        display(id);
      }
    },
    settled: () =>
      dwelling
        ? new Promise((resolve) => {
            waiters.push(resolve);
          })
        : Promise.resolve(),
  };
}
