const DEBUG = !!process.env.DEBUG;

export function debug(...args: unknown[]): void {
  if (DEBUG) {
    console.error(...args);
  }
}
