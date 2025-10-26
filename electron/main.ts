import { app, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'

// Disable Chromium audio output when running on hosts without audio devices to avoid stream allocation errors.
app.commandLine.appendSwitch('disable-audio-output')
app.commandLine.appendSwitch('disable-features', 'AudioServiceOutOfProcess')

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1340,
    height: 900,
    minWidth: 1120,
    minHeight: 760,
    show: false,
    title: 'Enigma OS · Control Room',
    backgroundColor: '#050a1a',
    autoHideMenuBar: true,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: process.platform === 'darwin' ? { x: 18, y: 18 } : undefined,
    vibrancy: process.platform === 'darwin' ? 'sidebar' : undefined,
    visualEffectState: 'active',
    backgroundMaterial: process.platform === 'win32' ? 'mica' : undefined,
    webPreferences: {
      preload: join(__dirname, '../preload/preload.mjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.setTitle('Enigma OS · Control Room')
    if (process.platform !== 'darwin') {
      mainWindow.setMenuBarVisibility(false)
    }
    if (process.platform === 'darwin') {
      mainWindow.setVibrancy('sidebar')
      mainWindow.setVisualEffectState('active')
    }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    // optimizer.watch(window)
  })

  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
