/**
 * 高级分析查询模块
 * 提供复读、口头禅、夜猫、龙王等复杂分析
 */

import {
  openDatabase,
  buildTimeFilter,
  buildSystemMessageFilter,
  type TimeFilter,
} from './dbCore'

// ==================== 复读分析 ====================

/**
 * 获取复读分析数据
 */
export function getRepeatAnalysis(sessionId: string, filter?: TimeFilter): any {
  const db = openDatabase(sessionId)
  const emptyResult = {
    originators: [],
    initiators: [],
    breakers: [],
    originatorRates: [],
    initiatorRates: [],
    breakerRates: [],
    chainLengthDistribution: [],
    hotContents: [],
    avgChainLength: 0,
    totalRepeatChains: 0,
  }

  if (!db) return emptyResult

  const { clause, params } = buildTimeFilter(filter)

  let whereClause = clause
  if (whereClause.includes('WHERE')) {
    whereClause +=
      " AND m.name != '系统消息' AND msg.type = 0 AND msg.content IS NOT NULL AND TRIM(msg.content) != ''"
  } else {
    whereClause =
      " WHERE m.name != '系统消息' AND msg.type = 0 AND msg.content IS NOT NULL AND TRIM(msg.content) != ''"
  }

  const messages = db
    .prepare(
      `
        SELECT
          msg.id,
          msg.sender_id as senderId,
          msg.content,
          msg.ts,
          m.platform_id as platformId,
          m.name
        FROM message msg
        JOIN member m ON msg.sender_id = m.id
        ${whereClause}
        ORDER BY msg.ts ASC, msg.id ASC
      `
    )
    .all(...params) as Array<{
    id: number
    senderId: number
    content: string
    ts: number
    platformId: string
    name: string
  }>

  const originatorCount = new Map<number, number>()
  const initiatorCount = new Map<number, number>()
  const breakerCount = new Map<number, number>()
  const memberMessageCount = new Map<number, number>()
  const memberInfo = new Map<number, { platformId: string; name: string }>()
  const chainLengthCount = new Map<number, number>()
  const contentStats = new Map<
    string,
    { count: number; maxChainLength: number; originatorId: number; lastTs: number }
  >()

  let currentContent: string | null = null
  let repeatChain: Array<{ senderId: number; content: string; ts: number }> = []
  let totalRepeatChains = 0
  let totalChainLength = 0

  const processRepeatChain = (
    chain: Array<{ senderId: number; content: string; ts: number }>,
    breakerId?: number
  ) => {
    if (chain.length < 3) return

    totalRepeatChains++
    const chainLength = chain.length
    totalChainLength += chainLength

    const originatorId = chain[0].senderId
    originatorCount.set(originatorId, (originatorCount.get(originatorId) || 0) + 1)

    const initiatorId = chain[1].senderId
    initiatorCount.set(initiatorId, (initiatorCount.get(initiatorId) || 0) + 1)

    if (breakerId !== undefined) {
      breakerCount.set(breakerId, (breakerCount.get(breakerId) || 0) + 1)
    }

    chainLengthCount.set(chainLength, (chainLengthCount.get(chainLength) || 0) + 1)

    const content = chain[0].content
    const chainTs = chain[0].ts
    const existing = contentStats.get(content)
    if (existing) {
      existing.count++
      existing.lastTs = Math.max(existing.lastTs, chainTs)
      if (chainLength > existing.maxChainLength) {
        existing.maxChainLength = chainLength
        existing.originatorId = originatorId
      }
    } else {
      contentStats.set(content, { count: 1, maxChainLength: chainLength, originatorId, lastTs: chainTs })
    }
  }

  for (const msg of messages) {
    if (!memberInfo.has(msg.senderId)) {
      memberInfo.set(msg.senderId, { platformId: msg.platformId, name: msg.name })
    }

    memberMessageCount.set(msg.senderId, (memberMessageCount.get(msg.senderId) || 0) + 1)

    const content = msg.content.trim()

    if (content === currentContent) {
      const lastSender = repeatChain[repeatChain.length - 1]?.senderId
      if (lastSender !== msg.senderId) {
        repeatChain.push({ senderId: msg.senderId, content, ts: msg.ts })
      }
    } else {
      processRepeatChain(repeatChain, msg.senderId)

      currentContent = content
      repeatChain = [{ senderId: msg.senderId, content, ts: msg.ts }]
    }
  }

  processRepeatChain(repeatChain)

  const buildRankList = (countMap: Map<number, number>, total: number): any[] => {
    const items: any[] = []
    for (const [memberId, count] of countMap.entries()) {
      const info = memberInfo.get(memberId)
      if (info) {
        items.push({
          memberId,
          platformId: info.platformId,
          name: info.name,
          count,
          percentage: total > 0 ? Math.round((count / total) * 10000) / 100 : 0,
        })
      }
    }
    return items.sort((a, b) => b.count - a.count)
  }

  const buildRateList = (countMap: Map<number, number>): any[] => {
    const items: any[] = []
    for (const [memberId, count] of countMap.entries()) {
      const info = memberInfo.get(memberId)
      const totalMessages = memberMessageCount.get(memberId) || 0
      if (info && totalMessages > 0) {
        items.push({
          memberId,
          platformId: info.platformId,
          name: info.name,
          count,
          totalMessages,
          rate: Math.round((count / totalMessages) * 10000) / 100,
        })
      }
    }
    return items.sort((a, b) => b.rate - a.rate)
  }

  const chainLengthDistribution: any[] = []
  for (const [length, count] of chainLengthCount.entries()) {
    chainLengthDistribution.push({ length, count })
  }
  chainLengthDistribution.sort((a, b) => a.length - b.length)

  const hotContents: any[] = []
  for (const [content, stats] of contentStats.entries()) {
    const originatorInfo = memberInfo.get(stats.originatorId)
    hotContents.push({
      content,
      count: stats.count,
      maxChainLength: stats.maxChainLength,
      originatorName: originatorInfo?.name || '未知',
      lastTs: stats.lastTs,
    })
  }
  hotContents.sort((a, b) => b.maxChainLength - a.maxChainLength)
  const top10HotContents = hotContents.slice(0, 10)

  return {
    originators: buildRankList(originatorCount, totalRepeatChains),
    initiators: buildRankList(initiatorCount, totalRepeatChains),
    breakers: buildRankList(breakerCount, totalRepeatChains),
    originatorRates: buildRateList(originatorCount),
    initiatorRates: buildRateList(initiatorCount),
    breakerRates: buildRateList(breakerCount),
    chainLengthDistribution,
    hotContents: top10HotContents,
    avgChainLength: totalRepeatChains > 0 ? Math.round((totalChainLength / totalRepeatChains) * 100) / 100 : 0,
    totalRepeatChains,
  }
}

// ==================== 口头禅分析 ====================

/**
 * 获取口头禅分析数据
 */
export function getCatchphraseAnalysis(sessionId: string, filter?: TimeFilter): any {
  const db = openDatabase(sessionId)
  if (!db) return { members: [] }

  const { clause, params } = buildTimeFilter(filter)

  let whereClause = clause
  if (whereClause.includes('WHERE')) {
    whereClause +=
      " AND m.name != '系统消息' AND msg.type = 0 AND msg.content IS NOT NULL AND LENGTH(TRIM(msg.content)) >= 2"
  } else {
    whereClause =
      " WHERE m.name != '系统消息' AND msg.type = 0 AND msg.content IS NOT NULL AND LENGTH(TRIM(msg.content)) >= 2"
  }

  const rows = db
    .prepare(
      `
        SELECT
          m.id as memberId,
          m.platform_id as platformId,
          m.name,
          TRIM(msg.content) as content,
          COUNT(*) as count
        FROM message msg
        JOIN member m ON msg.sender_id = m.id
        ${whereClause}
        GROUP BY m.id, TRIM(msg.content)
        ORDER BY m.id, count DESC
      `
    )
    .all(...params) as Array<{
    memberId: number
    platformId: string
    name: string
    content: string
    count: number
  }>

  const memberMap = new Map<
    number,
    {
      memberId: number
      platformId: string
      name: string
      catchphrases: Array<{ content: string; count: number }>
    }
  >()

  for (const row of rows) {
    if (!memberMap.has(row.memberId)) {
      memberMap.set(row.memberId, {
        memberId: row.memberId,
        platformId: row.platformId,
        name: row.name,
        catchphrases: [],
      })
    }

    const member = memberMap.get(row.memberId)!
    if (member.catchphrases.length < 5) {
      member.catchphrases.push({
        content: row.content,
        count: row.count,
      })
    }
  }

  const members = Array.from(memberMap.values())
  members.sort((a, b) => {
    const aTotal = a.catchphrases.reduce((sum, c) => sum + c.count, 0)
    const bTotal = b.catchphrases.reduce((sum, c) => sum + c.count, 0)
    return bTotal - aTotal
  })

  return { members }
}

// ==================== 夜猫分析 ====================

/**
 * 根据深夜发言数获取称号
 */
function getNightOwlTitleByCount(count: number): string {
  if (count === 0) return '养生达人'
  if (count <= 20) return '偶尔失眠'
  if (count <= 50) return '夜猫子'
  if (count <= 100) return '秃头预备役'
  if (count <= 200) return '修仙练习生'
  if (count <= 500) return '守夜冠军'
  return '不睡觉の神'
}

/**
 * 将时间戳转换为"调整后的日期"（以凌晨5点为界）
 */
function getAdjustedDate(ts: number): string {
  const date = new Date(ts * 1000)
  const hour = date.getHours()

  if (hour < 5) {
    date.setDate(date.getDate() - 1)
  }

  return date.toISOString().split('T')[0]
}

/**
 * 格式化分钟数为 HH:MM
 */
function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`
}

/**
 * 获取夜猫分析数据
 */
export function getNightOwlAnalysis(sessionId: string, filter?: TimeFilter): any {
  const db = openDatabase(sessionId)
  const emptyResult = {
    nightOwlRank: [],
    lastSpeakerRank: [],
    firstSpeakerRank: [],
    consecutiveRecords: [],
    champions: [],
    totalDays: 0,
  }

  if (!db) return emptyResult

  const { clause, params } = buildTimeFilter(filter)
  const clauseWithSystem = buildSystemMessageFilter(clause)

  const messages = db
    .prepare(
      `
        SELECT
          msg.id,
          msg.sender_id as senderId,
          msg.ts,
          m.platform_id as platformId,
          m.name
        FROM message msg
        JOIN member m ON msg.sender_id = m.id
        ${clauseWithSystem}
        ORDER BY msg.ts ASC
      `
    )
    .all(...params) as Array<{
    id: number
    senderId: number
    ts: number
    platformId: string
    name: string
  }>

  if (messages.length === 0) return emptyResult

  const memberInfo = new Map<number, { platformId: string; name: string }>()
  const nightStats = new Map<
    number,
    {
      total: number
      h23: number
      h0: number
      h1: number
      h2: number
      h3to4: number
      totalMessages: number
    }
  >()
  const dailyMessages = new Map<
    string,
    Array<{ senderId: number; ts: number; hour: number; minute: number }>
  >()
  const memberNightDays = new Map<number, Set<string>>()

  for (const msg of messages) {
    if (!memberInfo.has(msg.senderId)) {
      memberInfo.set(msg.senderId, { platformId: msg.platformId, name: msg.name })
    }

    const date = new Date(msg.ts * 1000)
    const hour = date.getHours()
    const minute = date.getMinutes()
    const adjustedDate = getAdjustedDate(msg.ts)

    if (!nightStats.has(msg.senderId)) {
      nightStats.set(msg.senderId, { total: 0, h23: 0, h0: 0, h1: 0, h2: 0, h3to4: 0, totalMessages: 0 })
    }
    const stats = nightStats.get(msg.senderId)!
    stats.totalMessages++

    if (hour === 23) {
      stats.h23++
      stats.total++
    } else if (hour === 0) {
      stats.h0++
      stats.total++
    } else if (hour === 1) {
      stats.h1++
      stats.total++
    } else if (hour === 2) {
      stats.h2++
      stats.total++
    } else if (hour >= 3 && hour < 5) {
      stats.h3to4++
      stats.total++
    }

    if (hour >= 23 || hour < 5) {
      if (!memberNightDays.has(msg.senderId)) {
        memberNightDays.set(msg.senderId, new Set())
      }
      memberNightDays.get(msg.senderId)!.add(adjustedDate)
    }

    if (!dailyMessages.has(adjustedDate)) {
      dailyMessages.set(adjustedDate, [])
    }
    dailyMessages.get(adjustedDate)!.push({ senderId: msg.senderId, ts: msg.ts, hour, minute })
  }

  const totalDays = dailyMessages.size

  // 构建修仙排行榜
  const nightOwlRank: any[] = []
  for (const [memberId, stats] of nightStats.entries()) {
    if (stats.total === 0) continue
    const info = memberInfo.get(memberId)!
    nightOwlRank.push({
      memberId,
      platformId: info.platformId,
      name: info.name,
      totalNightMessages: stats.total,
      title: getNightOwlTitleByCount(stats.total),
      hourlyBreakdown: {
        h23: stats.h23,
        h0: stats.h0,
        h1: stats.h1,
        h2: stats.h2,
        h3to4: stats.h3to4,
      },
      percentage: stats.totalMessages > 0 ? Math.round((stats.total / stats.totalMessages) * 10000) / 100 : 0,
    })
  }
  nightOwlRank.sort((a, b) => b.totalNightMessages - a.totalNightMessages)

  // 最晚/最早发言
  const lastSpeakerStats = new Map<number, { count: number; times: number[] }>()
  const firstSpeakerStats = new Map<number, { count: number; times: number[] }>()

  for (const [, dayMessages] of dailyMessages.entries()) {
    if (dayMessages.length === 0) continue

    const lastMsg = dayMessages[dayMessages.length - 1]
    if (!lastSpeakerStats.has(lastMsg.senderId)) {
      lastSpeakerStats.set(lastMsg.senderId, { count: 0, times: [] })
    }
    const lastStats = lastSpeakerStats.get(lastMsg.senderId)!
    lastStats.count++
    lastStats.times.push(lastMsg.hour * 60 + lastMsg.minute)

    const firstMsg = dayMessages[0]
    if (!firstSpeakerStats.has(firstMsg.senderId)) {
      firstSpeakerStats.set(firstMsg.senderId, { count: 0, times: [] })
    }
    const firstStats = firstSpeakerStats.get(firstMsg.senderId)!
    firstStats.count++
    firstStats.times.push(firstMsg.hour * 60 + firstMsg.minute)
  }

  // 构建排行
  const lastSpeakerRank: any[] = []
  for (const [memberId, stats] of lastSpeakerStats.entries()) {
    const info = memberInfo.get(memberId)!
    const avgMinutes = stats.times.reduce((a, b) => a + b, 0) / stats.times.length
    const maxMinutes = Math.max(...stats.times)
    lastSpeakerRank.push({
      memberId,
      platformId: info.platformId,
      name: info.name,
      count: stats.count,
      avgTime: formatMinutes(avgMinutes),
      extremeTime: formatMinutes(maxMinutes),
      percentage: totalDays > 0 ? Math.round((stats.count / totalDays) * 10000) / 100 : 0,
    })
  }
  lastSpeakerRank.sort((a, b) => b.count - a.count)

  const firstSpeakerRank: any[] = []
  for (const [memberId, stats] of firstSpeakerStats.entries()) {
    const info = memberInfo.get(memberId)!
    const avgMinutes = stats.times.reduce((a, b) => a + b, 0) / stats.times.length
    const minMinutes = Math.min(...stats.times)
    firstSpeakerRank.push({
      memberId,
      platformId: info.platformId,
      name: info.name,
      count: stats.count,
      avgTime: formatMinutes(avgMinutes),
      extremeTime: formatMinutes(minMinutes),
      percentage: totalDays > 0 ? Math.round((stats.count / totalDays) * 10000) / 100 : 0,
    })
  }
  firstSpeakerRank.sort((a, b) => b.count - a.count)

  // 连续修仙天数
  const consecutiveRecords: any[] = []

  for (const [memberId, nightDaysSet] of memberNightDays.entries()) {
    if (nightDaysSet.size === 0) continue

    const info = memberInfo.get(memberId)!
    const sortedDays = Array.from(nightDaysSet).sort()

    let maxStreak = 1
    let currentStreak = 1

    for (let i = 1; i < sortedDays.length; i++) {
      const prevDate = new Date(sortedDays[i - 1])
      const currDate = new Date(sortedDays[i])
      const diffDays = (currDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24)

      if (diffDays === 1) {
        currentStreak++
        maxStreak = Math.max(maxStreak, currentStreak)
      } else {
        currentStreak = 1
      }
    }

    const lastDay = sortedDays[sortedDays.length - 1]
    const today = new Date().toISOString().split('T')[0]
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0]
    const isCurrentStreak = lastDay === today || lastDay === yesterday

    consecutiveRecords.push({
      memberId,
      platformId: info.platformId,
      name: info.name,
      maxConsecutiveDays: maxStreak,
      currentStreak: isCurrentStreak ? currentStreak : 0,
    })
  }
  consecutiveRecords.sort((a, b) => b.maxConsecutiveDays - a.maxConsecutiveDays)

  // 综合排名
  const championScores = new Map<number, { nightMessages: number; lastSpeakerCount: number; consecutiveDays: number }>()

  for (const item of nightOwlRank) {
    if (!championScores.has(item.memberId)) {
      championScores.set(item.memberId, { nightMessages: 0, lastSpeakerCount: 0, consecutiveDays: 0 })
    }
    championScores.get(item.memberId)!.nightMessages = item.totalNightMessages
  }

  for (const item of lastSpeakerRank) {
    if (!championScores.has(item.memberId)) {
      championScores.set(item.memberId, { nightMessages: 0, lastSpeakerCount: 0, consecutiveDays: 0 })
    }
    championScores.get(item.memberId)!.lastSpeakerCount = item.count
  }

  for (const item of consecutiveRecords) {
    if (!championScores.has(item.memberId)) {
      championScores.set(item.memberId, { nightMessages: 0, lastSpeakerCount: 0, consecutiveDays: 0 })
    }
    championScores.get(item.memberId)!.consecutiveDays = item.maxConsecutiveDays
  }

  const champions: any[] = []
  for (const [memberId, scores] of championScores.entries()) {
    const info = memberInfo.get(memberId)!
    const score = scores.nightMessages * 1 + scores.lastSpeakerCount * 10 + scores.consecutiveDays * 20
    if (score > 0) {
      champions.push({
        memberId,
        platformId: info.platformId,
        name: info.name,
        score,
        nightMessages: scores.nightMessages,
        lastSpeakerCount: scores.lastSpeakerCount,
        consecutiveDays: scores.consecutiveDays,
      })
    }
  }
  champions.sort((a, b) => b.score - a.score)

  return {
    nightOwlRank,
    lastSpeakerRank,
    firstSpeakerRank,
    consecutiveRecords,
    champions,
    totalDays,
  }
}

// ==================== 龙王分析 ====================

/**
 * 获取龙王排名
 */
export function getDragonKingAnalysis(sessionId: string, filter?: TimeFilter): any {
  const db = openDatabase(sessionId)
  const emptyResult = { rank: [], totalDays: 0 }

  if (!db) return emptyResult

  const { clause, params } = buildTimeFilter(filter)
  const clauseWithSystem = buildSystemMessageFilter(clause)

  const dailyTopSpeakers = db
    .prepare(
      `
        WITH daily_counts AS (
          SELECT
            strftime('%Y-%m-%d', msg.ts, 'unixepoch', 'localtime') as date,
            msg.sender_id,
            m.platform_id,
            m.name,
            COUNT(*) as msg_count
          FROM message msg
          JOIN member m ON msg.sender_id = m.id
          ${clauseWithSystem}
          GROUP BY date, msg.sender_id
        ),
        daily_max AS (
          SELECT date, MAX(msg_count) as max_count
          FROM daily_counts
          GROUP BY date
        )
        SELECT dc.sender_id, dc.platform_id, dc.name, COUNT(*) as dragon_days
        FROM daily_counts dc
        JOIN daily_max dm ON dc.date = dm.date AND dc.msg_count = dm.max_count
        GROUP BY dc.sender_id
        ORDER BY dragon_days DESC
      `
    )
    .all(...params) as Array<{
    sender_id: number
    platform_id: string
    name: string
    dragon_days: number
  }>

  const totalDaysRow = db
    .prepare(
      `
        SELECT COUNT(DISTINCT strftime('%Y-%m-%d', msg.ts, 'unixepoch', 'localtime')) as total
        FROM message msg
        JOIN member m ON msg.sender_id = m.id
        ${clauseWithSystem}
      `
    )
    .get(...params) as { total: number }

  const totalDays = totalDaysRow.total

  const rank = dailyTopSpeakers.map((item) => ({
    memberId: item.sender_id,
    platformId: item.platform_id,
    name: item.name,
    count: item.dragon_days,
    percentage: totalDays > 0 ? Math.round((item.dragon_days / totalDays) * 10000) / 100 : 0,
  }))

  return { rank, totalDays }
}

// ==================== 潜水分析 ====================

/**
 * 获取潜水排名
 */
export function getDivingAnalysis(sessionId: string, filter?: TimeFilter): any {
  const db = openDatabase(sessionId)
  const emptyResult = { rank: [] }

  if (!db) return emptyResult

  const { clause, params } = buildTimeFilter(filter)
  const clauseWithSystem = buildSystemMessageFilter(clause)

  const lastMessages = db
    .prepare(
      `
        SELECT
          m.id as member_id,
          m.platform_id,
          m.name,
          MAX(msg.ts) as last_ts
        FROM member m
        JOIN message msg ON m.id = msg.sender_id
        ${clauseWithSystem.replace('msg.', 'msg.')}
        GROUP BY m.id
        ORDER BY last_ts ASC
      `
    )
    .all(...params) as Array<{
    member_id: number
    platform_id: string
    name: string
    last_ts: number
  }>

  const now = Math.floor(Date.now() / 1000)

  const rank = lastMessages.map((item) => ({
    memberId: item.member_id,
    platformId: item.platform_id,
    name: item.name,
    lastMessageTs: item.last_ts,
    daysSinceLastMessage: Math.floor((now - item.last_ts) / 86400),
  }))

  return { rank }
}

// ==================== 自言自语分析 ====================

/**
 * 获取自言自语分析
 */
export function getMonologueAnalysis(sessionId: string, filter?: TimeFilter): any {
  const db = openDatabase(sessionId)
  const emptyResult = { rank: [], maxComboRecord: null }

  if (!db) return emptyResult

  const { clause, params } = buildTimeFilter(filter)

  let whereClause = clause
  if (whereClause.includes('WHERE')) {
    whereClause += " AND m.name != '系统消息' AND msg.type = 0"
  } else {
    whereClause = " WHERE m.name != '系统消息' AND msg.type = 0"
  }

  const messages = db
    .prepare(
      `
        SELECT
          msg.id,
          msg.sender_id as senderId,
          msg.ts,
          m.platform_id as platformId,
          m.name
        FROM message msg
        JOIN member m ON msg.sender_id = m.id
        ${whereClause}
        ORDER BY msg.ts ASC
      `
    )
    .all(...params) as Array<{
    id: number
    senderId: number
    ts: number
    platformId: string
    name: string
  }>

  if (messages.length === 0) return emptyResult

  const memberInfo = new Map<number, { platformId: string; name: string }>()
  const memberStats = new Map<
    number,
    {
      totalStreaks: number
      maxCombo: number
      lowStreak: number
      midStreak: number
      highStreak: number
    }
  >()

  let globalMaxCombo: { memberId: number; comboLength: number; startTs: number } | null = null
  const MAX_INTERVAL = 300

  let currentStreak = {
    senderId: -1,
    count: 0,
    startTs: 0,
    lastTs: 0,
  }

  const finishStreak = () => {
    if (currentStreak.count >= 3) {
      const memberId = currentStreak.senderId

      if (!memberStats.has(memberId)) {
        memberStats.set(memberId, {
          totalStreaks: 0,
          maxCombo: 0,
          lowStreak: 0,
          midStreak: 0,
          highStreak: 0,
        })
      }

      const stats = memberStats.get(memberId)!
      stats.totalStreaks++
      stats.maxCombo = Math.max(stats.maxCombo, currentStreak.count)

      if (currentStreak.count >= 10) {
        stats.highStreak++
      } else if (currentStreak.count >= 5) {
        stats.midStreak++
      } else {
        stats.lowStreak++
      }

      if (!globalMaxCombo || currentStreak.count > globalMaxCombo.comboLength) {
        globalMaxCombo = {
          memberId,
          comboLength: currentStreak.count,
          startTs: currentStreak.startTs,
        }
      }
    }
  }

  for (const msg of messages) {
    if (!memberInfo.has(msg.senderId)) {
      memberInfo.set(msg.senderId, { platformId: msg.platformId, name: msg.name })
    }

    const isSameSender = msg.senderId === currentStreak.senderId
    const isWithinInterval = msg.ts - currentStreak.lastTs <= MAX_INTERVAL

    if (isSameSender && isWithinInterval) {
      currentStreak.count++
      currentStreak.lastTs = msg.ts
    } else {
      finishStreak()
      currentStreak = {
        senderId: msg.senderId,
        count: 1,
        startTs: msg.ts,
        lastTs: msg.ts,
      }
    }
  }

  finishStreak()

  const rank: any[] = []
  for (const [memberId, stats] of memberStats.entries()) {
    const info = memberInfo.get(memberId)!
    rank.push({
      memberId,
      platformId: info.platformId,
      name: info.name,
      totalStreaks: stats.totalStreaks,
      maxCombo: stats.maxCombo,
      lowStreak: stats.lowStreak,
      midStreak: stats.midStreak,
      highStreak: stats.highStreak,
    })
  }
  rank.sort((a, b) => b.totalStreaks - a.totalStreaks)

  let maxComboRecord: any = null
  if (globalMaxCombo) {
    const info = memberInfo.get(globalMaxCombo.memberId)!
    maxComboRecord = {
      memberId: globalMaxCombo.memberId,
      platformId: info.platformId,
      memberName: info.name,
      comboLength: globalMaxCombo.comboLength,
      startTs: globalMaxCombo.startTs,
    }
  }

  return { rank, maxComboRecord }
}

