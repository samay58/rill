import { afterEach } from 'vitest';

// Reader writes #read/<id> into the URL; one test's open article must not open in the next test's app.
afterEach(() => {
  if (typeof window !== 'undefined' && window.location.hash) window.history.replaceState(null, '', window.location.pathname);
});
