Nephelai - Self Quantification Aggregator
=========================================

   The Νεφελαι were the Okeanid-nymphs of clouds and rain.

**NB: This is a hobby project, not properly tested, nor cleanly implemented.**

This repo aims to collect a user's self quantification data into a
single useful place and do some visualizations.

It has many temporary hacks that even circumvent the login and
security and fixes it to my own user.  It's basically a PoC.

Current state
-------------

Collect data from:

* Android Health Connect from [Nepehai App](https://github.com/fiddur/NephelaiApp)
* [OwnTracks](https://owntracks.org/) (json http mode)
* [Oura](https://ouraring.com/) API
* [RescueTime](https://www.rescuetime.com/) API

Visualizations:

* Heartrate.
* ...served from backend is a timeline with HR, sleep, exercise and locations, but that is going into the web part...


Parts in apps
-------------

 - Backend (needing PostgreSQL storage configured in .env)
 - Web (for visualizations)
 - Android (to colled Andoid Health Connect data)
