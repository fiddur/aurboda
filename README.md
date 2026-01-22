Aurboda - Self Quantification Aggregator
========================================

[![Backend Coverage](https://codecov.io/gh/fiddur/aurboda/graph/badge.svg?flag=backend)](https://codecov.io/gh/fiddur/aurboda)
[![Web Coverage](https://codecov.io/gh/fiddur/aurboda/graph/badge.svg?flag=web)](https://codecov.io/gh/fiddur/aurboda)
[![Android Coverage](https://codecov.io/gh/fiddur/aurboda/graph/badge.svg?flag=android)](https://codecov.io/gh/fiddur/aurboda)

In Norse mythology, Aurboða is a mountain jötunn (giantess) associated with
strength and vitality. Her name, meaning "gravel-offerer" or "gold-offerer",
reflects her role as a gatherer and provider. As mother of Gerðr, whose name
relates to growth and gardens, Aurboða represents the foundation from which
health and flourishing emerge.

This project embodies that spirit: gathering scattered health data from
multiple sources into a unified foundation for understanding your wellbeing.

This repo aims to collect a user's self quantification data into a
single useful place and do some visualizations.


Current state
-------------

Collect data from:

* Android Health Connect from [Aurboda App](https://github.com/fiddur/aurboda) (apps/android)
* [OwnTracks](https://owntracks.org/) (json http mode) - see [OwnTracks setup](docs/owntracks.md)
* [Oura](https://ouraring.com/) API
* [RescueTime](https://www.rescuetime.com/) API

Visualizations:

* Timeline with Heartrate, tags, places etc...


Downloads
---------

 - [Android APK](https://github.com/fiddur/aurboda/releases/latest/download/aurboda.apk)

The APK is signed with a release keystore. Upgrading from a previous version
requires matching signatures - if you installed an older unsigned/debug build,
you'll need to uninstall it first before installing the signed release.

Parts in apps
-------------

 - Backend (needing PostgreSQL storage configured in .env)
 - Web (for visualizations)
 - Android (to collect Android Health Connect data)


GitHub Secrets for Android Release Build
----------------------------------------

The Android APK is automatically built and released on pushes to develop.
The following GitHub secrets are required for signing:

 - `ANDROID_KEYSTORE_BASE64` - base64-encoded keystore file (`base64 -w 0 keystore.jks`)
 - `ANDROID_KEYSTORE_PASSWORD` - keystore password
 - `ANDROID_KEY_ALIAS` - key alias in the keystore
 - `ANDROID_KEY_PASSWORD` - key password
