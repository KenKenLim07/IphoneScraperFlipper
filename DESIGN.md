# Design System — Bantay Pilipinas

> Semantic design system extracted from the codebase. Reference this file for all visual decisions.

## Aesthetic Direction

**"Ops Center Noir"** — A dark-themed, data-dense monitoring dashboard inspired by military operations centers and air traffic control interfaces. The design prioritizes information density, real-time data legibility, and sustained viewing comfort. Philippine flag colors (blue, red, yellow) serve as intentional accents encoding data semantics: blue for information, red for alerts, yellow for live/active states.

---

## Color System

All colors use the **oklch** color space for perceptual uniformity. Defined in `client/src/index.css`.

### Dark Theme (Default)

| Token | Value | Usage |
|-------|-------|-------|
| `--background` | `oklch(0.10 0.015 260)` | Page background — deep navy |
| `--foreground` | `oklch(0.92 0.005 260)` | Primary text |
| `--card` | `oklch(0.14 0.02 260)` | Panel backgrounds |
| `--card-foreground` | `oklch(0.92 0.005 260)` | Panel text |
| `--primary` | `oklch(0.55 0.18 260)` | Primary actions, links |
| `--secondary` | `oklch(0.18 0.02 260)` | Secondary surfaces |
| `--muted` | `oklch(0.20 0.015 260)` | Disabled/subdued surfaces |
| `--muted-foreground` | `oklch(0.60 0.01 260)` | Secondary text, timestamps |
| `--border` | `oklch(0.25 0.02 260)` | Panel borders, dividers |
| `--destructive` | `oklch(0.55 0.22 25)` | Error states, critical alerts |

### Light Theme

| Token | Value | Usage |
|-------|-------|-------|
| `--background` | `oklch(0.975 0.003 80)` | Page background — warm paper-white |
| `--foreground` | `oklch(0.15 0.02 260)` | Primary text |
| `--card` | `oklch(0.995 0.002 80)` | Panel backgrounds |
| `--primary` | `oklch(0.42 0.18 260)` | Primary actions (darker for contrast) |
| `--border` | `oklch(0.90 0.008 80)` | Subtle borders |

### Philippine Flag Accents

| Token | Value | Semantic Meaning |
|-------|-------|-----------------|
| `--color-ph-blue` | `oklch(0.40 0.15 260)` | Information, data layers |
| `--color-ph-red` | `oklch(0.55 0.22 25)` | Alerts, critical events, active tab |
| `--color-ph-yellow` | `oklch(0.85 0.17 85)` | Live indicators, active states |
| `--color-ph-navy` | `oklch(0.12 0.02 260)` | Deep background accents |

### Chart Colors

| Token | Hue | Purpose |
|-------|-----|---------|
| `--chart-1` | 260 (blue) | Primary data series |
| `--chart-2` | 25 (red) | Alert/critical series |
| `--chart-3` | 85 (yellow) | Highlight/active series |
| `--chart-4` | 160 (teal) | Secondary data series |
| `--chart-5` | 300 (purple) | Tertiary data series |

### Data Freshness Colors (Hardcoded in FreshnessContext)

| State | Color | Threshold |
|-------|-------|-----------|
| Fresh | Green `#22c55e` | < 5 minutes |
| Aging | Yellow `#eab308` | 5-15 minutes |
| Stale | Orange `#f97316` | 15-30 minutes |
| Very Stale | Red `#ef4444` | > 30 minutes |

---

## Typography

Defined in `client/src/index.css` `@theme inline` block and `@layer base`.

| Role | Font Family | Weight | Size | Usage |
|------|------------|--------|------|-------|
| **Display** | Space Grotesk | 600-700 | 18-24px | Panel titles, headings, header |
| **Body** | IBM Plex Sans | 400-500 | 13-16px | Body text, descriptions, labels |
| **Data** | JetBrains Mono | 400 | 12-14px | Timestamps, coordinates, magnitudes |

### Hierarchy Rules

- `h1-h6` elements automatically use Space Grotesk via `@layer base`.
- `body` uses IBM Plex Sans as the default.
- Monospace data uses `font-mono` Tailwind class.
- Font loading via Google Fonts CDN in `client/index.html`.

---

## Spacing and Layout

### Desktop Grid

| Property | Value | Notes |
|----------|-------|-------|
| Grid system | react-grid-layout | 12 columns |
| Row height | Dynamic (calculated from viewport) | `(viewportHeight - headerHeight) / maxRows` |
| Margin | `[6, 6]` | 6px gap between panels |
| Bounded | `true` | Panels cannot overflow viewport |
| Compaction | Vertical | Panels compact upward |

### Default Panel Layout

| Panel | Position (x,y) | Size (w,h) | Min Size |
|-------|----------------|-----------|----------|
| Map | 0,0 | 7x13 | 4x6 |
| PhiVolcs | 7,0 | 2x13 | 2x4 |
| Volcano Cams | 9,0 | 3x13 | 2x3 |
| PH News | 0,13 | 3x12 | 2x3 |
| Water Levels | 3,13 | 3x12 | 2x3 |
| Weather & AQ | 6,13 | 3x12 | 2x3 |
| Livestream | 9,13 | 3x12 | 2x3 |

### Mobile Layout

| Property | Value |
|----------|-------|
| Bottom nav height | 64px (`MOBILE_NAV_HEIGHT`) |
| Tab count | 5 (Home, Map, News, Video, Alerts) |
| Tab switching | CSS `display: none` (no remounting) |
| Safe area | `env(safe-area-inset-bottom)` |
| Breakpoint | `< 768px` |

### Border Radius

| Token | Value |
|-------|-------|
| `--radius` | `0.5rem` (8px) |
| `--radius-sm` | `0.25rem` (4px) |
| `--radius-md` | `0.375rem` (6px) |
| `--radius-lg` | `0.5rem` (8px) |
| `--radius-xl` | `0.625rem` (10px) |

---

## Component Patterns

### Panel Wrapper

Every dashboard panel follows this structure:

```
PanelWrapper (border, rounded, overflow-hidden, flex-col)
├── Header (flex, items-center, justify-between, px-3, py-2)
│   ├── Icon + Title (Space Grotesk, font-semibold)
│   └── Controls (freshness indicator, action buttons)
├── Content (flex-1, overflow-y-auto, custom-scrollbar)
│   └── Panel-specific content
└── Footer (optional, source attribution)
```

### Scrollbar Style

Custom scrollbar mimicking a "crypto watchlist" aesthetic:

- Width: 6px
- Track: transparent
- Thumb: `var(--border)` with hover brightening
- Border-radius: 3px

### Mobile Bottom Nav Bar

```
Nav (fixed, bottom-0, left-0, right-0, z-[9999])
├── Frosted glass background (backdrop-blur-xl)
├── 5 tab buttons (flex, justify-around)
│   ├── Icon (SVG, filled when active, outlined when inactive)
│   └── Label (text-[10px], font-medium)
└── Safe area padding (env(safe-area-inset-bottom))
```

Active tab: Red color (`--ph-red`), filled icon.
Inactive tab: Muted foreground, outlined icon.

---

## Motion

| Interaction | Duration | Easing | Property |
|-------------|----------|--------|----------|
| Theme transition | 300ms | ease | background-color, color |
| Panel drag | Instant | N/A | transform (via react-grid-layout) |
| Tab switch | 0ms | N/A | display toggle (no animation) |
| Hover states | 150ms | ease | color, background-color, opacity |
| Toast appear | 200ms | ease-out | transform, opacity |

### Motion Philosophy

- Motion is **functional, not decorative**.
- Tab switching is instant (CSS display toggle) to prioritize data access speed.
- `prefers-reduced-motion` must be respected for all animations.
- No parallax, no scroll-triggered animations, no decorative micro-motion.

---

## Z-Index Scale

| Layer | Z-Index | Element |
|-------|---------|---------|
| Base content | 0 | Dashboard panels |
| Panel drag overlay | 10 | react-grid-layout drag handle |
| Header | 50 | Dashboard header bar |
| Tooltips/Popovers | 100 | Radix UI popovers |
| Mobile nav | 9999 | Bottom tab navigation |
| Toasts | 10000 | Sonner toast notifications |

---

## Icons

- **Library:** Lucide React (`lucide-react` v0.453)
- **Custom SVGs:** Mobile tab icons (inline SVG for filled/outlined variants)
- **Panel icons:** Text abbreviations in header (MAP, PV, VCAM, RSS, WL, WX, LIVE)
- **No emojis** as UI icons — SVG only.

---

## Accessibility

| Requirement | Implementation |
|-------------|---------------|
| Color contrast | 4.5:1 minimum (oklch values chosen for this) |
| Focus rings | Default Tailwind `outline-ring/50` on all interactive elements |
| ARIA labels | Icon-only buttons have `aria-label` |
| Keyboard nav | Tab order matches visual order |
| Reduced motion | Respect `prefers-reduced-motion` media query |
| Touch targets | 44x44px minimum on mobile |

---

*Generated from codebase analysis on March 6, 2026*
*Source files: `client/src/index.css`, `client/src/pages/Dashboard.tsx`, `client/src/contexts/ThemeContext.tsx`*
