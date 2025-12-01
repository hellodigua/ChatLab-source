/**
 * shuakami/qq-chat-exporter 格式预处理器
 * 适配项目: https://github.com/shuakami/qq-chat-exporter
 *
 * 功能：移除 content.html、content.raw 等冗余字段，减小文件体积
 * 阈值：>50MB 自动触发预处理
 */

import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { parser } from 'stream-json'
import { pick } from 'stream-json/filters/Pick'
import { streamArray } from 'stream-json/streamers/StreamArray'
import { chain } from 'stream-chain'
import type { ParseProgress, Preprocessor } from '../types'
import { getFileSize, createProgress } from '../utils'

/** 预处理阈值：50MB */
const PREPROCESS_THRESHOLD = 50 * 1024 * 1024

/**
 * 获取临时目录
 */
function getTempDir(): string {
  return path.join(os.tmpdir(), 'chatlab')
}

/**
 * 确保目录存在
 */
function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

/**
 * QQ JSON 消息的精简结构
 */
interface SlimQQMessage {
  id?: string
  messageId?: string
  timestamp: number | string
  sender: {
    uid?: string
    uin?: string
    name: string
  }
  type?: string
  messageType?: number
  content: {
    text: string
    elements?: Array<{ type: string }>
    resources?: Array<{ type: string }>
  }
  recalled?: boolean
  isRecalled?: boolean
  system?: boolean
  isSystemMessage?: boolean
}

/**
 * 精简 QQ JSON 消息对象
 */
function slimMessage(msg: Record<string, unknown>): SlimQQMessage {
  const sender = msg.sender as { uin?: string; uid?: string; name?: string } | undefined
  const content = msg.content as Record<string, unknown> | undefined

  const slimContent: SlimQQMessage['content'] = {
    text: (content?.text as string) || '',
  }

  if (content?.elements && Array.isArray(content.elements)) {
    slimContent.elements = (content.elements as Array<{ type: string }>).map((e) => ({
      type: e.type,
    }))
  }

  if (content?.resources && Array.isArray(content.resources)) {
    slimContent.resources = (content.resources as Array<{ type: string }>).map((r) => ({
      type: r.type,
    }))
  }

  const slimMsg: SlimQQMessage = {
    timestamp: msg.timestamp as number | string,
    sender: { name: sender?.name || '' },
    content: slimContent,
  }

  // 旧格式字段
  if (msg.id) slimMsg.id = msg.id as string
  if (msg.type) slimMsg.type = msg.type as string
  if (msg.recalled) slimMsg.recalled = msg.recalled as boolean
  if (msg.system) slimMsg.system = msg.system as boolean

  // V4 新格式字段
  if (msg.messageId) slimMsg.messageId = msg.messageId as string
  if (msg.messageType !== undefined) slimMsg.messageType = msg.messageType as number
  if (msg.isRecalled) slimMsg.isRecalled = msg.isRecalled as boolean
  if (msg.isSystemMessage) slimMsg.isSystemMessage = msg.isSystemMessage as boolean

  // sender 字段
  if (sender?.uin) slimMsg.sender.uin = sender.uin
  if (sender?.uid) slimMsg.sender.uid = sender.uid

  return slimMsg
}

/**
 * 预处理 QQ JSON 文件
 */
async function preprocessQQJson(inputPath: string, onProgress?: (progress: ParseProgress) => void): Promise<string> {
  const totalBytes = getFileSize(inputPath)
  let bytesRead = 0
  let messagesProcessed = 0

  const tempDir = getTempDir()
  ensureDir(tempDir)
  const outputFilename = `slim_${Date.now()}_${path.basename(inputPath)}`
  const outputPath = path.join(tempDir, outputFilename)

  onProgress?.(createProgress('parsing', 0, totalBytes, 0, '预处理：读取文件头...'))

  return new Promise((resolve, reject) => {
    const headChunks: string[] = []
    let headSize = 0
    const maxHeadSize = 100000

    const headStream = fs.createReadStream(inputPath, { encoding: 'utf-8' })
    let chatInfo: Record<string, unknown> = { name: '未知群聊', type: 'group' }
    let metadata: Record<string, unknown> | undefined

    headStream.on('data', (chunk: string) => {
      if (headSize < maxHeadSize) {
        headChunks.push(chunk)
        headSize += chunk.length
      } else {
        headStream.destroy()
      }
    })

    headStream.on('close', () => {
      const headContent = headChunks.join('')

      try {
        const chatInfoMatch = headContent.match(/"chatInfo"\s*:\s*(\{[^}]+\})/)
        if (chatInfoMatch) {
          chatInfo = JSON.parse(chatInfoMatch[1])
        }
      } catch {
        // 使用默认值
      }

      try {
        const metadataMatch = headContent.match(/"metadata"\s*:\s*(\{[^}]+\})/)
        if (metadataMatch) {
          metadata = JSON.parse(metadataMatch[1])
        }
      } catch {
        // 忽略
      }

      onProgress?.(createProgress('parsing', 0, totalBytes, 0, '预处理：开始精简消息...'))

      const readStream = fs.createReadStream(inputPath, { encoding: 'utf-8' })
      const writeStream = fs.createWriteStream(outputPath, { encoding: 'utf-8' })

      readStream.on('data', (chunk: string | Buffer) => {
        bytesRead += typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length
      })

      const header = { metadata, chatInfo, messages: [] }
      const headerJson = JSON.stringify(header)
      writeStream.write(headerJson.slice(0, -3) + '\n')

      let isFirstMessage = true

      const pipeline = chain([readStream, parser(), pick({ filter: /^messages\.\d+$/ }), streamArray()])

      pipeline.on('data', ({ value }: { value: Record<string, unknown> }) => {
        const slimMsg = slimMessage(value)
        const msgJson = JSON.stringify(slimMsg)

        if (isFirstMessage) {
          writeStream.write(msgJson)
          isFirstMessage = false
        } else {
          writeStream.write(',\n' + msgJson)
        }

        messagesProcessed++

        if (messagesProcessed % 10000 === 0) {
          onProgress?.(
            createProgress(
              'parsing',
              bytesRead,
              totalBytes,
              messagesProcessed,
              `预处理：已精简 ${messagesProcessed} 条消息...`
            )
          )
        }
      })

      pipeline.on('end', () => {
        writeStream.write('\n]}')
        writeStream.end()

        writeStream.on('finish', () => {
          onProgress?.(createProgress('done', totalBytes, totalBytes, messagesProcessed, '预处理完成'))
          resolve(outputPath)
        })
      })

      pipeline.on('error', (err) => {
        writeStream.destroy()
        if (fs.existsSync(outputPath)) {
          fs.unlinkSync(outputPath)
        }
        onProgress?.(createProgress('error', bytesRead, totalBytes, messagesProcessed, `预处理错误: ${err.message}`))
        reject(err)
      })
    })

    headStream.on('error', reject)
  })
}

/**
 * 清理临时文件
 */
function cleanupTempFile(filePath: string): void {
  try {
    if (fs.existsSync(filePath) && filePath.includes(getTempDir())) {
      fs.unlinkSync(filePath)
    }
  } catch {
    // 忽略清理错误
  }
}

/**
 * QQ Chat Exporter 预处理器
 */
export const qqPreprocessor: Preprocessor = {
  needsPreprocess(filePath: string, fileSize: number): boolean {
    return fileSize > PREPROCESS_THRESHOLD
  },

  preprocess: preprocessQQJson,

  cleanup: cleanupTempFile,
}
