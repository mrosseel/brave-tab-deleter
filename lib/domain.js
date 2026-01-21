// Two-part TLDs that need special handling
export const TWO_PART_TLDS = [
  'co.uk', 'com.au', 'co.nz', 'co.jp', 'com.br',
  'co.kr', 'co.in', 'org.uk', 'net.au', 'com.mx'
];

/**
 * Check if hostname is an IP address (IPv4 or IPv6)
 */
export function isIPAddress(hostname) {
  // IPv4 pattern
  const ipv4Pattern = /^(\d{1,3}\.){3}\d{1,3}$/;
  // IPv6 pattern (simplified - covers most cases)
  const ipv6Pattern = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/;

  return ipv4Pattern.test(hostname) || ipv6Pattern.test(hostname);
}

/**
 * Get short display name for group (strip TLD)
 * e.g., "google.com" -> "google", "bbc.co.uk" -> "bbc"
 */
export function getShortName(domain) {
  if (isIPAddress(domain)) {
    return domain; // Keep IP addresses as-is
  }

  const parts = domain.split('.');
  if (parts.length >= 2) {
    // Handle two-part TLDs like co.uk
    const lastTwo = parts.slice(-2).join('.');
    if (TWO_PART_TLDS.includes(lastTwo) && parts.length >= 3) {
      return parts.slice(0, -2).join('.');
    }
    // Remove single TLD
    return parts.slice(0, -1).join('.');
  }
  return domain;
}

/**
 * Get main domain from URL (e.g., mail.google.com -> google.com)
 * Returns null for invalid URLs
 */
export function getDomain(url) {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.toLowerCase();

    // Keep IP addresses as-is
    if (isIPAddress(hostname)) {
      return hostname;
    }

    // Split into parts
    const parts = hostname.split('.');

    if (parts.length <= 2) {
      return hostname; // Already a main domain like google.com
    }

    // Handle common two-part TLDs (co.uk, com.au, etc.)
    const lastTwo = parts.slice(-2).join('.');

    if (TWO_PART_TLDS.includes(lastTwo)) {
      // Take last 3 parts (e.g., bbc.co.uk)
      return parts.slice(-3).join('.');
    }

    // Otherwise take last 2 parts (e.g., google.com from mail.google.com)
    return parts.slice(-2).join('.');
  } catch {
    return null;
  }
}

/**
 * Get full hostname from URL (e.g., https://mail.google.com/foo -> mail.google.com)
 */
export function getHostname(url) {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Check if URL should be skipped (chrome internal URLs, blank pages)
 */
export function shouldSkipUrl(url) {
  return !url ||
    url === 'chrome://newtab/' ||
    url === 'about:blank' ||
    url.startsWith('chrome://') ||
    url.startsWith('chrome-extension://');
}

/**
 * Escape HTML to prevent XSS
 */
export function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
