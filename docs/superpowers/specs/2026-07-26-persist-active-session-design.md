# Persist Active Tracking Session Design

**Date:** 2026-07-26
**Status:** Approved for implementation

## Goal

Prevent website usage from being under-counted when the Manifest V3 service
worker is suspended and restarted while a tab remains active.

## Design

The background worker will persist the active tracking session in the existing
IndexedDB `session` record. The session will include `activeDomain`,
`activeStart`, and `activeDate` in addition to the existing notification state.

`activeDate` records the local date on which the interval began. Flushes will
add elapsed seconds to that date, rather than always using the current date.
This prevents activity spanning local midnight from being assigned wholly to
the new day.

On startup, initialization will restore the persisted session, flush any
restored interval using its stored domain/start/date, then query Chrome for the
currently focused window and active tab. It will begin a new interval for that
tab when it is an HTTP(S) page; otherwise tracking remains stopped.

Normal tab activation, page completion, focus changes, periodic flushes, and
midnight resets will continue to use the same tracking state and will persist
state changes. When tracking stops, the persisted active session will be
cleared after its final interval is flushed.

## Data Flow

1. A trackable active tab starts an interval and persists its domain, start
   timestamp, and local start date.
2. A flush reads the active interval, adds it to the stored usage for the
   interval's date, advances the start timestamp, and persists the updated
   session.
3. A worker restart restores and flushes the durable interval, then reconciles
   tracking with Chrome's current focused tab.
4. Tab/window changes flush the previous interval before starting or stopping
   the next one.

## Edge Cases

- Service-worker restart while the same tab remains active: elapsed time is
  retained and tracking resumes.
- Service-worker restart after the user changes tabs: the persisted interval
  is attributed to the old domain, then the current tab starts a new interval.
- Service-worker restart while Chrome has no focused window: the persisted
  interval is flushed and no new interval starts.
- Non-HTTP(S) pages are not tracked.
- A session crossing midnight is written to the date on which its interval
  began; the existing midnight alarm flushes and resets tracking at midnight.

## Verification

Add tests or targeted checks for session persistence, startup reconciliation,
flush behavior, and date attribution. Run the available project checks and
inspect the resulting diff before claiming completion.
