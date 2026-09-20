/** Shared by the host across runs. A timed-out uncooperative task retains its slot
 * until it settles, so cancellation cannot silently exceed provider concurrency. */
export class GuardrailScheduler {
  private active = 0;
  private readonly queue: Array<() => void> = [];
  constructor(
    readonly concurrency = 2,
    readonly queueSize = 32,
  ) {
    if (
      !Number.isSafeInteger(concurrency) ||
      concurrency < 1 ||
      !Number.isSafeInteger(queueSize) ||
      queueSize < 0
    )
      throw new Error("Invalid classifier limits");
  }
  async run<T>(signal: AbortSignal, operation: () => Promise<T>): Promise<T> {
    signal.throwIfAborted();
    if (this.active >= this.concurrency) {
      if (this.queue.length >= this.queueSize)
        throw new Error("Classifier queue full");
      await new Promise<void>((resolve, reject) => {
        const grant = () => {
          signal.removeEventListener("abort", cancel);
          resolve();
        };
        const cancel = () => {
          const index = this.queue.indexOf(grant);
          if (index >= 0) this.queue.splice(index, 1);
          reject(signal.reason);
        };
        this.queue.push(grant);
        signal.addEventListener("abort", cancel, { once: true });
      });
    } else this.active++;
    try {
      signal.throwIfAborted();
      return await operation();
    } finally {
      const next = this.queue.shift();
      if (next) next();
      else this.active--;
    }
  }
  get pending(): number {
    return this.queue.length;
  }
  get running(): number {
    return this.active;
  }
}
