/**
 * LLM 服务类型定义
 */

/**
 * 支持的 LLM 提供商
 */
export type LLMProvider = 'deepseek' | 'qwen' | 'minimax' | 'glm' | 'kimi' | 'gemini' | 'doubao' | 'openai-compatible'

/**
 * LLM 配置
 */
export interface LLMConfig {
  provider: LLMProvider
  apiKey: string
  model?: string
  baseUrl?: string
  maxTokens?: number
}

/**
 * 聊天消息
 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  /** tool 角色时的 tool_call_id */
  tool_call_id?: string
  /** assistant 角色时的 tool_calls */
  tool_calls?: ToolCall[]
}

/**
 * 聊天请求选项
 */
export interface ChatOptions {
  temperature?: number
  maxTokens?: number
  stream?: boolean
  /** 可用的工具列表 */
  tools?: ToolDefinition[]
  /** 中止信号，用于取消请求 */
  abortSignal?: AbortSignal
}

/**
 * 非流式响应
 */
export interface ChatResponse {
  content: string
  finishReason: 'stop' | 'length' | 'error' | 'tool_calls'
  /** 如果 LLM 决定调用工具，返回 tool_calls */
  tool_calls?: ToolCall[]
  usage?: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
}

/**
 * 流式响应 chunk
 */
export interface ChatStreamChunk {
  content: string
  isFinished: boolean
  finishReason?: 'stop' | 'length' | 'error' | 'tool_calls'
  /** 流式过程中的 tool_calls（增量） */
  tool_calls?: ToolCall[]
  /** Token 使用量（通常在最后一个 chunk 中返回） */
  usage?: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
}

// ==================== Function Calling 相关类型 ====================

/**
 * 工具定义（OpenAI 兼容格式）
 */
export interface ToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: {
      type: 'object'
      properties: Record<
        string,
        {
          type: string
          description: string
          enum?: string[]
          items?: { type: string }
        }
      >
      required?: string[]
    }
  }
}

/**
 * 工具调用
 */
export interface ToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string // JSON 字符串
  }
  /** Gemini 3+ 模型需要的思考签名（用于工具调用验证） */
  thoughtSignature?: string
}

/**
 * 工具调用结果
 */
export interface ToolCallResult {
  tool_call_id: string
  result: unknown
}

/**
 * LLM 服务接口
 */
export interface ILLMService {
  /**
   * 获取提供商名称
   */
  getProvider(): LLMProvider

  /**
   * 获取可用模型列表
   */
  getModels(): string[]

  /**
   * 获取默认模型
   */
  getDefaultModel(): string

  /**
   * 发送聊天请求（非流式）
   * @param messages 消息列表
   * @param options 选项，可包含 tools 参数启用 Function Calling
   */
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse>

  /**
   * 发送聊天请求（流式）
   * @param messages 消息列表
   * @param options 选项，可包含 tools 参数启用 Function Calling
   */
  chatStream(messages: ChatMessage[], options?: ChatOptions): AsyncGenerator<ChatStreamChunk>

  /**
   * 验证 API Key 是否有效
   * @returns 验证结果和可能的错误信息
   */
  validateApiKey(): Promise<{ success: boolean; error?: string }>
}

/**
 * 提供商信息
 */
export interface ProviderInfo {
  id: LLMProvider
  name: string
  description: string
  defaultBaseUrl: string
  models: Array<{
    id: string
    name: string
    description?: string
  }>
}

// ==================== 多配置管理相关类型 ====================

/**
 * 单个 AI 服务配置
 */
export interface AIServiceConfig {
  id: string // UUID
  name: string // 用户自定义名称
  provider: LLMProvider
  apiKey: string // 可为空（本地 API 场景）
  model?: string
  baseUrl?: string // 自定义端点
  maxTokens?: number
  /** 禁用思考模式（用于本地服务，如 Qwen3、DeepSeek-R1 等） */
  disableThinking?: boolean
  createdAt: number // 创建时间戳
  updatedAt: number // 更新时间戳
}

/**
 * AI 配置存储结构
 */
export interface AIConfigStore {
  configs: AIServiceConfig[]
  activeConfigId: string | null
}

/**
 * 最大配置数量限制
 */
export const MAX_CONFIG_COUNT = 10
