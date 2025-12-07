<script setup lang="ts">
import { useChatStore } from '@/stores/chat'
import { storeToRefs } from 'pinia'
import { ref, onMounted, nextTick } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import type { AnalysisSession } from '@/types/chat'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import 'dayjs/locale/zh-cn'
import SidebarFooter from './sidebar/SidebarFooter.vue'

dayjs.extend(relativeTime)
dayjs.locale('zh-cn')

const chatStore = useChatStore()
const { sessions, isSidebarCollapsed: isCollapsed } = storeToRefs(chatStore)
const { toggleSidebar } = chatStore
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
  chatStore.loadSessions()
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

  const success = await chatStore.renameSession(renameTarget.value.id, newName.value.trim())
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

  await chatStore.deleteSession(deleteTarget.value.id)
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
  return [
    [
      {
        label: '重命名',
        icon: 'i-lucide-pencil',
        onSelect: () => openRenameModal(session),
      },
      {
        label: '删除',
        icon: 'i-lucide-trash',
        color: 'error' as const,
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
        <div v-if="!isCollapsed" class="text-lg font-semibold text-gray-900 dark:text-white">ChatLab</div>
        <UTooltip :text="isCollapsed ? '展开侧边栏' : '收起侧边栏'" :popper="{ placement: 'right' }">
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
      <UTooltip :text="isCollapsed ? '分析新聊天' : ''" :popper="{ placement: 'right' }">
        <UButton
          :block="!isCollapsed"
          class="transition-all rounded-full hover:bg-gray-200/60 dark:hover:bg-gray-800 h-12 cursor-pointer"
          :class="[isCollapsed ? 'flex w-12 items-center justify-center px-0' : 'justify-start pl-4']"
          color="gray"
          variant="ghost"
          @click="handleImport"
        >
          <UIcon name="i-heroicons-plus" class="h-5 w-5 shrink-0" :class="[isCollapsed ? '' : 'mr-2']" />
          <span v-if="!isCollapsed" class="truncate">分析新聊天</span>
        </UButton>
      </UTooltip>

      <!-- Tools Button -->
      <UTooltip :text="isCollapsed ? '实用工具' : ''" :popper="{ placement: 'right' }">
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
          <UIcon name="i-heroicons-squares-2x2" class="h-5 w-5 shrink-0" :class="[isCollapsed ? '' : 'mr-2']" />
          <span v-if="!isCollapsed" class="truncate">实用工具</span>
        </UButton>
      </UTooltip>
    </div>

    <!-- Session List -->
    <div class="flex-1 relative min-h-0">
      <div class="h-full overflow-y-auto px-3">
        <div v-if="sessions.length === 0 && !isCollapsed" class="py-8 text-center text-sm text-gray-500">暂无记录</div>

        <div class="space-y-1">
          <!-- Session List Header - Sticky -->
          <UTooltip
            v-if="!isCollapsed && sessions.length > 0"
            text="右键可删除或重命名聊天记录"
            :popper="{ placement: 'right' }"
          >
            <div class="sticky top-0 bg-gray-50 dark:bg-gray-900 mb-4 px-2 flex items-center gap-1">
              <div class="text-sm font-medium text-gray-500">聊天记录</div>
              <UIcon name="i-heroicons-question-mark-circle" class="size-3.5 text-gray-400" />
            </div>
          </UTooltip>

          <UTooltip
            v-for="session in sessions"
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
                  class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold"
                  :class="[
                    route.params.id === session.id
                      ? isPrivateChat(session)
                        ? 'bg-pink-600 text-white dark:bg-pink-500 dark:text-white'
                        : 'bg-primary-600 text-white dark:bg-primary-500 dark:text-white'
                      : isPrivateChat(session)
                        ? 'bg-gray-400 text-white dark:bg-pink-600 dark:text-white'
                        : 'bg-gray-400 text-white dark:bg-gray-600 dark:text-white',
                    isCollapsed ? '' : 'mr-3',
                  ]"
                >
                  <!-- 私聊显示用户图标，群聊显示首字母 -->
                  <UIcon v-if="isPrivateChat(session)" name="i-heroicons-user" class="h-4 w-4" />
                  <template v-else>{{ session.name ? session.name.charAt(0) : '?' }}</template>
                </div>

                <!-- Session Info -->
                <div v-if="!isCollapsed" class="min-w-0 flex-1">
                  <p class="truncate text-sm font-medium">
                    {{ session.name }}
                  </p>
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
          <h3 class="mb-3 font-semibold text-gray-900 dark:text-white">重命名</h3>
          <UInput
            ref="renameInputRef"
            v-model="newName"
            placeholder="请输入新名称"
            class="mb-4 w-100"
            @keydown.enter="handleRename"
          />
          <div class="flex justify-end gap-2">
            <UButton variant="soft" @click="closeRenameModal">取消</UButton>
            <UButton color="primary" :disabled="!newName.trim()" @click="handleRename">确定</UButton>
          </div>
        </div>
      </template>
    </UModal>

    <!-- Delete Confirmation Modal -->
    <UModal v-model:open="showDeleteModal">
      <template #content>
        <div class="p-4">
          <h3 class="mb-3 font-semibold text-gray-900 dark:text-white">确认删除</h3>
          <p class="mb-4 text-sm text-gray-600 dark:text-gray-400">
            确定要删除聊天记录
            <span class="font-medium text-gray-900 dark:text-white">"{{ deleteTarget?.name }}"</span>
            吗？此操作无法撤销。
          </p>
          <div class="flex justify-end gap-2">
            <UButton variant="soft" @click="closeDeleteModal">取消</UButton>
            <UButton color="error" @click="confirmDelete">删除</UButton>
          </div>
        </div>
      </template>
    </UModal>

    <!-- Footer -->
    <SidebarFooter />
  </div>
</template>
