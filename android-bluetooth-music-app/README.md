# Song Catcher Overlay

Android head-unit app that shows a floating button over other apps. Tap the button to save the currently playing song. Hold the button to open the saved list and share it as a text file, with Bluetooth preferred when the stereo exposes a Bluetooth share target.

## What it does
- Starts a small always-on-top overlay button.
- Reads the active media session metadata through Android notification listener access.
- Saves each captured song to app-private storage.
- Shows the saved song list from a long press on the floating button.
- Exports the list as `captured-songs-YYYYMMDD-HHMMSS.txt`.
- Opens Bluetooth sharing directly when available, otherwise opens Android's share chooser.

## Required stereo permissions
1. Open the app.
2. Grant overlay permission so the button can appear on top of other apps.
3. Grant notification listener access so the app can read the current track title and artist.
4. Start the floating button.

Without notification listener access, Android does not reliably expose the currently playing song to normal apps.

## Build APK
From this folder:

```bash
./gradlew assembleDebug
```

The debug APK is generated at:

```text
app/build/outputs/apk/debug/app-debug.apk
```
