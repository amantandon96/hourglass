import test from 'node:test';
import assert from 'node:assert/strict';
import { splitElapsedByLocalDate, datesBetween } from '../shared/tracker.js';

test('splits an interval that crosses local midnight', () => {
  const start = new Date(2026, 6, 26, 23, 59, 30).getTime();
  const end = new Date(2026, 6, 27, 0, 0, 30).getTime();

  assert.deepEqual(splitElapsedByLocalDate(start, end), {
    '2026-07-26': 30,
    '2026-07-27': 30,
  });
});

test('keeps an interval on one date when it does not cross midnight', () => {
  const start = new Date(2026, 6, 26, 12, 0, 0).getTime();
  const end = new Date(2026, 6, 26, 12, 2, 15).getTime();

  assert.deepEqual(splitElapsedByLocalDate(start, end), {
    '2026-07-26': 135,
  });
});

test('ignores intervals with no elapsed time', () => {
  const now = new Date(2026, 6, 26, 12, 0, 0).getTime();

  assert.deepEqual(splitElapsedByLocalDate(now, now), {});
  assert.deepEqual(splitElapsedByLocalDate(now + 1, now), {});
});

test('datesBetween lists every date inclusively, across month ends', () => {
  assert.deepEqual(datesBetween('2026-10-30', '2026-11-02'), [
    '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02',
  ]);
});

test('datesBetween neither repeats nor skips a date across DST changes', () => {
  // Spans both the EU (late March / late October) and US (March / November) switches.
  const spring = datesBetween('2026-03-01', '2026-04-30');
  const autumn = datesBetween('2026-10-01', '2026-11-30');
  assert.equal(spring.length, 61);
  assert.equal(new Set(spring).size, 61);
  assert.equal(autumn.length, 61);
  assert.equal(new Set(autumn).size, 61);
});

test('datesBetween handles single days and reversed ranges', () => {
  assert.deepEqual(datesBetween('2026-11-21', '2026-11-21'), ['2026-11-21']);
  assert.deepEqual(datesBetween('2026-11-22', '2026-11-21'), []);
});
