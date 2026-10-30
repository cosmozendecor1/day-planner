const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('desktop', {
  alarm: info => ipcRenderer.send('alarm', info),
  schedule: items => ipcRenderer.send('schedule', items),
  saveFile: (name, text) => ipcRenderer.invoke('save-file', name, text),
  onAlarmTick: cb => ipcRenderer.on('alarm-tick', () => cb())
});
