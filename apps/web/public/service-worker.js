const CACHE_PREFIX = "zetema-app-shell-";
const CACHE_NAME = `${CACHE_PREFIX}v1`;
const SCOPE_URL = new URL(self.registration.scope);
const SCOPE_PATH = SCOPE_URL.pathname;

const APP_SHELL = [
  SCOPE_URL.href,
  new URL("manifest.webmanifest", SCOPE_URL).href,
  new URL("icons/icon-192.png", SCOPE_URL).href,
  new URL("icons/icon-512.png", SCOPE_URL).href,
  new URL("icons/icon-512-maskable.png", SCOPE_URL).href,
  new URL("icons/apple-touch-icon.png", SCOPE_URL).href,
];

function isInAppScope(url) {
  return url.origin === self.location.origin && url.pathname.startsWith(SCOPE_PATH);
}

function isCacheableAsset(url) {
  return /\.(?:css|js|mjs|png|jpe?g|svg|webp|woff2?|webmanifest)$/i.test(url.pathname);
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      caches
        .keys()
        .then((keys) =>
          Promise.all(
            keys
              .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
              .map((key) => caches.delete(key)),
          ),
        ),
      self.clients.claim(),
    ]),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type !== "CACHE_URLS" || !Array.isArray(event.data.urls)) {
    return;
  }

  const urls = [...new Set(event.data.urls)]
    .map((value) => {
      try {
        return new URL(value, SCOPE_URL);
      } catch {
        return null;
      }
    })
    .filter((url) => url !== null && isInAppScope(url) && isCacheableAsset(url))
    .map((url) => url.href);

  if (urls.length === 0) {
    return;
  }

  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await Promise.allSettled(
        urls.map(async (url) => {
          const response = await fetch(url, { cache: "reload" });
          if (response.ok) {
            await cache.put(url, response);
          }
        }),
      );
    }),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);
  if (!isInAppScope(url)) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then(async (response) => {
          if (response.ok) {
            const cache = await caches.open(CACHE_NAME);
            await cache.put(SCOPE_URL.href, response.clone());
          }
          return response;
        })
        .catch(async () => {
          const cachedShell = await caches.match(SCOPE_URL.href);
          return cachedShell ?? Response.error();
        }),
    );
    return;
  }

  if (!isCacheableAsset(url)) {
    return;
  }

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(request);
      const network = fetch(request)
        .then(async (response) => {
          if (response.ok) {
            await cache.put(request, response.clone());
          }
          return response;
        })
        .catch(() => cached);

      return cached ?? network;
    }),
  );
});
