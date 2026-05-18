# Blue Stereo Music (Android head-unit app)

This is an installable Android app project intended for Android-based car stereos/head units.

## Features implemented
- Bluetooth media session controls (play/pause/next/previous) via active system media session.
- Favourites toggle for currently active song.
- Add current song to playlist.
- Quick history replay.
- In-app equalizer UI sliders (bass/mid/treble state).
- Landscape-first UI suitable for car stereo screens.

## Build APK
1. Open folder `android-bluetooth-music-app` in Android Studio (Jellyfish+).
2. Let Gradle sync and install SDK 35.
3. Build > Build Bundle(s) / APK(s) > Build APK(s).
4. Copy generated `app-release.apk` to USB or SD card and install on stereo.

## Notes
- Some head units lock background media/session APIs by vendor firmware. If controls do not work, allow notification/media permissions in stereo settings.
- Equalizer sliders are app-level state. To bind to DSP hardware equalizer, integrate the unit vendor audio SDK.
