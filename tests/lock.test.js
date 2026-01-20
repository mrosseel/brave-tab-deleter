import { describe, it, expect } from 'vitest';
import { createLock } from '../lib/lock.js';

describe('createLock', () => {
  it('executes single operation immediately', async () => {
    const withLock = createLock();
    const result = await withLock(async () => 'done');
    expect(result).toBe('done');
  });

  it('serializes concurrent operations', async () => {
    const withLock = createLock();
    const order = [];

    const p1 = withLock(async () => {
      order.push('start-1');
      await new Promise(r => setTimeout(r, 50));
      order.push('end-1');
      return 1;
    });

    const p2 = withLock(async () => {
      order.push('start-2');
      await new Promise(r => setTimeout(r, 10));
      order.push('end-2');
      return 2;
    });

    const p3 = withLock(async () => {
      order.push('start-3');
      order.push('end-3');
      return 3;
    });

    const results = await Promise.all([p1, p2, p3]);

    expect(results).toEqual([1, 2, 3]);
    expect(order).toEqual([
      'start-1', 'end-1',
      'start-2', 'end-2',
      'start-3', 'end-3'
    ]);
  });

  it('handles errors without blocking queue', async () => {
    const withLock = createLock();
    const order = [];

    const p1 = withLock(async () => {
      order.push('1');
      throw new Error('fail');
    }).catch(() => 'caught-1');

    const p2 = withLock(async () => {
      order.push('2');
      return 'success';
    });

    const results = await Promise.all([p1, p2]);

    expect(results).toEqual(['caught-1', 'success']);
    expect(order).toEqual(['1', '2']);
  });

  it('allows reuse after queue drains', async () => {
    const withLock = createLock();

    const r1 = await withLock(async () => 'first');
    expect(r1).toBe('first');

    const r2 = await withLock(async () => 'second');
    expect(r2).toBe('second');
  });

  it('processes deep queue correctly', async () => {
    const withLock = createLock();
    const results = [];

    const promises = [];
    for (let i = 0; i < 10; i++) {
      promises.push(withLock(async () => {
        await new Promise(r => setTimeout(r, 5));
        results.push(i);
        return i;
      }));
    }

    const returned = await Promise.all(promises);

    expect(returned).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(results).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
});
