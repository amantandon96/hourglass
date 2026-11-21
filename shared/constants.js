// shared/constants.js
export const DEFAULT_NOTIFY_AT = [80, 100];
export const FLUSH_ALARM_NAME = 'flush';
export const MIDNIGHT_ALARM_NAME = 'midnight-reset';
export const SNOOZE_MINUTES = 15;
export const PRUNE_DAYS = 90;

// v2: no pre-defined categories — user sets up their own from scratch
export const DEFAULT_CATEGORIES = [];

export const DEFAULT_SETTINGS = {
  notifyAt: DEFAULT_NOTIFY_AT,
  categories: DEFAULT_CATEGORIES,
};
