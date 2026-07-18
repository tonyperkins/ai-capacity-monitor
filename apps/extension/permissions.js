// Permission helpers shared by the Settings page and service worker. These
// return Chrome match patterns, not page URLs, and never request permission on
// their own. Requesting is deliberately left to a Settings user gesture.
function originPatternForUrl(value) {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.hostname}/*`;
  } catch {
    return null;
  }
}

function providerOrigin(provider) {
  return originPatternForUrl(provider.url);
}
