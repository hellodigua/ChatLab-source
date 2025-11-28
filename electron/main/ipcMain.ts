import { ipcMain, app, dialog, clipboard, shell, BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import * as fs from 'fs/promises'

// 导入数据库核心模块（用于导入和删除操作）
import * as databaseCore from './database/core'
// 导入 Worker 模块（用于异步分析查询）
import * as worker from './worker'
// 导入解析器模块
import * as parser from './parser'

console.log('[IpcMain] Database, Worker and Parser modules imported')

const mainIpcMain = (win: BrowserWindow) => {
  console.log('[IpcMain] Registering IPC handlers...')

  // 初始化 Worker
  try {
    worker.initWorker()
    console.log('[IpcMain] Worker initialized successfully')
  } catch (error) {
    console.error('[IpcMain] Failed to initialize worker:', error)
  }
  // ==================== 窗口操作 ====================
  ipcMain.on('window-min', (ev) => {
    ev.preventDefault()
    win.minimize()
  })

  ipcMain.on('window-maxOrRestore', (ev) => {
    const winSizeState = win.isMaximized()
    winSizeState ? win.restore() : win.maximize()
    ev.reply('windowState', win.isMaximized())
  })

  ipcMain.on('window-restore', () => {
    win.restore()
  })

  ipcMain.on('window-hide', () => {
    win.hide()
  })

  ipcMain.on('window-close', () => {
    win.close()
    // @ts-ignore
    app.isQuitting = true
    app.quit()
  })

  ipcMain.on('window-resize', (_, data) => {
    if (data.resize) {
      win.setResizable(true)
    } else {
      win.setSize(1180, 720)
      win.setResizable(false)
    }
  })

  ipcMain.on('open-devtools', () => {
    win.webContents.openDevTools()
  })

  // ==================== 更新检查 ====================
  ipcMain.on('check-update', () => {
    autoUpdater.checkForUpdates()
  })

  // ==================== 通用工具 ====================
  ipcMain.handle('show-message', (event, args) => {
    event.sender.send('show-message', args)
  })

  // 复制到剪贴板
  ipcMain.handle('copyData', async (_, data) => {
    try {
      clipboard.writeText(data)
      return true
    } catch (error) {
      console.error('复制操作出错：', error)
      return false
    }
  })

  // ==================== 文件系统操作 ====================
  // 选择文件夹
  ipcMain.handle('selectDir', async (_, defaultPath = '') => {
    try {
      const { canceled, filePaths } = await dialog.showOpenDialog({
        title: '选择目录',
        defaultPath: defaultPath || app.getPath('documents'),
        properties: ['openDirectory', 'createDirectory'],
        buttonLabel: '选择文件夹',
      })
      if (!canceled) {
        return filePaths[0]
      }
      return null
    } catch (err) {
      console.error('选择文件夹时发生错误：', err)
      throw err
    }
  })

  // 检查文件是否存在
  ipcMain.handle('checkFileExist', async (_, filePath) => {
    try {
      await fs.access(filePath)
      return true
    } catch {
      return false
    }
  })

  // 在文件管理器中打开
  ipcMain.handle('openInFolder', async (_, path) => {
    try {
      await fs.access(path)
      await shell.showItemInFolder(path)
      return true
    } catch (error) {
      console.error('打开目录时出错：', error)
      return false
    }
  })

  // ==================== 聊天记录导入与分析 ====================

  /**
   * 选择聊天记录文件
   */
  ipcMain.handle('chat:selectFile', async () => {
    try {
      const { canceled, filePaths } = await dialog.showOpenDialog({
        title: '选择聊天记录文件',
        defaultPath: app.getPath('documents'),
        properties: ['openFile'],
        filters: [
          { name: '聊天记录', extensions: ['json', 'txt'] },
          { name: '所有文件', extensions: ['*'] },
        ],
        buttonLabel: '导入',
      })

      if (canceled || filePaths.length === 0) {
        return null
      }

      const filePath = filePaths[0]
      console.log('[IpcMain] File selected:', filePath)

      // 检测文件格式
      const format = parser.detectFormat(filePath)
      console.log('[IpcMain] Detected format:', format)
      if (!format) {
        return { error: '无法识别的文件格式' }
      }

      return { filePath, format }
    } catch (error) {
      console.error('[IpcMain] Error selecting file:', error)
      return { error: String(error) }
    }
  })

  /**
   * 导入聊天记录
   */
  ipcMain.handle('chat:import', async (_, filePath: string) => {
    console.log('[IpcMain] chat:import called with:', filePath)

    try {
      // 发送进度：开始解析
      win.webContents.send('chat:importProgress', {
        stage: 'parsing',
        progress: 10,
        message: '正在解析文件...',
      })

      console.log('[IpcMain] Parsing file...')
      // 解析文件
      const parseResult = parser.parseFile(filePath)
      console.log('[IpcMain] Parse result:', {
        memberCount: parseResult.members.length,
        messageCount: parseResult.messages.length,
      })

      // 发送进度：开始保存
      win.webContents.send('chat:importProgress', {
        stage: 'saving',
        progress: 50,
        message: `正在保存 ${parseResult.messages.length} 条消息...`,
      })

      console.log('[IpcMain] Importing to database...')
      // 导入到数据库（使用核心模块，同步操作）
      const sessionId = databaseCore.importData(parseResult)
      console.log('[IpcMain] Import successful, sessionId:', sessionId)

      // 发送进度：完成
      win.webContents.send('chat:importProgress', {
        stage: 'done',
        progress: 100,
        message: '导入完成',
      })

      return { success: true, sessionId }
    } catch (error) {
      console.error('[IpcMain] Import failed:', error)

      win.webContents.send('chat:importProgress', {
        stage: 'error',
        progress: 0,
        message: String(error),
      })

      return { success: false, error: String(error) }
    }
  })

  /**
   * 获取所有分析会话列表
   */
  ipcMain.handle('chat:getSessions', async () => {
    console.log('[IpcMain] chat:getSessions called')
    try {
      const sessions = await worker.getAllSessions()
      console.log('[IpcMain] Found sessions:', sessions.length)
      return sessions
    } catch (error) {
      console.error('[IpcMain] Error getting sessions:', error)
      return []
    }
  })

  /**
   * 获取单个会话信息
   */
  ipcMain.handle('chat:getSession', async (_, sessionId: string) => {
    try {
      return await worker.getSession(sessionId)
    } catch (error) {
      console.error('获取会话信息失败：', error)
      return null
    }
  })

  /**
   * 删除会话
   */
  ipcMain.handle('chat:deleteSession', async (_, sessionId: string) => {
    try {
      // 先关闭 Worker 中的数据库连接
      await worker.closeDatabase(sessionId)
      // 然后删除文件（使用核心模块）
      return databaseCore.deleteSession(sessionId)
    } catch (error) {
      console.error('删除会话失败：', error)
      return false
    }
  })

  /**
   * 获取可用年份列表
   */
  ipcMain.handle('chat:getAvailableYears', async (_, sessionId: string) => {
    try {
      return await worker.getAvailableYears(sessionId)
    } catch (error) {
      console.error('获取可用年份失败：', error)
      return []
    }
  })

  /**
   * 获取成员活跃度排行
   */
  ipcMain.handle(
    'chat:getMemberActivity',
    async (_, sessionId: string, filter?: { startTs?: number; endTs?: number }) => {
      try {
        return await worker.getMemberActivity(sessionId, filter)
      } catch (error) {
        console.error('获取成员活跃度失败：', error)
        return []
      }
    }
  )

  /**
   * 获取成员历史昵称
   */
  ipcMain.handle('chat:getMemberNameHistory', async (_, sessionId: string, memberId: number) => {
    try {
      return await worker.getMemberNameHistory(sessionId, memberId)
    } catch (error) {
      console.error('获取成员历史昵称失败：', error)
      return []
    }
  })

  /**
   * 获取每小时活跃度分布
   */
  ipcMain.handle(
    'chat:getHourlyActivity',
    async (_, sessionId: string, filter?: { startTs?: number; endTs?: number }) => {
      try {
        return await worker.getHourlyActivity(sessionId, filter)
      } catch (error) {
        console.error('获取小时活跃度失败：', error)
        return []
      }
    }
  )

  /**
   * 获取每日活跃度趋势
   */
  ipcMain.handle(
    'chat:getDailyActivity',
    async (_, sessionId: string, filter?: { startTs?: number; endTs?: number }) => {
      try {
        return await worker.getDailyActivity(sessionId, filter)
      } catch (error) {
        console.error('获取日活跃度失败：', error)
        return []
      }
    }
  )

  /**
   * 获取星期活跃度分布
   */
  ipcMain.handle(
    'chat:getWeekdayActivity',
    async (_, sessionId: string, filter?: { startTs?: number; endTs?: number }) => {
      try {
        return await worker.getWeekdayActivity(sessionId, filter)
      } catch (error) {
        console.error('获取星期活跃度失败：', error)
        return []
      }
    }
  )

  /**
   * 获取消息类型分布
   */
  ipcMain.handle(
    'chat:getMessageTypeDistribution',
    async (_, sessionId: string, filter?: { startTs?: number; endTs?: number }) => {
      try {
        return await worker.getMessageTypeDistribution(sessionId, filter)
      } catch (error) {
        console.error('获取消息类型分布失败：', error)
        return []
      }
    }
  )

  /**
   * 获取时间范围
   */
  ipcMain.handle('chat:getTimeRange', async (_, sessionId: string) => {
    try {
      return await worker.getTimeRange(sessionId)
    } catch (error) {
      console.error('获取时间范围失败：', error)
      return null
    }
  })

  /**
   * 获取数据库存储目录
   */
  ipcMain.handle('chat:getDbDirectory', async () => {
    try {
      return worker.getDbDirectory()
    } catch (error) {
      console.error('获取数据库目录失败：', error)
      return null
    }
  })

  /**
   * 获取支持的格式列表
   */
  ipcMain.handle('chat:getSupportedFormats', async () => {
    return parser.getSupportedFormats()
  })

  /**
   * 获取复读分析数据
   */
  ipcMain.handle(
    'chat:getRepeatAnalysis',
    async (_, sessionId: string, filter?: { startTs?: number; endTs?: number }) => {
      try {
        return await worker.getRepeatAnalysis(sessionId, filter)
      } catch (error) {
        console.error('获取复读分析失败：', error)
        return { originators: [], initiators: [], breakers: [], totalRepeatChains: 0 }
      }
    }
  )

  /**
   * 获取口头禅分析数据
   */
  ipcMain.handle(
    'chat:getCatchphraseAnalysis',
    async (_, sessionId: string, filter?: { startTs?: number; endTs?: number }) => {
      try {
        return await worker.getCatchphraseAnalysis(sessionId, filter)
      } catch (error) {
        console.error('获取口头禅分析失败：', error)
        return { members: [] }
      }
    }
  )

  /**
   * 获取夜猫分析数据
   */
  ipcMain.handle(
    'chat:getNightOwlAnalysis',
    async (_, sessionId: string, filter?: { startTs?: number; endTs?: number }) => {
      try {
        return await worker.getNightOwlAnalysis(sessionId, filter)
      } catch (error) {
        console.error('获取夜猫分析失败：', error)
        return {
          nightOwlRank: [],
          lastSpeakerRank: [],
          firstSpeakerRank: [],
          consecutiveRecords: [],
          champions: [],
          totalDays: 0,
        }
      }
    }
  )

  /**
   * 获取龙王分析数据
   */
  ipcMain.handle(
    'chat:getDragonKingAnalysis',
    async (_, sessionId: string, filter?: { startTs?: number; endTs?: number }) => {
      try {
        return await worker.getDragonKingAnalysis(sessionId, filter)
      } catch (error) {
        console.error('获取龙王分析失败：', error)
        return { rank: [], totalDays: 0 }
      }
    }
  )

  /**
   * 获取潜水分析数据
   */
  ipcMain.handle(
    'chat:getDivingAnalysis',
    async (_, sessionId: string, filter?: { startTs?: number; endTs?: number }) => {
      try {
        return await worker.getDivingAnalysis(sessionId, filter)
      } catch (error) {
        console.error('获取潜水分析失败：', error)
        return { rank: [] }
      }
    }
  )

  /**
   * 获取自言自语分析数据
   */
  ipcMain.handle(
    'chat:getMonologueAnalysis',
    async (_, sessionId: string, filter?: { startTs?: number; endTs?: number }) => {
      try {
        return await worker.getMonologueAnalysis(sessionId, filter)
      } catch (error) {
        console.error('获取自言自语分析失败：', error)
        return { rank: [], maxComboRecord: null }
      }
    }
  )
}

export default mainIpcMain
