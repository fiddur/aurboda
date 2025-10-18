Nephelai Backend
================

This repo aims to collect a user's self quantification data into a
single useful place.


Current state
-------------

Currently collects data from:

* Android Health Connect from [Nepehai App](https://github.com/fiddur/NephelaiApp)
* [OwnTracks](https://owntracks.org/) (json http mode)
* [Oura](https://ouraring.com/) API
* [RescueTime](https://www.rescuetime.com/) API


Setup and use
-------------

* Setup PostgreSQL
* Setup .env (see .env.sample)
* `corepack use && pnpm i`

### Start web (for user creation and authorization)

`pnpm start`
