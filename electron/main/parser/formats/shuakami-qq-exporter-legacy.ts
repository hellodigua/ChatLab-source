/**
 * shuakami/qq-chat-exporter Legacy 格式解析器
 * 适配项目: https://github.com/shuakami/qq-chat-exporter
 * 版本: V1-V3（早期版本）
 *
 * 特征：
 * - 时间戳使用毫秒数
 * - 没有 metadata.version 或版本号小于 4
 * - sender 中主要使用 uin 字段
 *
 * 注意：此解析器仅适配 shuakami/qq-chat-exporter 项目导出的格式，
 * 其他 QQ 聊天记录导出工具可能需要创建独立的解析器。
 */

import * as fs from 'fs'
import { parser } from 'stream-json'
import { pick } from 'stream-json/filters/Pick'
import { streamValues } from 'stream-json/streamers/StreamValues'
import { chain } from 'stream-chain'
import { ChatPlatform, ChatType, MessageType } from '../../../../src/types/chat'
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
  id: 'shuakami-qq-exporter-legacy',
  name: 'shuakami/qq-chat-exporter (Legacy)',
  platform: ChatPlatform.QQ,
  priority: 20, // 低于 V4
  extensions: ['.json'],
  signatures: {
    head: [/QQChatExporter/, /"chatInfo"/],
    requiredFields: ['chatInfo', 'messages'],
  },
}

// ==================== 消息结构 ====================

interface LegacyMessage {
  id?: string
  timestamp: number // 毫秒时间戳
  sender: {
    uid?: string
    uin: string
    name: string
  }
  type?: string
  system?: boolean
  recalled?: boolean
  content: {
    text: string
    html?: string
    resources?: Array<{ type: string }>
    elements?: Array<{ type: string }>
  }
}

// ==================== 消息类型转换 ====================

function convertMessageType(qqType: string | undefined, content: LegacyMessage['content']): MessageType {
  // 检查资源类型
  if (content.resources && content.resources.length > 0) {
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
    }
  }

  // 检查元素类型
  if (content.elements) {
    for (const elem of content.elements) {
      if (elem.type === 'market_face' || elem.type === 'face') {
        return MessageType.EMOJI
      }
    }
  }

  // 根据 type 字符串判断
  switch (qqType) {
    case 'type_1':
      return MessageType.TEXT
    case 'type_17':
      return MessageType.EMOJI
    case 'type_3':
      return MessageType.IMAGE
    case 'type_7':
      return MessageType.VOICE
    default:
      return MessageType.TEXT
  }
}

// ==================== 解析器实现 ====================

async function* parseLegacy(options: ParseOptions): AsyncGenerator<ParseEvent, void, unknown> {
  const { filePath, batchSize = 5000, onProgress } = options

  const totalBytes = getFileSize(filePath)
  let bytesRead = 0
  let messagesProcessed = 0

  // 发送初始进度
  const initialProgress = createProgress('parsing', 0, totalBytes, 0, '开始解析...')
  yield { type: 'progress', data: initialProgress }
  onProgress?.(initialProgress)

  // 读取文件头获取 meta 信息
  const headContent = readFileHeadBytes(filePath, 100000)

  // 解析 chatInfo
  let chatInfo = { name: '未知群聊', type: 'group' as const }
  try {
    const chatInfoMatch = headContent.match(/"chatInfo"\s*:\s*(\{[^}]+\})/)
    if (chatInfoMatch) {
      chatInfo = JSON.parse(chatInfoMatch[1])
    }
  } catch {
    // 使用默认值
  }

  // 发送 meta
  const meta: ParsedMeta = {
    name: chatInfo.name,
    platform: ChatPlatform.QQ,
    type: chatInfo.type === 'group' ? ChatType.GROUP : ChatType.PRIVATE,
  }
  yield { type: 'meta', data: meta }

  // 收集成员和消息
  const memberMap = new Map<string, ParsedMember>()
  let messageBatch: ParsedMessage[] = []

  // 流式解析
  await new Promise<void>((resolve, reject) => {
    const readStream = fs.createReadStream(filePath, { encoding: 'utf-8' })

    readStream.on('data', (chunk: string | Buffer) => {
      bytesRead += typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length
    })

    const pipeline = chain([readStream, parser(), pick({ filter: /^messages\.\d+$/ }), streamValues()])

    const processMessage = (msg: LegacyMessage): ParsedMessage | null => {
      // 获取 platformId
      const platformId = msg.sender.uin || msg.sender.uid
      if (!platformId) return null

      // 获取发送者名称
      const senderName = msg.sender.name || platformId

      // 更新成员
      memberMap.set(platformId, { platformId, name: senderName })

      // 解析时间戳（毫秒）
      const timestamp = parseTimestamp(msg.timestamp)
      if (timestamp === null || !isValidYear(timestamp)) return null

      // 消息类型
      const type = msg.system ? MessageType.SYSTEM : convertMessageType(msg.type, msg.content)

      // 文本内容
      let textContent = msg.content?.text || ''
      if (msg.recalled) {
        textContent = '[已撤回] ' + textContent
      }

      return {
        senderPlatformId: platformId,
        senderName,
        timestamp,
        type,
        content: textContent || null,
      }
    }

    // 用于收集批次的临时数组
    const batchCollector: ParsedMessage[] = []

    pipeline.on('data', ({ value }: { value: LegacyMessage }) => {
      const parsed = processMessage(value)
      if (parsed) {
        batchCollector.push(parsed)
        messagesProcessed++

        // 达到批次大小
        if (batchCollector.length >= batchSize) {
          messageBatch.push(...batchCollector)
          batchCollector.length = 0

          const progress = createProgress(
            'parsing',
            bytesRead,
            totalBytes,
            messagesProcessed,
            `已处理 ${messagesProcessed} 条消息...`
          )
          onProgress?.(progress)
        }
      }
    })

    pipeline.on('end', () => {
      // 收集剩余消息
      if (batchCollector.length > 0) {
        messageBatch.push(...batchCollector)
      }
      resolve()
    })

    pipeline.on('error', reject)
  })

  // 发送成员
  yield { type: 'members', data: Array.from(memberMap.values()) }

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

// ==================== 导出解析器 ====================

export const parser_: Parser = {
  feature,
  parse: parseLegacy,
}

// ==================== 导出预处理器 ====================

import { qqPreprocessor } from './shuakami-qq-preprocessor'
export const preprocessor = qqPreprocessor

// ==================== 导出格式模块 ====================

const module_: FormatModule = {
  feature,
  parser: parser_,
  preprocessor: qqPreprocessor,
}

export default module_
