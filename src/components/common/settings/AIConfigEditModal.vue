<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import AlertTips from './AlertTips.vue'

// ============ 类型定义 ============

interface AIServiceConfig {
  id: string
  name: string
  provider: string
  apiKey: string
  apiKeySet: boolean
  model?: string
  baseUrl?: string
  disableThinking?: boolean
  createdAt: number
  updatedAt: number
}

interface Provider {
  id: string
  name: string
  description: string
  defaultBaseUrl: string
  models: Array<{ id: string; name: string; description?: string }>
}

// 三种配置类型
type ConfigType = 'preset' | 'local' | 'openai-compatible'

const aiTips = JSON.parse(localStorage.getItem('chatlab_app_config') || '{}').aiTips || {}

// ============ Props & Emits ============

const props = defineProps<{
  open: boolean
  mode: 'add' | 'edit'
  config: AIServiceConfig | null
  providers: Provider[]
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  saved: []
}>()

// ============ 状态 ============

const configType = ref<ConfigType>('preset')
const isValidating = ref(false)
const isSaving = ref(false)
const showAdvanced = ref(false)
const showApiKey = ref(false) // 控制API Key显示/隐藏

const formData = ref({
  name: '',
  provider: '',
  apiKey: '',
  model: '',
  baseUrl: '',
  disableThinking: true, // 默认禁用思考模式
})

const validationResult = ref<'idle' | 'valid' | 'invalid'>('idle')
const validationMessage = ref('')

// ============ 计算属性 ============

// 预设服务商（排除 openai-compatible）
const presetProviders = computed(() => {
  return props.providers.filter((p) => p.id !== 'openai-compatible')
})

const currentProvider = computed(() => {
  return props.providers.find((p) => p.id === formData.value.provider)
})

const providerOptions = computed(() => {
  return presetProviders.value.map((p) => ({
    label: p.name,
    value: p.id,
    description: p.description,
  }))
})

const modelOptions = computed(() => {
  if (!currentProvider.value) return []
  return currentProvider.value.models.map((m) => ({
    label: m.name,
    value: m.id,
    description: m.description,
  }))
})

const selectedModelDescription = computed(() => {
  if (!formData.value.model) return ''
  return modelOptions.value.find((m) => m.value === formData.value.model)?.description || ''
})

const canSave = computed(() => {
  const { provider, apiKey, baseUrl, model } = formData.value

  if (props.mode === 'add') {
    switch (configType.value) {
      case 'preset':
        // 预设服务：需要提供商、API Key（名称选填）
        return provider && apiKey.trim()
      case 'local':
        // 本地服务：需要端点、模型名（名称选填）
        return baseUrl.trim() && model.trim()
      case 'openai-compatible':
        // OpenAI 兼容：需要端点、API Key、模型名（名称选填）
        return baseUrl.trim() && apiKey.trim() && model.trim()
    }
  }

  // 编辑模式
  if (formData.value.provider === 'openai-compatible') {
    if (configType.value === 'local') {
      return baseUrl.trim() && model.trim()
    }
    return baseUrl.trim() && model.trim()
  }
  return provider
})

const modalTitle = computed(() => (props.mode === 'add' ? '添加新配置' : '编辑配置'))

// ============ 方法 ============

function resetForm() {
  configType.value = 'preset'
  showAdvanced.value = false
  showApiKey.value = false
  formData.value = {
    name: '',
    provider: presetProviders.value[0]?.id || '',
    apiKey: '',
    model: presetProviders.value[0]?.models[0]?.id || '',
    baseUrl: '',
    disableThinking: true, // 默认禁用思考模式
  }
  validationResult.value = 'idle'
  validationMessage.value = ''
}

function initFromConfig(config: AIServiceConfig) {
  // 判断配置类型
  if (config.provider === 'openai-compatible') {
    // 根据是否有 API Key 和 baseUrl 判断是本地还是 OpenAI 兼容
    const isLocal = !config.apiKeySet || (config.baseUrl?.includes('localhost') ?? false)
    configType.value = isLocal ? 'local' : 'openai-compatible'
    showAdvanced.value = isLocal && !!config.apiKeySet
  } else {
    configType.value = 'preset'
    showAdvanced.value = false
  }

  showApiKey.value = false // 编辑时默认隐藏API Key
  formData.value = {
    name: config.name,
    provider: config.provider,
    apiKey: '',
    model: config.model || '',
    baseUrl: config.baseUrl || '',
    disableThinking: config.disableThinking ?? true, // 默认禁用
  }
  validationResult.value = 'idle'
  validationMessage.value = ''
}

function switchConfigType(type: ConfigType) {
  configType.value = type
  validationResult.value = 'idle'
  validationMessage.value = ''
  showAdvanced.value = false

  switch (type) {
    case 'preset':
      formData.value.provider = presetProviders.value[0]?.id || ''
      formData.value.model = presetProviders.value[0]?.models[0]?.id || ''
      formData.value.baseUrl = ''
      formData.value.apiKey = ''
      break
    case 'local':
      formData.value.provider = 'openai-compatible'
      formData.value.model = ''
      formData.value.baseUrl = 'http://localhost:11434/v1'
      formData.value.apiKey = ''
      break
    case 'openai-compatible':
      formData.value.provider = 'openai-compatible'
      formData.value.model = ''
      formData.value.baseUrl = ''
      formData.value.apiKey = ''
      break
  }
}

async function validateKey() {
  const { provider, apiKey, baseUrl } = formData.value

  // 本地服务可以不需要 API Key
  if (configType.value === 'local') {
    if (!baseUrl) return
  } else {
    if (!provider || !apiKey) {
      validationResult.value = 'idle'
      validationMessage.value = ''
      return
    }
  }

  isValidating.value = true
  validationResult.value = 'idle'

  try {
    const testApiKey = apiKey || 'sk-no-key-required'
    const result = await window.llmApi.validateApiKey(
      provider || 'openai-compatible',
      testApiKey,
      baseUrl || undefined,
      formData.value.model || undefined
    )
    validationResult.value = result.success ? 'valid' : 'invalid'
    if (result.success) {
      validationMessage.value = '连接验证成功'
    } else {
      // 显示详细的错误信息
      validationMessage.value = result.error || '连接验证失败'
    }
  } catch (error) {
    validationResult.value = 'invalid'
    validationMessage.value = '验证失败：' + String(error)
  } finally {
    isValidating.value = false
  }
}

/**
 * 生成默认配置名称
 */
function getDefaultName(): string {
  switch (configType.value) {
    case 'preset': {
      // 使用服务商名称
      const provider = props.providers.find((p) => p.id === formData.value.provider)
      return provider?.name || formData.value.provider
    }
    case 'local':
    case 'openai-compatible': {
      // 使用 API 端点（简化显示）
      try {
        const url = new URL(formData.value.baseUrl)
        return url.hostname
      } catch {
        return formData.value.baseUrl || '自定义服务'
      }
    }
    default:
      return '未命名配置'
  }
}

async function saveConfig() {
  if (!canSave.value) return

  isSaving.value = true
  try {
    // 确定最终的 provider
    const finalProvider = configType.value === 'preset' ? formData.value.provider : 'openai-compatible'

    // 确定 API Key
    let finalApiKey = formData.value.apiKey.trim()
    if (!finalApiKey && configType.value === 'local') {
      finalApiKey = 'sk-no-key-required'
    }

    // 确定名称（如果未填写则自动生成）
    const finalName = formData.value.name.trim() || getDefaultName()

    if (props.mode === 'add') {
      const result = await window.llmApi.addConfig({
        name: finalName,
        provider: finalProvider,
        apiKey: finalApiKey,
        model: formData.value.model.trim() || undefined,
        baseUrl: formData.value.baseUrl.trim() || undefined,
        // 仅本地服务才传递 disableThinking
        disableThinking: configType.value === 'local' ? formData.value.disableThinking : undefined,
      })

      if (result.success) {
        emit('update:open', false)
        emit('saved')
      } else {
        console.error('添加配置失败：', result.error)
      }
    } else {
      const updates: Record<string, unknown> = {
        name: finalName,
        provider: finalProvider,
        model: formData.value.model.trim() || undefined,
        baseUrl: formData.value.baseUrl.trim() || undefined,
        // 仅本地服务才传递 disableThinking
        disableThinking: configType.value === 'local' ? formData.value.disableThinking : undefined,
      }

      if (formData.value.apiKey.trim()) {
        updates.apiKey = formData.value.apiKey.trim()
      }

      const result = await window.llmApi.updateConfig(props.config!.id, updates)

      if (result.success) {
        emit('update:open', false)
        emit('saved')
      } else {
        console.error('更新配置失败：', result.error)
      }
    }
  } catch (error) {
    console.error('保存配置失败：', error)
  } finally {
    isSaving.value = false
  }
}

function closeModal() {
  emit('update:open', false)
}

// ============ 监听器 ============

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      if (props.mode === 'edit' && props.config) {
        initFromConfig(props.config)
      } else {
        resetForm()
      }
    }
  }
)

watch(
  () => formData.value.provider,
  (newProvider, oldProvider) => {
    const provider = props.providers.find((p) => p.id === newProvider)
    // 只有在用户手动切换provider时才重置model，编辑模式下初始化时不要重置
    if (
      provider &&
      provider.models.length > 0 &&
      configType.value === 'preset' &&
      oldProvider !== undefined &&
      oldProvider !== '' &&
      oldProvider !== newProvider
    ) {
      formData.value.model = provider.models[0].id
    }
    validationResult.value = 'idle'
    validationMessage.value = ''
  }
)

watch(
  () => formData.value.apiKey,
  () => {
    validationResult.value = 'idle'
    validationMessage.value = ''
  }
)
</script>

<template>
  <UModal :open="open" @update:open="emit('update:open', $event)">
    <template #content>
      <div class="p-6">
        <h3 class="mb-4 text-lg font-semibold text-gray-900 dark:text-white">{{ modalTitle }}</h3>

        <!-- 配置类型选择（仅新增时显示）-->
        <div v-if="mode === 'add'" class="mb-6">
          <div class="grid grid-cols-3 gap-2">
            <!-- 预设服务商 -->
            <button
              class="flex flex-col items-center gap-2 rounded-lg border-2 p-3 transition-colors"
              :class="[
                configType === 'preset'
                  ? 'border-primary-500 bg-primary-50 dark:border-primary-400 dark:bg-primary-900/20'
                  : 'border-gray-200 hover:border-gray-300 dark:border-gray-700 dark:hover:border-gray-600',
              ]"
              @click="switchConfigType('preset')"
            >
              <UIcon
                name="i-heroicons-cloud"
                class="h-5 w-5"
                :class="[configType === 'preset' ? 'text-primary-500' : 'text-gray-400']"
              />
              <div class="text-center">
                <p
                  class="text-xs font-medium"
                  :class="[
                    configType === 'preset'
                      ? 'text-primary-600 dark:text-primary-400'
                      : 'text-gray-700 dark:text-gray-300',
                  ]"
                >
                  官方API
                </p>
                <p class="mt-0.5 text-[10px] text-gray-500">DeepSeek、Gemini 等</p>
              </div>
            </button>

            <!-- 本地服务 -->
            <button
              class="flex flex-col items-center gap-2 rounded-lg border-2 p-3 transition-colors"
              :class="[
                configType === 'local'
                  ? 'border-primary-500 bg-primary-50 dark:border-primary-400 dark:bg-primary-900/20'
                  : 'border-gray-200 hover:border-gray-300 dark:border-gray-700 dark:hover:border-gray-600',
              ]"
              @click="switchConfigType('local')"
            >
              <UIcon
                name="i-heroicons-server"
                class="h-5 w-5"
                :class="[configType === 'local' ? 'text-primary-500' : 'text-gray-400']"
              />
              <div class="text-center">
                <p
                  class="text-xs font-medium"
                  :class="[
                    configType === 'local'
                      ? 'text-primary-600 dark:text-primary-400'
                      : 'text-gray-700 dark:text-gray-300',
                  ]"
                >
                  本地服务
                </p>
                <p class="mt-0.5 text-[10px] text-gray-500">Ollama 等</p>
              </div>
            </button>

            <!-- OpenAI 兼容 -->
            <button
              class="flex flex-col items-center gap-2 rounded-lg border-2 p-3 transition-colors"
              :class="[
                configType === 'openai-compatible'
                  ? 'border-primary-500 bg-primary-50 dark:border-primary-400 dark:bg-primary-900/20'
                  : 'border-gray-200 hover:border-gray-300 dark:border-gray-700 dark:hover:border-gray-600',
              ]"
              @click="switchConfigType('openai-compatible')"
            >
              <UIcon
                name="i-heroicons-globe-alt"
                class="h-5 w-5"
                :class="[configType === 'openai-compatible' ? 'text-primary-500' : 'text-gray-400']"
              />
              <div class="text-center">
                <p
                  class="text-xs font-medium"
                  :class="[
                    configType === 'openai-compatible'
                      ? 'text-primary-600 dark:text-primary-400'
                      : 'text-gray-700 dark:text-gray-300',
                  ]"
                >
                  OpenAI 兼容
                </p>
                <p class="mt-0.5 text-[10px] text-gray-500">自定义端点</p>
              </div>
            </button>
          </div>
        </div>

        <div class="space-y-4">
          <!-- 配置名称（选填） -->
          <div>
            <label class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
              配置名称
              <span class="font-normal text-gray-400">（选填）</span>
            </label>
            <UInput
              v-model="formData.name"
              :placeholder="configType === 'preset' ? '留空将使用服务商名称' : '留空将使用 API 端点地址'"
              class="w-full"
            />
          </div>

          <!-- ========== 预设服务商配置 ========== -->
          <template v-if="configType === 'preset'">
            <!-- 服务商选择 -->
            <div>
              <label class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">AI 服务商</label>
              <USelect
                v-model="formData.provider"
                :items="providerOptions"
                placeholder="选择AI服务商"
                class="w-full"
              />
              <p v-if="currentProvider" class="mt-2 text-xs text-gray-500">
                {{ currentProvider.description }}
              </p>
            </div>

            <!-- API Key -->
            <div>
              <label class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">API Key</label>
              <div class="flex gap-2">
                <div class="relative flex-1">
                  <UInput
                    v-model="formData.apiKey"
                    :type="showApiKey ? 'text' : 'password'"
                    :placeholder="mode === 'edit' ? '输入新的 API Key（留空保持原有）' : '输入你的 API Key'"
                    class="w-full pr-10"
                  />
                  <button
                    type="button"
                    class="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                    @click="showApiKey = !showApiKey"
                  >
                    <UIcon
                      :name="showApiKey ? 'i-heroicons-eye-slash' : 'i-heroicons-eye'"
                      class="h-5 w-5"
                    />
                  </button>
                </div>
                <UButton :loading="isValidating" :disabled="!formData.apiKey" variant="soft" @click="validateKey">
                  验证
                </UButton>
              </div>
              <!-- 验证结果 -->
              <div v-if="validationMessage" class="mt-2">
                <div
                  v-if="validationResult === 'valid'"
                  class="flex items-center gap-1 text-sm text-green-600 dark:text-green-400"
                >
                  <UIcon name="i-heroicons-check-circle" class="h-4 w-4" />
                  {{ validationMessage }}
                </div>
                <div
                  v-else-if="validationResult === 'invalid'"
                  class="flex items-center gap-1 text-sm text-amber-600 dark:text-amber-400"
                >
                  <UIcon name="i-heroicons-exclamation-triangle" class="h-4 w-4" />
                  {{ validationMessage }}
                </div>
              </div>
            </div>

            <!-- 模型选择 -->
            <div v-if="formData.provider && modelOptions.length > 0">
              <label class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">模型</label>
              <USelect
                v-model="formData.model"
                :items="modelOptions"
                placeholder="选择模型"
                class="w-full"
              />
              <p v-if="selectedModelDescription" class="mt-2 text-xs text-gray-500">
                {{ selectedModelDescription }}
              </p>
            </div>
          </template>

          <!-- ========== 本地服务配置 ========== -->
          <template v-else-if="configType === 'local'">
            <!-- API 端点 -->
            <div>
              <label class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">API 端点</label>
              <div class="flex gap-2">
                <UInput v-model="formData.baseUrl" placeholder="http://localhost:11434/v1" class="flex-1" />
                <UButton :loading="isValidating" :disabled="!formData.baseUrl" variant="soft" @click="validateKey">
                  验证
                </UButton>
              </div>
            </div>

            <!-- 模型名称 -->
            <div>
              <label class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">模型名称</label>
              <UInput v-model="formData.model" placeholder="如 qwen3、deepseek-r1" />
              <p class="mt-1 text-xs text-gray-500">输入本地部署的模型名称</p>
            </div>

            <!-- 禁用思考模式 -->
            <div class="flex items-center justify-between rounded-lg bg-gray-50 p-3 dark:bg-gray-800">
              <div>
                <p class="text-sm font-medium text-gray-700 dark:text-gray-300">禁用思考模式</p>
                <p class="text-xs text-gray-500 dark:text-gray-400">
                  针对 Qwen3、DeepSeek-R1 等模型，禁用后使用标准工具调用格式
                </p>
              </div>
              <USwitch v-model="formData.disableThinking" />
            </div>

            <!-- 验证结果 -->
            <div v-if="validationMessage">
              <div
                v-if="validationResult === 'valid'"
                class="flex items-center gap-1 text-sm text-green-600 dark:text-green-400"
              >
                <UIcon name="i-heroicons-check-circle" class="h-4 w-4" />
                {{ validationMessage }}
              </div>
              <div
                v-else-if="validationResult === 'invalid'"
                class="flex items-center gap-1 text-sm text-amber-600 dark:text-amber-400"
              >
                <UIcon name="i-heroicons-exclamation-triangle" class="h-4 w-4" />
                {{ validationMessage }}
              </div>
            </div>

            <!-- 高级选项（API Key） -->
            <div>
              <button
                class="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                @click="showAdvanced = !showAdvanced"
              >
                <UIcon
                  name="i-heroicons-chevron-right"
                  class="h-4 w-4 transition-transform"
                  :class="{ 'rotate-90': showAdvanced }"
                />
                高级选项
              </button>

              <div v-if="showAdvanced" class="mt-3 rounded-lg bg-gray-50 p-4 dark:bg-gray-800">
                <div>
                  <label class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
                    API Key
                    <span class="font-normal text-gray-400">（可选）</span>
                  </label>
                  <div class="relative">
                    <UInput
                      v-model="formData.apiKey"
                      :type="showApiKey ? 'text' : 'password'"
                      placeholder="本地服务通常不需要"
                      class="w-full pr-10"
                    />
                    <button
                      type="button"
                      class="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                      @click="showApiKey = !showApiKey"
                    >
                      <UIcon
                        :name="showApiKey ? 'i-heroicons-eye-slash' : 'i-heroicons-eye'"
                        class="h-5 w-5"
                      />
                    </button>
                  </div>
                  <p class="mt-1 text-xs text-gray-500">如果服务设置了认证，在此输入</p>
                </div>
              </div>
            </div>
          </template>

          <!-- ========== OpenAI 兼容配置 ========== -->
          <template v-else>
            <!-- 风险提示 -->
            <AlertTips
              v-if="aiTips.thirdPartyApi?.show"
              icon="i-heroicons-exclamation-triangle"
              :content="aiTips.thirdPartyApi?.content"
            />

            <!-- API 端点 -->
            <div>
              <label class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">API 端点</label>
              <UInput v-model="formData.baseUrl" placeholder="https://api.example.com/v1" />
              <p class="mt-1 text-xs text-gray-500">兼容 OpenAI 格式的 API 端点</p>
            </div>

            <!-- API Key -->
            <div>
              <label class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">API Key</label>
              <div class="flex gap-2">
                <div class="relative flex-1">
                  <UInput
                    v-model="formData.apiKey"
                    :type="showApiKey ? 'text' : 'password'"
                    :placeholder="mode === 'edit' ? '输入新的 API Key（留空保持原有）' : '输入你的 API Key'"
                    class="w-full pr-10"
                  />
                  <button
                    type="button"
                    class="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                    @click="showApiKey = !showApiKey"
                  >
                    <UIcon
                      :name="showApiKey ? 'i-heroicons-eye-slash' : 'i-heroicons-eye'"
                      class="h-5 w-5"
                    />
                  </button>
                </div>
                <UButton
                  :loading="isValidating"
                  :disabled="!formData.apiKey || !formData.baseUrl"
                  variant="soft"
                  @click="validateKey"
                >
                  验证
                </UButton>
              </div>
              <!-- 验证结果 -->
              <div v-if="validationMessage" class="mt-2">
                <div
                  v-if="validationResult === 'valid'"
                  class="flex items-center gap-1 text-sm text-green-600 dark:text-green-400"
                >
                  <UIcon name="i-heroicons-check-circle" class="h-4 w-4" />
                  {{ validationMessage }}
                </div>
                <div
                  v-else-if="validationResult === 'invalid'"
                  class="flex items-center gap-1 text-sm text-amber-600 dark:text-amber-400"
                >
                  <UIcon name="i-heroicons-exclamation-triangle" class="h-4 w-4" />
                  {{ validationMessage }}
                </div>
              </div>
            </div>

            <!-- 模型名称 -->
            <div>
              <label class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">模型名称</label>
              <UInput v-model="formData.model" placeholder="如 gpt-4、claude-3" />
              <p class="mt-1 text-xs text-gray-500">输入 API 支持的模型名称</p>
            </div>
          </template>
        </div>

        <!-- 底部按钮 -->
        <div class="mt-6 flex justify-end gap-2">
          <UButton variant="soft" @click="closeModal">取消</UButton>
          <UButton color="primary" :disabled="!canSave" :loading="isSaving" @click="saveConfig">
            {{ mode === 'add' ? '添加' : '保存' }}
          </UButton>
        </div>
      </div>
    </template>
  </UModal>
</template>
