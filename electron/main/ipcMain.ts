import { ipcMain, app, dialog, clipboard, shell, BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import * as fs from 'fs/promises'

// 导入数据库核心模块（用于导入和删除操作）
import * as databaseCore from './database/core'
// 导入 Worker 模块（用于异步分析查询和流式导入）
import * as worker from './worker'
// 导入解析器模块
import * as parser from './parser'
import { detectFormat, type ParseProgress } from './parser'
// 导入合并模块
import * as merger from './merger'
import type { MergeParams } from '../../src/types/chat'

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

      // 检测文件格式（使用流式检测，只读取文件开头）
      const formatFeature = detectFormat(filePath)
      const format = formatFeature?.name || null
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
   * 导入聊天记录（流式版本）
   */
  ipcMain.handle('chat:import', async (_, filePath: string) => {
    console.log('[IpcMain] chat:import called with:', filePath)

    try {
      // 发送进度：开始检测格式
      win.webContents.send('chat:importProgress', {
        stage: 'detecting',
        progress: 5,
        message: '正在检测文件格式...',
      })

      // 使用流式导入（在 Worker 线程中执行）
      const result = await worker.streamImport(filePath, (progress: ParseProgress) => {
        // 转发进度到渲染进程
        win.webContents.send('chat:importProgress', {
          stage: progress.stage,
          progress: progress.percentage,
          message: progress.message,
          bytesRead: progress.bytesRead,
          totalBytes: progress.totalBytes,
          messagesProcessed: progress.messagesProcessed,
        })
      })

      if (result.success) {
        console.log('[IpcMain] Stream import successful, sessionId:', result.sessionId)
        return { success: true, sessionId: result.sessionId }
      } else {
        console.error('[IpcMain] Stream import failed:', result.error)
        win.webContents.send('chat:importProgress', {
          stage: 'error',
          progress: 0,
          message: result.error,
        })
        return { success: false, error: result.error }
      }
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
    try {
      const sessions = await worker.getAllSessions()
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
   * 获取月份活跃度分布
   */
  ipcMain.handle(
    'chat:getMonthlyActivity',
    async (_, sessionId: string, filter?: { startTs?: number; endTs?: number }) => {
      try {
        return await worker.getMonthlyActivity(sessionId, filter)
      } catch (error) {
        console.error('获取月份活跃度失败：', error)
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

  /**
   * 获取 @ 互动分析数据
   */
  ipcMain.handle(
    'chat:getMentionAnalysis',
    async (_, sessionId: string, filter?: { startTs?: number; endTs?: number }) => {
      try {
        return await worker.getMentionAnalysis(sessionId, filter)
      } catch (error) {
        console.error('获取 @ 互动分析失败：', error)
        return { topMentioners: [], topMentioned: [], oneWay: [], twoWay: [], totalMentions: 0, memberDetails: [] }
      }
    }
  )

  /**
   * 获取含笑量分析数据
   */
  ipcMain.handle(
    'chat:getLaughAnalysis',
    async (_, sessionId: string, filter?: { startTs?: number; endTs?: number }, keywords?: string[]) => {
      try {
        return await worker.getLaughAnalysis(sessionId, filter, keywords)
      } catch (error) {
        console.error('获取含笑量分析失败：', error)
        return {
          rankByRate: [],
          rankByCount: [],
          typeDistribution: [],
          totalLaughs: 0,
          totalMessages: 0,
          groupLaughRate: 0,
        }
      }
    }
  )

  /**
   * 获取斗图分析数据
   */
  ipcMain.handle(
    'chat:getMemeBattleAnalysis',
    async (_, sessionId: string, filter?: { startTs?: number; endTs?: number }) => {
      try {
        return await worker.getMemeBattleAnalysis(sessionId, filter)
      } catch (error) {
        console.error('获取斗图分析失败：', error)
        return {
          longestBattle: null,
          rankByCount: [],
          rankByImageCount: [],
          totalBattles: 0,
        }
      }
    }
  )

  /**
   * 获取打卡分析数据（火花榜 + 忠臣榜）
   */
  ipcMain.handle(
    'chat:getCheckInAnalysis',
    async (_, sessionId: string, filter?: { startTs?: number; endTs?: number }) => {
      try {
        return await worker.getCheckInAnalysis(sessionId, filter)
      } catch (error) {
        console.error('获取打卡分析失败：', error)
        return {
          streakRank: [],
          loyaltyRank: [],
          totalDays: 0,
        }
      }
    }
  )

  // ==================== 合并功能 ====================

  /**
   * 解析文件获取基本信息（用于合并预览）
   * 使用流式解析，支持大文件
   */
  ipcMain.handle('merge:parseFileInfo', async (_, filePath: string) => {
    try {
      // 使用流式解析，避免大文件 OOM
      return await worker.streamParseFileInfo(filePath, (progress: ParseProgress) => {
        // 可选：发送进度到渲染进程
        win.webContents.send('merge:parseProgress', {
          filePath,
          progress,
        })
      })
    } catch (error) {
      console.error('解析文件信息失败：', error)
      throw error
    }
  })

  /**
   * 检测合并冲突
   */
  ipcMain.handle('merge:checkConflicts', async (_, filePaths: string[]) => {
    try {
      return merger.checkConflicts(filePaths)
    } catch (error) {
      console.error('检测冲突失败：', error)
      throw error
    }
  })

  /**
   * 执行合并
   */
  ipcMain.handle('merge:mergeFiles', async (_, params: MergeParams) => {
    try {
      return merger.mergeFiles(params)
    } catch (error) {
      console.error('合并失败：', error)
      return { success: false, error: String(error) }
    }
  })

  /**
   * 显示打开对话框（通用）
   */
  ipcMain.handle('dialog:showOpenDialog', async (_, options) => {
    try {
      return await dialog.showOpenDialog(options)
    } catch (error) {
      console.error('显示对话框失败：', error)
      throw error
    }
  })
}

export default mainIpcMain
