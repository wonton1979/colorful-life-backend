const MAX_CALLS = 3;
const WINDOW_MS = 15 * 60 * 1000;

type Entry = { startedAt: number; calls: number };
const usage = new Map<number, Entry>();
let clock = () => Date.now();

export function consumeAddressLookupAllowance(userId: number): boolean {
  const now = clock();
  const existing = usage.get(userId);
  if (!existing || now - existing.startedAt >= WINDOW_MS) {
    usage.set(userId, { startedAt: now, calls: 1 });
    return true;
  }
  if (existing.calls >= MAX_CALLS) return false;
  existing.calls += 1;
  return true;
}

export function resetAddressLookupRateLimiterForTests(): void {
  usage.clear();
}

export function setAddressLookupRateLimiterClockForTests(testClock: () => number): () => void {
  const previous = clock;
  clock = testClock;
  return () => { clock = previous; };
}
