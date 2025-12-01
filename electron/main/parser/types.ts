/**
 * Parser V2 - 类型定义
 * 三层架构：标准层、嗅探层、解析层
 */

import type { ChatPlatform, ChatType, ParsedMember, ParsedMessage } from '../../../src/types/chat'

// ==================== 标准层：统一输出结构 ====================

/**
 * 解析的元信息
 */
export interface ParsedMeta {
  name: string
  platform: ChatPlatform
  type: ChatType
}

/**
 * 解析进度
 */
export interface ParseProgress {
  /** 阶段 */
  stage: 'detecting' | 'parsing' | 'done' | 'error'
  /** 已读取字节数 */
  bytesRead: number
  /** 文件总字节数 */
  totalBytes: number
  /** 已处理消息数 */
  messagesProcessed: number
  /** 百分比 0-100 */
  percentage: number
  /** 状态消息 */
  message: string
}

/**
 * 解析事件（AsyncGenerator 输出）
 */
export type ParseEvent =
  | { type: 'meta'; data: ParsedMeta }
  | { type: 'members'; data: ParsedMember[] }
  | { type: 'messages'; data: ParsedMessage[] }
  | { type: 'progress'; data: ParseProgress }
  | { type: 'done'; data: { messageCount: number; memberCount: number } }
  | { type: 'error'; data: Error }

/**
 * 完整解析结果（用于同步收集）
 */
export interface ParseResult {
  meta: ParsedMeta
  members: ParsedMember[]
  messages: ParsedMessage[]
}

// ==================== 嗅探层：特征定义 ====================

/**
 * 格式特征签名
 */
export interface FormatSignatures {
  /** 文件头正则匹配（任意一个匹配即可） */
  head?: RegExp[]
  /** 必须存在的 JSON 字段路径 */
  requiredFields?: string[]
  /** 字段值模式匹配 */
  fieldPatterns?: Record<string, RegExp>
}

/**
 * 格式特征定义
 */
export interface FormatFeature {
  /** 唯一标识符 */
  id: string
  /** 显示名称 */
  name: string
  /** 平台 */
  platform: ChatPlatform
  /** 优先级（数字越小越优先） */
  priority: number
  /** 支持的文件扩展名 */
  extensions: string[]
  /** 内容特征签名 */
  signatures: FormatSignatures
}

// ==================== 解析层：解析器接口 ====================

/**
 * 解析选项
 */
export interface ParseOptions {
  /** 文件路径 */
  filePath: string
  /** 每批消息数量（默认 5000） */
  batchSize?: number
  /** 进度回调（可选，用于外部监听） */
  onProgress?: (progress: ParseProgress) => void
}

/**
 * 解析器接口
 * 使用 AsyncGenerator 实现渐进式输出
 */
export interface Parser {
  /** 关联的格式特征 */
  readonly feature: FormatFeature

  /**
   * 解析文件
   * @param options 解析选项
   * @yields 解析事件流
   */
  parse(options: ParseOptions): AsyncGenerator<ParseEvent, void, unknown>
}

/**
 * 预处理器接口
 * 用于大文件预处理，移除冗余字段
 */
export interface Preprocessor {
  /** 是否需要预处理 */
  needsPreprocess(filePath: string, fileSize: number): boolean
  /** 执行预处理，返回临时文件路径 */
  preprocess(filePath: string, onProgress?: (progress: ParseProgress) => void): Promise<string>
  /** 清理临时文件 */
  cleanup(tempPath: string): void
}

/**
 * 格式模块导出结构
 * 每个格式文件同时导出 feature、parser，以及可选的 preprocessor
 */
export interface FormatModule {
  feature: FormatFeature
  parser: Parser
  preprocessor?: Preprocessor
}

// ==================== 工具类型 ====================

/**
 * 创建进度对象的工具函数类型
 */
export type CreateProgress = (
  stage: ParseProgress['stage'],
  bytesRead: number,
  totalBytes: number,
  messagesProcessed: number,
  message: string
) => ParseProgress

// 重新导出共享类型
export type { ParsedMember, ParsedMessage, ChatPlatform, ChatType }
