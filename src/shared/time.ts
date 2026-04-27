import type { UnixMs } from './types';

export type Clock = () => UnixMs;

export const systemClock: Clock = () => Date.now();

export function secondsFromNow(clock: Clock, seconds: number): UnixMs {
  return clock() + seconds * 1000;
}
