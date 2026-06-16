const PREFIX = 'visionos_';

export function storageKey(key: string): string {
  return `${PREFIX}${key}`;
}

export function loadJson<T>(key: string, fallback: T): T {
  if (typeof localStorage === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(storageKey(key));
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function saveJson<T>(key: string, value: T): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(storageKey(key), JSON.stringify(value));
  } catch {
    // quota exceeded — silently ignore
  }
}

export function loadString(key: string, fallback = ''): string {
  if (typeof localStorage === 'undefined') return fallback;
  return localStorage.getItem(storageKey(key)) ?? fallback;
}

export function saveString(key: string, value: string): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(storageKey(key), value);
}

export function remove(key: string): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(storageKey(key));
}
