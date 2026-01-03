import { createI18n } from 'vue-i18n'
import zhCN from './locales/zh-CN'
import enUS from './locales/en-US'
import { defaultLocale, type LocaleType } from './types'

// 导出类型
export type { LocaleType } from './types'
export {
  availableLocales,
  defaultLocale,
  detectSystemLocale,
  isFeatureSupported,
  featureLocaleRestrictions,
} from './types'

/**
 * 创建 i18n 实例
 */
export const i18n = createI18n({
  legacy: false, // 使用 Composition API 模式
  locale: defaultLocale, // 默认语言
  fallbackLocale: 'en-US', // 回退语言
  messages: {
    'zh-CN': zhCN,
    'en-US': enUS,
  },
})

/**
 * 动态切换语言
 */
export function setLocale(locale: LocaleType) {
  i18n.global.locale.value = locale
}

/**
 * 获取当前语言
 */
export function getLocale(): LocaleType {
  return i18n.global.locale.value as LocaleType
}

export default i18n

