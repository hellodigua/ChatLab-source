import { app, shell, BrowserWindow, protocol, nativeTheme } from 'electron'
import { join } from 'path'
import { optimizer, is, platform } from '@electron-toolkit/utils'
import * as fs from 'fs/promises'
import { checkUpdate } from './update'
import mainIpcMain from './ipcMain'
import { initAnalytics, trackDailyActive } from './analytics'

class MainProcess {
  mainWindow: BrowserWindow | null
  constructor() {
    // 主窗口
    this.mainWindow = null

    // 设置应用程序名称
    if (process.platform === 'win32') app.setAppUserModelId(app.getName())
    // 初始化
    this.checkApp().then(async (lockObtained) => {
      if (lockObtained) {
        await this.init()
      }
    })
  }

  // 单例锁
  async checkApp() {
    if (!app.requestSingleInstanceLock()) {
      app.quit()
      // 未获得锁
      return false
    }
    // 聚焦到当前程序
    else {
      app.on('second-instance', () => {
        if (this.mainWindow) {
          this.mainWindow.show()
          if (this.mainWindow.isMinimized()) this.mainWindow.restore()
          this.mainWindow.focus()
        }
      })
      // 获得锁
      return true
    }
  }

  // 初始化程序
  async init() {
    initAnalytics()

    // 注册应用协议
    app.setAsDefaultProtocolClient('chatlab')

    // 应用程序准备好之前注册
    protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { secure: true, standard: true } }])

    // 主应用程序事件
    this.mainAppEvents()
  }

  // 创建主窗口
  async createWindow() {
    this.mainWindow = new BrowserWindow({
      width: 1180,
      height: 800,
      minWidth: 1180,
      minHeight: 800,
      show: false,
      autoHideMenuBar: true,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: false,
        devTools: true,
      },
    })

    // 设置默认日间模式
    nativeTheme.themeSource = 'light'

    this.mainWindow.once('ready-to-show', () => {
      this.mainWindow?.show()
    })

    // 主窗口事件
    this.mainWindowEvents()

    this.mainWindow.webContents.setWindowOpenHandler((details) => {
      shell.openExternal(details.url)
      return { action: 'deny' }
    })

    // HMR for renderer base on electron-vite cli.
    // Load the remote URL for development or the local html file for production.
    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      this.mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
    } else {
      this.mainWindow.loadFile(join(__dirname, '../../out/renderer/index.html'))
    }
  }

  // 主应用程序事件
  mainAppEvents() {
    app.whenReady().then(async () => {
      console.log('[Main] App is ready')
      // 设置Windows应用程序用户模型id
      if (process.platform === 'win32') app.setAppUserModelId(app.getName())

      // 记录日活（用于统计操作系统版本、客户端版本，便于更好的适配客户端）
      trackDailyActive()

      // 创建主窗口
      console.log('[Main] Creating window...')
      await this.createWindow()
      console.log('[Main] Window created')

      // 检查更新逻辑
      checkUpdate(this.mainWindow)

      // 引入主进程ipcMain
      if (this.mainWindow) {
        console.log('[Main] Registering IPC handlers...')
        mainIpcMain(this.mainWindow)
        console.log('[Main] IPC handlers registered')
      }

      // 开发环境下 F12 打开控制台
      app.on('browser-window-created', (_, window) => {
        optimizer.watchWindowShortcuts(window)
      })

      app.on('activate', () => {
        // 在 macOS 上，当单击 Dock 图标且没有其他窗口时，通常会重新创建窗口
        if (BrowserWindow.getAllWindows().length === 0) {
          this.createWindow()
          return
        }

        if (platform.isMacOS) {
          this.mainWindow?.show()
        }
      })

      // 监听渲染进程崩溃
      app.on('render-process-gone', (e, w, d) => {
        if (d.reason == 'crashed') {
          w.reload()
        }
        // fs.appendFile(`./error-log-${+new Date()}.txt`, `${new Date()}渲染进程被杀死${d.reason}\n`)
      })

      // 自定义协议
      app.on('open-url', (_, url) => {
        console.log('Received custom protocol URL:', url)
      })

      // 当所有窗口都关闭时退出应用，macOS 除外
      app.on('window-all-closed', () => {
        if (!platform.isMacOS) {
          app.quit()
        }
      })

      // 只有显式调用quit才退出系统，区分MAC系统程序坞退出和点击X隐藏
      app.on('before-quit', () => {
        // @ts-ignore
        app.isQuiting = true
      })
    })
  }

  // 主窗口事件
  mainWindowEvents() {
    if (!this.mainWindow) {
      return
    }
    this.mainWindow.webContents.on('did-finish-load', () => {
      setTimeout(() => {
        this.mainWindow && this.mainWindow.webContents.send('app-started')
      }, 500)
    })

    this.mainWindow.on('maximize', () => {
      this.mainWindow?.webContents.send('windowState', true)
    })

    this.mainWindow.on('unmaximize', () => {
      this.mainWindow?.webContents.send('windowState', false)
    })

    // 窗口关闭
    this.mainWindow.on('close', (event) => {
      event.preventDefault()
      // @ts-ignore
      if (!app.isQuiting) {
        this.mainWindow?.hide()
      } else {
        app.exit()
      }
    })
  }
}

// 捕获未捕获的异常
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error)
})

new MainProcess()
