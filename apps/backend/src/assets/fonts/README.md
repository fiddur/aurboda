# Bundled fonts

`LiberationSans-Regular.ttf` and `LiberationSans-Bold.ttf` are part of the
**Liberation Fonts** family, licensed under the **SIL Open Font License, Version
1.1** (OFL-1.1). Liberation Sans is metric-compatible with Arial.

They are bundled so [`services/og-image.ts`](../../services/og-image.ts) can render
Open Graph preview cards with Satori at runtime (Satori needs raw font data and the
production image has no system fonts).

- Upstream: https://github.com/liberationfonts/liberation-fonts
- License: https://github.com/liberationfonts/liberation-fonts/blob/main/LICENSE

Emoji are not font-based: `services/og-image.ts` draws each emoji as an SVG from the
[`@twemoji/svg`](https://www.npmjs.com/package/@twemoji/svg) npm package (Twemoji
graphics licensed CC-BY 4.0; package code MIT).
