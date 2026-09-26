/**
 * Web-native stand-in for the native AsyncStorage API.
 *
 * The React Native build persists hunts/progress to AsyncStorage; the browser
 * build uses `localStorage`, which is synchronous, so every method returns an
 * already-resolved promise to keep the same call sites (`await repo.getGame()`).
 *
 * `window` is guarded so this module stays importable during server rendering
 * — all access is lazy and happens inside function bodies.
 */
const memoryFallback = new Map<string, string>();

/** True when a real, writable `localStorage` is available (not a server render). */
function hasLocalStorage(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.localStorage;
  } catch {
    // Safari private mode / blocked storage throws on access.
    return false;
  }
}

export const webStorage = {
  async getItem(key: string): Promise<string | null> {
    if (!hasLocalStorage()) return memoryFallback.get(key) ?? null;
    return window.localStorage.getItem(key);
  },

  async setItem(key: string, value: string): Promise<void> {
    if (!hasLocalStorage()) {
      memoryFallback.set(key, value);
      return;
    }
    window.localStorage.setItem(key, value);
  },

  async removeItem(key: string): Promise<void> {
    if (!hasLocalStorage()) {
      memoryFallback.delete(key);
      return;
    }
    window.localStorage.removeItem(key);
  },
};

export default webStorage;