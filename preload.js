const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("brightness", {
  get: () => ipcRenderer.invoke("get-brightness"),
  set: (value) => ipcRenderer.invoke("set-brightness", value),
  minimizeToTray: () => ipcRenderer.send("minimize-to-tray"),
  onBrightnessUpdated: (callback) => ipcRenderer.on("brightness-updated", callback),
  getSettings: () => ipcRenderer.invoke("get-settings"),
  saveSettings: (settings) => ipcRenderer.invoke("save-settings", settings),
  getAppInfo: () => ipcRenderer.invoke("get-app-info"),
});
