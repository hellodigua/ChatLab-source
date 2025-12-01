/**
 * Parser V2 - 嗅探层
 * 负责检测文件格式，匹配对应的解析器
 */

import * as fs from 'fs'
import * as path from 'path'
import type { FormatFeature, FormatModule, Parser } from './types'

/** 文件头检测大小 (8KB) */
const HEAD_SIZE = 8 * 1024

/**
 * 读取文件头部内容
 */
function readFileHead(filePath: string, size: number = HEAD_SIZE): string {
  const fd = fs.openSync(filePath, 'r')
  const buffer = Buffer.alloc(size)
  const bytesRead = fs.readSync(fd, buffer, 0, size, 0)
  fs.closeSync(fd)
  return buffer.slice(0, bytesRead).toString('utf-8')
}

/**
 * 获取文件扩展名（小写）
 */
function getExtension(filePath: string): string {
  return path.extname(filePath).toLowerCase()
}

/**
 * 检查文件头是否匹配签名
 */
function matchHeadSignatures(headContent: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(headContent))
}

/**
 * 检查必需字段是否存在
 */
function matchRequiredFields(headContent: string, fields: string[]): boolean {
  // 简单检查：字段名是否出现在文件头中
  // 对于 JSON 文件，检查 "fieldName" 是否存在
  return fields.every((field) => {
    const pattern = new RegExp(`"${field.replace('.', '"\\s*:\\s*.*"')}"\\s*:`)
    return pattern.test(headContent) || headContent.includes(`"${field}"`)
  })
}

/**
 * 格式嗅探器
 * 管理所有格式特征，负责检测文件格式
 */
export class FormatSniffer {
  private formats: FormatModule[] = []

  /**
   * 注册格式模块
   */
  register(module: FormatModule): void {
    this.formats.push(module)
    // 按优先级排序（优先级数字越小越靠前）
    this.formats.sort((a, b) => a.feature.priority - b.feature.priority)
  }

  /**
   * 批量注册格式模块
   */
  registerAll(modules: FormatModule[]): void {
    for (const module of modules) {
      this.register(module)
    }
  }

  /**
   * 嗅探文件格式
   * @param filePath 文件路径
   * @returns 匹配的格式特征，如果无法识别则返回 null
   */
  sniff(filePath: string): FormatFeature | null {
    const ext = getExtension(filePath)
    const headContent = readFileHead(filePath)

    for (const { feature } of this.formats) {
      if (this.matchFeature(feature, ext, headContent)) {
        return feature
      }
    }

    return null
  }

  /**
   * 获取文件对应的解析器
   * @param filePath 文件路径
   * @returns 匹配的解析器，如果无法识别则返回 null
   */
  getParser(filePath: string): Parser | null {
    const ext = getExtension(filePath)
    const headContent = readFileHead(filePath)

    for (const { feature, parser } of this.formats) {
      if (this.matchFeature(feature, ext, headContent)) {
        return parser
      }
    }

    return null
  }

  /**
   * 根据格式 ID 获取解析器
   */
  getParserById(formatId: string): Parser | null {
    const module = this.formats.find((m) => m.feature.id === formatId)
    return module?.parser || null
  }

  /**
   * 获取所有支持的格式
   */
  getSupportedFormats(): FormatFeature[] {
    return this.formats.map((m) => m.feature)
  }

  /**
   * 检查特征是否匹配
   */
  private matchFeature(feature: FormatFeature, ext: string, headContent: string): boolean {
    // 1. 检查扩展名
    if (!feature.extensions.includes(ext)) {
      return false
    }

    const { signatures } = feature

    // 2. 检查文件头签名（如果定义了）
    if (signatures.head && signatures.head.length > 0) {
      if (!matchHeadSignatures(headContent, signatures.head)) {
        return false
      }
    }

    // 3. 检查必需字段（如果定义了）
    if (signatures.requiredFields && signatures.requiredFields.length > 0) {
      if (!matchRequiredFields(headContent, signatures.requiredFields)) {
        return false
      }
    }

    // 4. 检查字段值模式（如果定义了）
    if (signatures.fieldPatterns) {
      for (const [, pattern] of Object.entries(signatures.fieldPatterns)) {
        if (!pattern.test(headContent)) {
          return false
        }
      }
    }

    return true
  }
}

/**
 * 创建并返回全局嗅探器实例
 */
export function createSniffer(): FormatSniffer {
  return new FormatSniffer()
}

