# Android app

Built automatically by GitHub Actions (`.github/workflows/android.yml`) on every push to `main`
that touches `web/` or `android-app/`. Download the APK from the latest workflow run → Artifacts.

The APK bundles the `web/` app and uses Capacitor Local Notifications so task alarms ring with
the tinker sound even when the app is closed.
