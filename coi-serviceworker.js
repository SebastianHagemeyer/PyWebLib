/*
 * coi-serviceworker: stamps COOP/COEP (and CORP on cross-origin responses) onto
 * everything, so the page becomes cross-origin isolated and SharedArrayBuffer
 * works WITHOUT the server setting headers (GitHub Pages can't). Registered from
 * pyrun.js ONLY on browsers without JSPI (Safari/Firefox); Chrome/Edge never see
 * it, so their auth and avatars are untouched. Lives at the site root so its
 * scope can cover /, /community/ and /game/.
 */
self.addEventListener("install", function () { self.skipWaiting(); });
self.addEventListener("activate", function (e) { e.waitUntil(self.clients.claim()); });

self.addEventListener("fetch", function (event) {
  const req = event.request;
  if (req.cache === "only-if-cached" && req.mode !== "same-origin") return;

  event.respondWith(
    fetch(req).then(function (res) {
      if (res.status === 0) return res;
      const headers = new Headers(res.headers);
      headers.set("Cross-Origin-Embedder-Policy", "require-corp");
      headers.set("Cross-Origin-Opener-Policy", "same-origin");
      headers.set("Cross-Origin-Resource-Policy", "cross-origin");
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers: headers });
    }).catch(function (err) { console.error("coi-sw", err); throw err; })
  );
});
