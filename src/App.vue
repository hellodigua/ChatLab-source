<script setup lang="ts">
import { onMounted } from 'vue'
import { storeToRefs } from 'pinia'
import { useRoute } from 'vue-router'
import Sidebar from '@/components/common/Sidebar.vue'
import SettingModal from '@/components/common/SettingModal.vue'
import ScreenCaptureModal from '@/components/common/ScreenCaptureModal.vue'
import { ChatRecordDrawer } from '@/components/common/ChatRecord'
import { useSessionStore } from '@/stores/session'
import { useLayoutStore } from '@/stores/layout'
import { usePromptStore } from '@/stores/prompt'
import { useSettingsStore } from '@/stores/settings'

const sessionStore = useSessionStore()
const layoutStore = useLayoutStore()
const promptStore = usePromptStore()
const settingsStore = useSettingsStore()
const { isInitialized } = storeToRefs(sessionStore)
const route = useRoute()

const tooltip = {
  delayDuration: 100,
}

// 应用启动时初始化
onMounted(async () => {
  // 初始化语言设置（同步 i18n 和 dayjs）
  settingsStore.initLocale()
  // 从数据库加载会话列表
  await sessionStore.loadSessions()
})
</script>

<template>
  <UApp :tooltip="tooltip">
    <div class="flex h-screen w-full overflow-hidden bg-white dark:bg-gray-950">
      <template v-if="!isInitialized">
        <div class="flex h-full w-full items-center justify-center">
          <div class="flex flex-col items-center justify-center text-center">
            <UIcon name="i-heroicons-arrow-path" class="h-8 w-8 animate-spin text-pink-500" />
            <p class="mt-2 text-sm text-gray-500">加载中...</p>
          </div>
        </div>
      </template>
      <template v-else>
        <Sidebar />
        <main class="flex-1 overflow-hidden">
          <router-view v-slot="{ Component }">
            <Transition name="page-fade" mode="out-in">
              <component :is="Component" :key="route.path" />
            </Transition>
          </router-view>
        </main>
      </template>
    </div>
    <SettingModal
      v-model:open="layoutStore.showSettingModal"
      @ai-config-saved="promptStore.notifyAIConfigChanged"
    />
    <ScreenCaptureModal
      :open="layoutStore.showScreenCaptureModal"
      :image-data="layoutStore.screenCaptureImage"
      @update:open="(v) => (v ? null : layoutStore.closeScreenCaptureModal())"
    />
    <!-- 全局聊天记录查看器 -->
    <ChatRecordDrawer />
  </UApp>
</template>

<style scoped>
.page-fade-enter-active,
.page-fade-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}

.page-fade-enter-from {
  opacity: 0;
  transform: translateY(10px);
}

.page-fade-leave-to {
  opacity: 0;
  transform: translateY(-10px);
}
</style>
