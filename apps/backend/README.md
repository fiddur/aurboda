Nephelai - Self Quantification Aggregator
=========================================

The Νεφελαι were the Okeanid-nymphs of clouds and rain.

This repo aims to collect a user's self quantification data into a
single useful place.  Maybe I'll add more visualizations, right now
there is a simple timeline.

**NB: This is a hobby project, not properly tested, nor cleanly implemented.**


Current state
-------------

Currently collects data from:

* Android Health Connect from [Nepehai App](https://github.com/fiddur/NephelaiApp)
* [OwnTracks](https://owntracks.org/) (json http mode)
* [Oura](https://ouraring.com/) API
* [RescueTime](https://www.rescuetime.com/) API

...has many temporary hacks that even circumvent the login and
security and fixes it to my own user.  It's basically a PoC.

Some hacks to cleanup soon(ish):

* Let user give rescuetime api key for backend to store.
* Add user handling to OwnTrack endpoint.
* config sessionSalt


Setup and use
-------------

* Setup PostgreSQL
* Setup .env (see .env.sample)
* `corepack use && pnpm i`

### Start web (for user creation and authorization)

`pnpm start`
