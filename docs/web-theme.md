# Web theme ("Fjord")

The web app's colours come from the logo (`apps/web/public/logo.svg`): a navy chrome, teal for
links, focus and primary buttons, and orange only for the single main call to action on a page.

## Tokens

They are CSS custom properties on `:root` in `apps/web/src/style.css`, redefined inside its
`@media (prefers-color-scheme: dark)` block, so a rule that uses a token needs no dark override.

| token                   | light     | dark      | use                                                                    |
| ----------------------- | --------- | --------- | ---------------------------------------------------------------------- |
| `--color-bg`            | `#ffffff` | `#12161c` | page background                                                        |
| `--color-surface`       | `#ffffff` | `#1b222b` | cards and panels                                                       |
| `--color-border`        | `#dde3ea` | `#2a333f` | neutral borders                                                        |
| `--color-text`          | `#1b2430` | `#e6e9ee` | body text                                                              |
| `--color-text-muted`    | `#5b6675` | `#9aa6b4` | secondary text                                                         |
| `--color-chrome`        | `#0f2a4f` | `#0b1a30` | sidebar, narrow top bar, drawer                                        |
| `--color-chrome-hover`  | `#173a66` | `#14294a` | hovered nav item                                                       |
| `--color-chrome-active` | `#1d4270` | `#173357` | active nav item                                                        |
| `--color-chrome-text`   | `#d6e2f0` | `#c3cfdd` | nav link text (active and brand text are `#fff`)                       |
| `--color-accent`        | `#17707a` | `#4cc3cc` | links, text accents, outlines, focus rings, underlines, accent borders |
| `--color-accent-hover`  | `#0f5a62` | `#8fe3e9` | hovered links and accents                                              |
| `--color-accent-soft`   | `#e7f4f5` | `#11262b` | tinted backgrounds (selected rows, chips, hovered cards)               |
| `--color-accent-border` | `#a8d8dc` | `#1f5a60` | soft borders around tinted backgrounds                                 |
| `--color-primary`       | `#17707a` | `#17707a` | filled buttons with white text                                         |
| `--color-primary-hover` | `#0f5a62` | `#1f8a94` | hovered filled buttons                                                 |
| `--color-cta`           | `#f9ab33` | `#f9ab33` | the one main call to action on a page (sign up, start)                 |
| `--color-cta-text`      | `#1b1406` | `#1b1406` | text on `--color-cta`                                                  |
| `--color-cta-hover`     | `#e8981c` | `#ffbb55` | hovered call to action                                                 |

White text goes on `--color-primary`, never on `--color-accent`: the dark accent is a light teal
that white text cannot be read on.

## Rules

- No literal brand colours in CSS or inline styles: use the tokens. `no-brand-purple.test.ts`
  fails on the old `#673ab8` purple.
- Categorical data colours are separate and stay literal: a palette where a hue means a
  category or a series (timeline tags, activity and screen-time categories, HR zones,
  multi-series palettes, challenge member colours) is not the brand.
- Charts drawn on canvas or SVG take their colours from TypeScript, where CSS variables do not
  reach: `apps/web/src/theme.ts` has `CHART_PRIMARY` (the logo teal, `#2b9ea7`, for a
  single-series or default line, bar or area).
- The images the backend renders (share cards, feed charts, route maps) use the same palette as
  literals: navy `#0f2a4f` for backgrounds, teal `#2b9ea7` for the main series, orange
  `#f9ab33` for a highlight.
- The Android app uses dynamic colour (Material You); its fallback scheme in
  `apps/android/app/src/main/java/net/aurboda/ui/theme/` mirrors these colours (light primary
  `#17707a`, secondary `#0f2a4f`, tertiary `#f9ab33`; dark primary `#4cc3cc`, secondary
  `#8fb3d9`, tertiary `#f9ab33`).
