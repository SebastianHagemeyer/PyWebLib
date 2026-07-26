/*
 * Minimal coi-serviceworker: stamps COOP/COEP onto every response so the page
 * becomes cross-origin isolated (crossOriginIsolated === true) and can use
 * SharedArrayBuffer, WITHOUT the server setting any headers. This is the hack
 * that makes SharedArrayBuffer work on GitHub Pages.
 *
 * It also re-stamps CROSS-ORIGIN responses (e.g. the Pyodide CDN) with
 * Cross-Origin-Resource-Policy so they survive COEP: require-corp.
 */
self.addEventListener("install", function () { self.skipWaiting(); });
self.addEventListener("activate", function (e) { e.waitUntil(self.clients.claim()); });

self.addEventListener("fetch", function (event) {
  const req = event.request;
  if (req.cache === "only-if-cached" && req.mode !== "same-origin") return;

  event.respondWith(
    fetch(req).then(function (res) {
      if (res.status === 0) return res;   // opaque, leave alone
      const headers = new Headers(res.headers);
      headers.set("Cross-Origin-Embedder-Policy", "require-corp");
      headers.set("Cross-Origin-Opener-Policy", "same-origin");
      // Let cross-origin subresources (CDN scripts, wasm) pass COEP.
      headers.set("Cross-Origin-Resource-Policy", "cross-origin");
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers: headers });
    }).catch(function (err) { console.error("coi-sw fetch failed", err); throw err; })
  );
});
