<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import MarkdownIt from 'markdown-it'

// 协议版本号（更新协议时修改此版本号）
const AGREEMENT_VERSION = '1.0'
const AGREEMENT_KEY = 'chatlab_agreement_version'

// 弹窗显示状态（内部管理）
const isOpen = ref(false)

// 组件挂载时检查是否需要显示
onMounted(() => {
  const acceptedVersion = localStorage.getItem(AGREEMENT_KEY)
  // 版本号不匹配时需要重新同意
  if (acceptedVersion !== AGREEMENT_VERSION) {
    isOpen.value = true
  }
})

// 倒计时状态
const countdown = ref(20)
let timer: ReturnType<typeof setInterval> | null = null

// 监听 modal 打开状态，启动倒计时
watch(isOpen, (open) => {
  if (open) {
    countdown.value = 20
    timer = setInterval(() => {
      if (countdown.value > 0) {
        countdown.value--
      } else if (timer) {
        clearInterval(timer)
        timer = null
      }
    }, 1000)
  } else if (timer) {
    clearInterval(timer)
    timer = null
  }
})

onUnmounted(() => {
  if (timer) clearInterval(timer)
})

// 是否可以点击同意按钮
const canAgree = computed(() => countdown.value === 0)

// 创建 markdown-it 实例
const md = new MarkdownIt({
  html: false,
  breaks: true,
  linkify: true,
  typographer: true,
})

// 自定义链接渲染：所有链接在新窗口打开
md.renderer.rules.link_open = (tokens, idx, options, _env, self) => {
  tokens[idx].attrSet('target', '_blank')
  tokens[idx].attrSet('rel', 'noopener noreferrer')
  return self.renderToken(tokens, idx, options)
}

// 协议文案
const agreementText = `
欢迎来到 ChatLab，它是一个免费、开源、本地化的，专注于分析聊天记录的应用。

我们希望你能自由地掌控你的聊天数据，但必须是在合法、合规的前提下。请务必阅读以下条款：

## 1. 核心功能与独立性

- **仅分析，不导出**：本工具仅用于对已导出的聊天记录进行本地分析。我们不提供任何解密、抓包或导出工具，从第三方聊天软件获取数据是您的个人行为。
- **第三方独立工具**：本项目为个人开源项目，与任何第三方公司或组织等无关。

## 2. 数据隐私与安全

- **纯本地分析**：默认情况下，存储与分析均在您的设备本地完成，**零上传**。
- **AI 功能例外**：若您主动启用 AI 功能，相关聊天数据将发送至您配置的第三方模型服务商（如 DeepSeek/通义千问等）。**请勿发送涉及国家秘密或高度敏感的个人隐私信息**，风险自担。
- **匿名使用统计**：为了优化产品，软件会收集**非敏感**的数据（如版本号、操作系统类型等）。此数据不包含任何个人身份信息，仅用于辅助后续开发决策，后续你可在设置中关闭。

## 3. 数据授权与使用限制

- **合法授权原则**：您仅可处理您**本人参与**的聊天记录。若分析内容涉及他人隐私（尤其是**私聊对象、群聊成员**），请务必确保已获得相关人员的知情同意。
- **禁止非法用途**：
  - **严禁**用于窃取、监控或分析未经授权的他人隐私。
  - **严禁**将分析结果用于骚扰、诈骗、人肉搜索或任何侵犯他人权益的行为。
  - **严禁**用于规避安全措施或网络渗透测试。
- **开源协议**：本项目为开源软件，采用 AGPL-3.0 协议，严禁用于任何商业用途。

## 4. 风险警告

- **官方渠道**：请仅通过 [chatLab.fun](https://chatlab.fun) 或 [GitHub Release](https://github.com/ChatLab-Team/ChatLab/releases) 下载本软件。
- **供应链风险**：本项目代码完全开源，任何人均可二次打包。他人分享的非官方版本可能被植入恶意代码，导致您的 API Token、聊天记录或本地数据泄露，请务必保持警惕。

## 5. 免责声明

- **技术研究用途**：本软件仅供技术研究、学习与交流目的使用。
- **责任自负**：使用本软件产生的一切后果（包括但不限于数据丢失、隐私纠纷、法律责任）均由用户自行承担。
- **接受声明**：下载、安装或使用本软件，即表示您已阅读、理解并同意本声明的所有条款。如不同意，请立即停止使用并删除相关程序。


`

// 渲染后的 HTML
const renderedContent = computed(() => md.render(agreementText))

// 同意协议
function handleAgree() {
  localStorage.setItem(AGREEMENT_KEY, AGREEMENT_VERSION)
  isOpen.value = false
}

// 不同意协议，退出应用
function handleDisagree() {
  window.api.send('window-close')
}
</script>

<template>
  <UModal
    :open="isOpen"
    prevent-close
    :ui="{
      content: 'md:w-full max-w-2xl',
      overlay: 'backdrop-blur-sm',
    }"
  >
    <template #content>
      <div class="flex max-h-[85vh] flex-col p-6">
        <!-- Header -->
        <div class="mb-4 flex items-center gap-3">
          <div
            class="flex h-12 w-12 items-center justify-center rounded-xl bg-linear-to-br from-pink-100 to-rose-100 dark:from-pink-900/30 dark:to-rose-900/30"
          >
            <UIcon name="i-heroicons-document-text" class="h-6 w-6 text-pink-600 dark:text-pink-400" />
          </div>
          <div>
            <h2 class="text-xl font-bold text-gray-900 dark:text-white">欢迎使用 ChatLab</h2>
            <p class="text-sm text-gray-500 dark:text-gray-400">使用前请仔细阅读</p>
          </div>
        </div>

        <!-- 协议内容滚动区域 -->
        <div class="mb-6 flex-1 overflow-y-auto pr-4">
          <div class="agreement-content" v-html="renderedContent" />
        </div>

        <!-- 底部按钮 -->
        <div class="flex items-center justify-end gap-3 border-t border-gray-200 pt-4 dark:border-gray-700">
          <UButton variant="ghost" color="neutral" size="lg" @click="handleDisagree">我不同意</UButton>
          <UButton
            color="primary"
            size="lg"
            :disabled="!canAgree"
            class="bg-pink-500 hover:bg-pink-600 dark:bg-pink-600 dark:hover:bg-pink-700 disabled:opacity-50 disabled:cursor-not-allowed"
            @click="handleAgree"
          >
            {{ canAgree ? '我已阅读并同意' : `请阅读 (${countdown}s)` }}
          </UButton>
        </div>
      </div>
    </template>
  </UModal>
</template>

<style scoped>
/* 用户协议 markdown 样式优化 */
.agreement-content {
  font-size: 0.875rem;
  line-height: 1.6;
  color: var(--color-gray-600);
}

/* 暗色模式 */
:root.dark .agreement-content {
  color: var(--color-gray-300);
}

/* 标题样式 */
.agreement-content :deep(h2) {
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--color-gray-900);
  margin-top: 1.25rem;
  margin-bottom: 0.5rem;
  padding-bottom: 0.25rem;
  border-bottom: 1px solid var(--color-gray-200);
}

:root.dark .agreement-content :deep(h2) {
  color: var(--color-gray-100);
  border-bottom-color: var(--color-gray-700);
}

/* 第一个标题不需要上边距 */
.agreement-content :deep(h2:first-child) {
  margin-top: 0;
}

/* 列表样式 */
.agreement-content :deep(ul) {
  margin: 0.5rem 0;
  padding-left: 1.25rem;
  list-style: none;
}

.agreement-content :deep(li) {
  position: relative;
  margin-bottom: 0.375rem;
  padding-left: 0.5rem;
}

.agreement-content :deep(li::before) {
  content: '•';
  position: absolute;
  left: -0.75rem;
  color: var(--color-pink-500);
  font-weight: bold;
}

/* 加粗文字 */
.agreement-content :deep(strong) {
  font-weight: 600;
  color: var(--color-gray-800);
}

:root.dark .agreement-content :deep(strong) {
  color: var(--color-gray-200);
}

/* 段落间距 */
.agreement-content :deep(p) {
  margin: 0.5rem 0;
}

/* 链接样式 */
.agreement-content :deep(a) {
  color: var(--color-pink-500);
  text-decoration: none;
}

.agreement-content :deep(a:hover) {
  text-decoration: underline;
}
</style>
