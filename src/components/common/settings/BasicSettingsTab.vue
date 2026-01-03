<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useLayoutStore } from '@/stores/layout'
import { useSettingsStore } from '@/stores/settings'
import { useColorMode } from '@vueuse/core'
import { availableLocales, type LocaleType } from '@/i18n'
import NetworkSettingsSection from './NetworkSettingsSection.vue'

const { t } = useI18n()

// Store
const layoutStore = useLayoutStore()
const settingsStore = useSettingsStore()
const { screenshotMobileAdapt } = storeToRefs(layoutStore)
const { locale } = storeToRefs(settingsStore)

// Color Mode
const colorMode = useColorMode({
  emitAuto: true,
  initialValue: 'light',
})

const colorModeOptions = [
  { label: '跟随系统', value: 'auto' },
  { label: '浅色模式', value: 'light' },
  { label: '深色模式', value: 'dark' },
]

// Language options
const languageOptions = computed(() =>
  availableLocales.map((l) => ({
    label: l.nativeName,
    value: l.code,
  }))
)

// Handle language change
function handleLocaleChange(newLocale: LocaleType) {
  settingsStore.setLocale(newLocale)
}
</script>

<template>
  <div class="space-y-6">
    <!-- 语言设置 -->
    <div>
      <h3 class="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
        <UIcon name="i-heroicons-language" class="h-4 w-4 text-green-500" />
        {{ t('settings.basic.language.title') }}
      </h3>
      <div class="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/50">
        <div class="flex items-center justify-between">
          <div class="flex-1 pr-4">
            <p class="text-sm font-medium text-gray-900 dark:text-white">
              {{ t('settings.basic.language.description') }}
            </p>
          </div>
          <div class="w-48">
            <UTabs :model-value="locale" :items="languageOptions" @update:model-value="handleLocaleChange"></UTabs>
          </div>
        </div>
      </div>
    </div>

    <!-- 外观设置 -->
    <div>
      <h3 class="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
        <UIcon name="i-heroicons-paint-brush" class="h-4 w-4 text-pink-500" />
        外观设置
      </h3>
      <div class="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/50">
        <div class="flex items-center justify-between">
          <div class="flex-1 pr-4">
            <p class="text-sm font-medium text-gray-900 dark:text-white">主题模式</p>
          </div>
          <div class="w-64">
            <UTabs v-model="colorMode" :items="colorModeOptions"></UTabs>
          </div>
        </div>
      </div>
    </div>

    <!-- 截图设置 -->
    <div>
      <h3 class="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
        <UIcon name="i-heroicons-camera" class="h-4 w-4 text-blue-500" />
        截图设置
      </h3>
      <div class="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/50">
        <div class="flex items-center justify-between">
          <div class="flex-1 pr-4">
            <p class="text-sm font-medium text-gray-900 dark:text-white">移动端适配</p>
            <p class="text-xs text-gray-500 dark:text-gray-400">截图时自动缩放宽度，适合移动端查看</p>
          </div>
          <USwitch v-model="screenshotMobileAdapt" />
        </div>
      </div>
    </div>

    <!-- 网络设置 -->
    <NetworkSettingsSection />
  </div>
</template>
