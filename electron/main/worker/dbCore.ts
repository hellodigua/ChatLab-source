/**
 * 数据库核心工具模块
 * 提供数据库连接管理和通用工具函数
 */

import Database from 'better-sqlite3'
import * as fs from 'fs'
import * as path from 'path'

// 数据库目录（由 Worker 初始化时设置）
let DB_DIR: string = ''

// 数据库连接缓存
const dbCache = new Map<string, Database.Database>()

/**
 * 初始化数据库目录
 */
export function initDbDir(dir: string): void {
  DB_DIR = dir
}

/**
 * 获取数据库文件路径
 */
export function getDbPath(sessionId: string): string {
  return path.join(DB_DIR, `${sessionId}.db`)
}

/**
 * 打开数据库（带缓存）
 */
export function openDatabase(sessionId: string): Database.Database | null {
  // 检查缓存
  if (dbCache.has(sessionId)) {
    return dbCache.get(sessionId)!
  }

  const dbPath = getDbPath(sessionId)
  if (!fs.existsSync(dbPath)) {
    return null
  }

  const db = new Database(dbPath, { readonly: true })
  db.pragma('journal_mode = WAL')

  // 缓存连接
  dbCache.set(sessionId, db)
  return db
}

/**
 * 关闭指定会话的数据库连接
 */
export function closeDatabase(sessionId: string): void {
  const db = dbCache.get(sessionId)
  if (db) {
    db.close()
    dbCache.delete(sessionId)
  }
}

/**
 * 关闭所有数据库连接
 */
export function closeAllDatabases(): void {
  for (const [sessionId, db] of dbCache.entries()) {
    db.close()
    dbCache.delete(sessionId)
  }
}

/**
 * 获取数据库目录
 */
export function getDbDir(): string {
  return DB_DIR
}

// ==================== 时间过滤工具 ====================

export interface TimeFilter {
  startTs?: number
  endTs?: number
}

/**
 * 构建时间过滤 WHERE 子句
 */
export function buildTimeFilter(filter?: TimeFilter): { clause: string; params: number[] } {
  const conditions: string[] = []
  const params: number[] = []

  if (filter?.startTs !== undefined) {
    conditions.push('ts >= ?')
    params.push(filter.startTs)
  }
  if (filter?.endTs !== undefined) {
    conditions.push('ts <= ?')
    params.push(filter.endTs)
  }

  return {
    clause: conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '',
    params,
  }
}

/**
 * 构建排除系统消息的过滤条件
 */
export function buildSystemMessageFilter(existingClause: string): string {
  const systemFilter = "m.name != '系统消息'"

  if (existingClause.includes('WHERE')) {
    return existingClause + ' AND ' + systemFilter
  } else {
    return ' WHERE ' + systemFilter
  }
}

