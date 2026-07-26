import OpenAI from 'openai'

// AI 客戶端（Phase 1 升級：agent 大腦與名片 OCR 共用）
export const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

// 帳號可用的最新正式版模型。要升級只改這一行，agent 與名片辨識會一起套用。
export const AGENT_MODEL = 'gpt-5.5'
