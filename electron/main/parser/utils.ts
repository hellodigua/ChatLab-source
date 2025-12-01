/**
 * Parser V2 - 工具函数
 */

import * as fs from 'fs'
import type { ParseProgress, CreateProgress } from './types'

/**
 * 获取文件大小
 */
export function getFileSize(filePath: string): number {
  return fs.statSync(filePath).size
}

/**
 * 读取文件头部指定字节数
 */
export function readFileHeadBytes(filePath: string, size: number): string {
  const fd = fs.openSync(filePath, 'r')
  const buffer = Buffer.alloc(size)
  const bytesRead = fs.readSync(fd, buffer, 0, size, 0)
  fs.closeSync(fd)
  return buffer.slice(0, bytesRead).toString('utf-8')
}

/**
 * 创建进度对象
 */
export const createProgress: CreateProgress = (stage, bytesRead, totalBytes, messagesProcessed, message) => {
  const percentage = totalBytes > 0 ? Math.min(99, Math.round((bytesRead / totalBytes) * 100)) : 0
  return {
    stage,
    bytesRead,
    totalBytes,
    messagesProcessed,
    percentage: stage === 'done' ? 100 : percentage,
    message,
  }
}

/**
 * 解析 ISO 时间戳或毫秒时间戳
 * @returns 秒级时间戳，如果解析失败返回 null
 */
export function parseTimestamp(value: string | number): number | null {
  if (typeof value === 'string') {
    // ISO 字符串格式：2017-12-30T03:24:36.000Z
    const parsed = Date.parse(value)
    if (isNaN(parsed)) return null
    return Math.floor(parsed / 1000)
  } else if (typeof value === 'number') {
    // 毫秒时间戳
    if (isNaN(value)) return null
    return Math.floor(value / 1000)
  }
  return null
}

/**
 * 验证年份是否合理（2000年以后）
 */
export function isValidYear(timestampSeconds: number): boolean {
  return new Date(timestampSeconds * 1000).getFullYear() >= 2000
}

/**
 * 格式化文件大小
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

