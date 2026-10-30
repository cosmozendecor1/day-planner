# Day Planner — setup guide

Daily tasks with end times and a tinker alarm, plus weekly, monthly, quarterly and yearly targets that fill up as you complete linked tasks.

## 1. Windows laptop

1. Unzip **DayPlanner-Windows.zip** anywhere (e.g. `C:\Apps\Day Planner`).
2. Double-click **Day Planner.exe**. If Windows SmartScreen appears, click **More info → Run anyway** (the app isn't code-signed).
3. That's it. The app:
   - starts automatically with Windows (tray icon, bottom-right),
   - keeps running when you close the window — closing only hides it,
   - **pops open on top of everything with the tinker sound** before/at each task's end time.
4. Right-click the tray icon to turn off *Start with Windows* or to quit (quitting stops alarms).

Tip: pin it — right-click the taskbar icon → *Pin to taskbar*.

## 2. iPhone

1. On iPhone, open **https://day-planner-cosmo-zen.vercel.app** in **Safari** → **Share** → **Add to Home Screen**.
2. Open Day Planner from the home screen → **Settings → Enable notifications**.

**Alarm behaviour on iPhone** (Apple restriction — no app can open itself):
- App open: full-screen alarm + tinker sound.
- App closed: tap **📅 Add this day's alarms to Calendar** each morning (or *All upcoming tasks → Calendar* in Settings). The iPhone Calendar then rings at every end time even when the planner is closed.

## 3. Sync between iPhone and laptop

Sync is built in (Supabase project `day-planner`, Mumbai region, free plan).

1. On the first device: **Settings → Sync** → enter your email and a password → **Create account**.
2. Open the confirmation email from Supabase and tap the link.
3. Back in the app: **Sign in**. On every other device, just **Sign in** with the same email and password.

Sync runs after every change, every minute, and whenever the app comes to the front. Each device rings its own alarms. Row-level security means each account can only ever read its own planner.

## How it works

- **Targets tab** → pick Week / Month / Quarter / Year → *Add target* with a goal (number of tasks to complete). Use ‹ › to plan future periods.
- **Today tab** → **+** → task name, date, end time, and which target it counts toward. Tick the circle when done; the target's progress bar moves.
- **Settings** → how early the app opens before the end time (default 5 min), how many times the tinker repeats, volume, test sound.
- Alarm buttons: **Mark done**, **Snooze 5 min**, **Dismiss**.

## Rebuilding the Windows app (optional)

Requires Node.js on Windows: `cd desktop && npm install && npm run dist` → installer and portable `.exe` in `desktop/dist`.

## Files

- `web/` — the planner app (used by iPhone and inside the Windows app)
- `desktop/` — Windows shell source (tray, auto-start, pop-up alarms)
- `supabase-setup.sql` — sync table with row-level security (each user sees only their own data)
