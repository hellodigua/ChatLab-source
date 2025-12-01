/**
 * 聊天记录合并模块
 * 支持多个聊天记录文件合并为 ChatLab 专属格式
 */

import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'
import { parseFileSync, detectFormat } from '../parser'
import { importData } from '../database/core'
import type {
  ParseResult,
  ParsedMessage,
  ChatLabFormat,
  ChatLabMember,
  ChatLabMessage,
  FileParseInfo,
  MergeConflict,
  ConflictCheckResult,
  ConflictResolution,
  MergeParams,
  MergeResult,
  ChatPlatform,
  ChatType,
  MergeSource,
} from '../../../src/types/chat'

/**
 * 获取默认输出目录
 */
function getDefaultOutputDir(): string {
  try {
    const docPath = app.getPath('documents')
    return path.join(docPath, 'ChatLab', 'merged')
  } catch {
    return path.join(process.cwd(), 'merged')
  }
}

/**
 * 确保输出目录存在
 */
function ensureOutputDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

/**
 * 生成输出文件名
 */
function generateOutputFilename(name: string): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const safeName = name.replace(/[/\\?%*:|"<>]/g, '_')
  return `${safeName}_merged_${date}.chatlab.json`
}

/**
 * 解析文件获取基本信息（用于预览）
 * 注意：推荐使用 parser.parseFileInfo 获取更详细的信息
 */
export async function parseFileInfo(filePath: string): Promise<FileParseInfo> {
  const format = detectFormat(filePath)
  if (!format) {
    throw new Error('无法识别文件格式')
  }

  const result = await parseFileSync(filePath)

  return {
    name: result.meta.name,
    format: format.name,
    platform: result.meta.platform,
    messageCount: result.messages.length,
    memberCount: result.members.length,
  }
}

/**
 * 生成消息的唯一标识（用于去重和冲突检测）
 */
function getMessageKey(msg: ParsedMessage): string {
  return `${msg.timestamp}_${msg.senderPlatformId}_${(msg.content || '').length}`
}

/**
 * 检测合并冲突
 * 规则：时间戳 + 用户名 + 字符长度，当两项相同但另一项不同时报告冲突
 */
export async function checkConflicts(filePaths: string[]): Promise<ConflictCheckResult> {
  const allMessages: Array<{ msg: ParsedMessage; source: string }> = []
  const conflicts: MergeConflict[] = []

  console.log('[Merger] checkConflicts: 开始检测冲突')
  console.log(
    '[Merger] 文件列表:',
    filePaths.map((p) => path.basename(p))
  )

  // 先检查格式一致性
  const formats: string[] = []
  for (const filePath of filePaths) {
    const format = detectFormat(filePath)
    if (format) {
      formats.push(format.name)
    } else {
      throw new Error(`无法识别文件格式: ${path.basename(filePath)}`)
    }
  }

  // 检查是否所有文件格式一致
  const uniqueFormats = [...new Set(formats)]
  if (uniqueFormats.length > 1) {
    throw new Error(
      `不支持合并不同格式的聊天记录。\n检测到的格式：${uniqueFormats.join('、')}\n请确保所有文件使用相同的导出工具和格式。`
    )
  }
  console.log('[Merger] 格式检查通过:', uniqueFormats[0])

  // 解析所有文件
  for (const filePath of filePaths) {
    const result = await parseFileSync(filePath)
    const sourceName = path.basename(filePath)
    console.log(`[Merger] 解析 ${sourceName}: ${result.messages.length} 条消息`)
    for (const msg of result.messages) {
      allMessages.push({ msg, source: sourceName })
    }
  }
  console.log(`[Merger] 总消息数: ${allMessages.length}`)

  // 按时间戳分组检测冲突
  const timeGroups = new Map<number, Array<{ msg: ParsedMessage; source: string }>>()
  for (const item of allMessages) {
    const ts = item.msg.timestamp
    if (!timeGroups.has(ts)) {
      timeGroups.set(ts, [])
    }
    timeGroups.get(ts)!.push(item)
  }
  console.log(`[Merger] 唯一时间戳数: ${timeGroups.size}`)

  // 统计有多条消息的时间戳
  let multiMsgTsCount = 0
  for (const [, items] of timeGroups) {
    if (items.length > 1) multiMsgTsCount++
  }
  console.log(`[Merger] 有多条消息的时间戳数: ${multiMsgTsCount}`)

  // 检测每个时间戳内的冲突
  for (const [ts, items] of timeGroups) {
    if (items.length < 2) continue

    // 按发送者分组
    const senderGroups = new Map<string, Array<{ msg: ParsedMessage; source: string }>>()
    for (const item of items) {
      const sender = item.msg.senderPlatformId
      if (!senderGroups.has(sender)) {
        senderGroups.set(sender, [])
      }
      senderGroups.get(sender)!.push(item)
    }

    // 检测同一时间戳同一发送者的不同内容
    for (const [sender, senderItems] of senderGroups) {
      if (senderItems.length < 2) continue

      // 检查是否来自不同文件
      const sources = new Set(senderItems.map((it) => it.source))
      if (sources.size < 2) {
        // 所有消息来自同一个文件，跳过（这是同一文件内同一秒内多条消息的情况）
        continue
      }

      // 按内容长度分组
      const lengthGroups = new Map<number, Array<{ msg: ParsedMessage; source: string }>>()
      for (const item of senderItems) {
        const len = (item.msg.content || '').length
        if (!lengthGroups.has(len)) {
          lengthGroups.set(len, [])
        }
        lengthGroups.get(len)!.push(item)
      }

      // 如果有多个不同长度的消息，说明可能是冲突
      if (lengthGroups.size > 1) {
        const lengthEntries = Array.from(lengthGroups.entries())
        for (let i = 0; i < lengthEntries.length - 1; i++) {
          for (let j = i + 1; j < lengthEntries.length; j++) {
            const [len1, items1] = lengthEntries[i]
            const [len2, items2] = lengthEntries[j]

            // 找到两个来源不同的消息
            const item1 = items1[0]
            const item2 = items2.find((it) => it.source !== item1.source)

            // 如果找不到来自不同文件的消息，跳过
            if (!item2) continue

            // 打印冲突详情
            if (conflicts.length < 5) {
              console.log(`[Merger] 冲突 #${conflicts.length + 1}:`)
              console.log(`  时间戳: ${ts} (${new Date(ts * 1000).toLocaleString()})`)
              console.log(`  发送者: ${sender} (${item1.msg.senderName})`)
              console.log(
                `  文件1: ${item1.source}, 长度: ${len1}, 内容: "${(item1.msg.content || '').slice(0, 50)}..."`
              )
              console.log(
                `  文件2: ${item2.source}, 长度: ${len2}, 内容: "${(item2.msg.content || '').slice(0, 50)}..."`
              )
            }

            conflicts.push({
              id: `conflict_${ts}_${sender}_${conflicts.length}`,
              timestamp: ts,
              sender: item1.msg.senderName || sender,
              contentLength1: len1,
              contentLength2: len2,
              content1: item1.msg.content || '',
              content2: item2.msg.content || '',
            })
          }
        }
      }
    }
  }

  console.log(`[Merger] 检测到冲突数: ${conflicts.length}`)

  // 计算去重后的消息数
  const uniqueKeys = new Set<string>()
  for (const item of allMessages) {
    uniqueKeys.add(getMessageKey(item.msg))
  }
  console.log(`[Merger] 去重后消息数: ${uniqueKeys.size}`)

  return {
    conflicts,
    totalMessages: uniqueKeys.size,
  }
}

/**
 * 合并多个聊天记录文件
 */
export async function mergeFiles(params: MergeParams): Promise<MergeResult> {
  try {
    const { filePaths, outputName, outputDir, conflictResolutions, andAnalyze } = params

    // 解析所有文件
    const parseResults: Array<{ result: ParseResult; source: string }> = []
    for (const filePath of filePaths) {
      const result = await parseFileSync(filePath)
      parseResults.push({ result, source: path.basename(filePath) })
    }

    // 合并成员
    const memberMap = new Map<string, ChatLabMember>()
    for (const { result } of parseResults) {
      for (const member of result.members) {
        const existing = memberMap.get(member.platformId)
        if (existing) {
          // 如果昵称不同，添加到 aliases
          if (existing.name !== member.name && !existing.aliases?.includes(member.name)) {
            existing.aliases = existing.aliases || []
            existing.aliases.push(member.name)
          }
        } else {
          memberMap.set(member.platformId, {
            platformId: member.platformId,
            name: member.name,
          })
        }
      }
    }

    // 合并消息（带冲突解决和去重）
    const resolutionMap = new Map(conflictResolutions.map((r) => [r.id, r.resolution]))
    const allMessages: Array<{ msg: ParsedMessage; source: string }> = []

    for (const { result, source } of parseResults) {
      for (const msg of result.messages) {
        allMessages.push({ msg, source })
      }
    }

    // 去重逻辑
    const messageMap = new Map<string, ChatLabMessage[]>()
    const processedConflicts = new Set<string>()

    for (const { msg } of allMessages) {
      const key = getMessageKey(msg)

      // 检查是否是冲突消息
      const conflictId = conflictResolutions.find((c) => {
        return c.id.includes(`${msg.timestamp}_${msg.senderPlatformId}`)
      })?.id

      if (conflictId && !processedConflicts.has(conflictId)) {
        processedConflicts.add(conflictId)
        const resolution = resolutionMap.get(conflictId)

        // 根据解决方案处理
        if (resolution === 'keepBoth') {
          // 保留两者：不去重
        } else if (resolution === 'keep1' || resolution === 'keep2') {
          // 保留其中一个：跳过另一个（简化处理，保留第一个遇到的）
        }
      }

      // 添加消息
      if (!messageMap.has(key)) {
        messageMap.set(key, [])
      }

      const chatLabMsg: ChatLabMessage = {
        sender: msg.senderPlatformId,
        name: msg.senderName,
        timestamp: msg.timestamp,
        type: msg.type,
        content: msg.content,
      }

      // 只添加一次（去重）
      const existing = messageMap.get(key)!
      if (existing.length === 0) {
        existing.push(chatLabMsg)
      }
    }

    // 扁平化并排序
    const mergedMessages = Array.from(messageMap.values())
      .flat()
      .sort((a, b) => a.timestamp - b.timestamp)

    // 确定平台
    const platforms = new Set(parseResults.map((r) => r.result.meta.platform))
    const platform = platforms.size === 1 ? parseResults[0].result.meta.platform : 'mixed'

    // 构建来源信息
    const sources: MergeSource[] = parseResults.map(({ result, source }) => ({
      filename: source,
      platform: result.meta.platform,
      messageCount: result.messages.length,
    }))

    // 构建 ChatLab 格式
    const chatLabData: ChatLabFormat = {
      chatlab: {
        version: '1.0.0',
        exportedAt: Math.floor(Date.now() / 1000),
        generator: 'ChatLab Merge Tool',
      },
      meta: {
        name: outputName,
        platform: platform as ChatPlatform,
        type: parseResults[0].result.meta.type as ChatType,
        sources,
      },
      members: Array.from(memberMap.values()),
      messages: mergedMessages,
    }

    // 写入文件
    const targetDir = outputDir || getDefaultOutputDir()
    ensureOutputDir(targetDir)
    const filename = generateOutputFilename(outputName)
    const outputPath = path.join(targetDir, filename)

    fs.writeFileSync(outputPath, JSON.stringify(chatLabData, null, 2), 'utf-8')

    // 如果需要分析，导入数据库
    let sessionId: string | undefined
    if (andAnalyze) {
      // 将 ChatLab 格式转换为 ParseResult
      const parseResult: ParseResult = {
        meta: {
          name: chatLabData.meta.name,
          platform: chatLabData.meta.platform,
          type: chatLabData.meta.type,
        },
        members: chatLabData.members.map((m) => ({
          platformId: m.platformId,
          name: m.name,
        })),
        messages: chatLabData.messages.map((msg) => ({
          senderPlatformId: msg.sender,
          senderName: msg.name,
          timestamp: msg.timestamp,
          type: msg.type,
          content: msg.content,
        })),
      }
      sessionId = importData(parseResult)
    }

    return {
      success: true,
      outputPath,
      sessionId,
    }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : '合并失败',
    }
  }
}
