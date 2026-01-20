// Shared utilities for Tab Deleter extension

// Chrome tab group colors with hex values
export const TAB_COLORS = {
  grey: '#5f6368',
  blue: '#1a73e8',
  red: '#d93025',
  yellow: '#f9ab00',
  green: '#1e8e3e',
  pink: '#d01884',
  purple: '#9334e6',
  cyan: '#007b83',
  orange: '#e8710a'
};

// Common two-part TLDs
const TWO_PART_TLDS = [
  'co.uk', 'com.au', 'co.nz', 'co.jp', 'com.br',
  'co.kr', 'co.in', 'org.uk', 'net.au', 'com.mx'
];

// Get hex color for a color name
export function getColorHex(colorName) {
  return TAB_COLORS[colorName] || TAB_COLORS.grey;
}

// Check if hostname is an IP address
export function isIPAddress(hostname) {
  const ipv4Pattern = /^(\d{1,3}\.){3}\d{1,3}$/;
  const ipv6Pattern = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/;
  return ipv4Pattern.test(hostname) || ipv6Pattern.test(hostname);
}

// Get main domain from URL (e.g., mail.google.com -> google.com)
export function getDomain(url) {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.toLowerCase();

    if (isIPAddress(hostname)) {
      return hostname;
    }

    const parts = hostname.split('.');

    if (parts.length <= 2) {
      return hostname;
    }

    const lastTwo = parts.slice(-2).join('.');
    if (TWO_PART_TLDS.includes(lastTwo)) {
      return parts.slice(-3).join('.');
    }

    return parts.slice(-2).join('.');
  } catch {
    return null;
  }
}

// Get short display name for group (strip TLD)
export function getShortName(domain) {
  if (isIPAddress(domain)) {
    return domain;
  }

  const parts = domain.split('.');
  if (parts.length >= 2) {
    const lastTwo = parts.slice(-2).join('.');
    if (TWO_PART_TLDS.includes(lastTwo) && parts.length >= 3) {
      return parts.slice(0, -2).join('.');
    }
    return parts.slice(0, -1).join('.');
  }
  return domain;
}

// Escape HTML to prevent XSS
export function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Check if URL should be skipped (chrome internal URLs)
export function shouldSkipUrl(url) {
  return !url ||
    url === 'chrome://newtab/' ||
    url === 'about:blank' ||
    url.startsWith('chrome://') ||
    url.startsWith('chrome-extension://');
}
