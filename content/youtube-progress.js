// YouTube video progress content script
// Only active on www.youtube.com (not music.youtube.com)

if (window.location.hostname !== 'www.youtube.com') {
  // Exit early for music.youtube.com or other subdomains
  throw new Error('Not www.youtube.com');
}

// Guard against multiple injections
if (window.__youtubeProgressInjected) {
  throw new Error('Already injected');
}
window.__youtubeProgressInjected = true;

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

function sendProgress() {
  const data = getVideoProgress();
  if (data && data.videoId) {
    chrome.runtime.sendMessage({
      type: 'youtubeProgress',
      progress: data.progress,
      videoId: data.videoId
    }).catch(() => {});
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

// Listen for start/stop messages from background
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'startYoutubePolling') {
    startPolling();
  } else if (message.type === 'stopYoutubePolling') {
    stopPolling();
  }
});

// Handle YouTube SPA navigation
const originalPushState = history.pushState;
const originalReplaceState = history.replaceState;

function onNavigation() {
  if (isPolling) {
    sendProgress();
  }
}

history.pushState = function(...args) {
  originalPushState.apply(this, args);
  onNavigation();
};

history.replaceState = function(...args) {
  originalReplaceState.apply(this, args);
  onNavigation();
};

window.addEventListener('popstate', onNavigation);

// Notify background that content script is ready
chrome.runtime.sendMessage({ type: 'youtubeContentScriptReady' }).catch(() => {});
