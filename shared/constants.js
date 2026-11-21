// shared/constants.js
export const DEFAULT_BUDGET_MINUTES = 120;
export const DEFAULT_NOTIFY_AT = [80, 100];
export const FLUSH_ALARM_NAME = 'flush';
export const MIDNIGHT_ALARM_NAME = 'midnight-reset';
export const SNOOZE_MINUTES = 15;
export const PRUNE_DAYS = 90;

export const DEFAULT_LEISURE_DOMAINS = [
  'youtube.com', 'reddit.com', 'twitter.com', 'x.com',
  'tiktok.com', 'instagram.com', 'facebook.com',
  'twitch.tv', 'netflix.com', 'hulu.com',
  '9gag.com', 'buzzfeed.com', 'tumblr.com',
  'pinterest.com', 'imgur.com', 'digg.com',
  'news.ycombinator.com', 'lobste.rs', 'producthunt.com',
  'discord.com',
];

export const DEFAULT_SETTINGS = {
  dailyBudgetMinutes: DEFAULT_BUDGET_MINUTES,
  notifyAt: DEFAULT_NOTIFY_AT,
  leisureDomains: DEFAULT_LEISURE_DOMAINS,
};
