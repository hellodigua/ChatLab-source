/**
 * 格式模块注册
 * 导出所有支持的格式
 */

import type { FormatModule } from '../types'

// 导入所有格式模块
import chatlab from './chatlab'
import chatlabJsonl from './chatlab-jsonl'
import shuakamiQqExporter from './shuakami-qq-exporter'
import yccccccyEchotrace from './ycccccccy-echotrace'
import wechatDefault from './wechat-default'
import qqNativeTxt from './qq-native-txt'

/**
 * 所有支持的格式模块（按优先级排序）
 */
export const formats: FormatModule[] = [
  chatlab, // 优先级 1 - ChatLab JSON
  chatlabJsonl, // 优先级 2 - ChatLab JSONL（流式格式，支持超大文件）
  shuakamiQqExporter, // 优先级 10 - shuakami/qq-chat-exporter
  yccccccyEchotrace, // 优先级 15 - ycccccccy/echotrace 微信导出
  wechatDefault, // 优先级 20 - 微信数据库导出 JSON
  qqNativeTxt, // 优先级 30 - QQ 官方导出 TXT
]

// 按名称导出，方便单独使用
export { chatlab, chatlabJsonl, shuakamiQqExporter, yccccccyEchotrace, wechatDefault, qqNativeTxt }
