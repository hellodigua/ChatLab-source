/**
 * 支持的语言类型
 */
export type LocaleType = 'zh-CN' | 'en-US'

/**
 * 语言配置项
 */
export interface LocaleOption {
  code: LocaleType
  name: string
  nativeName: string
}

/**
 * 可用的语言列表
 */
export const availableLocales: LocaleOption[] = [
  { code: 'zh-CN', name: 'Chinese (Simplified)', nativeName: '简体中文' },
  { code: 'en-US', name: 'English (US)', nativeName: 'English' },
]

/**
 * 默认语言
 */
export const defaultLocale: LocaleType = 'zh-CN'

/**
 * 检测系统语言
 */
export function detectSystemLocale(): LocaleType {
  const systemLocale = navigator.language
  if (systemLocale.startsWith('zh')) {
    return 'zh-CN'
  }
  return 'en-US'
}

/**
 * 功能模块的语言支持配置
 * 某些功能可能只支持特定语言
 */
export interface FeatureLocaleSupport {
  /** 功能标识 */
  feature: string
  /** 支持的语言列表，如果为空则支持所有语言 */
  supportedLocales: LocaleType[]
}

/**
 * 功能语言限制配置
 * 用于控制某些功能只在特定语言下显示
 */
export const featureLocaleRestrictions: Record<string, LocaleType[]> = {
  // 群榜单（龙王、夜猫等）只在中文下显示
  groupRanking: ['zh-CN'],
  // 以后可以在这里添加更多限制
}

/**
 * 检查功能是否支持当前语言
 */
export function isFeatureSupported(feature: string, currentLocale: LocaleType): boolean {
  const supportedLocales = featureLocaleRestrictions[feature]
  // 如果没有配置限制，则支持所有语言
  if (!supportedLocales || supportedLocales.length === 0) {
    return true
  }
  return supportedLocales.includes(currentLocale)
}

