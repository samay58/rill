import { describe, expect, it } from 'vitest';
import { relativeTime, startOfLocalDay } from '../../src/client/views/readingDay';

describe('relativeTime', () => {
  const now = Date.parse('2026-11-16T15:00:00');

  it('reads minutes and hours inside a day', () => {
    expect(relativeTime(now - 5 * 60000, now)).toBe('5m');
    expect(relativeTime(now - 3 * 3600000, now)).toBe('3h');
  });

  it('says Yesterday only for yesterday, then the weekday, then the date', () => {
    expect(relativeTime(Date.parse('2026-11-15T09:00:00'), now)).toBe('Yesterday');
    expect(relativeTime(Date.parse('2026-11-12T09:00:00'), now)).toBe('Thu');
    expect(relativeTime(Date.parse('2026-11-01T09:00:00'), now)).toBe('Nov 1');
  });

  it('starts the day at local midnight', () => {
    expect(new Date(startOfLocalDay(now)).getHours()).toBe(0);
  });
});
