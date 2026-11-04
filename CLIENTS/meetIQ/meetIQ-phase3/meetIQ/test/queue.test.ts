import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryJobQueue } from "../src/queue/job-queue.ts";

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

test("enqueue runs jobs and size reflects pending + active work", async () => {
  const q = new InMemoryJobQueue({ concurrency: 1 });
  const gate = deferred();
  let ran = false;
  q.enqueue(async () => {
    await gate.promise;
    ran = true;
  });
  assert.equal(q.size, 1);
  gate.resolve();
  await q.onIdle();
  assert.equal(ran, true);
  assert.equal(q.size, 0);
});

test("respects the concurrency limit — no more than N jobs run at once", async () => {
  const q = new InMemoryJobQueue({ concurrency: 2 });
  let concurrent = 0;
  let maxConcurrent = 0;
  const gates = Array.from({ length: 5 }, () => deferred());

  gates.forEach((g, i) => {
    q.enqueue(async () => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await g.promise;
      concurrent--;
    });
    void i;
  });

  // Let the first wave start.
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(maxConcurrent, 2, "only 2 jobs should be running at once");

  for (const g of gates) g.resolve();
  await q.onIdle();
  assert.equal(maxConcurrent, 2);
  assert.equal(q.size, 0);
});

test("a job rejecting does not stop the queue or reject onIdle", async () => {
  const errors: unknown[] = [];
  const q = new InMemoryJobQueue({ concurrency: 1, onError: (e) => errors.push(e) });
  let secondRan = false;
  q.enqueue(async () => {
    throw new Error("boom");
  });
  q.enqueue(async () => {
    secondRan = true;
  });
  await q.onIdle();
  assert.equal(secondRan, true, "a failing job must not block later jobs");
  assert.equal(errors.length, 1);
  assert.equal((errors[0] as Error).message, "boom");
});

test("onIdle resolves immediately when nothing is queued", async () => {
  const q = new InMemoryJobQueue();
  await q.onIdle(); // must not hang
  assert.equal(q.size, 0);
});

test("onIdle waits for jobs enqueued while already draining", async () => {
  const q = new InMemoryJobQueue({ concurrency: 1 });
  const order: string[] = [];
  const gate = deferred();
  q.enqueue(async () => {
    await gate.promise;
    order.push("first");
    // Enqueue more work from inside a running job — onIdle() must still wait for it.
    q.enqueue(async () => {
      order.push("second");
    });
  });
  const idle = q.onIdle();
  gate.resolve();
  await idle;
  assert.deepEqual(order, ["first", "second"]);
});
