/**
 * Parser V2 - 模块入口
 * 三层架构：标准层、嗅探层、解析层
 */

import { FormatSniffer, createSniffer } from './sniffer'
import { formats } from './formats'
import type {
  ParseOptions,
  ParseEvent,
  ParseResult,
  ParseProgress,
  FormatFeature,
  Parser,
  ParsedMeta,
  ParsedMember,
  ParsedMessage,
} from './types'

// ==================== 全局嗅探器实例 ====================

const sniffer = createSniffer()
sniffer.registerAll(formats)

// ==================== 公共 API ====================

/**
 * 检测文件格式
 * @param filePath 文件路径
 * @returns 格式特征，如果无法识别则返回 null
 */
export function detectFormat(filePath: string): FormatFeature | null {
  return sniffer.sniff(filePath)
}

/**
 * 获取文件对应的解析器
 * @param filePath 文件路径
 * @returns 解析器实例，如果无法识别则返回 null
 */
export function getParser(filePath: string): Parser | null {
  return sniffer.getParser(filePath)
}

/**
 * 获取所有支持的格式
 */
export function getSupportedFormats(): FormatFeature[] {
  return sniffer.getSupportedFormats()
}

/**
 * 获取格式的预处理器（如果有）
 */
export function getPreprocessor(filePath: string) {
  const feature = sniffer.sniff(filePath)
  if (!feature) return null

  const module = formats.find((m) => m.feature.id === feature.id)
  return module?.preprocessor || null
}

/**
 * 检查文件是否需要预处理
 */
export function needsPreprocess(filePath: string): boolean {
  const preprocessor = getPreprocessor(filePath)
  if (!preprocessor) return false

  const fileSize = getFileSize(filePath)
  return preprocessor.needsPreprocess(filePath, fileSize)
}

/**
 * 流式解析文件
 * @param options 解析选项
 * @yields 解析事件流
 */
export async function* parseFile(options: ParseOptions): AsyncGenerator<ParseEvent, void, unknown> {
  const parser = sniffer.getParser(options.filePath)
  if (!parser) {
    yield { type: 'error', data: new Error(`无法识别文件格式: ${options.filePath}`) }
    return
  }

  console.log(`[Parser V2] 使用解析器: ${parser.feature.name}`)
  yield* parser.parse(options)
}

/**
 * 同步解析文件（收集所有事件为完整结果）
 * 适用于不需要流式处理的场景（如合并工具）
 * @param filePath 文件路径
 * @param onProgress 进度回调（可选）
 */
export async function parseFileSync(
  filePath: string,
  onProgress?: (progress: ParseProgress) => void
): Promise<ParseResult> {
  let meta: ParsedMeta | null = null
  const members: ParsedMember[] = []
  const messages: ParsedMessage[] = []

  for await (const event of parseFile({ filePath, onProgress })) {
    switch (event.type) {
      case 'meta':
        meta = event.data
        break
      case 'members':
        members.push(...event.data)
        break
      case 'messages':
        messages.push(...event.data)
        break
      case 'progress':
        onProgress?.(event.data)
        break
      case 'error':
        throw event.data
    }
  }

  if (!meta) {
    throw new Error('解析失败：未获取到元信息')
  }

  return { meta, members, messages }
}

/**
 * 解析文件获取基本信息（只统计，不返回完整消息）
 * 用于预览和合并工具
 */
export async function parseFileInfo(
  filePath: string,
  onProgress?: (progress: ParseProgress) => void
): Promise<{
  name: string
  format: string
  platform: string
  messageCount: number
  memberCount: number
  fileSize: number
}> {
  const feature = sniffer.sniff(filePath)
  if (!feature) {
    throw new Error(`无法识别文件格式: ${filePath}`)
  }

  let name = '未知群聊'
  let platform = feature.platform
  let messageCount = 0
  let memberCount = 0

  for await (const event of parseFile({ filePath, onProgress })) {
    switch (event.type) {
      case 'meta':
        name = event.data.name
        platform = event.data.platform
        break
      case 'members':
        memberCount += event.data.length
        break
      case 'messages':
        messageCount += event.data.length
        break
      case 'progress':
        onProgress?.(event.data)
        break
      case 'error':
        throw event.data
    }
  }

  // 获取文件大小
  const fs = await import('fs')
  const fileSize = fs.statSync(filePath).size

  return {
    name,
    format: feature.name,
    platform,
    messageCount,
    memberCount,
    fileSize,
  }
}

// ==================== 导出类型 ====================

export type {
  ParseOptions,
  ParseEvent,
  ParseResult,
  ParseProgress,
  FormatFeature,
  Parser,
  ParsedMeta,
  ParsedMember,
  ParsedMessage,
}

// ==================== 导出嗅探器（高级用法） ====================

export { FormatSniffer, createSniffer }

// ==================== 导出工具函数 ====================

export { getFileSize, formatFileSize, parseTimestamp, isValidYear, createProgress, readFileHeadBytes } from './utils'

// ==================== 回调模式 API ====================

/**
 * 回调模式的解析选项
 */
export interface StreamParseCallbacks {
  onProgress: (progress: ParseProgress) => void
  onMeta: (meta: ParsedMeta) => void
  onMembers: (members: ParsedMember[]) => void
  onMessageBatch: (messages: ParsedMessage[]) => void
}

export interface StreamParseOptions extends StreamParseCallbacks {
  filePath: string
  batchSize?: number
}

/**
 * 回调模式的流式解析
 * 内部使用 AsyncGenerator，对外提供回调接口
 */
export async function streamParseFile(
  filePath: string,
  callbacks: Omit<StreamParseOptions, 'filePath'>
): Promise<void> {
  const { onProgress, onMeta, onMembers, onMessageBatch, batchSize = 5000 } = callbacks

  for await (const event of parseFile({ filePath, batchSize, onProgress })) {
    switch (event.type) {
      case 'meta':
        onMeta(event.data)
        break
      case 'members':
        onMembers(event.data)
        break
      case 'messages':
        onMessageBatch(event.data)
        break
      case 'progress':
        onProgress(event.data)
        break
      case 'error':
        throw event.data
    }
  }
}
