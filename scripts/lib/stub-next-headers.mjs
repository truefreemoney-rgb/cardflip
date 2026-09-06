/**
 * Test stand-in for `next/headers`: a cookie jar the test controls. Import
 * `next/headers` from the test too — the loader resolves both to this one
 * module instance, so `testCookies` here is the jar the routes read.
 */
export const testCookies = new Map();

export async function cookies() {
  return {
    get: (name) => (testCookies.has(name) ? { name, value: testCookies.get(name) } : undefined),
    getAll: () => [...testCookies].map(([name, value]) => ({ name, value })),
    has: (name) => testCookies.has(name),
    set: (name, value) => {
      if (typeof name === "object") testCookies.set(name.name, name.value);
      else testCookies.set(name, value);
    },
    delete: (name) => testCookies.delete(name),
  };
}

export async function headers() {
  return new Headers();
}

export async function draftMode() {
  return { isEnabled: false, enable() {}, disable() {} };
}
