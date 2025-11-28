/**
 * 基础查询模块
 * 提供活跃度、时段分布等基础统计查询
 */

import Database from 'better-sqlite3'
import * as fs from 'fs'
import * as path from 'path'
import {
  openDatabase,
  getDbDir,
  getDbPath,
  buildTimeFilter,
  buildSystemMessageFilter,
  type TimeFilter,
} from './dbCore'

// ==================== 基础查询 ====================

/**
 * 获取可用的年份列表
 */
export function getAvailableYears(sessionId: string): number[] {
  const db = openDatabase(sessionId)
  if (!db) return []

  const rows = db
    .prepare(
      `
      SELECT DISTINCT CAST(strftime('%Y', ts, 'unixepoch', 'localtime') AS INTEGER) as year
      FROM message
      ORDER BY year DESC
    `
    )
    .all() as Array<{ year: number }>

  return rows.map((r) => r.year)
}

/**
 * 获取成员活跃度排行
 */
export function getMemberActivity(sessionId: string, filter?: TimeFilter): any[] {
  const db = openDatabase(sessionId)
  if (!db) return []

  const { clause, params } = buildTimeFilter(filter)

  const msgFilterBase = clause ? clause.replace('WHERE', 'AND') : ''
  const msgFilterWithSystem = msgFilterBase + " AND m.name != '系统消息'"

  const totalClauseWithSystem = buildSystemMessageFilter(clause)
  const totalMessages = (
    db
      .prepare(
        `SELECT COUNT(*) as count
         FROM message msg
         JOIN member m ON msg.sender_id = m.id
         ${totalClauseWithSystem}`
      )
      .get(...params) as { count: number }
  ).count

  const rows = db
    .prepare(
      `
      SELECT
        m.id as memberId,
        m.platform_id as platformId,
        m.name,
        COUNT(msg.id) as messageCount
      FROM member m
      LEFT JOIN message msg ON m.id = msg.sender_id ${msgFilterWithSystem}
      WHERE m.name != '系统消息'
      GROUP BY m.id
      HAVING messageCount > 0
      ORDER BY messageCount DESC
    `
    )
    .all(...params) as Array<{
    memberId: number
    platformId: string
    name: string
    messageCount: number
  }>

  return rows.map((row) => ({
    memberId: row.memberId,
    platformId: row.platformId,
    name: row.name,
    messageCount: row.messageCount,
    percentage: totalMessages > 0 ? Math.round((row.messageCount / totalMessages) * 10000) / 100 : 0,
  }))
}

/**
 * 获取每小时活跃度分布
 */
export function getHourlyActivity(sessionId: string, filter?: TimeFilter): any[] {
  const db = openDatabase(sessionId)
  if (!db) return []

  const { clause, params } = buildTimeFilter(filter)
  const clauseWithSystem = buildSystemMessageFilter(clause)

  const rows = db
    .prepare(
      `
      SELECT
        CAST(strftime('%H', msg.ts, 'unixepoch', 'localtime') AS INTEGER) as hour,
        COUNT(*) as messageCount
      FROM message msg
      JOIN member m ON msg.sender_id = m.id
      ${clauseWithSystem}
      GROUP BY hour
      ORDER BY hour
    `
    )
    .all(...params) as Array<{ hour: number; messageCount: number }>

  const result: any[] = []
  for (let h = 0; h < 24; h++) {
    const found = rows.find((r) => r.hour === h)
    result.push({
      hour: h,
      messageCount: found ? found.messageCount : 0,
    })
  }

  return result
}

/**
 * 获取每日活跃度趋势
 */
export function getDailyActivity(sessionId: string, filter?: TimeFilter): any[] {
  const db = openDatabase(sessionId)
  if (!db) return []

  const { clause, params } = buildTimeFilter(filter)
  const clauseWithSystem = buildSystemMessageFilter(clause)

  const rows = db
    .prepare(
      `
      SELECT
        strftime('%Y-%m-%d', msg.ts, 'unixepoch', 'localtime') as date,
        COUNT(*) as messageCount
      FROM message msg
      JOIN member m ON msg.sender_id = m.id
      ${clauseWithSystem}
      GROUP BY date
      ORDER BY date
    `
    )
    .all(...params) as Array<{ date: string; messageCount: number }>

  return rows
}

/**
 * 获取星期活跃度分布
 */
export function getWeekdayActivity(sessionId: string, filter?: TimeFilter): any[] {
  const db = openDatabase(sessionId)
  if (!db) return []

  const { clause, params } = buildTimeFilter(filter)
  const clauseWithSystem = buildSystemMessageFilter(clause)

  const rows = db
    .prepare(
      `
      SELECT
        CASE
          WHEN CAST(strftime('%w', msg.ts, 'unixepoch', 'localtime') AS INTEGER) = 0 THEN 7
          ELSE CAST(strftime('%w', msg.ts, 'unixepoch', 'localtime') AS INTEGER)
        END as weekday,
        COUNT(*) as messageCount
      FROM message msg
      JOIN member m ON msg.sender_id = m.id
      ${clauseWithSystem}
      GROUP BY weekday
      ORDER BY weekday
    `
    )
    .all(...params) as Array<{ weekday: number; messageCount: number }>

  const result: any[] = []
  for (let w = 1; w <= 7; w++) {
    const found = rows.find((r) => r.weekday === w)
    result.push({
      weekday: w,
      messageCount: found ? found.messageCount : 0,
    })
  }

  return result
}

/**
 * 获取消息类型分布
 */
export function getMessageTypeDistribution(sessionId: string, filter?: TimeFilter): any[] {
  const db = openDatabase(sessionId)
  if (!db) return []

  const { clause, params } = buildTimeFilter(filter)
  const clauseWithSystem = buildSystemMessageFilter(clause)

  const rows = db
    .prepare(
      `
      SELECT msg.type, COUNT(*) as count
      FROM message msg
      JOIN member m ON msg.sender_id = m.id
      ${clauseWithSystem}
      GROUP BY msg.type
      ORDER BY count DESC
    `
    )
    .all(...params) as Array<{ type: number; count: number }>

  return rows.map((r) => ({
    type: r.type,
    count: r.count,
  }))
}

/**
 * 获取时间范围
 */
export function getTimeRange(sessionId: string): { start: number; end: number } | null {
  const db = openDatabase(sessionId)
  if (!db) return null

  const row = db
    .prepare(
      `
      SELECT MIN(ts) as start, MAX(ts) as end FROM message
    `
    )
    .get() as { start: number | null; end: number | null }

  if (row.start === null || row.end === null) return null

  return { start: row.start, end: row.end }
}

/**
 * 获取成员的历史昵称记录
 */
export function getMemberNameHistory(
  sessionId: string,
  memberId: number
): any[] {
  const db = openDatabase(sessionId)
  if (!db) return []

  const rows = db
    .prepare(
      `
      SELECT name, start_ts as startTs, end_ts as endTs
      FROM member_name_history
      WHERE member_id = ?
      ORDER BY start_ts DESC
    `
    )
    .all(memberId) as Array<{ name: string; startTs: number; endTs: number | null }>

  return rows
}

// ==================== 会话管理 ====================

interface DbMeta {
  name: string
  platform: string
  type: string
  imported_at: number
}

/**
 * 获取所有会话列表
 */
export function getAllSessions(): any[] {
  const dbDir = getDbDir()
  if (!fs.existsSync(dbDir)) {
    return []
  }

  const sessions: any[] = []
  const files = fs.readdirSync(dbDir).filter((f) => f.endsWith('.db'))

  for (const file of files) {
    const sessionId = file.replace('.db', '')
    const dbPath = path.join(dbDir, file)

    try {
      const db = new Database(dbPath)
      db.pragma('journal_mode = WAL')

      const meta = db.prepare('SELECT * FROM meta LIMIT 1').get() as DbMeta | undefined

      if (meta) {
        const messageCount = (
          db
            .prepare(
              `SELECT COUNT(*) as count
             FROM message msg
             JOIN member m ON msg.sender_id = m.id
             WHERE m.name != '系统消息'`
            )
            .get() as { count: number }
        ).count
        const memberCount = (
          db
            .prepare(
              `SELECT COUNT(*) as count
             FROM member
             WHERE name != '系统消息'`
            )
            .get() as { count: number }
        ).count

        sessions.push({
          id: sessionId,
          name: meta.name,
          platform: meta.platform,
          type: meta.type,
          importedAt: meta.imported_at,
          messageCount,
          memberCount,
          dbPath,
        })
      }

      db.close()
    } catch (error) {
      console.error(`[Worker] Failed to read database ${file}:`, error)
    }
  }

  return sessions.sort((a, b) => b.importedAt - a.importedAt)
}

/**
 * 获取单个会话信息
 */
export function getSession(sessionId: string): any | null {
  const db = openDatabase(sessionId)
  if (!db) return null

  const meta = db.prepare('SELECT * FROM meta LIMIT 1').get() as DbMeta | undefined
  if (!meta) return null

  const messageCount = (
    db
      .prepare(
        `SELECT COUNT(*) as count
         FROM message msg
         JOIN member m ON msg.sender_id = m.id
         WHERE m.name != '系统消息'`
      )
      .get() as { count: number }
  ).count

  const memberCount = (
    db
      .prepare(
        `SELECT COUNT(*) as count
         FROM member
         WHERE name != '系统消息'`
      )
      .get() as { count: number }
  ).count

  return {
    id: sessionId,
    name: meta.name,
    platform: meta.platform,
    type: meta.type,
    importedAt: meta.imported_at,
    messageCount,
    memberCount,
    dbPath: getDbPath(sessionId),
  }
}

