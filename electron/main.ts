import { app, BrowserWindow, shell, dialog } from "electron";
import { spawn, ChildProcess } from "child_process";
import * as path from "path";

let service: ChildProcess | null = null;
let window: BrowserWindow | null = null;
let address = "";
let quitting = false;
app.setName("Nota");
const locked = app.requestSingleInstanceLock();
if (!locked) app.quit();
app.on("second-instance", () => {
  window?.show();
  window?.focus();
});

function openWindow() {
  if (window) {
    window.show();
    return;
  }
  window = new BrowserWindow({
    width: 1400,
    height: 940,
    minWidth: 900,
    minHeight: 650,
    title: "Nota",
    backgroundColor: "#ffffff",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(address + "/papers/") && url.endsWith("/original.pdf")) {
      const pdf = new BrowserWindow({
        width: 950,
        height: 900,
        parent: window!,
        webPreferences: {
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
        },
      });
      void pdf.loadURL(url);
    } else if (/^https:\/\//.test(url) || url === "mailto:zhangzitao997@gmail.com") {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(address + "/")) event.preventDefault();
  });
  window.on("close", (event) => {
    if (!quitting) {
      event.preventDefault();
      app.quit();
    }
  });
  window.on("closed", () => {
    window = null;
  });
  void window.loadURL(address);
}

async function startService() {
  const root = app.getAppPath();
  const node = process.env.PAPER_NODE_BIN || path.join(root, "node_modules/node/bin", process.platform === "win32" ? "node.exe" : "node");
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PORT: "0",
    PATH: [process.env.PATH, "/opt/homebrew/bin", "/usr/local/bin"]
      .filter(Boolean)
      .join(path.delimiter),
  };
  delete env["ELECTRON_RUN_AS_NODE"];
  service = spawn(node, [path.join(root, "server/server.mjs")], {
    cwd: root,
    env,
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  let stderr = "";
  service.stderr?.on("data", (b) => {
    stderr = (stderr + String(b)).slice(-3000);
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(Error("Local service did not start within 15 seconds")),
      15000,
    );
    service!.once("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    service!.once("exit", (code) => {
      clearTimeout(timer);
      reject(Error(stderr || `Local service exited (${code})`));
    });
    service!.on("message", (message: any) => {
      if (message?.type === "ready") {
        clearTimeout(timer);
        address = `http://127.0.0.1:${message.port}`;
        console.log(address);
        resolve();
      }
    });
  });
  service.on("exit", () => {
    if (!quitting) {
      void dialog.showMessageBox({
        type: "error",
        message: "Local reading service stopped",
        detail: stderr || "Restart the app to resume saved work.",
      });
    }
  });
}
if (locked)
  app.whenReady().then(async () => {
    try {
      app.dock?.setIcon(path.join(app.getAppPath(), "dist/assets/nota-macos-icon.png"));
      await startService();
      openWindow();
    } catch (e) {
      dialog.showErrorBox(
        "Unable to start workbench",
        String(e) + "\n请检查依赖安装，或运行 npm run setup:pdf。",
      );
      app.quit();
    }
  });
app.on("activate", () => {
  if (address) openWindow();
});
app.on("window-all-closed", () => app.quit());
app.on("before-quit", (event) => {
  if (quitting || !service || service.exitCode !== null) return;
  event.preventDefault();
  quitting = true;
  void (async () => {
    try {
      await Promise.race([
        window?.webContents.executeJavaScript(
          "window.persistReadingPosition?.()",
        ),
        new Promise((resolve) => setTimeout(resolve, 1500)),
      ]);
    } catch (e) {
      console.warn("Reading position flush:", String(e));
    }
    service!.once("exit", () => app.quit());
    service!.kill("SIGTERM");
    setTimeout(() => {
      service?.kill("SIGKILL");
      app.quit();
    }, 2500).unref();
  })();
});
