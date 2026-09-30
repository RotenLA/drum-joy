const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const path = require("path");
const fs = require("fs");

const settingsFile = () => path.join(app.getPath("userData"), "settings.json");
const SKIP_DIRS = new Set(["node_modules", ".git"]);

function listFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) listFiles(full, out);
    } else if (entry.isFile()) {
      out.push({ name: entry.name, path: full });
    }
  }
  return out;
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    backgroundColor: "#14161b",
    title: "AeroGame 谱面导出工具",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, "dist", "index.html"));
}

ipcMain.handle("pick-folder", async () => {
  const r = await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"] });
  return r.canceled ? null : r.filePaths[0] ?? null;
});
ipcMain.handle("list-files", (_e, dir) => listFiles(dir));
ipcMain.handle("read-file", (_e, p) => new Uint8Array(fs.readFileSync(p)));
ipcMain.handle("write-file", (_e, p, data) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, typeof data === "string" ? data : Buffer.from(data));
});
ipcMain.handle("join-path", (_e, dir, name) => path.join(dir, name));
ipcMain.handle("open-folder", (_e, dir) => shell.openPath(dir));
ipcMain.handle("get-settings", () => {
  try { return JSON.parse(fs.readFileSync(settingsFile(), "utf8")); } catch { return {}; }
});
ipcMain.handle("set-settings", (_e, s) => {
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(s));
});

app.whenReady().then(createWindow);
app.on("window-all-closed", () => app.quit());
