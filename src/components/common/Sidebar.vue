<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { ref, onMounted, nextTick } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import type { AnalysisSession } from '@/types/base'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import 'dayjs/locale/zh-cn'
import 'dayjs/locale/en'
import SidebarFooter from './sidebar/SidebarFooter.vue'
import { useSessionStore } from '@/stores/session'
import { useLayoutStore } from '@/stores/layout'
import { useSettingsStore } from '@/stores/settings'

dayjs.extend(relativeTime)

const { t } = useI18n()
const settingsStore = useSettingsStore()

const sessionStore = useSessionStore()
const layoutStore = useLayoutStore()
const { sessions, sortedSessions } = storeToRefs(sessionStore)
const { isSidebarCollapsed: isCollapsed } = storeToRefs(layoutStore)
const { toggleSidebar } = layoutStore
const router = useRouter()
const route = useRoute()

// 重命名相关状态
const showRenameModal = ref(false)
const renameTarget = ref<AnalysisSession | null>(null)
const newName = ref('')
const renameInputRef = ref<HTMLInputElement | null>(null)

// 删除确认相关状态
const showDeleteModal = ref(false)
const deleteTarget = ref<AnalysisSession | null>(null)

// 加载会话列表
onMounted(() => {
  sessionStore.loadSessions()
})

function handleImport() {
  // Navigate to home (Welcome Guide)
  router.push('/')
}

function formatTime(timestamp: number): string {
  return dayjs.unix(timestamp).fromNow()
}

// 打开重命名弹窗
function openRenameModal(session: AnalysisSession) {
  renameTarget.value = session
  newName.value = session.name
  showRenameModal.value = true
  // 等待 DOM 更新后聚焦输入框
  nextTick(() => {
    renameInputRef.value?.focus()
    renameInputRef.value?.select()
  })
}

// 执行重命名
async function handleRename() {
  if (!renameTarget.value || !newName.value.trim()) return

  const success = await sessionStore.renameSession(renameTarget.value.id, newName.value.trim())
  if (success) {
    showRenameModal.value = false
    renameTarget.value = null
    newName.value = ''
  }
}

// 关闭重命名弹窗
function closeRenameModal() {
  showRenameModal.value = false
  renameTarget.value = null
  newName.value = ''
}

// 打开删除确认弹窗
function openDeleteModal(session: AnalysisSession) {
  deleteTarget.value = session
  showDeleteModal.value = true
}

// 确认删除会话
async function confirmDelete() {
  if (!deleteTarget.value) return

  await sessionStore.deleteSession(deleteTarget.value.id)
  showDeleteModal.value = false
  deleteTarget.value = null
}

// 关闭删除确认弹窗
function closeDeleteModal() {
  showDeleteModal.value = false
  deleteTarget.value = null
}

// 生成右键菜单项
function getContextMenuItems(session: AnalysisSession) {
  const isPinned = sessionStore.isPinned(session.id)
  return [
    [
      {
        label: t('sidebar.contextMenu.rename'),
        icon: 'i-lucide-pencil',
        class: 'p-2',
        onSelect: () => openRenameModal(session),
      },
      {
        label: isPinned ? t('sidebar.contextMenu.unpin') : t('sidebar.contextMenu.pin'),
        icon: isPinned ? 'i-lucide-pin-off' : 'i-lucide-pin',
        class: 'p-2',
        onSelect: () => sessionStore.togglePinSession(session.id),
      },
      {
        label: t('sidebar.contextMenu.delete'),
        icon: 'i-lucide-trash',
        color: 'error' as const,
        class: 'p-2',
        onSelect: () => openDeleteModal(session),
      },
    ],
  ]
}

// 根据会话类型获取路由名称
function getSessionRouteName(session: AnalysisSession): string {
  return session.type === 'private' ? 'private-chat' : 'group-chat'
}

// 判断是否是私聊
function isPrivateChat(session: AnalysisSession): boolean {
  return session.type === 'private'
}

// 获取会话头像显示文字：私聊取最后两字，群聊取前两字
function getSessionAvatarText(session: AnalysisSession): string {
  const name = session.name || ''
  if (!name) return '?'
  if (isPrivateChat(session)) {
    // 私聊：取最后两个字
    return name.length <= 2 ? name : name.slice(-2)
  } else {
    // 群聊：取前两个字
    return name.length <= 2 ? name : name.slice(0, 2)
  }
}
</script>

<template>
  <div
    class="flex h-full flex-col border-r border-gray-200 bg-gray-50 transition-all duration-300 ease-in-out dark:border-gray-800 dark:bg-gray-900"
    :class="[isCollapsed ? 'w-20' : 'w-72']"
  >
    <!-- Top Section -->
    <div class="flex flex-col p-4">
      <!-- Header / Toggle -->
      <div class="mb-2 flex items-center" :class="[isCollapsed ? 'justify-center' : 'justify-between']">
        <div v-if="!isCollapsed" class="text-2xl font-black tracking-tight text-pink-500 ml-2">{{ t('sidebar.brand') }}</div>
        <UTooltip :text="isCollapsed ? t('sidebar.tooltip.expand') : t('sidebar.tooltip.collapse')" :popper="{ placement: 'right' }">
          <UButton
            icon="i-heroicons-bars-3"
            color="gray"
            variant="ghost"
            size="md"
            class="flex h-12 w-12 cursor-pointer items-center justify-center rounded-full hover:bg-gray-200/60 dark:hover:bg-gray-800"
            @click="toggleSidebar"
          />
        </UTooltip>
      </div>

      <!-- New Analysis Button -->
      <UTooltip :text="isCollapsed ? t('sidebar.newAnalysis') : ''" :popper="{ placement: 'right' }">
        <UButton
          :block="!isCollapsed"
          class="transition-all rounded-full hover:bg-gray-200/60 dark:hover:bg-gray-800 h-12 cursor-pointer"
          :class="[isCollapsed ? 'flex w-12 items-center justify-center px-0' : 'justify-start pl-4']"
          color="gray"
          variant="ghost"
          @click="handleImport"
        >
          <UIcon name="i-heroicons-plus" class="h-5 w-5 shrink-0" :class="[isCollapsed ? '' : 'mr-2']" />
          <span v-if="!isCollapsed" class="truncate">{{ t('sidebar.newAnalysis') }}</span>
        </UButton>
      </UTooltip>

      <!-- Tools Button -->
      <UTooltip :text="isCollapsed ? t('sidebar.tools') : ''" :popper="{ placement: 'right' }">
        <UButton
          :block="!isCollapsed"
          class="transition-all rounded-full hover:bg-gray-200/60 dark:hover:bg-gray-800 h-12 cursor-pointer mt-2"
          :class="[
            isCollapsed ? 'flex w-12 items-center justify-center px-0' : 'justify-start pl-4',
            route.name === 'tools'
              ? 'bg-primary-100 text-primary-600 dark:bg-primary-900/30 dark:text-primary-400'
              : '',
          ]"
          color="gray"
          variant="ghost"
          @click="router.push({ name: 'tools' })"
        >
          <UIcon name="i-heroicons-wrench-screwdriver" class="h-4 w-4 shrink-0" :class="[isCollapsed ? '' : 'mr-2']" />
          <span v-if="!isCollapsed" class="truncate">{{ t('sidebar.tools') }}</span>
        </UButton>
      </UTooltip>
    </div>

    <!-- Session List -->
    <div class="flex-1 relative min-h-0 px-4 flex flex-col">
      <!-- 聊天记录标题 - 固定在顶部，不随列表滚动 -->
      <UTooltip
        v-if="!isCollapsed && sessions.length > 0"
        :text="t('sidebar.tooltip.hint')"
        :popper="{ placement: 'right' }"
      >
        <div class="px-3 mb-2 flex items-center gap-1">
          <div class="text-sm font-medium text-gray-500">{{ t('sidebar.chatHistory') }}</div>
          <UIcon name="i-heroicons-question-mark-circle" class="size-3.5 text-gray-400" />
        </div>
      </UTooltip>

      <!-- 聊天记录列表 - 可滚动区域 -->
      <div class="flex-1 overflow-y-auto">
        <div v-if="sessions.length === 0 && !isCollapsed" class="py-8 text-center text-sm text-gray-500">{{ t('sidebar.noRecords') }}</div>

        <div class="space-y-1 pb-8">
          <UTooltip
            v-for="session in sortedSessions"
            :key="session.id"
            :text="isCollapsed ? session.name : ''"
            :popper="{ placement: 'right' }"
          >
            <UContextMenu :items="getContextMenuItems(session)">
              <div
                class="group relative flex w-full items-center rounded-full p-2 text-left transition-colors"
                :class="[
                  route.params.id === session.id && !isCollapsed
                    ? 'bg-primary-100 text-gray-900 dark:bg-primary-900/30 dark:text-primary-100'
                    : 'text-gray-700 dark:text-gray-200 hover:bg-gray-200/60 dark:hover:bg-gray-800',
                  isCollapsed ? 'justify-center cursor-pointer' : 'cursor-pointer',
                ]"
                @click="router.push({ name: getSessionRouteName(session), params: { id: session.id } })"
              >
                <!-- Platform Icon / Text Avatar - 私聊和群聊使用不同样式 -->
                <div
                  class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[10px] font-bold"
                  :class="[
                    route.params.id === session.id
                      ? isPrivateChat(session)
                        ? 'bg-pink-600 text-white dark:bg-pink-500 dark:text-white'
                        : 'bg-primary-600 text-white dark:bg-primary-500 dark:text-white'
                      : 'bg-gray-400 text-white dark:bg-gray-600 dark:text-white',
                    isCollapsed ? '' : 'mr-3',
                  ]"
                >
                  <!-- 折叠时显示缩略名字，不折叠时显示图标 -->
                  <template v-if="isCollapsed">
                    {{ getSessionAvatarText(session) }}
                  </template>
                  <template v-else>
                    <UIcon
                      :name="isPrivateChat(session) ? 'i-heroicons-user' : 'i-heroicons-chat-bubble-left-right'"
                      class="h-4 w-4"
                    />
                  </template>
                </div>

                <!-- Session Info -->
                <div v-if="!isCollapsed" class="min-w-0 flex-1">
                  <div class="flex items-center justify-between gap-2">
                    <p class="truncate text-sm font-medium">
                      {{ session.name }}
                    </p>
                    <UIcon
                      v-if="sessionStore.isPinned(session.id)"
                      name="i-lucide-pin"
                      class="h-3.5 w-3.5 shrink-0 text-gray-400 rotate-45"
                    />
                  </div>
                  <p class="truncate text-xs text-gray-500 dark:text-gray-400">
                    {{ session.messageCount }} 条消息 · {{ formatTime(session.importedAt) }}
                  </p>
                </div>
              </div>
            </UContextMenu>
          </UTooltip>
        </div>
      </div>
      <!-- Fade overlay at bottom -->
      <div
        class="absolute bottom-0 left-0 right-0 h-16 pointer-events-none bg-gradient-to-t from-gray-50 dark:from-gray-900 to-transparent"
      />
    </div>

    <!-- Rename Modal -->
    <UModal v-model:open="showRenameModal">
      <template #content>
        <div class="p-4">
          <h3 class="mb-3 font-semibold text-gray-900 dark:text-white">{{ t('sidebar.renameModal.title') }}</h3>
          <UInput
            ref="renameInputRef"
            v-model="newName"
            :placeholder="t('sidebar.renameModal.placeholder')"
            class="mb-4 w-100"
            @keydown.enter="handleRename"
          />
          <div class="flex justify-end gap-2">
            <UButton variant="soft" @click="closeRenameModal">{{ t('common.cancel') }}</UButton>
            <UButton color="primary" :disabled="!newName.trim()" @click="handleRename">{{ t('common.confirm') }}</UButton>
          </div>
        </div>
      </template>
    </UModal>

    <!-- Delete Confirmation Modal -->
    <UModal v-model:open="showDeleteModal">
      <template #content>
        <div class="p-4">
          <h3 class="mb-3 font-semibold text-gray-900 dark:text-white">{{ t('sidebar.deleteModal.title') }}</h3>
          <p class="mb-4 text-sm text-gray-600 dark:text-gray-400">
            {{ t('sidebar.deleteModal.message', { name: deleteTarget?.name }) }}
          </p>
          <div class="flex justify-end gap-2">
            <UButton variant="soft" @click="closeDeleteModal">{{ t('common.cancel') }}</UButton>
            <UButton color="error" @click="confirmDelete">{{ t('common.delete') }}</UButton>
          </div>
        </div>
      </template>
    </UModal>

    <!-- Footer -->
    <SidebarFooter />
  </div>
</template>
