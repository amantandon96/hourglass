import test from 'node:test';
import assert from 'node:assert/strict';
import { splitElapsedByLocalDate } from '../shared/tracker.js';

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
