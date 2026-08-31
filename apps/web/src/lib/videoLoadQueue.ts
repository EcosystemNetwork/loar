/**
 * Video Load Queue — Serializes video loading so videos appear one-by-one
 * instead of all fighting for bandwidth simultaneously.
 *
 * Videos load in small batches (concurrency = 3 by default).
 * When one finishes, the next starts immediately.
 */

type QueueEntry = {
  resolve: () => void;
  id: string;
};

class VideoLoadQueue {
  private queue: QueueEntry[] = [];
  private active = 0;
  private concurrency: number;

  constructor(concurrency = 3) {
    this.concurrency = concurrency;
  }

  /**
   * Request a loading slot. Returns a promise that resolves when
   * this video is allowed to start loading (i.e., set its src).
   */
  enqueue(id: string): Promise<void> {
    return new Promise((resolve) => {
      this.queue.push({ resolve, id });
      this.flush();
    });
  }

  /** Call when a video's metadata/data has loaded or errored. Frees the slot. */
  done(_id: string) {
    this.active--;
    this.flush();
  }

  /** Remove a video from the queue (e.g., if the component unmounts before loading). */
  cancel(id: string) {
    this.queue = this.queue.filter((e) => e.id !== id);
  }

  private flush() {
    while (this.active < this.concurrency && this.queue.length > 0) {
      this.active++;
      const entry = this.queue.shift()!;
      entry.resolve();
    }
  }
}

/**
 * Singleton queue shared across all gallery video cards.
 *
 * Concurrency 12: the IPFS gateway (w3s.link) is HTTP/2, so requests multiplex
 * over a single connection and the old HTTP/1.1 "6 per origin" cap doesn't
 * apply. 6 was throttling the first visible screenful into slow batches —
 * tiles trickled in one row at a time. 12 lets the whole above-the-fold grid
 * (~8–12 tiles, bounded by useVideoLoad's 300px intersection gate) start
 * loading at once, so the page fills evenly instead of staggered. Off-screen
 * cards still wait their turn, and the per-slot watchdog frees stuck loads.
 */
export const videoLoadQueue = new VideoLoadQueue(12);
