Aurboda - Self Quantification Aggregator
========================================

In Norse mythology, Aurboða is a mountain jötunn (giantess) associated with
strength and vitality. Her name, meaning "gravel-offerer" or "gold-offerer",
reflects her role as a gatherer and provider. As mother of Gerðr, whose name
relates to growth and gardens, Aurboða represents the foundation from which
health and flourishing emerge.

This project embodies that spirit: gathering scattered health data from
multiple sources into a unified foundation for understanding your wellbeing.

**NB: This is a hobby project, not properly tested, nor cleanly implemented.**

This repo aims to collect a user's self quantification data into a
single useful place and do some visualizations.

It has many temporary hacks that even circumvent the login and
security and fixes it to my own user.  It's basically a PoC.

Current state
-------------

Collect data from:

* Android Health Connect from [Aurboda App](https://github.com/fiddur/aurboda) (apps/android)
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
