const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("chartTool", {
  pickFolder: () => ipcRenderer.invoke("pick-folder"),
  listFiles: (dir) => ipcRenderer.invoke("list-files", dir),
  readFile: (p) => ipcRenderer.invoke("read-file", p),
  writeFile: (p, data) => ipcRenderer.invoke("write-file", p, data),
  joinPath: (dir, name) => ipcRenderer.invoke("join-path", dir, name),
  openFolder: (dir) => ipcRenderer.invoke("open-folder", dir),
  getSettings: () => ipcRenderer.invoke("get-settings"),
  setSettings: (s) => ipcRenderer.invoke("set-settings", s),
});
