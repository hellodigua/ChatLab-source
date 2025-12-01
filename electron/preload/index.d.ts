import { ElectronAPI } from '@electron-toolkit/preload'
import type {
  AnalysisSession,
  MemberActivity,
  MemberNameHistory,
  HourlyActivity,
  DailyActivity,
  WeekdayActivity,
  MonthlyActivity,
  MessageType,
  ImportProgress,
  RepeatAnalysis,
  CatchphraseAnalysis,
  NightOwlAnalysis,
  DragonKingAnalysis,
  DivingAnalysis,
  MonologueAnalysis,
  MentionAnalysis,
  LaughAnalysis,
  MemeBattleAnalysis,
  CheckInAnalysis,
  FileParseInfo,
  ConflictCheckResult,
  MergeParams,
  MergeResult,
} from '../../src/types/chat'

interface TimeFilter {
  startTs?: number
  endTs?: number
}

interface ChatApi {
  selectFile: () => Promise<{ filePath?: string; format?: string; error?: string } | null>
  import: (filePath: string) => Promise<{ success: boolean; sessionId?: string; error?: string }>
  getSessions: () => Promise<AnalysisSession[]>
  getSession: (sessionId: string) => Promise<AnalysisSession | null>
  deleteSession: (sessionId: string) => Promise<boolean>
  getAvailableYears: (sessionId: string) => Promise<number[]>
  getMemberActivity: (sessionId: string, filter?: TimeFilter) => Promise<MemberActivity[]>
  getMemberNameHistory: (sessionId: string, memberId: number) => Promise<MemberNameHistory[]>
  getHourlyActivity: (sessionId: string, filter?: TimeFilter) => Promise<HourlyActivity[]>
  getDailyActivity: (sessionId: string, filter?: TimeFilter) => Promise<DailyActivity[]>
  getWeekdayActivity: (sessionId: string, filter?: TimeFilter) => Promise<WeekdayActivity[]>
  getMonthlyActivity: (sessionId: string, filter?: TimeFilter) => Promise<MonthlyActivity[]>
  getMessageTypeDistribution: (
    sessionId: string,
    filter?: TimeFilter
  ) => Promise<Array<{ type: MessageType; count: number }>>
  getTimeRange: (sessionId: string) => Promise<{ start: number; end: number } | null>
  getDbDirectory: () => Promise<string | null>
  getSupportedFormats: () => Promise<Array<{ name: string; platform: string }>>
  onImportProgress: (callback: (progress: ImportProgress) => void) => () => void
  getRepeatAnalysis: (sessionId: string, filter?: TimeFilter) => Promise<RepeatAnalysis>
  getCatchphraseAnalysis: (sessionId: string, filter?: TimeFilter) => Promise<CatchphraseAnalysis>
  getNightOwlAnalysis: (sessionId: string, filter?: TimeFilter) => Promise<NightOwlAnalysis>
  getDragonKingAnalysis: (sessionId: string, filter?: TimeFilter) => Promise<DragonKingAnalysis>
  getDivingAnalysis: (sessionId: string, filter?: TimeFilter) => Promise<DivingAnalysis>
  getMonologueAnalysis: (sessionId: string, filter?: TimeFilter) => Promise<MonologueAnalysis>
  getMentionAnalysis: (sessionId: string, filter?: TimeFilter) => Promise<MentionAnalysis>
  getLaughAnalysis: (sessionId: string, filter?: TimeFilter, keywords?: string[]) => Promise<LaughAnalysis>
  getMemeBattleAnalysis: (sessionId: string, filter?: TimeFilter) => Promise<MemeBattleAnalysis>
  getCheckInAnalysis: (sessionId: string, filter?: TimeFilter) => Promise<CheckInAnalysis>
}

interface Api {
  send: (channel: string, data?: unknown) => void
  receive: (channel: string, func: (...args: unknown[]) => void) => void
  removeListener: (channel: string, func: (...args: unknown[]) => void) => void
  dialog: {
    showOpenDialog: (options: Electron.OpenDialogOptions) => Promise<Electron.OpenDialogReturnValue>
  }
}

interface MergeApi {
  parseFileInfo: (filePath: string) => Promise<FileParseInfo>
  checkConflicts: (filePaths: string[]) => Promise<ConflictCheckResult>
  mergeFiles: (params: MergeParams) => Promise<MergeResult>
  onParseProgress: (callback: (data: { filePath: string; progress: ImportProgress }) => void) => () => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: Api
    chatApi: ChatApi
    mergeApi: MergeApi
  }
}

export { ChatApi, Api, MergeApi }
