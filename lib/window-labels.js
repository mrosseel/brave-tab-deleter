import { GROUP_COLORS } from './colors.js';

const STORAGE_KEY = 'windowLabels';

// Palette for label badges. Indexed by label position so the same label
// always gets the same color within a session.
const LABEL_PALETTE = ['blue', 'red', 'green', 'orange', 'purple', 'cyan', 'pink', 'yellow', 'grey'];

// 0 -> A, 25 -> Z, 26 -> AA, 27 -> AB, ...
export function indexToLabel(idx) {
  let label = '';
  let n = idx;
  do {
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return label;
}

const EMPTY_STATE = { labels: {}, nextIndex: 0 };

export async function loadWindowLabels() {
  try {
    const stored = await chrome.storage.session.get(STORAGE_KEY);
    const state = stored[STORAGE_KEY];
    if (!state || typeof state !== 'object') return { ...EMPTY_STATE };
    return { labels: { ...state.labels }, nextIndex: state.nextIndex || 0 };
  } catch {
    return { ...EMPTY_STATE };
  }
}

export async function saveWindowLabels(state) {
  try {
    await chrome.storage.session.set({ [STORAGE_KEY]: state });
  } catch {}
}

// Ensure every windowId in the list has a sticky label. Labels are assigned
// in ascending windowId order (Chrome creates windowIds monotonically) so
// initial seeding matches creation order.
export async function ensureLabelsForWindows(windowIds, state = null) {
  if (!state) state = await loadWindowLabels();
  const missing = windowIds
    .filter((wid) => state.labels[wid] === undefined)
    .sort((a, b) => a - b);
  if (missing.length === 0) return state;
  for (const wid of missing) {
    state.labels[wid] = indexToLabel(state.nextIndex);
    state.nextIndex++;
  }
  await saveWindowLabels(state);
  return state;
}

// Drop a label entry (window closed). Keeps nextIndex so the freed letter
// is never reused.
export async function releaseLabelForWindow(windowId, state = null) {
  if (!state) state = await loadWindowLabels();
  if (state.labels[windowId] === undefined) return state;
  delete state.labels[windowId];
  await saveWindowLabels(state);
  return state;
}

export function getColorForLabel(label) {
  // Use first character to pick from palette so AA/AB still get a stable color.
  const idx = (label.charCodeAt(0) - 65 + 26) % 26;
  return GROUP_COLORS[LABEL_PALETTE[idx % LABEL_PALETTE.length]];
}
