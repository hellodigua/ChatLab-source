/**
 * ChatLab JSON 格式
 * ChatLab 专属的统一格式（.chatlab.json）
 *
 * 特征：
 * - 文件头包含 "chatlab" 字段
 * - 有 version 版本号
 * - 消息结构已经是标准化的
 */

import * as fs from 'fs'
import { parser } from 'stream-json'
import { pick } from 'stream-json/filters/Pick'
import { streamValues } from 'stream-json/streamers/StreamValues'
import { chain } from 'stream-chain'
import { ChatPlatform, ChatType } from '../../../../src/types/chat'
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
import { getFileSize, createProgress, readFileHeadBytes } from '../utils'

// ==================== 特征定义 ====================

export const feature: FormatFeature = {
  id: 'chatlab',
  name: 'ChatLab JSON',
  platform: ChatPlatform.UNKNOWN, // ChatLab 格式可能包含多平台数据
  priority: 1, // 最高优先级
  extensions: ['.json', '.chatlab.json'],
  signatures: {
    head: [/"chatlab"\s*:\s*\{/, /"version"\s*:\s*"/],
    requiredFields: ['chatlab', 'meta', 'messages'],
  },
}

// ==================== 消息结构 ====================

interface ChatLabMessage {
  sender: string // platformId
  name: string // 发送时昵称
  timestamp: number // 秒级时间戳
  type: number // MessageType
  content: string | null
}

interface ChatLabMember {
  platformId: string
  name: string
  aliases?: string[]
}

// ==================== 解析器实现 ====================

async function* parseChatLab(options: ParseOptions): AsyncGenerator<ParseEvent, void, unknown> {
  const { filePath, batchSize = 5000, onProgress } = options

  const totalBytes = getFileSize(filePath)
  let bytesRead = 0
  let messagesProcessed = 0

  // 发送初始进度
  const initialProgress = createProgress('parsing', 0, totalBytes, 0, '开始解析...')
  yield { type: 'progress', data: initialProgress }
  onProgress?.(initialProgress)

  // 读取文件头获取 meta 和 members 信息
  const headContent = readFileHeadBytes(filePath, 200000)

  // 解析 meta
  let meta: ParsedMeta = {
    name: '未知群聊',
    platform: ChatPlatform.UNKNOWN,
    type: ChatType.GROUP,
  }
  try {
    const metaMatch = headContent.match(/"meta"\s*:\s*(\{[^}]+\})/)
    if (metaMatch) {
      const metaObj = JSON.parse(metaMatch[1])
      meta = {
        name: metaObj.name || '未知群聊',
        platform: (metaObj.platform as ChatPlatform) || ChatPlatform.UNKNOWN,
        type: (metaObj.type as ChatType) || ChatType.GROUP,
      }
    }
  } catch {
    // 使用默认值
  }
  yield { type: 'meta', data: meta }

  // 解析 members（如果在文件开头能找到）
  const members: ParsedMember[] = []
  try {
    const membersMatch = headContent.match(/"members"\s*:\s*\[([\s\S]*?)\]/)
    if (membersMatch) {
      const membersJson = JSON.parse(`[${membersMatch[1]}]`) as ChatLabMember[]
      for (const m of membersJson) {
        members.push({
          platformId: m.platformId,
          name: m.name,
        })
      }
    }
  } catch {
    // members 可能太大，稍后从消息中收集
  }

  // 收集成员和消息
  const memberMapFromMessages = new Map<string, ParsedMember>()
  let messageBatch: ParsedMessage[] = []

  // 流式解析
  await new Promise<void>((resolve, reject) => {
    const readStream = fs.createReadStream(filePath, { encoding: 'utf-8' })

    readStream.on('data', (chunk: string | Buffer) => {
      bytesRead += typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length
    })

    const pipeline = chain([readStream, parser(), pick({ filter: /^messages\.\d+$/ }), streamValues()])

    // 用于收集批次的临时数组
    const batchCollector: ParsedMessage[] = []

    pipeline.on('data', ({ value }: { value: ChatLabMessage }) => {
      const msg = value

      // 如果前面没解析到 members，从消息中收集
      if (members.length === 0) {
        memberMapFromMessages.set(msg.sender, {
          platformId: msg.sender,
          name: msg.name,
        })
      }

      batchCollector.push({
        senderPlatformId: msg.sender,
        senderName: msg.name,
        timestamp: msg.timestamp,
        type: msg.type,
        content: msg.content,
      })

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
  if (members.length > 0) {
    yield { type: 'members', data: members }
  } else if (memberMapFromMessages.size > 0) {
    yield { type: 'members', data: Array.from(memberMapFromMessages.values()) }
  }

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
    data: {
      messageCount: messagesProcessed,
      memberCount: members.length > 0 ? members.length : memberMapFromMessages.size,
    },
  }
}

// ==================== 导出解析器 ====================

export const parser_: Parser = {
  feature,
  parse: parseChatLab,
}

// ==================== 导出格式模块 ====================

const module_: FormatModule = {
  feature,
  parser: parser_,
}

export default module_
