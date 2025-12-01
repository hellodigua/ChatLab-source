/**
 * 流式导入模块
 * 在 Worker 线程中流式解析文件并批量写入数据库
 */

import Database from 'better-sqlite3'
import * as fs from 'fs'
import * as path from 'path'
import { parentPort } from 'worker_threads'
import {
  streamParseFile,
  detectFormat,
  getPreprocessor,
  needsPreprocess,
  type ParseProgress,
  type ParsedMeta,
  type ParsedMember,
  type ParsedMessage,
  getFileSize,
} from '../parser'

/** 流式导入结果 */
export interface StreamImportResult {
  success: boolean
  sessionId?: string
  error?: string
}
import { getDbDir } from './dbCore'

/**
 * 发送进度到主进程
 */
function sendProgress(requestId: string, progress: ParseProgress): void {
  parentPort?.postMessage({
    id: requestId,
    type: 'progress',
    payload: progress,
  })
}

/**
 * 生成唯一的会话ID
 */
function generateSessionId(): string {
  const timestamp = Date.now()
  const random = Math.random().toString(36).substring(2, 8)
  return `chat_${timestamp}_${random}`
}

/**
 * 获取数据库文件路径
 */
function getDbPath(sessionId: string): string {
  return path.join(getDbDir(), `${sessionId}.db`)
}

/**
 * 创建数据库并初始化表结构
 */
function createDatabase(sessionId: string): Database.Database {
  const dbDir = getDbDir()
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true })
  }

  const dbPath = getDbPath(sessionId)
  const db = new Database(dbPath)

  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')

  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      name TEXT NOT NULL,
      platform TEXT NOT NULL,
      type TEXT NOT NULL,
      imported_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS member (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform_id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS member_name_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      start_ts INTEGER NOT NULL,
      end_ts INTEGER,
      FOREIGN KEY(member_id) REFERENCES member(id)
    );

    CREATE TABLE IF NOT EXISTS message (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_id INTEGER NOT NULL,
      ts INTEGER NOT NULL,
      type INTEGER NOT NULL,
      content TEXT,
      FOREIGN KEY(sender_id) REFERENCES member(id)
    );

    CREATE INDEX IF NOT EXISTS idx_message_ts ON message(ts);
    CREATE INDEX IF NOT EXISTS idx_message_sender ON message(sender_id);
    CREATE INDEX IF NOT EXISTS idx_member_name_history_member_id ON member_name_history(member_id);
  `)

  return db
}

/**
 * 流式导入聊天记录
 * @param filePath 文件路径
 * @param requestId 请求ID（用于进度回调）
 */
export async function streamImport(filePath: string, requestId: string): Promise<StreamImportResult> {
  // 检测格式
  const formatFeature = detectFormat(filePath)
  if (!formatFeature) {
    return { success: false, error: '无法识别文件格式' }
  }

  console.log(`[StreamImport] 开始导入: ${filePath}, 格式: ${formatFeature.name}`)

  // 预处理：如果格式需要且文件较大，先精简
  let actualFilePath = filePath
  let tempFilePath: string | null = null
  const preprocessor = getPreprocessor(filePath)

  if (preprocessor && needsPreprocess(filePath)) {
    console.log(`[StreamImport] 文件需要预处理，开始精简...`)
    sendProgress(requestId, {
      stage: 'parsing',
      bytesRead: 0,
      totalBytes: 0,
      messagesProcessed: 0,
      percentage: 0,
      message: '预处理：精简大文件中...',
    })

    try {
      tempFilePath = await preprocessor.preprocess(filePath, (progress) => {
        sendProgress(requestId, {
          ...progress,
          message: progress.message || '预处理中...',
        })
      })
      actualFilePath = tempFilePath
      console.log(`[StreamImport] 预处理完成: ${tempFilePath}`)
    } catch (err) {
      console.error(`[StreamImport] 预处理失败:`, err)
      return {
        success: false,
        error: `预处理失败: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  }

  const sessionId = generateSessionId()
  const db = createDatabase(sessionId)

  // 准备语句
  const insertMeta = db.prepare(`
    INSERT INTO meta (name, platform, type, imported_at) VALUES (?, ?, ?, ?)
  `)
  const insertMember = db.prepare(`
    INSERT OR IGNORE INTO member (platform_id, name) VALUES (?, ?)
  `)
  const getMemberId = db.prepare(`SELECT id FROM member WHERE platform_id = ?`)
  const insertMessage = db.prepare(`
    INSERT INTO message (sender_id, ts, type, content) VALUES (?, ?, ?, ?)
  `)
  const insertNameHistory = db.prepare(`
    INSERT INTO member_name_history (member_id, name, start_ts, end_ts) VALUES (?, ?, ?, ?)
  `)
  const updateMemberName = db.prepare(`UPDATE member SET name = ? WHERE platform_id = ?`)
  const updateNameHistoryEndTs = db.prepare(`
    UPDATE member_name_history SET end_ts = ? WHERE member_id = ? AND end_ts IS NULL
  `)

  // 成员ID映射（platformId -> dbId）
  const memberIdMap = new Map<string, number>()
  // 昵称追踪器
  const nicknameTracker = new Map<string, { currentName: string; lastSeenTs: number }>()
  // 是否已插入 meta
  let metaInserted = false

  // 开始事务（整个导入作为一个大事务，提高性能）
  db.exec('BEGIN TRANSACTION')

  try {
    await streamParseFile(actualFilePath, {
      batchSize: 5000,

      onProgress: (progress) => {
        // 转发进度到主进程
        sendProgress(requestId, progress)
      },

      onMeta: (meta: ParsedMeta) => {
        if (!metaInserted) {
          insertMeta.run(meta.name, meta.platform, meta.type, Math.floor(Date.now() / 1000))
          metaInserted = true
          console.log(`[StreamImport] Meta 已写入: ${meta.name}`)
        }
      },

      onMembers: (members: ParsedMember[]) => {
        console.log(`[StreamImport] 收到 ${members.length} 个成员`)
        for (const member of members) {
          insertMember.run(member.platformId, member.name)
          const row = getMemberId.get(member.platformId) as { id: number } | undefined
          if (row) {
            memberIdMap.set(member.platformId, row.id)
          }
        }
      },

      onMessageBatch: (messages: ParsedMessage[]) => {
        for (const msg of messages) {
          // 数据验证：跳过无效消息
          if (!msg.senderPlatformId || !msg.senderName) {
            console.warn('[StreamImport] 跳过无效消息：缺少发送者信息')
            continue
          }
          if (msg.timestamp === undefined || msg.timestamp === null || isNaN(msg.timestamp)) {
            console.warn('[StreamImport] 跳过无效消息：缺少时间戳')
            continue
          }
          if (msg.type === undefined || msg.type === null) {
            console.warn('[StreamImport] 跳过无效消息：缺少消息类型')
            continue
          }

          // 确保成员存在
          if (!memberIdMap.has(msg.senderPlatformId)) {
            const memberName = msg.senderName || msg.senderPlatformId
            insertMember.run(msg.senderPlatformId, memberName)
            const row = getMemberId.get(msg.senderPlatformId) as { id: number } | undefined
            if (row) {
              memberIdMap.set(msg.senderPlatformId, row.id)
            }
          }

          const senderId = memberIdMap.get(msg.senderPlatformId)
          if (senderId === undefined) continue

          // 插入消息
          insertMessage.run(senderId, msg.timestamp, msg.type, msg.content)

          // 追踪昵称变化
          const senderName = msg.senderName || msg.senderPlatformId
          const tracker = nicknameTracker.get(msg.senderPlatformId)
          if (!tracker) {
            nicknameTracker.set(msg.senderPlatformId, {
              currentName: senderName,
              lastSeenTs: msg.timestamp,
            })
            insertNameHistory.run(senderId, senderName, msg.timestamp, null)
          } else if (tracker.currentName !== senderName) {
            updateNameHistoryEndTs.run(msg.timestamp, senderId)
            insertNameHistory.run(senderId, senderName, msg.timestamp, null)
            tracker.currentName = senderName
            tracker.lastSeenTs = msg.timestamp
          } else {
            tracker.lastSeenTs = msg.timestamp
          }
        }
      },
    })

    // 更新成员的最新昵称
    for (const [platformId, tracker] of nicknameTracker.entries()) {
      updateMemberName.run(tracker.currentName, platformId)
    }

    // 提交事务
    db.exec('COMMIT')

    console.log(`[StreamImport] 导入完成: ${sessionId}`)
    return { success: true, sessionId }
  } catch (error) {
    // 回滚事务
    db.exec('ROLLBACK')

    // 删除失败的数据库文件
    const dbPath = getDbPath(sessionId)
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath)
    }

    console.error(`[StreamImport] 导入失败:`, error)
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  } finally {
    db.close()

    // 清理临时文件
    if (tempFilePath && preprocessor) {
      preprocessor.cleanup(tempFilePath)
      console.log(`[StreamImport] 已清理临时文件: ${tempFilePath}`)
    }
  }
}

/**
 * 流式解析文件获取基本信息（只统计，不写入数据库）
 * 用于合并功能的预览
 */
export async function streamParseFileInfo(
  filePath: string,
  requestId: string
): Promise<{
  name: string
  format: string
  platform: string
  messageCount: number
  memberCount: number
  fileSize: number
}> {
  const formatFeature = detectFormat(filePath)
  if (!formatFeature) {
    throw new Error('无法识别文件格式')
  }

  // 获取文件大小
  const fileSize = fs.statSync(filePath).size

  // 立即发送初始进度，让用户知道已开始处理
  sendProgress(requestId, {
    stage: 'parsing',
    bytesRead: 0,
    totalBytes: fileSize,
    messagesProcessed: 0,
    percentage: 0,
    message: '正在读取文件...',
  })

  let name = '未知群聊'
  let platform = formatFeature.platform
  let messageCount = 0
  const memberSet = new Set<string>()

  await streamParseFile(filePath, {
    // 对于大文件使用更小的批次，以更频繁地更新进度
    batchSize: fileSize > 100 * 1024 * 1024 ? 2000 : 5000,

    onProgress: (progress) => {
      sendProgress(requestId, progress)
    },

    onMeta: (meta) => {
      name = meta.name
      platform = meta.platform
    },

    onMembers: (members) => {
      for (const m of members) {
        memberSet.add(m.platformId)
      }
    },

    onMessageBatch: (messages) => {
      messageCount += messages.length
      for (const msg of messages) {
        memberSet.add(msg.senderPlatformId)
      }
    },
  })

  return {
    name,
    format: formatFeature.name,
    platform,
    messageCount,
    memberCount: memberSet.size,
    fileSize,
  }
}
