# Fediverse Enhancement Proposal drafts

This directory holds FEP drafts developed in the open from Aurboda's running
federation code, before and during submission to the
[FEP process](https://codeberg.org/fediverse/fep).

- **[quantpub.md](./quantpub.md)** — _QuantPub: federated personal metrics for
  quantified-self sharing_. A vendor-neutral generalisation of Aurboda's
  federated feed: the `quant:Exercise` / `quant:Observation` vocabulary, the
  out-of-band structured-payload pattern (well-known discovery, structured post
  endpoint, data-driven public series endpoint, capability tokens), and the
  privacy model — scalar/series/geography sharing each a separate explicit
  opt-in — as normative requirements. Submitted as
  [FEP-302f](https://codeberg.org/fediverse/fep/pulls/938); this file mirrors
  the `0.3` revision
  ([commit 3815169](https://codeberg.org/fediverse/fep/src/commit/3815169a149c9b13a891bfefdf83fa9be43bd423/fep/302f/fep-302f.md)),
  which the discussion on
  [SocialHub](https://socialhub.activitypub.rocks/t/fep-302f-quantpub-federated-personal-metrics-for-quantified-self-sharing/8919)
  shaped. Aurboda serves `0.2` and accepts `0.1`; `0.3` is in progress. Tracked in
  [issue #905](https://github.com/fiddur/aurboda/issues/905). Aurboda's own
  implementation of the pattern is documented in
  [docs/features/feed.md](../features/feed.md).
- **[quantpub-challenges.md](./quantpub-challenges.md)** — _QuantPub Challenges:
  federated competitions over shared metrics_. A companion to QuantPub: a
  `quant:Challenge` object on [FEP-8a8e](https://codeberg.org/fediverse/fep/src/branch/main/fep/8a8e/fep-8a8e.md)
  `Event` conventions, `Join`/`Leave` with an HTTP equivalent for trackers without
  ActivityPub, pulled member entries in QuantPub's bucketed-sample shape, and a
  standings document. Its §10 maps Aurboda's running challenge protocol
  ([docs/features/challenges.md](../features/challenges.md)) onto it.
- **[quantpub-reddit-draft.md](./quantpub-reddit-draft.md)** — draft of the
  r/QuantifiedSelf outreach post (issue #905 step 3), kept in-repo for review;
  not itself a FEP. Placeholders mark the screenshots and links to fill in
  before posting.
