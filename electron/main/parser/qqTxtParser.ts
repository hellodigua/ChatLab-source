/**
 * QQ 原生导出 TXT 格式解析器
 * 支持 QQ 客户端导出的文本格式聊天记录
 */

import type { ChatParser } from './types'
import {
  ChatPlatform,
  ChatType,
  MessageType,
  type ParseResult,
  type ParsedMember,
  type ParsedMessage,
} from '../../../src/types/chat'

/**
 * 消息行正则表达式
 * 格式: 2017-02-25 10:40:20 昵称(QQ号)
 * 或: 2017-02-25 10:40:20 (QQ号)
 * 或: 2017-02-25 10:40:20 【管理员】昵称(QQ号)
 * 或: 2017-02-25 10:40:20 昵称<邮箱>
 */
const MESSAGE_HEADER_REGEX =
  /^(\d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{2}:\d{2})\s+(?:【[^】]+】)?(.+?)(?:\((\d+)\)|<([^>]+)>)\s*$/

/**
 * 群名提取正则
 * 格式: 消息对象:群名
 */
const GROUP_NAME_REGEX = /^消息对象[:：](.+)$/

/**
 * 检测消息类型
 */
function detectMessageType(content: string): MessageType {
  const trimmed = content.trim()

  // 图片
  if (trimmed === '[图片]' || trimmed.startsWith('[图片]')) {
    return MessageType.IMAGE
  }

  // 表情
  if (/^\[.+\]$/.test(trimmed) || /^\[\[.+\]\]$/.test(trimmed)) {
    return MessageType.EMOJI
  }

  // 语音
  if (trimmed === '[语音]' || trimmed.startsWith('[语音]')) {
    return MessageType.VOICE
  }

  // 视频
  if (trimmed === '[视频]' || trimmed.startsWith('[视频]')) {
    return MessageType.VIDEO
  }

  // 文件
  if (trimmed === '[文件]' || trimmed.startsWith('[文件]')) {
    return MessageType.FILE
  }

  // 系统消息
  if (
    trimmed.includes('加入了群聊') ||
    trimmed.includes('退出了群聊') ||
    trimmed.includes('撤回了一条消息') ||
    trimmed.includes('被管理员') ||
    trimmed.includes('成为管理员')
  ) {
    return MessageType.SYSTEM
  }

  return MessageType.TEXT
}

/**
 * 解析日期时间字符串为时间戳（秒）
 */
function parseDateTime(dateTimeStr: string): number {
  // 格式: 2017-02-25 10:40:20
  const [datePart, timePart] = dateTimeStr.split(/\s+/)
  const [year, month, day] = datePart.split('-').map(Number)
  const [hour, minute, second] = timePart.split(':').map(Number)

  const date = new Date(year, month - 1, day, hour, minute, second)
  return Math.floor(date.getTime() / 1000)
}

/**
 * QQ TXT 格式解析器
 */
export const qqTxtParser: ChatParser = {
  name: 'QQ Native TXT Export',
  platform: 'qq',

  detect(content: string, filename: string): boolean {
    // 检查文件扩展名
    if (!filename.toLowerCase().endsWith('.txt')) {
      return false
    }

    // 检查文件头特征
    const lines = content.split('\n').slice(0, 20)
    const hasHeader = lines.some(
      (line) =>
        line.includes('消息记录') ||
        line.includes('消息分组') ||
        line.includes('消息对象') ||
        line.includes('================================================================')
    )

    // 检查是否有符合格式的消息行
    const hasMessagePattern = lines.some((line) => MESSAGE_HEADER_REGEX.test(line.trim()))

    return hasHeader || hasMessagePattern
  },

  parse(content: string, _filename: string): ParseResult {
    const lines = content.split('\n')

    // 提取群名
    let groupName = '未知对话'
    for (const line of lines.slice(0, 20)) {
      const match = line.trim().match(GROUP_NAME_REGEX)
      if (match) {
        groupName = match[1].trim()
        break
      }
    }

    // 收集成员信息
    const memberMap = new Map<string, ParsedMember>()

    // 解析消息
    const messages: ParsedMessage[] = []

    let currentSender: { platformId: string; name: string } | null = null
    let currentTimestamp: number = 0
    let currentContent: string[] = []

    // 处理当前累积的消息
    const flushMessage = (): void => {
      if (currentSender && currentContent.length > 0) {
        const content = currentContent.join('\n').trim()
        if (content) {
          messages.push({
            senderPlatformId: currentSender.platformId,
            senderName: currentSender.name,
            timestamp: currentTimestamp,
            type: detectMessageType(content),
            content,
          })
        }
      }
      currentContent = []
    }

    for (const line of lines) {
      const trimmedLine = line.trim()

      // 跳过空行和分隔线
      if (!trimmedLine || trimmedLine.startsWith('===') || trimmedLine.startsWith('消息')) {
        continue
      }

      // 尝试匹配消息头
      const headerMatch = trimmedLine.match(MESSAGE_HEADER_REGEX)

      if (headerMatch) {
        // 先保存之前的消息
        flushMessage()

        const dateTimeStr = headerMatch[1]
        const nameOrEmpty = headerMatch[2].trim()
        const qqNumber = headerMatch[3] || headerMatch[4] // QQ号或邮箱

        // 处理只有QQ号没有昵称的情况
        const name = nameOrEmpty || qqNumber

        // 更新成员信息（保留最新昵称）
        memberMap.set(qqNumber, {
          platformId: qqNumber,
          name,
        })

        const timestamp = parseDateTime(dateTimeStr)

        // 过滤掉不合理的年份（2000年以前）
        if (new Date(timestamp * 1000).getFullYear() < 2000) {
          // 如果时间戳无效，标记为 null，后续不添加
          currentSender = null
          currentTimestamp = 0
        } else {
          currentSender = { platformId: qqNumber, name }
          currentTimestamp = timestamp
        }
      } else {
        // 这是消息内容行
        currentContent.push(trimmedLine)
      }
    }

    // 处理最后一条消息
    flushMessage()

    return {
      meta: {
        name: groupName,
        platform: ChatPlatform.QQ,
        type: ChatType.GROUP, // TXT 导出通常是群聊
      },
      members: Array.from(memberMap.values()),
      messages,
    }
  },
}
