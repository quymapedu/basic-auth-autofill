// Pure helper. Imports nothing, touches no chrome.* API, so `node --test`
// exercises it directly.

/**
 * Returns an `enqueue(task)` function that runs tasks strictly one at a time,
 * in call order.
 *
 * Rule sync is a read-modify-write: it reads the installed rules, then writes a
 * replacement set. Adding a site fires two triggers almost at once
 * (permissions.onAdded and storage.onChanged), and without serialization both
 * reads see the same state, both compute the same stale removal list, and the
 * second write collides on an id the first one just added.
 *
 * A rejected task does not break the chain — later tasks still run.
 */
export function createSerialQueue() {
  let tail = Promise.resolve();

  return function enqueue(task) {
    const run = tail.then(() => task());
    tail = run.then(
      () => {},
      () => {},
    );
    return run;
  };
}
