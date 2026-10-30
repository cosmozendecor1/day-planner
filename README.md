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

The iPhone app needs to be hosted on a web address (HTTPS). Easiest free option, ~2 minutes:

1. On your laptop go to **app.netlify.com/drop** (free account).
2. Drag the **web** folder onto the page. You'll get a link like `https://something.netlify.app`.
3. On iPhone, open that link in **Safari** → **Share** → **Add to Home Screen**.
4. Open Day Planner from the home screen → **Settings → Enable notifications**.

**Alarm behaviour on iPhone** (Apple restriction — no app can open itself):
- App open: full-screen alarm + tinker sound.
- App closed: tap **📅 Add this day's alarms to Calendar** each morning (or *All upcoming tasks → Calendar* in Settings). The iPhone Calendar then rings at every end time even when the planner is closed.

## 3. Sync between iPhone and laptop (free, one-time)

1. Create a free project at **supabase.com** (New project → any name/password → region Mumbai).
2. In the project: **SQL Editor → New query**, paste the contents of `supabase-setup.sql`, click **Run**.
3. **Project Settings → API**: copy the **Project URL** and the **anon public** key.
4. In Day Planner on each device: **Settings → Sync** → paste URL + key, enter your email and a password.
   - First device: **Create account** (confirm via the email Supabase sends), then **Sign in**.
   - Other devices: **Sign in** with the same email/password.

Sync runs automatically after every change, every minute, and when the app comes to the front. Each device rings its own alarms. Without sync, everything is stored on the device — use *Export backup* in Settings.

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
