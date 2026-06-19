// Simple global toast system
let toastListeners: ((msg: string, type: string) => void)[] = [];

export function addToastListener(fn: (msg: string, type: string) => void) {
  toastListeners.push(fn);
  return () => { toastListeners = toastListeners.filter(l => l !== fn); };
}

export function toast(msg: string, type: 'success' | 'error' = 'success') {
  toastListeners.forEach(fn => fn(msg, type));
}
