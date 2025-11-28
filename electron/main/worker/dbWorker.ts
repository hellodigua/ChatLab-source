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
} from './queryAdvanced'

// 初始化数据库目录
initDbDir(workerData.dbDir)

// ==================== 消息处理 ====================

interface WorkerMessage {
  id: string
  type: string
  payload: any
}

// 消息类型到处理函数的映射
const handlers: Record<string, (payload: any) => any> = {
  // 基础查询
  getAvailableYears: (p) => getAvailableYears(p.sessionId),
  getMemberActivity: (p) => getMemberActivity(p.sessionId, p.filter),
  getHourlyActivity: (p) => getHourlyActivity(p.sessionId, p.filter),
  getDailyActivity: (p) => getDailyActivity(p.sessionId, p.filter),
  getWeekdayActivity: (p) => getWeekdayActivity(p.sessionId, p.filter),
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
}

// 处理消息
parentPort?.on('message', (message: WorkerMessage) => {
  const { id, type, payload } = message

  try {
    const handler = handlers[type]
    if (!handler) {
      throw new Error(`Unknown message type: ${type}`)
    }

    const result = handler(payload)
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
