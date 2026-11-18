// Service worker for the web proxy (Scramjet 2) and its Chrome-extension
// support (Sapphire). Only registered once someone opens a website, and it
// only answers proxy and extension URLs; everything else goes straight to
// the network as normal.
importScripts('/js/vendor/sapphire-sw.js');
importScripts('/controller/controller.sw.js');

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  if (self.$sapphireRouter.shouldRoute(event)) {
    event.respondWith(self.$sapphireRouter.route(event));
    return;
  }
  if (self.$scramjetController.shouldRoute(event)) {
    event.respondWith(self.$scramjetController.route(event));
  }
});
