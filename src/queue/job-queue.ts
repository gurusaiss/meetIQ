/**
 * Minimal in-process job queue so the HTTP layer never blocks on pipeline
 * work. Today the whole pipeline runs inline within one request — fine for
 * Groq's fast inference, but a slow/rate-limited provider holding a request
 * open for the duration of transcription + several LLM calls is a real
 * production risk (timeouts, exhausted connection pools under load).
 *
 * Same shape as every other provider in this codebase: a small interface
 * behind a swappable default implementation (`JobQueue` / `InMemoryJobQueue`,
 * mirroring `Repository` / `sqlite`-vs-`postgres` and `LLMProvider` /
 * `mock`-vs-`groq`). A real deployment would swap this for a Redis/BullMQ-
 * or Postgres-backed queue (surviving process restarts, shared across
 * replicas) without touching callers — `LectureService` only depends on the
 * `JobQueue` interface.
 */
export interface JobQueue {
  /** Number of jobs queued or currently running. */
  readonly size: number;
  /** Enqueue work to run in the background. Never throws synchronously. */
  enqueue(run: () => Promise<void>): void;
  /** Resolves once every queued/running job has settled. For tests and graceful shutdown. */
  onIdle(): Promise<void>;
}

export interface JobQueueOptions {
  /** How many jobs may run at once. Default 2 — enough to overlap I/O-bound
   *  provider calls without one slow tenant starving everyone else. */
  concurrency?: number;
  /** Called when a job's promise rejects. The queue itself never throws —
   *  a job is responsible for recording its own failure state (see
   *  `LectureService.enqueueProcessLecture`, which sets the lecture to
   *  "failed" from inside the job). Defaults to a no-op. */
  onError?: (err: unknown) => void;
}

/**
 * FIFO, bounded-concurrency, in-process queue. "In-process" means queued
 * work is lost on a process restart — acceptable here because the lecture
 * it was processing is left in `processing` status, which is already a
 * supported, visible, recoverable state (delete + recreate), not silent
 * data loss. A durable backend would remove that caveat; see the module
 * doc above.
 */
export class InMemoryJobQueue implements JobQueue {
  private readonly concurrency: number;
  private readonly onError: (err: unknown) => void;
  private readonly pending: Array<() => Promise<void>> = [];
  private active = 0;
  private idleWaiters: Array<() => void> = [];

  constructor(opts: JobQueueOptions = {}) {
    this.concurrency = Math.max(1, opts.concurrency ?? 2);
    this.onError = opts.onError ?? (() => undefined);
  }

  get size(): number {
    return this.pending.length + this.active;
  }

  enqueue(run: () => Promise<void>): void {
    this.pending.push(run);
    this.pump();
  }

  async onIdle(): Promise<void> {
    if (this.size === 0) return;
    await new Promise<void>((resolve) => this.idleWaiters.push(resolve));
  }

  private pump(): void {
    while (this.active < this.concurrency && this.pending.length > 0) {
      const job = this.pending.shift()!;
      this.active++;
      job()
        .catch((err) => this.onError(err))
        .finally(() => {
          this.active--;
          this.pump();
          if (this.size === 0) {
            const waiters = this.idleWaiters;
            this.idleWaiters = [];
            for (const w of waiters) w();
          }
        });
    }
  }
}
