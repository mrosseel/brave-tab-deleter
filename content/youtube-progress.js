// YouTube video progress content script
// Only active on www.youtube.com (not music.youtube.com)

if (window.location.hostname !== 'www.youtube.com') {
  // Exit early for music.youtube.com or other subdomains
  throw new Error('Not www.youtube.com');
}

// Clean up any previous instance (handles re-injection on extension reload / sidebar reopen)
if (window.__youtubeProgressCleanup) {
  window.__youtubeProgressCleanup();
}

let isPolling = false;
let pollIntervalId = null;
const POLL_INTERVAL_MS = 10000;

function getVideoId() {
  const params = new URLSearchParams(window.location.search);
  return params.get('v');
}

function getVideoProgress() {
  const video = document.querySelector('video.html5-main-video');
  if (!video || !video.duration || video.duration === 0) {
    return null;
  }
  const progress = Math.round((video.currentTime / video.duration) * 100);
  return { progress, videoId: getVideoId() };
}

function isContextValid() {
  try {
    return !!(chrome.runtime && chrome.runtime.id);
  } catch {
    return false;
  }
}

function sendProgress() {
  if (!isContextValid()) {
    // Extension was reloaded — stop polling so we don't keep throwing
    stopPolling();
    return;
  }
  const data = getVideoProgress();
  if (data && data.videoId) {
    try {
      chrome.runtime.sendMessage({
        type: 'youtubeProgress',
        progress: data.progress,
        videoId: data.videoId
      }).catch(() => {});
    } catch {
      stopPolling();
    }
  }
}

function startPolling() {
  if (isPolling) return;
  isPolling = true;
  sendProgress();
  pollIntervalId = setInterval(sendProgress, POLL_INTERVAL_MS);
}

function stopPolling() {
  if (!isPolling) return;
  isPolling = false;
  if (pollIntervalId) {
    clearInterval(pollIntervalId);
    pollIntervalId = null;
  }
}

function onMessage(message) {
  if (message.type === 'startYoutubePolling') {
    startPolling();
  } else if (message.type === 'stopYoutubePolling') {
    stopPolling();
  }
}
chrome.runtime.onMessage.addListener(onMessage);

// Wrap pushState/replaceState only once per page lifetime — preserve originals
// across re-injection so we don't stack wrappers.
const histPatch = (window.__youtubeProgressHistPatch ||= {
  origPush: history.pushState,
  origReplace: history.replaceState,
  current: null
});

function onNavigation() {
  if (isPolling) sendProgress();
}

histPatch.current = onNavigation;
history.pushState = function(...args) {
  histPatch.origPush.apply(this, args);
  if (histPatch.current) histPatch.current();
};
history.replaceState = function(...args) {
  histPatch.origReplace.apply(this, args);
  if (histPatch.current) histPatch.current();
};

window.addEventListener('popstate', onNavigation);

window.__youtubeProgressCleanup = () => {
  stopPolling();
  chrome.runtime.onMessage.removeListener(onMessage);
  window.removeEventListener('popstate', onNavigation);
  // Detach our nav handler from the shared history wrapper
  if (histPatch.current === onNavigation) histPatch.current = null;
};

// Notify background that content script is ready and auto-start if told to.
// The service worker may be starting up (or asleep) when we first ask, so retry
// a few times rather than silently never polling.
const READY_RETRIES = 3;
const READY_RETRY_MS = 1000;

function announceReady(attempt = 0) {
  if (!isContextValid()) return;
  try {
    chrome.runtime.sendMessage({ type: 'youtubeContentScriptReady' }, (response) => {
      if (chrome.runtime.lastError || !response) {
        if (attempt < READY_RETRIES) {
          setTimeout(() => announceReady(attempt + 1), READY_RETRY_MS * (attempt + 1));
        }
        return;
      }
      if (response.startPolling) {
        startPolling();
      }
    });
  } catch {
    // Context invalidated; nothing to do
  }
}

announceReady();
