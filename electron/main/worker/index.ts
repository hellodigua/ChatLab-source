/**
 * Worker 模块入口
 * 导出 Worker 管理器的所有 API
 */

export {
  initWorker,
  closeWorker,
  getDbDirectory,
  // 分析查询 API（异步）
  getAvailableYears,
  getMemberActivity,
  getHourlyActivity,
  getDailyActivity,
  getWeekdayActivity,
  getMonthlyActivity,
  getMessageTypeDistribution,
  getTimeRange,
  getMemberNameHistory,
  getRepeatAnalysis,
  getCatchphraseAnalysis,
  getNightOwlAnalysis,
  getDragonKingAnalysis,
  getDivingAnalysis,
  getMonologueAnalysis,
  getMentionAnalysis,
  getLaughAnalysis,
  getMemeBattleAnalysis,
  getCheckInAnalysis,
  // 会话管理 API（异步）
  getAllSessions,
  getSession,
  closeDatabase,
  // 文件解析 API（已废弃，使用流式版本）
  parseFileInfo,
  // 流式导入 API
  streamImport,
  streamParseFileInfo,
} from './workerManager'
