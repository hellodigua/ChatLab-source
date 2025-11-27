/**
 * QQ Chat Exporter V4 JSON 格式解析器
 * 支持 https://github.com/shuakami/qq-chat-exporter 导出的 JSON 格式
 */

import type { ChatParser, ParseError } from './types'
import {
  ChatPlatform,
  ChatType,
  MessageType,
  type ParseResult,
  type ParsedMember,
  type ParsedMessage,
} from '../../../src/types/chat'

/**
 * QQ JSON 导出格式的消息结构
 */
interface QQJsonMessage {
  id: string
  seq?: string
  timestamp: number
  time?: string
  sender: {
    uid?: string
    uin: string
    name: string
  }
  type: string
  content: {
    text: string
    html?: string
    elements?: Array<{
      type: string
      data: Record<string, unknown>
    }>
    resources?: Array<{
      type: string
      filename?: string
      size?: number
      url?: string
    }>
  }
  recalled?: boolean
  system?: boolean
}

/**
 * QQ JSON 导出格式的根结构
 */
interface QQJsonExport {
  metadata?: {
    name?: string
    version?: string
  }
  chatInfo: {
    name: string
    type: 'private' | 'group'
  }
  statistics?: {
    totalMessages?: number
    senders?: Array<{
      uid?: string
      name: string
      messageCount: number
    }>
  }
  messages: QQJsonMessage[]
}

/**
 * 将 QQ 消息类型转换为统一类型
 */
function convertMessageType(qqType: string, content: QQJsonMessage['content']): MessageType {
  // 检查是否有资源（图片等）
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

  // 检查 elements 中是否有特殊类型
  if (content.elements) {
    for (const elem of content.elements) {
      if (elem.type === 'market_face' || elem.type === 'face') {
        return MessageType.EMOJI
      }
    }
  }

  // 根据 QQ 原始类型判断
  switch (qqType) {
    case 'type_1':
      return MessageType.TEXT
    case 'type_17': // 表情包
      return MessageType.EMOJI
    case 'type_3': // 图片
      return MessageType.IMAGE
    case 'type_7': // 语音
      return MessageType.VOICE
    default:
      return MessageType.TEXT
  }
}

/**
 * QQ JSON 格式解析器
 */
export const qqJsonParser: ChatParser = {
  name: 'QQ Chat Exporter JSON',
  platform: 'qq',

  detect(content: string, filename: string): boolean {
    // 检查文件扩展名
    if (!filename.toLowerCase().endsWith('.json')) {
      return false
    }

    try {
      const data = JSON.parse(content)
      // 检查是否有 QQ Chat Exporter 的特征
      return (
        data.chatInfo &&
        typeof data.chatInfo.name === 'string' &&
        Array.isArray(data.messages) &&
        (data.metadata?.name?.includes('QQChatExporter') ||
          // 兼容没有 metadata 的情况，检查消息结构
          (data.messages.length > 0 && data.messages[0].sender?.uin !== undefined))
      )
    } catch {
      return false
    }
  },

  parse(content: string, _filename: string): ParseResult {
    let data: QQJsonExport
    try {
      data = JSON.parse(content)
    } catch (e) {
      throw new Error(`JSON 解析失败: ${e}`) as ParseError
    }

    if (!data.chatInfo || !Array.isArray(data.messages)) {
      throw new Error('无效的 QQ JSON 格式：缺少 chatInfo 或 messages') as ParseError
    }

    // 解析元信息
    const meta = {
      name: data.chatInfo.name,
      platform: ChatPlatform.QQ,
      type: data.chatInfo.type === 'group' ? ChatType.GROUP : ChatType.PRIVATE,
    }

    // 收集成员信息（使用 Map 去重，保留最新昵称）
    const memberMap = new Map<string, ParsedMember>()

    // 解析消息
    const messages: ParsedMessage[] = []

    for (const msg of data.messages) {
      const platformId = msg.sender.uin

      // 更新成员信息（保留最新昵称）
      memberMap.set(platformId, {
        platformId,
        name: msg.sender.name || platformId,
      })

      // 转换时间戳（QQ 导出是毫秒，需要转为秒）
      const timestamp = Math.floor(msg.timestamp / 1000)

      // 过滤掉不合理的年份（2000年以前）
      if (new Date(msg.timestamp).getFullYear() < 2000) {
        continue
      }

      // 确定消息类型
      const type = msg.system ? MessageType.SYSTEM : convertMessageType(msg.type, msg.content)

      // 提取文本内容
      let textContent = msg.content.text || ''

      // 如果是撤回的消息，添加标记
      if (msg.recalled) {
        textContent = '[已撤回] ' + textContent
      }

      messages.push({
        senderPlatformId: platformId,
        senderName: msg.sender.name || platformId,
        timestamp,
        type,
        content: textContent || null,
      })
    }

    return {
      meta,
      members: Array.from(memberMap.values()),
      messages,
    }
  },
}
