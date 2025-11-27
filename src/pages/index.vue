<script setup lang="ts">
import { useChatStore } from '@/stores/chat'
import { storeToRefs } from 'pinia'
import Sidebar from '@/components/Sidebar.vue'
import WelcomeGuide from '@/components/WelcomeGuide.vue'
import AnalysisDashboard from '@/components/AnalysisDashboard.vue'

const chatStore = useChatStore()
const { currentSessionId, isInitialized } = storeToRefs(chatStore)
</script>

<template>
  <div class="flex h-screen w-full overflow-hidden bg-white dark:bg-gray-950">
    <template v-if="!isInitialized">
      <div class="flex h-full w-full items-center justify-center">
        <div class="text-center">
          <UIcon name="i-heroicons-arrow-path" class="h-8 w-8 animate-spin text-indigo-500" />
          <p class="mt-2 text-sm text-gray-500">加载中...</p>
        </div>
      </div>
    </template>
    <template v-else>
      <Sidebar />
      <main class="flex-1 overflow-hidden">
        <WelcomeGuide v-if="!currentSessionId" />
        <AnalysisDashboard v-else />
      </main>
    </template>
  </div>
</template>
