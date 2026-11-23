# Web theme ("Fjord")

The web app's colours come from the logo (`apps/web/public/logo.svg`): a navy chrome, teal for
links, focus and primary buttons, and orange only for the single main call to action on a page.

## Tokens

They are CSS custom properties on `:root` in `apps/web/src/styles/_tokens.scss`, redefined inside its
`@media (prefers-color-scheme: dark)` block, so a rule that uses a token needs no dark override.
That file is the only one that defines a brand colour.

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

## Styles

The web app's style sheets are compiled with Sass (`sass-embedded`; Vite compiles any `.scss`
file it imports, with no further configuration).

- `apps/web/src/style.scss` is the global sheet, loaded by `index.tsx`. It `@use`s the partials
  in `apps/web/src/styles/`:
  - `_tokens.scss`: the colour tokens above, light and dark.
  - `_layout.scss`: the page containers (below).
  - `_mixins.scss`: shared breakpoints. `narrow-shell` is the `60em` switch between the sidebar
    and the narrow top bar; `phone` is the `639px` breakpoint where pages drop to phone padding.
    A `.scss` file uses them with `@use` and a path relative to itself (from a page,
    `@use '../../styles/mixins';`), then `@include mixins.phone { ... }`.
- New style files are `.scss`. Existing `.css` files are converted when they are next reworked.

### Colours

`_tokens.scss` is the only style sheet with colour literals. It has two tiers:

- **Palette**: one custom property per raw colour, the same in light and dark mode. A Tailwind
  colour is named after its Tailwind step (`--gray-700: #374151`, `--red-600`, `--amber-100`,
  `--white`, `--black`). Any other colour is named by hue family and HSL lightness, a form no
  Tailwind step has: `--neutral-l20` is `#333333`, `--green-l49` is `#4caf50`. Where two colours
  share that, the lightness gets a decimal (`--neutral-l12p2`), and then the chroma
  (`--blue-l18p4-c64`). A translucent colour adds its alpha in percent: `--black-a10` is
  `rgba(0, 0, 0, 0.1)`, `--gray-900-a95`.
- **Semantic** (`--color-*`): a role whose colour changes with the mode. Its light value is set
  in `:root` and its dark value in the `prefers-color-scheme: dark` block, both as palette
  references. Besides the brand tokens above there are text ranks (`--color-text-strongest`,
  `-strong`, `-default`, `-secondary`, `-muted-2`, `-subtle`, `-faint`), surfaces
  (`--color-surface-raised`, `-subtle`, `-sunken`, `-hover`, `-strong`, `-tooltip`),
  `--color-border-strong`, and status colours (`--color-danger-text`, `--color-warning-soft`,
  `--color-success-soft`, `--color-info-text`, ...). A numbered variant (`-2`, `-3`) is the same
  role with a different light or dark value; the unnumbered one is the most used.

A rule uses a semantic token where its colour changes with the mode, and so needs no dark
override; it uses a palette property where the colour is the same in both modes. For a new
colour: reuse a token whose light and dark values are the ones you want; else add a palette
property named as above (and, for a colour that changes with the mode, a `--color-*` token
with both values) to `_tokens.scss`. Do not reuse a token for a different role only because
its values match today.

`scripts/check-style-colors.mjs`, part of `pnpm check`, fails on a colour literal (hex,
`rgb()`, `rgba()`, `hsl()`, `hsla()` or a CSS colour name) in any `.css` or `.scss` file under
`apps/web/src` other than `_tokens.scss`. It ignores comments, quoted strings, `url(...)`
arguments, and names in font, animation, transition and grid-area values; `transparent`,
`currentColor` and the CSS-wide keywords are not colour literals. Colours in `.ts` and `.tsx`
files (charts, canvas, inline styles) are not checked.

### Page layout

Every routed page's root element carries `page` and at most one width modifier; its own
stylesheet sets no container width, centring margins, outer padding or `box-sizing`.

| class               | max width | for                                                         |
| ------------------- | --------- | ----------------------------------------------------------- |
| `page page--narrow` | 640px     | single forms and short columns (Strength)                   |
| `page`              | 760px     | reading and list pages (Feed, People, Journal, Help)        |
| `page page--wide`   | 1100px    | pages with charts or tables that still read as a column     |
| `page page--full`   | none      | pages that fill the window (Timeline, dashboards, settings) |

`.page` is centred, `box-sizing: border-box`, padded `2rem`, and `1rem` on phones. The widths
are the custom properties `--page-width-narrow`, `--page-width-default` and
`--page-width-wide` in `_layout.scss`. Pages outside the signed-in shell (the guest welcome
page, sign in and sign up, public profiles, posts and dashboards) keep their own containers.
