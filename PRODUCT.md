# Product

## Register

product

## Users
Anyone who wants an honest picture of where their browser time goes, especially privacy-minded people who won't install a tracker that phones home. Typical use is a glance at the toolbar popup a few times a day ("how much of my Social budget is left?"), plus occasional sessions in the dashboard to review the week, sort sites into categories, and adjust budgets.

## Product Purpose
Hourglass is a Chrome extension that measures time per site, groups sites into user-defined categories with daily budgets, and nudges the user when a budget runs low. All data stays in the browser (IndexedDB / chrome.storage); the extension cannot make network requests. Success means the user trusts the numbers, reads them in under two seconds, and changes their habits a little.

## Brand Personality
Calm, precise, trustworthy. Like a well-made instrument: it reports, it doesn't nag or celebrate. Numbers are the hero. Color is information (category identity, budget state), never decoration. Copy is plain and specific.

## Anti-references
- Generic Tailwind/shadcn SaaS dashboards: slate grays, indigo accents, emoji nav, rounded cards everywhere.
- Gamified "digital wellbeing" apps with streaks, confetti, mascots, guilt-trip copy.
- Dark-pattern productivity tools that shame the user.

## Design Principles
1. **Numbers first.** Time values are the primary content; give them the strongest typographic treatment and tabular figures.
2. **Color carries meaning.** Category hues and budget state (fine / close / over) are the only saturated color on screen.
3. **Quiet chrome.** Navigation, borders and containers recede; prefer whitespace and rules over boxes.
4. **Practice what we preach.** No tracking, no network, no fluff; the UI should feel as honest as the data policy.
5. **Respect the glance.** The popup must answer "how am I doing today?" without scrolling or reading labels.

## Accessibility & Inclusion
WCAG 2.2 AA: 4.5:1 text contrast in both light and dark themes, visible keyboard focus, real buttons and labels (no glyph-only controls without accessible names), budget state never conveyed by color alone, honors prefers-reduced-motion and prefers-color-scheme.
