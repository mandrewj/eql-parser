// Display formatting for the side panel. Every threshold here exists because the app is
// read in a ~540px column next to the game, where a number that wraps costs a whole row.
// Pure and DOM-free on purpose, so `node --test` can cover it without a browser.

export const fmt = (n: number) => n.toLocaleString();

/** k-notation past `at`, one decimal — dropped over 100k so narrow columns don't overflow. */
export const scaleK = (n: number, at: number) =>
  n >= at ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k` : n.toLocaleString();

export const fmtK = (n: number) => scaleK(n, 10000);
export const fmtTank = (n: number) => scaleK(n, 2000); // tanking totals get big fast
export const fmtDrill = (n: number) => scaleK(n, 1000); // breakdown lines stay compact

export const time = (ms: number) => new Date(ms).toLocaleTimeString();

/** Elapsed time, coarsening as it grows. */
export const span = (ms: number) => {
  const sec = Math.round(ms / 1000);
  if (sec < 90) return `${sec}s`; // a first session is seconds long, not "1m"
  const min = Math.round(sec / 60);
  return min < 60 ? `${min}m` : `${Math.floor(min / 60)}h ${min % 60}m`;
};

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
