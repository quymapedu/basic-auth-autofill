import { test } from "node:test";
import assert from "node:assert/strict";
import { createSerialQueue } from "../lib/queue.js";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test("runs tasks in call order", async () => {
  const enqueue = createSerialQueue();
  const order = [];
  await Promise.all([
    enqueue(async () => {
      await tick();
      order.push("a");
    }),
    enqueue(async () => order.push("b")),
    enqueue(async () => order.push("c")),
  ]);
  assert.deepEqual(order, ["a", "b", "c"]);
});

test("a second task cannot start before the first finishes", async () => {
  // This is the actual bug: two overlapping read-modify-write syncs both read
  // the same state, then collide on write.
  const enqueue = createSerialQueue();
  let running = 0;
  let maxConcurrent = 0;

  const task = async () => {
    running += 1;
    maxConcurrent = Math.max(maxConcurrent, running);
    await tick();
    running -= 1;
  };

  await Promise.all([enqueue(task), enqueue(task), enqueue(task)]);
  assert.equal(maxConcurrent, 1);
});

test("interleaved read-modify-write cannot observe a stale read", async () => {
  // Models syncRules: read current ids, then replace them. Without the queue
  // both tasks read [] and both try to add id 1.
  const enqueue = createSerialQueue();
  let installed = [];
  const collisions = [];

  const sync = async (ids) => {
    const seen = [...installed];
    await tick(); // the await that let the old code interleave
    for (const id of ids) {
      if (seen.includes(id) === false && installed.includes(id)) {
        collisions.push(id);
      }
    }
    installed = ids;
  };

  await Promise.all([enqueue(() => sync([1])), enqueue(() => sync([1]))]);
  assert.deepEqual(collisions, []);
});

test("a rejected task does not break the chain", async () => {
  const enqueue = createSerialQueue();
  const order = [];

  const failing = enqueue(async () => {
    order.push("boom");
    throw new Error("boom");
  });
  await assert.rejects(failing, /boom/);

  await enqueue(async () => order.push("after"));
  assert.deepEqual(order, ["boom", "after"]);
});

test("enqueue resolves with the task's return value", async () => {
  const enqueue = createSerialQueue();
  assert.equal(await enqueue(async () => 42), 42);
});
