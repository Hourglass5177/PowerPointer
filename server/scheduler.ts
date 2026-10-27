/** A shared, cancellable admission queue. Background work yields after each page. */
export class Scheduler {
  private running = 0;
  private queue: {
    background: boolean;
    signal: AbortSignal;
    start: () => void;
    cancel: () => void;
  }[] = [];
  constructor(readonly concurrency = 2) {}
  acquire(signal: AbortSignal, background = false): Promise<() => void> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(Error("已停止"));
        return;
      }
      const entry = {
        background,
        signal,
        start: () => {
          signal.removeEventListener("abort", entry.cancel);
          this.running++;
          let released = false;
          resolve(() => {
            if (!released) {
              released = true;
              this.running--;
              this.pump();
            }
          });
        },
        cancel: () => {
          this.queue = this.queue.filter((x) => x !== entry);
          reject(Error("已停止"));
        },
      };
      signal.addEventListener("abort", entry.cancel, { once: true });
      this.queue.push(entry);
      this.pump();
    });
  }
  private pump() {
    this.queue.sort((a, b) => Number(a.background) - Number(b.background));
    while (this.running < this.concurrency && this.queue.length)
      this.queue.shift()!.start();
  }
}
