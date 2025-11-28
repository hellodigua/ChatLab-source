<script setup lang="ts">
import { ref, onMounted, watch, computed } from 'vue'
import { useChatStore } from '@/stores/chat'
import { storeToRefs } from 'pinia'
import type { AnalysisSession, MemberActivity, HourlyActivity, DailyActivity, MessageType } from '@/types/chat'
import UITabs from '@/components/UI/Tabs.vue'
import OverviewTab from './analysis/OverviewTab.vue'
import MembersTab from './analysis/MembersTab.vue'
import TimeTab from './analysis/TimeTab.vue'
import TimelineTab from './analysis/TimelineTab.vue'

const chatStore = useChatStore()
const { currentSessionId } = storeToRefs(chatStore)

// 数据状态
const isLoading = ref(true)
const session = ref<AnalysisSession | null>(null)
const memberActivity = ref<MemberActivity[]>([])
const hourlyActivity = ref<HourlyActivity[]>([])
const dailyActivity = ref<DailyActivity[]>([])
const messageTypes = ref<Array<{ type: MessageType; count: number }>>([])
const timeRange = ref<{ start: number; end: number } | null>(null)

// 年份筛选
const availableYears = ref<number[]>([])
const selectedYear = ref<number>(0) // 0 表示全部
const isInitialLoad = ref(false) // 用于跳过初始加载时的 watch 触发

// Tab 配置
const tabs = [
  { id: 'overview', label: '总览', icon: 'i-heroicons-chart-pie' },
  { id: 'members', label: '成员', icon: 'i-heroicons-user-group' },
  { id: 'time', label: '规律', icon: 'i-heroicons-clock' },
  { id: 'timeline', label: '趋势', icon: 'i-heroicons-chart-bar' },
]

const activeTab = ref('overview')

// 计算时间过滤参数
const timeFilter = computed(() => {
  if (selectedYear.value === 0) {
    return undefined
  }
  // 计算年份的开始和结束时间戳
  const startDate = new Date(selectedYear.value, 0, 1, 0, 0, 0)
  const endDate = new Date(selectedYear.value, 11, 31, 23, 59, 59)
  return {
    startTs: Math.floor(startDate.getTime() / 1000),
    endTs: Math.floor(endDate.getTime() / 1000),
  }
})

// 年份选项
const yearOptions = computed(() => {
  const options = [{ label: '全部时间', value: 0 }]
  for (const year of availableYears.value) {
    options.push({ label: `${year}年`, value: year })
  }
  return options
})

// 计算属性
const topMembers = computed(() => memberActivity.value.slice(0, 3))
const bottomMembers = computed(() => {
  if (memberActivity.value.length <= 1) return []
  return [...memberActivity.value].sort((a, b) => a.messageCount - b.messageCount).slice(0, 1)
})

// 当前筛选后的消息总数
const filteredMessageCount = computed(() => {
  return memberActivity.value.reduce((sum, m) => sum + m.messageCount, 0)
})

// 当前筛选后的活跃成员数
const filteredMemberCount = computed(() => {
  return memberActivity.value.filter((m) => m.messageCount > 0).length
})

// 加载基础数据（不受年份筛选影响）
async function loadBaseData() {
  if (!currentSessionId.value) return

  try {
    const [sessionData, years, range] = await Promise.all([
      window.chatApi.getSession(currentSessionId.value),
      window.chatApi.getAvailableYears(currentSessionId.value),
      window.chatApi.getTimeRange(currentSessionId.value),
    ])

    session.value = sessionData
    availableYears.value = years
    timeRange.value = range

    // 默认选择最近的年份（years 已按降序排列）
    if (years.length > 0) {
      selectedYear.value = years[0]
    } else {
      selectedYear.value = 0
    }
  } catch (error) {
    console.error('加载基础数据失败:', error)
  }
}

// 加载分析数据（受年份筛选影响）
async function loadAnalysisData() {
  if (!currentSessionId.value) return

  isLoading.value = true

  try {
    const filter = timeFilter.value

    const [members, hourly, daily, types] = await Promise.all([
      window.chatApi.getMemberActivity(currentSessionId.value, filter),
      window.chatApi.getHourlyActivity(currentSessionId.value, filter),
      window.chatApi.getDailyActivity(currentSessionId.value, filter),
      window.chatApi.getMessageTypeDistribution(currentSessionId.value, filter),
    ])

    memberActivity.value = members
    hourlyActivity.value = hourly
    dailyActivity.value = daily
    messageTypes.value = types
  } catch (error) {
    console.error('加载分析数据失败:', error)
  } finally {
    isLoading.value = false
  }
}

// 加载所有数据
async function loadData() {
  isInitialLoad.value = true
  await loadBaseData()
  await loadAnalysisData()
  isInitialLoad.value = false
}

// 监听会话变化
watch(
  currentSessionId,
  () => {
    // 年份筛选会在 loadBaseData 中自动设置为最近年份
    loadData()
  },
  { immediate: true }
)

// 监听年份筛选变化（仅用户手动切换年份时触发）
watch(selectedYear, () => {
  // 跳过初始加载时的触发，避免重复加载
  if (isInitialLoad.value) return
  loadAnalysisData()
})

onMounted(loadData)
</script>

<template>
  <div class="flex h-full flex-col bg-gray-50 dark:bg-gray-950">
    <!-- Loading State -->
    <div v-if="isLoading && !session" class="flex h-full items-center justify-center">
      <div class="text-center">
        <UIcon name="i-heroicons-arrow-path" class="h-8 w-8 animate-spin text-pink-500" />
        <p class="mt-2 text-sm text-gray-500">加载分析数据...</p>
      </div>
    </div>

    <!-- Content -->
    <template v-else-if="session">
      <!-- Header -->
      <div class="border-b border-gray-200 bg-white px-6 py-4 dark:border-gray-800 dark:bg-gray-900">
        <div class="flex items-center justify-between">
          <!-- Session Info -->
          <div class="flex items-center gap-3">
            <div
              class="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-pink-400 to-pink-600"
            >
              <UIcon name="i-heroicons-chat-bubble-left-right" class="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 class="text-lg font-semibold text-gray-900 dark:text-white">
                {{ session.name }}
              </h1>
              <p class="text-xs text-gray-500 dark:text-gray-400">
                <template v-if="selectedYear">
                  {{ selectedYear }}年: {{ filteredMessageCount }} 条消息 · {{ filteredMemberCount }} 位活跃成员
                </template>
                <template v-else>{{ session.messageCount }} 条消息 · {{ session.memberCount }} 位成员</template>
              </p>
            </div>
          </div>

          <!-- Year Filter & Actions -->
          <div class="flex items-center gap-3">
            <!-- Actions -->
            <UButton icon="i-heroicons-arrow-down-tray" color="gray" variant="ghost" size="sm" disabled>
              生成报告
            </UButton>
          </div>
        </div>

        <!-- Tabs -->
        <div class="mt-4 flex items-center gap-1">
          <button
            v-for="tab in tabs"
            :key="tab.id"
            class="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all"
            :class="[
              activeTab === tab.id
                ? 'bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-300'
                : 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800',
            ]"
            @click="activeTab = tab.id"
          >
            <UIcon :name="tab.icon" class="h-4 w-4" />
            {{ tab.label }}
          </button>
          <!-- 年份选择器靠右 -->
          <UITabs v-model="selectedYear" :items="yearOptions" size="sm" class="ml-auto" />
        </div>
      </div>

      <!-- Tab Content -->
      <div class="relative flex-1 overflow-y-auto">
        <!-- Loading Overlay - 完全覆盖内容区 -->
        <div
          v-if="isLoading"
          class="absolute inset-0 z-50 flex items-center justify-center bg-gray-50 dark:bg-gray-950"
        >
          <div class="text-center">
            <UIcon name="i-heroicons-arrow-path" class="h-8 w-8 animate-spin text-pink-500" />
            <p class="mt-3 text-sm font-medium text-gray-600 dark:text-gray-400">加载中...</p>
          </div>
        </div>

        <!-- Content with padding -->
        <div class="p-6">

        <Transition name="fade" mode="out-in">
          <OverviewTab
            v-if="activeTab === 'overview'"
            :session="session"
            :member-activity="memberActivity"
            :top-members="topMembers"
            :bottom-members="bottomMembers"
            :message-types="messageTypes"
            :hourly-activity="hourlyActivity"
            :time-range="timeRange"
            :selected-year="selectedYear"
            :filtered-message-count="filteredMessageCount"
            :filtered-member-count="filteredMemberCount"
          />
          <MembersTab
            v-else-if="activeTab === 'members'"
            :session-id="currentSessionId!"
            :member-activity="memberActivity"
            :time-filter="timeFilter"
          />
          <TimeTab
            v-else-if="activeTab === 'time'"
            :session-id="currentSessionId!"
            :hourly-activity="hourlyActivity"
            :time-filter="timeFilter"
          />
          <TimelineTab
            v-else-if="activeTab === 'timeline'"
            :session-id="currentSessionId!"
            :daily-activity="dailyActivity"
            :time-range="timeRange"
            :time-filter="timeFilter"
          />
        </Transition>
        </div>
      </div>
    </template>

    <!-- Empty State -->
    <div v-else class="flex h-full items-center justify-center">
      <p class="text-gray-500">无法加载会话数据</p>
    </div>
  </div>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.15s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
