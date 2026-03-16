const { app, BrowserWindow, ipcMain, Tray, Menu, dialog, nativeImage } = require("electron");
const { exec } = require("child_process");
const path = require("path");
const fs = require("fs");

let mainWindow = null;
let tray = null;
let nightCheckInterval = null;
let settings = {
  nightHour: 21,
  nightMinute: 0,
  endHour: 6,
  endMinute: 0,
  brightnessThreshold: 50,
  snoozeMinutes: 30,
  startOnLogin: false,
  startMinimized: false,
};
let lastBrightnessValue = null;
let lastBrightnessAt = 0;
let brightnessInFlight = null;
let snoozeUntilMs = 0;

const SETTINGS_PATH = path.join(app.getPath("userData"), "settings.json");
const CHECK_INTERVAL_MS = 30 * 60 * 1000;
const BRIGHTNESS_CACHE_TTL_MS = 1500;
const ICON_PATH = path.join(__dirname, "public", "icon.png");
const APP_ID = "com.payso.thatstoobright";
const APP_NAME = "ThatsTooBright";

app.setName(APP_NAME);
if (process.platform === "win32") {
  // Set early so taskbar grouping/jumplist picks correct identity.
  app.setAppUserModelId(APP_ID);
}

// --- Settings persistence ---

function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      const data = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf-8"));
      settings.nightHour = toBoundedInteger(data.nightHour, 0, 23, 21);
      settings.nightMinute = toBoundedInteger(data.nightMinute, 0, 59, 0);
      settings.endHour = toBoundedInteger(data.endHour, 0, 23, 6);
      settings.endMinute = toBoundedInteger(data.endMinute, 0, 59, 0);
      settings.brightnessThreshold = toBoundedInteger(data.brightnessThreshold, 0, 100, 50);
      settings.snoozeMinutes = toBoundedInteger(data.snoozeMinutes, 1, 180, 30);
      settings.startOnLogin = !!data.startOnLogin;
      settings.startMinimized = !!data.startMinimized;
    }
  } catch {
    // defaults are fine
  }
}

function saveSettings() {
  try {
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
  } catch {
    // non-critical
  }
}

function toBoundedInteger(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

// --- PowerShell helpers ---

function runPowerShell(command) {
  return new Promise((resolve, reject) => {
    exec(
      `powershell -NoProfile -Command "${command}"`,
      (error, stdout, stderr) => {
        if (error) return reject(error);
        if (stderr) return reject(new Error(stderr));
        resolve(stdout.trim());
      }
    );
  });
}

async function getCurrentBrightness(forceRefresh = false) {
  const now = Date.now();
  if (
    !forceRefresh &&
    lastBrightnessValue !== null &&
    now - lastBrightnessAt < BRIGHTNESS_CACHE_TTL_MS
  ) {
    return lastBrightnessValue;
  }

  if (brightnessInFlight) return brightnessInFlight;

  brightnessInFlight = (async () => {
    const result = await runPowerShell(
      "(Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness).CurrentBrightness"
    );
    const parsed = parseInt(result, 10);
    if (!Number.isNaN(parsed)) {
      lastBrightnessValue = parsed;
      lastBrightnessAt = Date.now();
    }
    return parsed;
  })();

  try {
    return await brightnessInFlight;
  } finally {
    brightnessInFlight = null;
  }
}

async function setBrightnessLevel(level) {
  await runPowerShell(
    `Invoke-CimMethod -InputObject (Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods) -MethodName WmiSetBrightness -Arguments @{Timeout=1; Brightness=${level}}`
  );
  lastBrightnessValue = level;
  lastBrightnessAt = Date.now();
}

// --- Window + Tray ---

function getAppIcon() {
  return nativeImage.createFromPath(ICON_PATH);
}

function createWindow() {
  const shouldStartMinimized =
    settings.startMinimized || process.argv.includes("--start-minimized");

  mainWindow = new BrowserWindow({
    width: 420,
    height: 720,
    resizable: false,
    frame: false,
    transparent: true,
    show: false,
    skipTaskbar: false,
    title: APP_NAME,
    icon: getAppIcon(),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
    },
  });

  mainWindow.loadFile(path.join(__dirname, "public", "index.html"));
  mainWindow.once("ready-to-show", () => {
    if (!shouldStartMinimized) mainWindow.show();
  });

  mainWindow.on("close", (e) => {
    e.preventDefault();
    mainWindow.hide();
  });
}

function createTray() {
  const trayIcon = getAppIcon().resize({ width: 16, height: 16 });
  tray = new Tray(trayIcon);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Open ThatsTooBright",
      click: () => {
        mainWindow.show();
        mainWindow.focus();
      },
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        mainWindow.destroy();
        app.quit();
      },
    },
  ]);

  tray.setToolTip("ThatsTooBright");
  tray.setContextMenu(contextMenu);
  tray.on("click", () => {
    mainWindow.show();
    mainWindow.focus();
  });
}

// --- Night brightness check ---

function isNightTime() {
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const startMinutes = settings.nightHour * 60 + settings.nightMinute;
  const endMinutes = settings.endHour * 60 + settings.endMinute;

  if (startMinutes === endMinutes) return true;
  if (startMinutes < endMinutes) {
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  }

  return currentMinutes >= startMinutes || currentMinutes < endMinutes;
}

function formatNightTime() {
  const h = settings.nightHour;
  const m = settings.nightMinute;
  const period = h >= 12 ? "PM" : "AM";
  const display = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${display}:${String(m).padStart(2, "0")} ${period}`;
}

function applyStartupSettings() {
  if (process.platform !== "win32") return;

  app.setLoginItemSettings({
    openAtLogin: settings.startOnLogin,
    openAsHidden: settings.startMinimized,
    path: process.execPath,
    args: settings.startMinimized ? ["--start-minimized"] : [],
  });
}

async function nightBrightnessCheck() {
  if (!isNightTime()) return;
  if (Date.now() < snoozeUntilMs) return;

  let brightness;
  try {
    brightness = await getCurrentBrightness();
  } catch {
    return;
  }

  if (brightness <= settings.brightnessThreshold) return;

  const response = await dialog.showMessageBox(mainWindow, {
    type: "question",
    icon: getAppIcon(),
    title: "Brightness Reminder",
    message: `It's past ${formatNightTime()} and brightness is ${brightness}% (limit: ${settings.brightnessThreshold}%).`,
    detail: "Would you like to lower it to reduce eye strain and help you wind down?",
    buttons: [
      "Dim to 0%",
      `Set to ${settings.brightnessThreshold}%`,
      `Snooze ${settings.snoozeMinutes} min`,
      "Not now",
    ],
    defaultId: 0,
    cancelId: 3,
    noLink: true,
  });

  if (response.response === 0) {
    await setBrightnessLevel(0);
    mainWindow.webContents.send("brightness-updated");
  } else if (response.response === 1) {
    await setBrightnessLevel(settings.brightnessThreshold);
    mainWindow.webContents.send("brightness-updated");
  } else if (response.response === 2) {
    snoozeUntilMs = Date.now() + settings.snoozeMinutes * 60 * 1000;
  }
}

function startNightCheck() {
  nightBrightnessCheck();
  nightCheckInterval = setInterval(nightBrightnessCheck, CHECK_INTERVAL_MS);
}

// --- IPC handlers ---

ipcMain.handle("get-brightness", () => getCurrentBrightness());

ipcMain.handle("set-brightness", async (_event, value) => {
  const level = Math.round(value);
  await setBrightnessLevel(level);
  return level;
});

ipcMain.handle("get-settings", () => ({ ...settings }));

ipcMain.handle("save-settings", (_event, newSettings) => {
  settings.nightHour = toBoundedInteger(newSettings.nightHour, 0, 23, 21);
  settings.nightMinute = toBoundedInteger(newSettings.nightMinute, 0, 59, 0);
  settings.endHour = toBoundedInteger(newSettings.endHour, 0, 23, 6);
  settings.endMinute = toBoundedInteger(newSettings.endMinute, 0, 59, 0);
  settings.brightnessThreshold = toBoundedInteger(newSettings.brightnessThreshold, 0, 100, 50);
  settings.snoozeMinutes = toBoundedInteger(newSettings.snoozeMinutes, 1, 180, 30);
  settings.startOnLogin = !!newSettings.startOnLogin;
  settings.startMinimized = !!newSettings.startMinimized;
  if (!settings.startOnLogin) settings.startMinimized = false;
  saveSettings();
  applyStartupSettings();

  clearInterval(nightCheckInterval);
  startNightCheck();

  return { ...settings };
});

ipcMain.on("minimize-to-tray", () => mainWindow.hide());

// --- App lifecycle ---

app.whenReady().then(() => {
  loadSettings();
  applyStartupSettings();
  createWindow();
  createTray();
  startNightCheck();
});

app.on("window-all-closed", (e) => e.preventDefault());
