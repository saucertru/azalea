// Loads manifest.json (written by scripts/build-manifest.js)
const EMPTY = { games: [], music: [], pdfs: [], videos: [] };
let cache = null;

export function getManifest(force = false) {
  if (!cache || force) {
    cache = fetch('manifest.json', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : EMPTY))
      .then((m) => ({ ...EMPTY, ...m }))
      .catch(() => EMPTY);
  }
  return cache;
}
