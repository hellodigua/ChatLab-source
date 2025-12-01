/**
 * ChatLab 聊天数据模型定义
 * 统一的数据结构，支持多平台聊天记录导入
 */

// ==================== 枚举定义 ====================

/**
 * 消息类型枚举
 */
export enum MessageType {
  TEXT = 0, // 文本消息
  IMAGE = 1, // 图片
  VOICE = 2, // 语音
  VIDEO = 3, // 视频
  FILE = 4, // 文件
  EMOJI = 5, // 表情包/贴纸
  SYSTEM = 6, // 系统消息（入群/退群/撤回等）
  OTHER = 99, // 其他
}

/**
 * 消息类型名称映射
 */
export const MESSAGE_TYPE_NAMES: Record<number, string> = {
  [MessageType.TEXT]: '文字',
  [MessageType.IMAGE]: '图片',
  [MessageType.VOICE]: '语音',
  [MessageType.VIDEO]: '视频',
  [MessageType.FILE]: '文件',
  [MessageType.EMOJI]: '表情',
  [MessageType.SYSTEM]: '系统',
  [MessageType.OTHER]: '其他',
}

/**
 * 获取消息类型名称
 * @param type 消息类型
 */
export function getMessageTypeName(type: MessageType | number): string {
  return MESSAGE_TYPE_NAMES[type] || '未知'
}

/**
 * 聊天平台枚举
 */
export enum ChatPlatform {
  QQ = 'qq',
  WECHAT = 'wechat',
  TELEGRAM = 'telegram',
  DISCORD = 'discord',
  MIXED = 'mixed', // 合并的多平台聊天记录
  UNKNOWN = 'unknown',
}

/**
 * 聊天类型枚举
 */
export enum ChatType {
  GROUP = 'group', // 群聊
  PRIVATE = 'private', // 私聊
}

// ==================== 数据库模型 ====================

/**
 * 元信息（数据库中存储的格式）
 */
export interface DbMeta {
  name: string // 群名/对话名
  platform: ChatPlatform // 平台
  type: ChatType // 聊天类型
  imported_at: number // 导入时间戳（秒）
}

/**
 * 成员（数据库中存储的格式）
 */
export interface DbMember {
  id: number // 自增ID
  platform_id: string // 平台标识（QQ号等）
  name: string // 最新昵称
}

/**
 * 消息（数据库中存储的格式）
 */
export interface DbMessage {
  id: number // 自增ID
  sender_id: number // FK -> member.id
  ts: number // 时间戳（秒）
  type: MessageType // 消息类型
  content: string | null // 纯文本内容
}

// ==================== Parser 解析结果 ====================

/**
 * 解析后的成员信息
 */
export interface ParsedMember {
  platformId: string // 平台标识
  name: string // 昵称
}

/**
 * 解析后的消息
 */
export interface ParsedMessage {
  senderPlatformId: string // 发送者平台ID
  senderName: string // 发送者在该消息时的昵称
  timestamp: number // 时间戳（秒）
  type: MessageType // 消息类型
  content: string | null // 内容
}

/**
 * Parser 解析结果
 */
export interface ParseResult {
  meta: {
    name: string
    platform: ChatPlatform
    type: ChatType
  }
  members: ParsedMember[]
  messages: ParsedMessage[]
}

// ==================== 分析结果类型 ====================

/**
 * 成员活跃度统计
 */
export interface MemberActivity {
  memberId: number
  platformId: string
  name: string
  messageCount: number
  percentage: number // 占总消息的百分比
}

/**
 * 时段活跃度统计
 */
export interface HourlyActivity {
  hour: number // 0-23
  messageCount: number
}

/**
 * 日期活跃度统计
 */
export interface DailyActivity {
  date: string // YYYY-MM-DD
  messageCount: number
}

/**
 * 星期活跃度统计
 */
export interface WeekdayActivity {
  weekday: number // 1-7，1=周一，7=周日
  messageCount: number
}

/**
 * 月份活跃度统计
 */
export interface MonthlyActivity {
  month: number // 1-12
  messageCount: number
}

// ==================== 夜猫分析类型 ====================

/**
 * 夜猫称号等级
 */
export type NightOwlTitle = '养生达人' | '偶尔失眠' | '经常失眠' | '夜猫子' | '秃头预备役' | '修仙练习生' | '守夜冠军'

/**
 * 修仙排行榜项
 */
export interface NightOwlRankItem {
  memberId: number
  platformId: string
  name: string
  totalNightMessages: number // 深夜发言总数
  title: NightOwlTitle // 称号
  hourlyBreakdown: {
    // 各时段分布
    h23: number // 23:00-24:00
    h0: number // 00:00-01:00
    h1: number // 01:00-02:00
    h2: number // 02:00-03:00
    h3to4: number // 03:00-05:00
  }
  percentage: number // 占该用户总发言的百分比
}

/**
 * 最晚/最早发言排行项
 */
export interface TimeRankItem {
  memberId: number
  platformId: string
  name: string
  count: number // 成为最晚/最早发言者的次数
  avgTime: string // 平均时间，格式 "HH:MM"
  extremeTime: string // 最极端时间，格式 "HH:MM"
  percentage: number // 占总天数的百分比
}

/**
 * 连续修仙记录
 */
export interface ConsecutiveNightRecord {
  memberId: number
  platformId: string
  name: string
  maxConsecutiveDays: number // 最长连续修仙天数
  currentStreak: number // 当前连续天数（如果还在持续）
}

/**
 * 修仙王者项（综合排名）
 */
export interface NightOwlChampion {
  memberId: number
  platformId: string
  name: string
  score: number // 综合得分
  nightMessages: number // 深夜发言数
  lastSpeakerCount: number // 最晚下班次数
  consecutiveDays: number // 最长连续天数
}

// ==================== 自言自语分析类型 ====================

/**
 * 自言自语排名项
 */
export interface MonologueRankItem {
  memberId: number
  platformId: string
  name: string
  totalStreaks: number // 总连击次数（>=2的段落数）
  maxCombo: number // 个人最高连击数
  lowStreak: number // 2-4句（加特林模式）
  midStreak: number // 5-9句（小作文）
  highStreak: number // 10+句（无人区广播）
}

/**
 * 最高连击纪录
 */
export interface MaxComboRecord {
  memberId: number
  platformId: string
  memberName: string
  comboLength: number // 连击长度
  startTs: number // 开始时间
}

/**
 * 自言自语分析结果
 */
export interface MonologueAnalysis {
  rank: MonologueRankItem[]
  maxComboRecord: MaxComboRecord | null // 全群最高纪录
}

/**
 * 龙王排名项（每天发言最多的人）
 */
export interface DragonKingRankItem {
  memberId: number
  platformId: string
  name: string
  count: number // 成为龙王的天数
  percentage: number // 占总天数的百分比
}

/**
 * 龙王分析结果
 */
export interface DragonKingAnalysis {
  rank: DragonKingRankItem[]
  totalDays: number // 统计的总天数
}

/**
 * 潜水排名项（最后发言时间）
 */
export interface DivingRankItem {
  memberId: number
  platformId: string
  name: string
  lastMessageTs: number // 最后发言时间戳（秒）
  daysSinceLastMessage: number // 距离最后发言的天数
}

/**
 * 潜水分析结果
 */
export interface DivingAnalysis {
  rank: DivingRankItem[]
}

/**
 * 夜猫分析完整结果
 */
export interface NightOwlAnalysis {
  /** 修仙排行榜 */
  nightOwlRank: NightOwlRankItem[]
  /** 最晚下班排名 */
  lastSpeakerRank: TimeRankItem[]
  /** 最早上班排名 */
  firstSpeakerRank: TimeRankItem[]
  /** 连续修仙记录 */
  consecutiveRecords: ConsecutiveNightRecord[]
  /** 修仙王者（综合排名） */
  champions: NightOwlChampion[]
  /** 统计的总天数 */
  totalDays: number
}

/**
 * 分析会话信息（用于会话列表展示）
 */
export interface AnalysisSession {
  id: string // 数据库文件名（不含扩展名）
  name: string // 群名/对话名
  platform: ChatPlatform
  type: ChatType
  importedAt: number // 导入时间戳
  messageCount: number // 消息总数
  memberCount: number // 成员数
  dbPath: string // 数据库文件完整路径
}

/**
 * 成员历史昵称记录
 */
export interface MemberNameHistory {
  name: string // 昵称
  startTs: number // 开始使用时间戳（秒）
  endTs: number | null // 停止使用时间戳（秒），null 表示当前昵称
}

// ==================== IPC 通信类型 ====================

/**
 * 导入进度回调
 */
export interface ImportProgress {
  stage: 'detecting' | 'reading' | 'parsing' | 'saving' | 'done' | 'error'
  progress: number // 0-100
  message?: string
  // 流式解析额外字段
  bytesRead?: number
  totalBytes?: number
  messagesProcessed?: number
}

/**
 * 导入结果
 */
export interface ImportResult {
  success: boolean
  sessionId?: string // 成功时返回会话ID
  error?: string // 失败时返回错误信息
}

// ==================== 复读分析类型 ====================

/**
 * 复读统计项（单个成员）- 绝对次数
 */
export interface RepeatStatItem {
  memberId: number
  platformId: string
  name: string
  count: number // 统计次数
  percentage: number // 占总复读链的百分比
}

/**
 * 复读率统计项（单个成员）- 相对比例
 */
export interface RepeatRateItem {
  memberId: number
  platformId: string
  name: string
  count: number // 复读相关次数
  totalMessages: number // 该成员总发言数
  rate: number // 复读率（百分比）
}

/**
 * 复读链长度分布项
 */
export interface ChainLengthDistribution {
  length: number // 复读链长度（参与人数）
  count: number // 出现次数
}

/**
 * 热门复读内容项
 */
export interface HotRepeatContent {
  content: string // 复读内容
  count: number // 被复读次数
  maxChainLength: number // 最长复读链长度
  originatorName: string // 最长链的原创者名称
  lastTs: number // 最近一次发生的时间戳（秒）
}

/**
 * 成员口头禅项
 */
export interface MemberCatchphrase {
  memberId: number
  platformId: string
  name: string
  catchphrases: Array<{
    content: string
    count: number
  }>
}

/**
 * 口头禅分析结果
 */
export interface CatchphraseAnalysis {
  members: MemberCatchphrase[]
}

/**
 * 最快复读选手统计项
 */
export interface FastestRepeaterItem {
  memberId: number
  platformId: string
  name: string
  count: number // 参与复读次数
  avgTimeDiff: number // 平均反应时间（毫秒）
}

/**
 * 复读分析结果
 */
export interface RepeatAnalysis {
  /** 谁的聊天最容易产生复读（原创者）- 绝对次数 */
  originators: RepeatStatItem[]
  /** 谁最喜欢挑起复读（第二个复读的人）- 绝对次数 */
  initiators: RepeatStatItem[]
  /** 谁喜欢打断复读（终结者）- 绝对次数 */
  breakers: RepeatStatItem[]
  /** 最快复读选手（平均反应时间） */
  fastestRepeaters: FastestRepeaterItem[]

  /** 被复读率排名（相对比例） */
  originatorRates: RepeatRateItem[]
  /** 挑起复读率排名（相对比例） */
  initiatorRates: RepeatRateItem[]
  /** 打断复读率排名（相对比例） */
  breakerRates: RepeatRateItem[]

  /** 复读链长度分布 */
  chainLengthDistribution: ChainLengthDistribution[]
  /** 最火复读内容 TOP 10 */
  hotContents: HotRepeatContent[]
  /** 平均复读链长度 */
  avgChainLength: number

  /** 复读链总数 */
  totalRepeatChains: number
}

// ==================== @ 互动分析类型 ====================

/**
 * @ 排行榜项
 */
export interface MentionRankItem {
  memberId: number
  platformId: string
  name: string
  count: number // @ 次数
  percentage: number // 占比
}

/**
 * @ 关系对（谁 @ 谁）
 */
export interface MentionPair {
  fromMemberId: number
  fromName: string
  toMemberId: number
  toName: string
  count: number // @ 次数
}

/**
 * 单向关注（舔狗检测）
 */
export interface OneWayMention {
  fromMemberId: number
  fromName: string
  toMemberId: number
  toName: string
  fromToCount: number // A @ B 的次数
  toFromCount: number // B @ A 的次数
  ratio: number // 单向比例 (fromToCount / (fromToCount + toFromCount))
}

/**
 * 双向奔赴（CP检测）
 */
export interface TwoWayMention {
  member1Id: number
  member1Name: string
  member2Id: number
  member2Name: string
  member1To2: number // A @ B
  member2To1: number // B @ A
  total: number // 总互动次数
  balance: number // 平衡度 (较小值 / 较大值)，越接近 1 越平衡
}

/**
 * 成员的 @ 详情（点击成员查看其 @ 关系）
 */
export interface MemberMentionDetail {
  memberId: number
  name: string
  /** 该成员最常 @ 的人 TOP N */
  topMentioned: MentionPair[]
  /** 最常 @ 该成员的人 TOP N */
  topMentioners: MentionPair[]
}

/**
 * @ 互动分析结果
 */
export interface MentionAnalysis {
  /** 发起 @ 最多的人排行 */
  topMentioners: MentionRankItem[]
  /** 被 @ 最多的人排行 */
  topMentioned: MentionRankItem[]
  /** 单向关注列表（舔狗检测） */
  oneWay: OneWayMention[]
  /** 双向奔赴列表（CP检测） */
  twoWay: TwoWayMention[]
  /** @ 总次数 */
  totalMentions: number
  /** 所有成员的 @ 详情（用于点击查看详细关系） */
  memberDetails: MemberMentionDetail[]
}

// ==================== 含笑量分析类型 ====================

/**
 * 含笑量排名项
 */
export interface LaughRankItem {
  memberId: number
  platformId: string
  name: string
  laughCount: number // 笑声关键词出现次数
  messageCount: number // 该成员总消息数
  laughRate: number // 含笑率（laughCount / messageCount * 100）
  percentage: number // 贡献占比（laughCount / 全群总笑声 * 100）
  keywordDistribution: Array<{
    keyword: string
    count: number
    percentage: number
  }> // 各关键词分布
}

/**
 * 笑声类型分布项
 */
export interface LaughTypeDistribution {
  type: string // 关键词类型（如 "哈哈"、"233" 等）
  count: number // 出现次数
  percentage: number // 占比
}

/**
 * 含笑量分析结果
 */
export interface LaughAnalysis {
  /** 按含笑率排序的排行榜 */
  rankByRate: LaughRankItem[]
  /** 按贡献度排序的排行榜 */
  rankByCount: LaughRankItem[]
  /** 笑声类型分布 */
  typeDistribution: LaughTypeDistribution[]
  /** 全群总笑声次数 */
  totalLaughs: number
  /** 全群总消息数 */
  totalMessages: number
  /** 群整体含笑率 */
  groupLaughRate: number
}

// ==================== 关键词模板 ====================

/**
 * 自定义关键词模板
 */
export interface KeywordTemplate {
  id: string
  name: string
  keywords: string[]
}

// ==================== 斗图分析类型 ====================

/**
 * 斗图达人榜项
 */
export interface MemeBattleRankItem {
  memberId: number
  platformId: string
  name: string
  count: number // 参与场次 或 图片总数
  percentage: number // 占比
}

/**
 * 斗图记录（一场）
 */
export interface MemeBattleRecord {
  startTime: number // 开始时间戳
  endTime: number // 结束时间戳
  totalImages: number // 总图片数
  participantCount: number // 参与人数
  participants: Array<{
    memberId: number
    name: string
    imageCount: number // 在该场斗图中发的图片数
  }>
}

/**
 * 斗图分析结果
 */
export interface MemeBattleAnalysis {
  topBattles: MemeBattleRecord[] // 史诗级斗图榜（前30）
  rankByCount: MemeBattleRankItem[] // 按参与场次排名
  rankByImageCount: MemeBattleRankItem[] // 按图片总数排名
  totalBattles: number // 总斗图场次
}

// ==================== 打卡分析类型 ====================

/**
 * 火花榜项（连续发言天数）
 */
export interface StreakRankItem {
  memberId: number
  name: string
  maxStreak: number // 最长连续天数
  maxStreakStart: string // 最长连续开始日期 (YYYY-MM-DD)
  maxStreakEnd: string // 最长连续结束日期 (YYYY-MM-DD)
  currentStreak: number // 当前连续天数（0表示已中断）
}

/**
 * 忠臣榜项（累计发言天数）
 */
export interface LoyaltyRankItem {
  memberId: number
  name: string
  totalDays: number // 累计发言天数
  percentage: number // 相对于第一名的百分比
}

/**
 * 打卡分析结果
 */
export interface CheckInAnalysis {
  streakRank: StreakRankItem[] // 火花榜 - 连续发言天数排名
  loyaltyRank: LoyaltyRankItem[] // 忠臣榜 - 累计发言天数排名
  totalDays: number // 群聊总天数
}

// ==================== ChatLab 专属格式类型 ====================

/**
 * ChatLab 格式版本信息
 */
export interface ChatLabHeader {
  version: string // 格式版本，如 "1.0.0"
  exportedAt: number // 导出时间戳（秒）
  generator: string // 生成工具名称
}

/**
 * 合并来源信息
 */
export interface MergeSource {
  filename: string // 原文件名
  platform?: string // 原平台
  messageCount: number // 消息数量
}

/**
 * ChatLab 格式的元信息
 */
export interface ChatLabMeta {
  name: string // 群名/对话名
  platform: ChatPlatform // 平台（合并时为 mixed）
  type: ChatType // 聊天类型
  sources?: MergeSource[] // 合并来源（可选）
}

/**
 * ChatLab 格式的成员
 */
export interface ChatLabMember {
  platformId: string // 平台标识
  name: string // 当前昵称
  aliases?: string[] // 历史昵称（可选）
}

/**
 * ChatLab 格式的消息
 */
export interface ChatLabMessage {
  sender: string // 发送者 platformId
  name: string // 发送时的昵称
  timestamp: number // 时间戳（秒）
  type: MessageType // 消息类型
  content: string | null // 内容
}

/**
 * ChatLab 专属格式文件结构
 */
export interface ChatLabFormat {
  chatlab: ChatLabHeader
  meta: ChatLabMeta
  members: ChatLabMember[]
  messages: ChatLabMessage[]
}

// ==================== 合并相关类型 ====================

/**
 * 文件解析信息（用于合并前预览）
 */
export interface FileParseInfo {
  name: string // 群名
  format: string // 格式名称
  platform: string // 平台
  messageCount: number // 消息数量
  memberCount: number // 成员数量
  fileSize?: number // 文件大小（字节）
}

/**
 * 合并冲突项
 */
export interface MergeConflict {
  id: string // 冲突ID
  timestamp: number // 时间戳
  sender: string // 发送者
  contentLength1: number // 内容1长度
  contentLength2: number // 内容2长度
  content1: string // 内容1
  content2: string // 内容2
}

/**
 * 冲突检测结果
 */
export interface ConflictCheckResult {
  conflicts: MergeConflict[]
  totalMessages: number // 合并后预计消息数
}

/**
 * 冲突解决方案
 */
export interface ConflictResolution {
  id: string
  resolution: 'keep1' | 'keep2' | 'keepBoth'
}

/**
 * 合并参数
 */
export interface MergeParams {
  filePaths: string[]
  outputName: string
  outputDir?: string
  conflictResolutions: ConflictResolution[]
  andAnalyze: boolean
}

/**
 * 合并结果
 */
export interface MergeResult {
  success: boolean
  outputPath?: string
  sessionId?: string // 如果选择了分析，返回会话ID
  error?: string
}
