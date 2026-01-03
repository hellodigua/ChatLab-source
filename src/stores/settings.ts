import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import dayjs from 'dayjs'
import 'dayjs/locale/zh-cn'
import 'dayjs/locale/en'
import { type LocaleType, detectSystemLocale, setLocale as setI18nLocale } from '@/i18n'

/**
 * 全局设置 Store
 * 管理语言偏好、外观设置等
 */
export const useSettingsStore = defineStore(
  'settings',
  () => {
    // 语言设置（默认检测系统语言）
    const locale = ref<LocaleType>(detectSystemLocale())

    /**
     * 切换语言
     */
    function setLocale(newLocale: LocaleType) {
      locale.value = newLocale

      // 同步更新 vue-i18n
      setI18nLocale(newLocale)

      // 同步更新 dayjs
      dayjs.locale(newLocale === 'zh-CN' ? 'zh-cn' : 'en')

      // 通知主进程（用于对话框等）
      window.electron?.ipcRenderer.send('locale:change', newLocale)
    }

    /**
     * 初始化语言设置
     * 应在应用启动时调用
     */
    function initLocale() {
      // 同步 i18n 和 dayjs 到当前保存的语言
      setI18nLocale(locale.value)
      dayjs.locale(locale.value === 'zh-CN' ? 'zh-cn' : 'en')
    }

    return {
      locale,
      setLocale,
      initLocale,
    }
  },
  {
    persist: true, // 持久化到 localStorage
  }
)

