/**
 * Creates a queue-based async lock to serialize operations
 * @returns {Function} withLock function
 */
export function createLock() {
  let locked = false;
  let queue = [];

  function processQueue() {
    if (queue.length > 0 && !locked) {
      locked = true;
      const next = queue.shift();
      next().finally(() => {
        locked = false;
        processQueue();
      });
    }
  }

  return async function withLock(fn) {
    if (locked) {
      return new Promise((resolve, reject) => {
        queue.push(async () => {
          try {
            const result = await fn();
            resolve(result);
          } catch (err) {
            reject(err);
          }
        });
      });
    }

    locked = true;
    try {
      return await fn();
    } finally {
      locked = false;
      processQueue();
    }
  };
}
