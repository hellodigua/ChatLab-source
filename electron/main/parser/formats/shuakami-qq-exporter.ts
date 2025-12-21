/**
 * shuakami/qq-chat-exporter 格式解析器
 * 适配项目: https://github.com/shuakami/qq-chat-exporter
 * 版本: 通用（支持 V4.x 及后续版本）
 *
 * 文件结构：
 * - metadata: 元数据
 * - chatInfo: 聊天信息（包含群头像 avatar）
 * - statistics: 统计信息
 * - messages: 消息数组
 * - avatars: 用户头像（在 messages 之后）
 *
 * 名字字段说明：
 * - sendNickName: QQ原始昵称（始终存在）
 * - sendMemberName: 群昵称（可选）
 *
 * 显示名优先级: sendMemberName > sendNickName
 */

import * as fs from 'fs'
import * as path from 'path'
import { parser } from 'stream-json'
import { pick } from 'stream-json/filters/Pick'
import { streamValues } from 'stream-json/streamers/StreamValues'
import { chain } from 'stream-chain'
import { KNOWN_PLATFORMS, ChatType, MessageType } from '../../../../src/types/base'
import type {
  FormatFeature,
  FormatModule,
  Parser,
  ParseOptions,
  ParseEvent,
  ParsedMeta,
  ParsedMember,
  ParsedMessage,
} from '../types'
import { getFileSize, createProgress, readFileHeadBytes, parseTimestamp, isValidYear } from '../utils'

// ==================== 特征定义 ====================

export const feature: FormatFeature = {
  id: 'shuakami-qq-exporter',
  name: 'shuakami/qq-chat-exporter',
  platform: KNOWN_PLATFORMS.QQ,
  priority: 10,
  extensions: ['.json'],
  signatures: {
    head: [/QQChatExporter(?:\s+V\d+)?/, /"version"\s*:\s*"\d+\./],
    requiredFields: ['metadata', 'chatInfo'],
  },
}

// ==================== 类型定义 ====================

interface V4RawMessage {
  senderUin?: string
  senderUid?: string
  sendNickName?: string
  sendMemberName?: string
}

interface V4Message {
  timestamp: string
  sender: {
    uid?: string
    uin?: string
    name: string
  }
  messageType?: number
  isSystemMessage?: boolean
  isRecalled?: boolean
  content: {
    text: string
    resources?: Array<{ type: string }>
    emojis?: Array<{ type: string }>
  }
  rawMessage?: V4RawMessage
}

interface MemberInfo {
  platformId: string
  accountName: string
  groupNickname: string | undefined
  avatar: string | undefined
}

interface ChatInfo {
  name: string
  type: string
  avatar?: string
}

// ==================== 辅助函数 ====================

/**
 * 从字符串中提取 JSON 对象（处理嵌套和转义）
 */
function extractJsonObject(content: string, key: string): string | null {
  const searchStr = `"${key}":`
  const startIdx = content.indexOf(searchStr)
  if (startIdx === -1) return null

  let i = startIdx + searchStr.length
  while (i < content.length && /\s/.test(content[i])) i++

  if (content[i] !== '{') return null

  let braceDepth = 0
  let inString = false
  let escape = false
  const objStart = i

  for (; i < content.length; i++) {
    const char = content[i]

    if (escape) {
      escape = false
      continue
    }

    if (char === '\\' && inString) {
      escape = true
      continue
    }

    if (char === '"') {
      inString = !inString
      continue
    }

    if (!inString) {
      if (char === '{') braceDepth++
      if (char === '}') {
        braceDepth--
        if (braceDepth === 0) {
          return content.slice(objStart, i + 1)
        }
      }
    }
  }

  return null
}

/**
 * 从文件名提取名称
 */
function extractNameFromFilePath(filePath: string): string {
  const basename = path.basename(filePath)
  return basename.replace(/\.json$/i, '') || '未知群聊'
}

/**
 * 计算 senders 数量以判断聊天类型
 */
function countSenders(content: string): number {
  const sendersStart = content.indexOf('"senders"')
  if (sendersStart === -1) return 0

  const arrayStart = content.indexOf('[', sendersStart)
  if (arrayStart === -1 || arrayStart - sendersStart > 20) return 0

  // 找到匹配的 ]
  let depth = 1
  let i = arrayStart + 1
  while (i < content.length && depth > 0) {
    if (content[i] === '[') depth++
    else if (content[i] === ']') depth--
    i++
  }

  if (depth !== 0) return 0

  const sendersContent = content.slice(arrayStart + 1, i - 1)
  const uidMatches = sendersContent.match(/"uid"\s*:/g)
  return uidMatches ? uidMatches.length : 0
}

// ==================== 消息类型转换 ====================

function convertMessageType(
  messageType: number | undefined,
  content: V4Message['content'],
  isRecalled?: boolean
): MessageType {
  if (isRecalled) return MessageType.RECALL

  // 检查资源类型
  if (content.resources?.length) {
    const resourceType = content.resources[0].type
    switch (resourceType) {
      case 'image':
        return MessageType.IMAGE
      case 'video':
        return MessageType.VIDEO
      case 'voice':
      case 'audio':
        return MessageType.VOICE
      case 'file':
        return MessageType.FILE
      case 'location':
        return MessageType.LOCATION
    }
  }

  if (content.emojis?.length) return MessageType.EMOJI

  // 根据文本内容判断
  const text = content.text?.trim() || ''
  if (text.includes('QQ红包') || text.includes('发出了红包') || text === '[红包]') return MessageType.RED_PACKET
  if (text.includes('转账') || text === '[转账]') return MessageType.TRANSFER
  if (text.includes('拍了拍') || text.includes('戳了戳') || text === '[拍一拍]') return MessageType.POKE
  if (text.includes('语音通话') || text.includes('视频通话') || text.includes('通话时长')) return MessageType.CALL
  if (text === '[分享]' || text === '[音乐]' || text === '[小程序]') return MessageType.SHARE
  if (text === '[链接]' || text === '[卡片消息]') return MessageType.LINK
  if (text === '[位置]' || text === '[地理位置]') return MessageType.LOCATION
  if (text === '[转发]' || text === '[聊天记录]') return MessageType.FORWARD

  // 根据 messageType 判断
  if (messageType === 3) return MessageType.IMAGE
  if (messageType === 7) return MessageType.VIDEO
  if (messageType === 9) return MessageType.REPLY

  return MessageType.TEXT
}

// ==================== 解析器实现 ====================

async function* parseV4(options: ParseOptions): AsyncGenerator<ParseEvent, void, unknown> {
  const { filePath, batchSize = 5000, onProgress } = options

  const totalBytes = getFileSize(filePath)
  let bytesRead = 0
  let messagesProcessed = 0

  // 发送初始进度
  const initialProgress = createProgress('parsing', 0, totalBytes, 0, '开始解析...')
  yield { type: 'progress', data: initialProgress }
  onProgress?.(initialProgress)

  // 读取文件头获取 meta 信息（增加到 500KB 以包含 chatInfo.avatar）
  const headContent = readFileHeadBytes(filePath, 500000)

  // 解析 chatInfo（包含群头像）
  let chatInfo: ChatInfo = { name: '未知群聊', type: 'group' }
  try {
    const chatInfoStr = extractJsonObject(headContent, 'chatInfo')
    if (chatInfoStr) {
      chatInfo = JSON.parse(chatInfoStr)
    }
  } catch {
    // 使用默认值
  }

  // 根据 senders 数量判断聊天类型
  const sendersCount = countSenders(headContent)
  const chatType = sendersCount > 2 ? ChatType.GROUP : sendersCount > 0 ? ChatType.PRIVATE : ChatType.GROUP

  // 发送 meta（包含群头像）
  const meta: ParsedMeta = {
    name: chatInfo.name || extractNameFromFilePath(filePath),
    platform: KNOWN_PLATFORMS.QQ,
    type: chatType,
    groupAvatar: chatInfo.avatar, // 从 chatInfo.avatar 提取群头像
  }
  yield { type: 'meta', data: meta }

  // 收集成员和消息
  const memberMap = new Map<string, MemberInfo>()
  const messageBatch: ParsedMessage[] = []

  // 流式解析消息
  await new Promise<void>((resolve, reject) => {
    const readStream = fs.createReadStream(filePath, { encoding: 'utf-8' })

    readStream.on('data', (chunk: string | Buffer) => {
      bytesRead += typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length
    })

    const pipeline = chain([readStream, parser(), pick({ filter: /^messages\.\d+$/ }), streamValues()])

    pipeline.on('data', ({ value }: { value: V4Message }) => {
      // 获取 platformId
      const platformId =
        value.sender.uin || value.sender.uid || value.rawMessage?.senderUin || value.rawMessage?.senderUid
      if (!platformId) return

      // 获取名字信息
      const raw = value.rawMessage
      const accountName = raw?.sendNickName || value.sender.name || platformId
      const groupNickname = raw?.sendMemberName || undefined

      // 更新成员信息
      const existingMember = memberMap.get(platformId)
      if (!existingMember) {
        memberMap.set(platformId, { platformId, accountName, groupNickname, avatar: undefined })
      } else {
        existingMember.accountName = accountName
        if (groupNickname) existingMember.groupNickname = groupNickname
      }

      // 解析时间戳
      const timestamp = parseTimestamp(value.timestamp)
      if (timestamp === null || !isValidYear(timestamp)) return

      // 消息类型
      const type = value.isSystemMessage
        ? MessageType.SYSTEM
        : convertMessageType(value.messageType, value.content, value.isRecalled)

      // 文本内容
      let textContent = value.content?.text || ''
      if (value.isRecalled) textContent = '[已撤回] ' + textContent

      messageBatch.push({
        senderPlatformId: platformId,
        senderAccountName: accountName,
        senderGroupNickname: groupNickname,
        timestamp,
        type,
        content: textContent || null,
      })

      messagesProcessed++
      if (messagesProcessed % batchSize === 0) {
        const progress = createProgress(
          'parsing',
          bytesRead,
          totalBytes,
          messagesProcessed,
          `已处理 ${messagesProcessed} 条消息...`
        )
        onProgress?.(progress)
      }
    })

    pipeline.on('end', resolve)
    pipeline.on('error', reject)
  })

  // 消息解析完成后，读取文件末尾的 avatars 对象
  const avatarsMap = new Map<string, string>()
  try {
    // 读取文件末尾（avatars 通常在最后）
    const stats = fs.statSync(filePath)
    const tailSize = Math.min(stats.size, 5000000) // 最多读取 5MB
    const fd = fs.openSync(filePath, 'r')
    const buffer = Buffer.alloc(tailSize)
    fs.readSync(fd, buffer, 0, tailSize, stats.size - tailSize)
    fs.closeSync(fd)

    const tailContent = buffer.toString('utf-8')
    const avatarsStr = extractJsonObject(tailContent, 'avatars')
    if (avatarsStr) {
      const avatarsObj = JSON.parse(avatarsStr) as Record<string, string>
      for (const [uin, avatar] of Object.entries(avatarsObj)) {
        if (avatar && typeof avatar === 'string' && avatar.startsWith('data:image/')) {
          avatarsMap.set(uin, avatar)
        }
      }
    }
  } catch {
    // avatars 解析失败，继续不带头像
  }

  // 将头像关联到成员
  for (const member of memberMap.values()) {
    const avatar = avatarsMap.get(member.platformId)
    if (avatar) member.avatar = avatar
  }

  // 发送成员
  const members: ParsedMember[] = Array.from(memberMap.values()).map((m) => ({
    platformId: m.platformId,
    accountName: m.accountName,
    groupNickname: m.groupNickname,
    avatar: m.avatar,
  }))
  yield { type: 'members', data: members }

  // 分批发送消息
  for (let i = 0; i < messageBatch.length; i += batchSize) {
    const batch = messageBatch.slice(i, i + batchSize)
    yield { type: 'messages', data: batch }
  }

  // 完成
  const doneProgress = createProgress('done', totalBytes, totalBytes, messagesProcessed, '解析完成')
  yield { type: 'progress', data: doneProgress }
  onProgress?.(doneProgress)

  yield {
    type: 'done',
    data: { messageCount: messagesProcessed, memberCount: memberMap.size },
  }
}

// ==================== 导出 ====================

export const parser_: Parser = {
  feature,
  parse: parseV4,
}

import { qqPreprocessor } from './shuakami-qq-preprocessor'
export const preprocessor = qqPreprocessor

const module_: FormatModule = {
  feature,
  parser: parser_,
  preprocessor: qqPreprocessor,
}

export default module_
