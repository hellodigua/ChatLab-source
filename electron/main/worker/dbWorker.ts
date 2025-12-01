/**
 * 数据库 Worker 线程
 * 在独立线程中执行数据库操作，避免阻塞主进程
 *
 * 本文件作为 Worker 入口，负责：
 * 1. 初始化数据库目录
 * 2. 接收主进程消息
 * 3. 分发到对应的查询模块
 * 4. 返回结果
 */

import { parentPort, workerData } from 'worker_threads'
import { initDbDir, closeDatabase, closeAllDatabases } from './dbCore'
import {
  getAvailableYears,
  getMemberActivity,
  getHourlyActivity,
  getDailyActivity,
  getWeekdayActivity,
  getMonthlyActivity,
  getMessageTypeDistribution,
  getTimeRange,
  getMemberNameHistory,
  getAllSessions,
  getSession,
} from './queryBasic'
import {
  getRepeatAnalysis,
  getCatchphraseAnalysis,
  getNightOwlAnalysis,
  getDragonKingAnalysis,
  getDivingAnalysis,
  getMonologueAnalysis,
  getMentionAnalysis,
  getLaughAnalysis,
  getMemeBattleAnalysis,
  getCheckInAnalysis,
} from './queryAdvanced'
import { parseFile, detectFormat } from '../parser'
import { streamImport, streamParseFileInfo } from './streamImport'
import type { FileParseInfo } from '../../../src/types/chat'

/**
 * 解析文件获取基本信息（在 Worker 线程中执行，不阻塞主进程）
 * @deprecated 使用 streamParseFileInfo 替代
 */
function parseFileInfo(filePath: string): FileParseInfo {
  const format = detectFormat(filePath)
  if (!format) {
    throw new Error('无法识别文件格式')
  }

  const result = parseFile(filePath)

  return {
    name: result.meta.name,
    format,
    platform: result.meta.platform,
    messageCount: result.messages.length,
    memberCount: result.members.length,
  }
}

// 初始化数据库目录
initDbDir(workerData.dbDir)

// ==================== 消息处理 ====================

interface WorkerMessage {
  id: string
  type: string
  payload: any
}

// 同步消息处理器
const syncHandlers: Record<string, (payload: any) => any> = {
  // 文件解析（合并功能使用，已废弃）
  parseFileInfo: (p) => parseFileInfo(p.filePath),

  // 基础查询
  getAvailableYears: (p) => getAvailableYears(p.sessionId),
  getMemberActivity: (p) => getMemberActivity(p.sessionId, p.filter),
  getHourlyActivity: (p) => getHourlyActivity(p.sessionId, p.filter),
  getDailyActivity: (p) => getDailyActivity(p.sessionId, p.filter),
  getWeekdayActivity: (p) => getWeekdayActivity(p.sessionId, p.filter),
  getMonthlyActivity: (p) => getMonthlyActivity(p.sessionId, p.filter),
  getMessageTypeDistribution: (p) => getMessageTypeDistribution(p.sessionId, p.filter),
  getTimeRange: (p) => getTimeRange(p.sessionId),
  getMemberNameHistory: (p) => getMemberNameHistory(p.sessionId, p.memberId),

  // 会话管理
  getAllSessions: () => getAllSessions(),
  getSession: (p) => getSession(p.sessionId),
  closeDatabase: (p) => {
    closeDatabase(p.sessionId)
    return true
  },
  closeAll: () => {
    closeAllDatabases()
    return true
  },

  // 高级分析
  getRepeatAnalysis: (p) => getRepeatAnalysis(p.sessionId, p.filter),
  getCatchphraseAnalysis: (p) => getCatchphraseAnalysis(p.sessionId, p.filter),
  getNightOwlAnalysis: (p) => getNightOwlAnalysis(p.sessionId, p.filter),
  getDragonKingAnalysis: (p) => getDragonKingAnalysis(p.sessionId, p.filter),
  getDivingAnalysis: (p) => getDivingAnalysis(p.sessionId, p.filter),
  getMonologueAnalysis: (p) => getMonologueAnalysis(p.sessionId, p.filter),
  getMentionAnalysis: (p) => getMentionAnalysis(p.sessionId, p.filter),
  getLaughAnalysis: (p) => getLaughAnalysis(p.sessionId, p.filter, p.keywords),
  getMemeBattleAnalysis: (p) => getMemeBattleAnalysis(p.sessionId, p.filter),
  getCheckInAnalysis: (p) => getCheckInAnalysis(p.sessionId, p.filter),
}

// 异步消息处理器（流式操作）
const asyncHandlers: Record<string, (payload: any, requestId: string) => Promise<any>> = {
  // 流式导入
  streamImport: (p, id) => streamImport(p.filePath, id),
  // 流式解析文件信息（用于合并预览）
  streamParseFileInfo: (p, id) => streamParseFileInfo(p.filePath, id),
}

// 处理消息
parentPort?.on('message', async (message: WorkerMessage) => {
  const { id, type, payload } = message

  try {
    // 检查是否是异步处理器
    const asyncHandler = asyncHandlers[type]
    if (asyncHandler) {
      const result = await asyncHandler(payload, id)
      parentPort?.postMessage({ id, success: true, result })
      return
    }

    // 同步处理器
    const syncHandler = syncHandlers[type]
    if (!syncHandler) {
      throw new Error(`Unknown message type: ${type}`)
    }

    const result = syncHandler(payload)
    parentPort?.postMessage({ id, success: true, result })
  } catch (error) {
    parentPort?.postMessage({
      id,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    })
  }
})

// 进程退出时关闭所有数据库连接
process.on('exit', () => {
  closeAllDatabases()
})
