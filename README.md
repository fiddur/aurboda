Aurboda - Self Quantification Aggregator
========================================

Backend [![Backend Coverage](https://codecov.io/gh/fiddur/aurboda/graph/badge.svg?flag=backend)](https://codecov.io/gh/fiddur/aurboda)
Web [![Web Coverage](https://codecov.io/gh/fiddur/aurboda/graph/badge.svg?flag=web)](https://codecov.io/gh/fiddur/aurboda)
Android [![Android Coverage](https://codecov.io/gh/fiddur/aurboda/graph/badge.svg?flag=android)](https://codecov.io/gh/fiddur/aurboda)

Gather all your Self Quantification data into one place.

The aim is to gather and visualize all relevant data, offer a connection with your AI agent, find correlations.  Current state:

* Aurboda backend offers an API and MCP to fetch and discuss the data with an AI (Claude, or any that uses MCP).  It also detects locations and geocodes, offering the user to name visited locations.
* Aurboda Android funnels Health Connect data into the backend, and show minutes in HR zones for last week, also with a widget.
* Aurboda web offers timeline visualizations and location timeline naming (very early stage).


I currently don't offer any public signup, but contact me through [reddit](https://www.reddit.com/user/fiddur/).

Name
----

In Norse mythology, Aurboða (really pronounced "owr-BO-tha", but using
a hard D in aurboda now) is a mountain jötunn (giantess) associated
with strength and vitality. Her name, meaning "gravel-offerer" or
"gold-offerer", reflects her role as a gatherer and provider. As
mother of Gerðr, whose name relates to growth and gardens, Aurboða
represents the foundation from which health and flourishing emerge.

This project embodies that spirit: gathering scattered health data from
multiple sources into a unified foundation for understanding your wellbeing.

This repo aims to collect a user's self quantification data into a
single useful place and do some visualizations.


Data sources
------------

* Android Health Connect from [Aurboda App](https://github.com/fiddur/aurboda) (apps/android)
* [OwnTracks](https://owntracks.org/) (json http mode) - see [OwnTracks setup](docs/owntracks.md)
* [Oura](https://ouraring.com/) API
* [RescueTime](https://www.rescuetime.com/) API

Visualizations
--------------

Web:

* Timeline with Heartrate, tags, places etc...
* Location timeline with option to name the locations.

Android app:

* Minutes in HR zones for last 7 days (due to the Galpin/Huberman
  recommendation to be in zone 2 150-200 minutes per week and zone 5
  5-10 minutes), with a widget.


Downloads
---------

 - [Android APK](https://github.com/fiddur/aurboda/releases/download/latest/aurboda.apk)


Parts in apps
-------------

 - Backend (needing PostgreSQL storage configured in .env)
 - Web (for visualizations)
 - Android (to collect Android Health Connect data)
