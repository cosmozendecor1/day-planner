// Day Planner — Windows desktop shell.
// Lives in the system tray, starts with Windows, and pops the planner window
// to the front (with the tinker sound) when a task's end time arrives.
const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, protocol, net, dialog, shell, powerMonitor } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const WEB = path.join(__dirname, 'web');
let win = null, tray = null, quitting = false;
let timers = [];

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);

if (!app.requestSingleInstanceLock()) { app.quit(); }
else {
  app.on('second-instance', () => showWindow());
  app.whenReady().then(start);
}
app.setAppUserModelId('com.vinu.dayplanner');

function start() {
  protocol.handle('app', req => {
    const u = new URL(req.url);
    let p = decodeURIComponent(u.pathname); if (p === '/' || !p) p = '/index.html';
    const file = path.normalize(path.join(WEB, p));
    if (!file.startsWith(WEB)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });

  // start with Windows (hidden in tray)
  if (app.isPackaged && !app.getLoginItemSettings({ args: ['--hidden'] }).openAtLogin && !store.get('autoStartAsked')) {
    app.setLoginItemSettings({ openAtLogin: true, args: ['--hidden'] });
    store.set('autoStartAsked', true);
  }

  win = new BrowserWindow({
    width: 460, height: 860, minWidth: 360, minHeight: 560,
    title: 'Day Planner', icon: path.join(__dirname, 'icon.png'),
    backgroundColor: '#f6f4ef', autoHideMenuBar: true, show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), backgroundThrottling: false, contextIsolation: true, sandbox: true }
  });
  win.loadURL('app://planner/index.html');
  win.once('ready-to-show', () => { if (!process.argv.includes('--hidden')) win.show(); });
  win.on('close', e => { if (!quitting) { e.preventDefault(); win.hide(); trayHint(); } });
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });

  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'tray.png')));
  tray.setToolTip('Day Planner — alarms active');
  tray.on('click', () => showWindow());
  buildTrayMenu();

  powerMonitor.on('resume', () => win?.webContents.send('alarm-tick'));
  powerMonitor.on('unlock-screen', () => win?.webContents.send('alarm-tick'));
}

function buildTrayMenu() {
  const auto = app.getLoginItemSettings({ args: ['--hidden'] }).openAtLogin;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Day Planner', click: showWindow },
    { type: 'separator' },
    { label: 'Start with Windows', type: 'checkbox', checked: auto, enabled: app.isPackaged,
      click: i => { app.setLoginItemSettings({ openAtLogin: i.checked, args: ['--hidden'] }); buildTrayMenu(); } },
    { type: 'separator' },
    { label: 'Quit (alarms stop)', click: () => { quitting = true; app.quit(); } }
  ]));
}

let hinted = false;
function trayHint() {
  if (hinted || !tray?.displayBalloon) return; hinted = true;
  tray.displayBalloon({ title: 'Day Planner is still running', content: 'Alarms stay active. Right-click the tray icon to quit.', iconType: 'info' });
}

function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show(); win.focus();
}

// Pop the window over everything for a few seconds so it can't be missed
function popUp() {
  showWindow();
  win.setAlwaysOnTop(true, 'screen-saver');
  win.moveTop(); win.focus(); win.flashFrame(true);
  setTimeout(() => { if (win && !win.isDestroyed()) { win.setAlwaysOnTop(false); win.flashFrame(false); } }, 10000);
}

ipcMain.on('alarm', () => popUp());

// Renderer sends the upcoming list; main keeps its own timers so the window
// wakes even if the renderer is hidden.
ipcMain.on('schedule', (_e, items) => {
  timers.forEach(clearTimeout); timers = [];
  const now = Date.now(), MAX = 2 ** 31 - 1;
  for (const it of items || []) {
    for (const at of [it.before > 0 ? it.at - it.before : null, it.at]) {
      if (at == null) continue;
      const d = at - now;
      if (d > 0 && d < MAX) timers.push(setTimeout(() => { popUp(); win?.webContents.send('alarm-tick'); }, d + 300));
    }
  }
});

ipcMain.handle('save-file', async (_e, name, text) => {
  const r = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('downloads'), name), filters: [{ name: 'Calendar', extensions: ['ics'] }] });
  if (r.canceled || !r.filePath) return false;
  fs.writeFileSync(r.filePath, text, 'utf8');
  shell.openPath(r.filePath); // opens in Outlook / Windows Calendar
  return true;
});

app.on('before-quit', () => { quitting = true; });
app.on('window-all-closed', () => { /* keep running in tray */ });

// tiny JSON settings store
const store = {
  file: () => path.join(app.getPath('userData'), 'shell.json'),
  all() { try { return JSON.parse(fs.readFileSync(this.file(), 'utf8')); } catch { return {}; } },
  get(k) { return this.all()[k]; },
  set(k, v) { const a = this.all(); a[k] = v; try { fs.writeFileSync(this.file(), JSON.stringify(a)); } catch {} }
};
