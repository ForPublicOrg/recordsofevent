// SHA-256 fingerprints off the main thread (bundled as a classic script, served at /hash-worker.js).
// In:  { id, file, patches }   Out: { id, ack } then { id, p } progress 0..1, then { id, result } or { id, error }.
import { hashLocal } from './mp4.js';

self.onmessage = async ({ data }) => {
  const { id, file, patches } = data || {};
  self.postMessage({ id, ack: 1 });
  try {
    const result = await hashLocal(file, patches || [], (p) => self.postMessage({ id, p }));
    self.postMessage({ id, result });
  } catch (e) {
    self.postMessage({ id, error: (e && e.message) || String(e) });
  }
};
