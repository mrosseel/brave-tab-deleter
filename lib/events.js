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

    if (oldVal === newVal) continue;
    if (typeof oldVal === 'object' && typeof newVal === 'object' &&
        JSON.stringify(oldVal) === JSON.stringify(newVal)) continue;

    await bus.emit(`settings:${key}`, newVal, oldVal, context);
  }
}
