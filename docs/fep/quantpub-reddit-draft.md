# DRAFT: r/QuantifiedSelf post (QuantPub outreach, #905)

> Status: **draft for review — not yet posted.** Fredrik posts this himself
> after review, with the two screenshots captured (see placeholders). Suggested
> flair: "Apps & Tools" (or whatever the sub currently uses for tooling).

---

**Title:** Making our QS tools social: a small ActivityPub vocabulary so
home-built trackers can follow each other (RFC — looking for collaborators)

---

A lot of us run home-built or self-hosted tracking systems — and they're all
islands. I've been experimenting with making mine *federated*: my workouts are
ActivityPub posts (and the spec covers any observation — sleep, HRV, steps,
mood, …), so anyone on Mastodon can follow me and see them. But between two tools that speak a small extra vocabulary,
something better happens: the subscriber renders the *actual data* — an
interactive chart with real hoverable values, not a flattened text summary and
a static PNG.

Here's the same shared run, seen by a plain Mastodon follower vs. a
QuantPub-speaking subscriber:

**[SCREENSHOT 1: Mastodon view — flattened text + PNG attachment]**

**[SCREENSHOT 2: Aurboda subscriber view — native card: stat grid, personal
message, interactive multi-metric hover chart + synced route map]**

The interesting part is that the mechanism is deliberately boring, because
mainstream fediverse servers drop anything fancy. The whole contract, which
I've written up as a draft FEP (Fediverse Enhancement Proposal) called
**QuantPub**, is:

1. **Deliver a plain `Note`** (so Mastodon renders something sensible), with a
   few extra typed fields riding along: activity type, the scalar summaries
   you chose to share (`{key, value, unit}`), and links to series data.
2. **Serve a machine-readable payload** for each shared post at a predictable
   URL — plain JSON: typed scalars + bucketed time series (avg/min/max/count
   per bucket). This out-of-band channel is what actually survives real-world
   federation.
3. **A discovery document** (`/.well-known/quantpub`) so a peer can tell your
   host speaks the spec with one cacheable request.

That's a **weekend project on top of an existing home-built tracker** — the
publishing side needs no ActivityPub stack at all, just two-and-a-half
routes. Add a minimal AP actor later and you're followable from Mastodon and
every implementing peer.

Privacy is a first-class part of the spec, because QS data is sensitive:

- Sharing a scalar summary (avg HR) never exposes the underlying series; series
  are a separate per-post, per-metric opt-in.
- Unshared data is indistinguishable from nonexistent (404, never 403).
- Followers-only posts use capability URLs; deleting a post revokes access
  immediately (`no-store` on every data response — only the tiny discovery
  document is cacheable).
- It's not just exercise: a generic `Observation` shape covers sleep, HRV,
  steps, mood, glucose — anything measured over a window.

Draft spec: **[link to docs/fep/quantpub.md on GitHub]**
Running implementation (mine): **[https://aurboda.net]** — but the explicit
goal is that you *don't* have to adopt my software. If you have a home-built
system and this sounds interesting, I'd love feedback on the vocabulary and
endpoint contract before I submit the FEP upstream — especially from anyone
willing to try implementing the Level 1 publishing side against their own
data. What metrics would you need that the recommended key set doesn't cover?

---

> **Pre-post checklist**
>
> - [ ] Capture screenshot pair (same share): Mastodon web view + Aurboda
>   subscriber timeline card (enriched, hover chart visible). #996 shipped, so
>   any aurboda.net-to-aurboda.net follow renders the enriched card.
> - [ ] Replace the two link placeholders (GitHub blob URL for the FEP; keep
>   aurboda.net).
> - [ ] Check r/QuantifiedSelf rules for self-promotion framing (post leads
>   with the open spec, not the product — keep it that way).
