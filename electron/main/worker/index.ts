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
  getMessageTypeDistribution,
  getTimeRange,
  getMemberNameHistory,
  getRepeatAnalysis,
  getCatchphraseAnalysis,
  getNightOwlAnalysis,
  getDragonKingAnalysis,
  getDivingAnalysis,
  getMonologueAnalysis,
  // 会话管理 API（异步）
  getAllSessions,
  getSession,
  closeDatabase,
} from './workerManager'

