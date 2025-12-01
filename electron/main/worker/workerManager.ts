/**
 * Worker 管理器
 * 负责创建、管理 Worker 线程，并处理与主进程的通信
 */

import { Worker } from 'worker_threads'
import { app } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import type { ParseProgress } from '../parser'

// Worker 实例
let worker: Worker | null = null

// 等待中的请求 Map
const pendingRequests = new Map<
  string,
  {
    resolve: (value: any) => void
    reject: (error: Error) => void
    onProgress?: (progress: ParseProgress) => void // 进度回调
  }
>()

// 请求 ID 计数器
let requestIdCounter = 0

// 数据库目录
let dbDir: string | null = null

/**
 * 获取数据库目录
 */
function getDbDir(): string {
  if (dbDir) return dbDir

  try {
    const docPath = app.getPath('documents')
    dbDir = path.join(docPath, 'ChatLab', 'databases')
  } catch (error) {
    console.error('[WorkerManager] Error getting documents path:', error)
    dbDir = path.join(process.cwd(), 'databases')
  }

  // 确保目录存在
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true })
  }

  return dbDir
}

/**
 * 获取 Worker 文件路径
 * 开发环境和生产环境路径不同
 */
function getWorkerPath(): string {
  // 检查是否在开发环境
  const isDev = !app.isPackaged

  if (isDev) {
    // 开发环境：编译后的 JS 文件在 out/main 目录
    return path.join(__dirname, 'worker', 'dbWorker.js')
  } else {
    // 生产环境：打包后的路径
    return path.join(__dirname, 'worker', 'dbWorker.js')
  }
}

/**
 * 初始化 Worker
 */
export function initWorker(): void {
  if (worker) {
    console.log('[WorkerManager] Worker already initialized')
    return
  }

  const workerPath = getWorkerPath()
  console.log('[WorkerManager] Initializing worker at:', workerPath)

  try {
    worker = new Worker(workerPath, {
      workerData: {
        dbDir: getDbDir(),
      },
    })

    // 监听 Worker 消息
    worker.on('message', (message) => {
      const { id, type, success, result, error, payload } = message

      const pending = pendingRequests.get(id)
      if (!pending) return

      // 处理进度消息（不删除 pending，因为还没完成）
      if (type === 'progress') {
        if (pending.onProgress) {
          pending.onProgress(payload)
        }
        return
      }

      // 处理完成或错误消息
      pendingRequests.delete(id)

      if (success) {
        pending.resolve(result)
      } else {
        pending.reject(new Error(error))
      }
    })

    // 监听 Worker 错误
    worker.on('error', (error) => {
      console.error('[WorkerManager] Worker error:', error)
    })

    // 监听 Worker 退出
    worker.on('exit', (code) => {
      console.log('[WorkerManager] Worker exited with code:', code)
      worker = null

      // 拒绝所有等待中的请求
      for (const [id, pending] of pendingRequests.entries()) {
        pending.reject(new Error('Worker exited unexpectedly'))
        pendingRequests.delete(id)
      }
    })

    console.log('[WorkerManager] Worker initialized successfully')
  } catch (error) {
    console.error('[WorkerManager] Failed to initialize worker:', error)
    throw error
  }
}

/**
 * 发送消息到 Worker 并等待响应
 */
function sendToWorker<T>(type: string, payload: any): Promise<T> {
  return new Promise((resolve, reject) => {
    if (!worker) {
      try {
        initWorker()
      } catch (error) {
        reject(new Error('Worker not initialized'))
        return
      }
    }

    const id = `req_${++requestIdCounter}`

    pendingRequests.set(id, { resolve, reject })

    worker!.postMessage({ id, type, payload })

    // 设置超时（30秒）
    setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id)
        reject(new Error(`Worker request timeout: ${type}`))
      }
    }, 30000)
  })
}

/**
 * 发送消息到 Worker 并等待响应（带进度回调）
 * 用于流式导入等长时间操作
 */
function sendToWorkerWithProgress<T>(
  type: string,
  payload: any,
  onProgress?: (progress: ParseProgress) => void,
  timeoutMs: number = 600000 // 默认 10 分钟超时
): Promise<T> {
  return new Promise((resolve, reject) => {
    if (!worker) {
      try {
        initWorker()
      } catch (error) {
        reject(new Error('Worker not initialized'))
        return
      }
    }

    const id = `req_${++requestIdCounter}`

    pendingRequests.set(id, { resolve, reject, onProgress })

    worker!.postMessage({ id, type, payload })

    // 设置超时
    setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id)
        reject(new Error(`Worker request timeout: ${type}`))
      }
    }, timeoutMs)
  })
}

/**
 * 关闭 Worker
 */
export function closeWorker(): void {
  if (worker) {
    // 先关闭所有数据库连接
    sendToWorker('closeAll', {}).catch(() => {})

    worker.terminate()
    worker = null
    console.log('[WorkerManager] Worker terminated')
  }
}

// ==================== 导出的异步 API ====================

export async function getAvailableYears(sessionId: string): Promise<number[]> {
  return sendToWorker('getAvailableYears', { sessionId })
}

export async function getMemberActivity(sessionId: string, filter?: any): Promise<any[]> {
  return sendToWorker('getMemberActivity', { sessionId, filter })
}

export async function getHourlyActivity(sessionId: string, filter?: any): Promise<any[]> {
  return sendToWorker('getHourlyActivity', { sessionId, filter })
}

export async function getDailyActivity(sessionId: string, filter?: any): Promise<any[]> {
  return sendToWorker('getDailyActivity', { sessionId, filter })
}

export async function getWeekdayActivity(sessionId: string, filter?: any): Promise<any[]> {
  return sendToWorker('getWeekdayActivity', { sessionId, filter })
}

export async function getMonthlyActivity(sessionId: string, filter?: any): Promise<any[]> {
  return sendToWorker('getMonthlyActivity', { sessionId, filter })
}

export async function getMessageTypeDistribution(sessionId: string, filter?: any): Promise<any[]> {
  return sendToWorker('getMessageTypeDistribution', { sessionId, filter })
}

export async function getTimeRange(sessionId: string): Promise<{ start: number; end: number } | null> {
  return sendToWorker('getTimeRange', { sessionId })
}

export async function getMemberNameHistory(sessionId: string, memberId: number): Promise<any[]> {
  return sendToWorker('getMemberNameHistory', { sessionId, memberId })
}

export async function getRepeatAnalysis(sessionId: string, filter?: any): Promise<any> {
  return sendToWorker('getRepeatAnalysis', { sessionId, filter })
}

export async function getCatchphraseAnalysis(sessionId: string, filter?: any): Promise<any> {
  return sendToWorker('getCatchphraseAnalysis', { sessionId, filter })
}

export async function getNightOwlAnalysis(sessionId: string, filter?: any): Promise<any> {
  return sendToWorker('getNightOwlAnalysis', { sessionId, filter })
}

export async function getDragonKingAnalysis(sessionId: string, filter?: any): Promise<any> {
  return sendToWorker('getDragonKingAnalysis', { sessionId, filter })
}

export async function getDivingAnalysis(sessionId: string, filter?: any): Promise<any> {
  return sendToWorker('getDivingAnalysis', { sessionId, filter })
}

export async function getMonologueAnalysis(sessionId: string, filter?: any): Promise<any> {
  return sendToWorker('getMonologueAnalysis', { sessionId, filter })
}

export async function getMentionAnalysis(sessionId: string, filter?: any): Promise<any> {
  return sendToWorker('getMentionAnalysis', { sessionId, filter })
}

export async function getLaughAnalysis(sessionId: string, filter?: any, keywords?: string[]): Promise<any> {
  return sendToWorker('getLaughAnalysis', { sessionId, filter, keywords })
}

export async function getMemeBattleAnalysis(sessionId: string, filter?: any): Promise<any> {
  return sendToWorker('getMemeBattleAnalysis', { sessionId, filter })
}

export async function getCheckInAnalysis(sessionId: string, filter?: any): Promise<any> {
  return sendToWorker('getCheckInAnalysis', { sessionId, filter })
}

export async function getAllSessions(): Promise<any[]> {
  return sendToWorker('getAllSessions', {})
}

export async function getSession(sessionId: string): Promise<any | null> {
  return sendToWorker('getSession', { sessionId })
}

export async function closeDatabase(sessionId: string): Promise<void> {
  return sendToWorker('closeDatabase', { sessionId })
}

/**
 * 解析文件获取基本信息（在 Worker 线程中执行）
 * @deprecated 使用 streamParseFileInfo 替代
 */
export async function parseFileInfo(filePath: string): Promise<any> {
  return sendToWorker('parseFileInfo', { filePath })
}

/**
 * 流式解析文件获取基本信息（用于合并预览）
 */
export async function streamParseFileInfo(
  filePath: string,
  onProgress?: (progress: ParseProgress) => void
): Promise<{
  name: string
  format: string
  platform: string
  messageCount: number
  memberCount: number
}> {
  return sendToWorkerWithProgress('streamParseFileInfo', { filePath }, onProgress)
}

/**
 * 流式导入聊天记录
 * @param filePath 文件路径
 * @param onProgress 进度回调
 */
export async function streamImport(
  filePath: string,
  onProgress?: (progress: ParseProgress) => void
): Promise<{ success: boolean; sessionId?: string; error?: string }> {
  return sendToWorkerWithProgress('streamImport', { filePath }, onProgress)
}

/**
 * 获取数据库目录（供外部使用）
 */
export function getDbDirectory(): string {
  return getDbDir()
}
