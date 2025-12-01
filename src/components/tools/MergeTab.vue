<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { FileDropZone } from '@/components/UI'

interface FileInfo {
  id: string
  path: string
  name: string
  format: string
  messageCount: number
  fileSize?: number // 文件大小（字节）
  status: 'pending' | 'parsed' | 'error'
  error?: string
  // 解析进度（用于大文件）
  progress?: number
  progressMessage?: string
}

// 格式化文件大小
function formatFileSize(bytes?: number): string {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

interface MergeConflict {
  id: string
  timestamp: number
  sender: string
  contentLength1: number
  contentLength2: number
  content1: string
  content2: string
  source1?: string
  source2?: string
  resolution?: 'keep1' | 'keep2' | 'keepBoth'
}

const files = ref<FileInfo[]>([])
const conflicts = ref<MergeConflict[]>([])
const outputName = ref('')
const outputDir = ref('')
const isLoading = ref(false)
const isMerging = ref(false)
const mergeProgress = ref(0)
const currentStep = ref<'select' | 'conflict' | 'done'>('select')
const outputFilePath = ref('')

// 解析进度监听
let unsubscribeProgress: (() => void) | null = null

onMounted(() => {
  // 监听解析进度
  unsubscribeProgress = window.mergeApi.onParseProgress(({ filePath, progress }) => {
    const file = files.value.find((f) => f.path === filePath)
    if (file && file.status === 'pending') {
      // 使用 percentage 而不是 progress（更准确）
      file.progress = progress.percentage ?? progress.progress ?? 0
      // 构建更详细的进度消息
      if (progress.messagesProcessed && progress.messagesProcessed > 0) {
        file.progressMessage = `已处理 ${progress.messagesProcessed.toLocaleString()} 条消息`
      } else if (progress.message) {
        file.progressMessage = progress.message
      } else {
        file.progressMessage = '正在解析...'
      }
    }
  })
})

onUnmounted(() => {
  if (unsubscribeProgress) {
    unsubscribeProgress()
  }
})

// 计算总消息数
const totalMessages = computed(() => files.value.reduce((sum, f) => sum + (f.messageCount || 0), 0))

// 是否可以合并
const canMerge = computed(() => files.value.length >= 2 && files.value.every((f) => f.status === 'parsed'))

// 添加文件（通过路径列表）
async function addFilesByPaths(filePaths: string[]) {
  for (const filePath of filePaths) {
    // 检查是否已添加
    if (files.value.some((f) => f.path === filePath)) continue

    const fileName = filePath.split(/[/\\]/).pop() || ''
    const fileId = `file_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

    files.value.push({
      id: fileId,
      path: filePath,
      name: fileName,
      format: '检测中...',
      messageCount: 0,
      status: 'pending',
    })

    // 解析文件获取信息
    try {
      const info = await window.mergeApi.parseFileInfo(filePath)
      const file = files.value.find((f) => f.id === fileId)
      if (file) {
        file.format = info.format
        file.messageCount = info.messageCount
        file.fileSize = info.fileSize
        file.status = 'parsed'

        // 设置默认输出名称（取第一个文件的群名）
        if (!outputName.value && info.name) {
          outputName.value = info.name
        }
      }
    } catch (err) {
      const file = files.value.find((f) => f.id === fileId)
      if (file) {
        file.status = 'error'
        file.error = err instanceof Error ? err.message : '解析失败'
      }
    }
  }
}

// 处理拖拽上传
async function handleFileDrop({ paths }: { files: File[]; paths: string[] }) {
  if (paths.length === 0) return
  isLoading.value = true
  try {
    await addFilesByPaths(paths)
  } finally {
    isLoading.value = false
  }
}

// 点击选择文件
async function handleClickSelect() {
  try {
    isLoading.value = true
    const result = await window.api.dialog.showOpenDialog({
      title: '选择聊天记录文件',
      filters: [
        { name: '聊天记录', extensions: ['json', 'txt'] },
        { name: '所有文件', extensions: ['*'] },
      ],
      properties: ['openFile', 'multiSelections'],
    })

    if (result.canceled || !result.filePaths.length) return

    await addFilesByPaths(result.filePaths)
  } finally {
    isLoading.value = false
  }
}

// 移除文件
function removeFile(id: string) {
  files.value = files.value.filter((f) => f.id !== id)
}

// 选择输出目录
async function selectOutputDir() {
  const result = await window.api.dialog.showOpenDialog({
    title: '选择输出目录',
    properties: ['openDirectory', 'createDirectory'],
  })
  if (!result.canceled && result.filePaths.length) {
    outputDir.value = result.filePaths[0]
  }
}

// 错误弹窗状态
const showErrorModal = ref(false)
const errorMessage = ref('')

// 执行合并
async function doMerge() {
  if (!canMerge.value) return

  try {
    isMerging.value = true
    mergeProgress.value = 0

    const filePaths = files.value.map((f) => f.path)

    // 检测冲突
    mergeProgress.value = 10
    const checkResult = await window.mergeApi.checkConflicts(filePaths)

    if (checkResult.conflicts.length > 0) {
      conflicts.value = checkResult.conflicts
      currentStep.value = 'conflict'
      isMerging.value = false
      return
    }

    // 无冲突，直接合并
    await executeMerge()
  } catch (err) {
    console.error('Merge failed:', err)
    errorMessage.value = err instanceof Error ? err.message : '未知错误'
    showErrorModal.value = true
  } finally {
    isMerging.value = false
  }
}

// 解决冲突后继续合并
async function resolveConflictsAndMerge() {
  // 检查是否所有冲突都已解决
  if (conflicts.value.some((c) => !c.resolution)) {
    alert('请先解决所有冲突')
    return
  }

  try {
    isMerging.value = true
    await executeMerge()
  } finally {
    isMerging.value = false
  }
}

// 执行合并操作
async function executeMerge() {
  mergeProgress.value = 30

  const filePaths = files.value.map((f) => f.path)
  const resolutions = conflicts.value.map((c) => ({
    id: c.id,
    resolution: c.resolution || 'keep1',
  }))

  mergeProgress.value = 50

  const result = await window.mergeApi.mergeFiles({
    filePaths,
    outputName: outputName.value || '合并的聊天记录',
    outputDir: outputDir.value || undefined,
    conflictResolutions: resolutions,
    andAnalyze: false,
  })

  mergeProgress.value = 100

  if (result.success) {
    outputFilePath.value = result.outputPath || ''
    currentStep.value = 'done'
  } else {
    throw new Error(result.error || '合并失败')
  }
}

// 打开输出文件夹
async function openOutputFolder() {
  if (outputFilePath.value) {
    // 使用 electron 的 shell.showItemInFolder
    await window.electron.ipcRenderer.invoke('openInFolder', outputFilePath.value)
  }
}

// 重置状态
function reset() {
  files.value = []
  conflicts.value = []
  outputName.value = ''
  outputDir.value = ''
  currentStep.value = 'select'
  mergeProgress.value = 0
}

// 获取格式图标
function getFormatIcon(format: string): string {
  if (format.includes('JSON')) return 'i-heroicons-code-bracket'
  if (format.includes('TXT')) return 'i-heroicons-document-text'
  if (format.includes('ChatLab')) return 'i-heroicons-sparkles'
  return 'i-heroicons-document'
}

// 获取状态颜色
function getStatusColor(status: FileInfo['status']): string {
  switch (status) {
    case 'parsed':
      return 'text-green-500'
    case 'error':
      return 'text-red-500'
    default:
      return 'text-gray-400'
  }
}

// 计算已解决的冲突数
const resolvedCount = computed(() => conflicts.value.filter((c) => c.resolution).length)

// 批量选择所有冲突
function batchSelectAll(resolution: 'keep1' | 'keep2' | 'keepBoth') {
  for (const conflict of conflicts.value) {
    conflict.resolution = resolution
  }
}

// 获取文件1和文件2的名称
const file1Name = computed(() => files.value[0]?.name || '文件 1')
const file2Name = computed(() => files.value[1]?.name || '文件 2')
</script>

<template>
  <div class="mx-auto max-w-3xl">
    <!-- 选择文件阶段 -->
    <template v-if="currentStep === 'select'">
      <div class="rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
        <!-- 标题 -->
        <div class="border-b border-gray-200 px-5 py-4 dark:border-gray-800">
          <h2 class="font-semibold text-gray-900 dark:text-white">合并聊天记录</h2>
          <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
            将多个聊天记录文件合并为一个，支持 QQ JSON、TXT 和 ChatLab 格式
          </p>
        </div>

        <!-- 文件上传区域 -->
        <div class="p-5">
          <!-- 已添加的文件列表 -->
          <div v-if="files.length > 0" class="mb-4 space-y-2">
            <div
              v-for="file in files"
              :key="file.id"
              class="flex items-center gap-3 rounded-lg border border-gray-200 px-4 py-3 dark:border-gray-700"
            >
              <!-- 格式图标 -->
              <UIcon :name="getFormatIcon(file.format)" class="h-5 w-5 shrink-0 text-gray-400" />

              <!-- 文件信息 -->
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2">
                  <p class="truncate text-sm font-medium text-gray-900 dark:text-white">{{ file.name }}</p>
                  <span
                    v-if="file.fileSize && file.fileSize > 50 * 1024 * 1024"
                    class="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                  >
                    大文件
                  </span>
                </div>
                <p class="text-xs text-gray-500 dark:text-gray-400">
                  <span :class="getStatusColor(file.status)">
                    {{
                      file.status === 'pending'
                        ? file.progressMessage || '解析中...'
                        : file.status === 'error'
                          ? file.error
                          : file.format
                    }}
                  </span>
                  <template v-if="file.status === 'parsed'">
                    · {{ file.messageCount.toLocaleString() }} 条消息
                    <span v-if="file.fileSize" class="text-gray-400">· {{ formatFileSize(file.fileSize) }}</span>
                  </template>
                </p>
                <!-- 解析进度条（大文件时显示） -->
                <div v-if="file.status === 'pending' && file.progress !== undefined" class="mt-1.5">
                  <UProgress :model-value="file.progress" size="xs" />
                </div>
              </div>

              <!-- 删除按钮 -->
              <UButton
                icon="i-heroicons-x-mark"
                color="gray"
                variant="ghost"
                size="xs"
                class="shrink-0"
                @click="removeFile(file.id)"
              />
            </div>
          </div>

          <!-- 拖拽上传区域 -->
          <FileDropZone multiple :accept="['.json', '.txt']" :disabled="isLoading" @files="handleFileDrop">
            <template #default="{ isDragOver, openFileDialog }">
              <div
                class="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 px-6 py-6 transition-all hover:border-primary-400 hover:bg-primary-50/50 dark:border-gray-600 dark:hover:border-primary-500 dark:hover:bg-primary-900/10"
                :class="{
                  'border-primary-500 bg-primary-50 dark:border-primary-400 dark:bg-primary-900/20': isDragOver,
                  'opacity-60': isLoading,
                }"
                @click="!isLoading && handleClickSelect()"
              >
                <UIcon
                  name="i-heroicons-arrow-up-tray"
                  class="h-8 w-8 text-gray-400 transition-colors"
                  :class="{ 'text-primary-500': isDragOver }"
                />
                <p class="mt-2 text-sm font-medium text-gray-600 dark:text-gray-400">
                  {{ isDragOver ? '松开以添加文件' : '拖拽文件到这里，或点击选择' }}
                </p>
                <p class="mt-1 text-xs text-gray-400">支持 .json 和 .txt 格式</p>
              </div>
            </template>
          </FileDropZone>
        </div>

        <!-- 输出设置 -->
        <div v-if="files.length > 0" class="border-t border-gray-200 p-5 dark:border-gray-800">
          <h3 class="mb-3 text-sm font-medium text-gray-700 dark:text-gray-300">输出设置</h3>

          <div class="space-y-3">
            <!-- 名称 -->
            <div>
              <label class="mb-1 block text-xs text-gray-500 dark:text-gray-400">群聊名称</label>
              <UInput v-model="outputName" placeholder="合并的聊天记录" />
            </div>

            <!-- 输出目录 -->
            <div>
              <label class="mb-1 block text-xs text-gray-500 dark:text-gray-400">输出目录（可选）</label>
              <div class="flex gap-2">
                <UInput v-model="outputDir" placeholder="默认保存到文档/ChatLab/merged/" class="flex-1" readonly />
                <UButton icon="i-heroicons-folder" color="gray" variant="soft" @click="selectOutputDir">选择</UButton>
              </div>
            </div>
          </div>
        </div>

        <!-- 统计信息 -->
        <div
          v-if="files.length >= 2"
          class="border-t border-gray-200 bg-gray-50 px-5 py-3 dark:border-gray-800 dark:bg-gray-800/50"
        >
          <div class="flex items-center justify-between text-sm">
            <span class="text-gray-500 dark:text-gray-400">
              共 {{ files.length }} 个文件，约 {{ totalMessages.toLocaleString() }} 条消息
            </span>
          </div>
        </div>

        <!-- 操作按钮 -->
        <div class="flex justify-end gap-3 border-t border-gray-200 px-5 py-4 dark:border-gray-800">
          <UButton :disabled="!canMerge || isMerging" :loading="isMerging" color="primary" @click="doMerge">
            合并并导出
          </UButton>
        </div>
      </div>
    </template>

    <!-- 冲突解决阶段 -->
    <template v-else-if="currentStep === 'conflict'">
      <div class="rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
        <!-- 头部 -->
        <div class="border-b border-gray-200 px-5 py-4 dark:border-gray-800">
          <div class="flex items-center justify-between">
            <div>
              <div class="flex items-center gap-2">
                <UIcon name="i-heroicons-exclamation-triangle" class="h-5 w-5 text-amber-500" />
                <h2 class="font-semibold text-gray-900 dark:text-white">发现 {{ conflicts.length }} 个格式差异</h2>
              </div>
              <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
                同一条消息在不同文件中的格式可能有差异，请选择保留哪个版本
              </p>
            </div>
            <div class="text-sm text-gray-500">
              已选择
              <span class="font-medium text-primary-600">{{ resolvedCount }}</span>
              / {{ conflicts.length }}
            </div>
          </div>
        </div>

        <!-- 批量操作区 -->
        <div
          class="flex flex-wrap items-center gap-2 border-b border-gray-200 bg-gray-50 px-5 py-3 dark:border-gray-800 dark:bg-gray-800/50"
        >
          <span class="text-sm text-gray-600 dark:text-gray-400">一键选择：</span>
          <UButton size="xs" color="gray" variant="soft" @click="batchSelectAll('keep1')">
            全部保留「{{ file1Name }}」
          </UButton>
          <UButton size="xs" color="gray" variant="soft" @click="batchSelectAll('keep2')">
            全部保留「{{ file2Name }}」
          </UButton>
          <UButton size="xs" color="gray" variant="soft" @click="batchSelectAll('keepBoth')">全部保留两者</UButton>
        </div>

        <!-- 冲突列表 -->
        <div class="max-h-[400px] divide-y divide-gray-200 overflow-y-auto dark:divide-gray-800">
          <div v-for="(conflict, index) in conflicts" :key="conflict.id" class="p-4">
            <!-- 冲突信息 -->
            <div class="mb-3 flex items-center justify-between">
              <div class="flex items-center gap-2">
                <span
                  class="flex h-6 w-6 items-center justify-center rounded-full bg-gray-200 text-xs font-medium dark:bg-gray-700"
                >
                  {{ index + 1 }}
                </span>
                <span class="text-sm text-gray-600 dark:text-gray-400">{{ conflict.sender }}</span>
              </div>
              <span class="text-xs text-gray-400">
                {{ new Date(conflict.timestamp * 1000).toLocaleString() }}
              </span>
            </div>

            <div class="grid grid-cols-2 gap-3">
              <!-- 文件1内容 -->
              <div
                class="cursor-pointer rounded-lg border-2 p-3 transition-colors"
                :class="[
                  conflict.resolution === 'keep1'
                    ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                    : 'border-gray-200 hover:border-gray-300 dark:border-gray-700 dark:hover:border-gray-600',
                ]"
                @click="conflict.resolution = 'keep1'"
              >
                <div class="mb-2 flex items-center justify-between">
                  <span class="text-xs font-medium text-blue-600 dark:text-blue-400">{{ file1Name }}</span>
                  <span class="text-xs text-gray-400">{{ conflict.contentLength1 }} 字</span>
                </div>
                <p class="line-clamp-3 break-all text-sm text-gray-700 dark:text-gray-300">
                  {{ conflict.content1 || '(空)' }}
                </p>
              </div>

              <!-- 文件2内容 -->
              <div
                class="cursor-pointer rounded-lg border-2 p-3 transition-colors"
                :class="[
                  conflict.resolution === 'keep2'
                    ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                    : 'border-gray-200 hover:border-gray-300 dark:border-gray-700 dark:hover:border-gray-600',
                ]"
                @click="conflict.resolution = 'keep2'"
              >
                <div class="mb-2 flex items-center justify-between">
                  <span class="text-xs font-medium text-green-600 dark:text-green-400">{{ file2Name }}</span>
                  <span class="text-xs text-gray-400">{{ conflict.contentLength2 }} 字</span>
                </div>
                <p class="line-clamp-3 break-all text-sm text-gray-700 dark:text-gray-300">
                  {{ conflict.content2 || '(空)' }}
                </p>
              </div>
            </div>

            <!-- 保留两者选项 -->
            <div
              class="mt-2 cursor-pointer rounded-lg border-2 p-2 text-center transition-colors"
              :class="[
                conflict.resolution === 'keepBoth'
                  ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                  : 'border-gray-200 hover:border-gray-300 dark:border-gray-700 dark:hover:border-gray-600',
              ]"
              @click="conflict.resolution = 'keepBoth'"
            >
              <span class="text-sm text-gray-600 dark:text-gray-400">保留两者（作为两条独立消息）</span>
            </div>
          </div>
        </div>

        <!-- 底部操作 -->
        <div class="flex items-center justify-between border-t border-gray-200 px-5 py-4 dark:border-gray-800">
          <UButton color="gray" variant="ghost" @click="currentStep = 'select'">
            <UIcon name="i-heroicons-arrow-left" class="mr-1 h-4 w-4" />
            返回
          </UButton>
          <UButton
            color="primary"
            :disabled="resolvedCount < conflicts.length"
            :loading="isMerging"
            @click="resolveConflictsAndMerge"
          >
            合并并导出
          </UButton>
        </div>
      </div>
    </template>

    <!-- 完成阶段 -->
    <template v-else-if="currentStep === 'done'">
      <div class="rounded-xl border border-gray-200 bg-white p-8 text-center dark:border-gray-800 dark:bg-gray-900">
        <div
          class="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30"
        >
          <UIcon name="i-heroicons-check" class="h-8 w-8 text-green-600 dark:text-green-400" />
        </div>
        <h2 class="text-xl font-semibold text-gray-900 dark:text-white">合并完成！</h2>
        <p class="mt-2 text-gray-500 dark:text-gray-400">聊天记录已成功合并并导出</p>
        <div class="mt-6 flex justify-center gap-3">
          <UButton color="primary" @click="openOutputFolder">
            <UIcon name="i-heroicons-folder-open" class="mr-1 h-4 w-4" />
            打开文件夹
          </UButton>
          <UButton color="gray" @click="reset">继续合并</UButton>
        </div>
      </div>
    </template>

    <!-- 错误弹窗 -->
    <UModal v-model:open="showErrorModal">
      <template #content>
        <div class="p-6">
          <div class="flex items-start gap-4">
            <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30">
              <UIcon name="i-heroicons-exclamation-triangle" class="h-5 w-5 text-red-600 dark:text-red-400" />
            </div>
            <div class="flex-1">
              <h3 class="text-lg font-semibold text-gray-900 dark:text-white">合并失败</h3>
              <p class="mt-2 whitespace-pre-line text-sm text-gray-600 dark:text-gray-400">{{ errorMessage }}</p>
            </div>
          </div>
          <div class="mt-6 flex justify-end">
            <UButton color="gray" @click="showErrorModal = false">我知道了</UButton>
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
