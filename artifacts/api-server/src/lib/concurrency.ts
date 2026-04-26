/**
 * Tiny dependency-free concurrency limiter, modelled on `p-limit`.
 *
 * Used by the batch-upload pipeline so that uploading 6 PDFs at once doesn't
 * fan out into 6 simultaneous 3-lens runs (which would saturate the LLM
 * provider rate limits and also blow our memory budget). Caller pushes a
 * task, the limiter runs at most `concurrency` at a time and queues the
 * rest in FIFO order.
 *
 * Returned function preserves the task's resolved value and propagates
 * rejections, so callers can `await` individual results or use
 * `Promise.allSettled` over the array.
 */
export type LimitedRunner = <T>(task: () => Promise<T>) => Promise<T>;

export function createLimiter(concurrency: number): LimitedRunner {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error(`createLimiter: concurrency must be a positive integer, got ${concurrency}`);
  }
  let active = 0;
  const queue: Array<() => void> = [];

  const next = (): void => {
    if (active >= concurrency) return;
    const job = queue.shift();
    if (job) job();
  };

  return <T,>(task: () => Promise<T>): Promise<T> => {
    return new Promise<T>((resolve, reject) => {
      const run = (): void => {
        active++;
        // Wrap synchronously to catch tasks that throw before returning
        // a Promise (otherwise active would never decrement).
        Promise.resolve()
          .then(task)
          .then(
            (val) => {
              active--;
              resolve(val);
              next();
            },
            (err) => {
              active--;
              reject(err);
              next();
            },
          );
      };

      if (active < concurrency) run();
      else queue.push(run);
    });
  };
}
