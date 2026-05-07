function deepEqual(a, b) {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== 'object' || typeof b !== 'object') return false;

  const aIsArr = Array.isArray(a);
  const bIsArr = Array.isArray(b);
  if (aIsArr !== bIsArr) return false;

  if (aIsArr) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }

  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (!deepEqual(a[k], b[k])) return false;
  }
  return true;
}

class EventBus {
  constructor() {
    this.listeners = {};
  }

  on(event, fn) {
    (this.listeners[event] ??= []).push(fn);
    return () => this.off(event, fn);
  }

  off(event, fn) {
    this.listeners[event] = this.listeners[event]?.filter(f => f !== fn);
  }

  async emit(event, ...args) {
    for (const fn of this.listeners[event] || []) {
      await fn(...args);
    }
  }
}

export const bus = new EventBus();

export async function emitSettingsChanges(oldSettings, newSettings, context = {}) {
  for (const key of Object.keys(newSettings)) {
    const oldVal = oldSettings[key];
    const newVal = newSettings[key];

    if (deepEqual(oldVal, newVal)) continue;

    await bus.emit(`settings:${key}`, newVal, oldVal, context);
  }
}
