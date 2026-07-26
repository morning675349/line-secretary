import Anthropic from '@anthropic-ai/sdk'

// Claude API 客戶端（Phase 1 升級：agent 大腦與名片 OCR 都走 Claude）
export const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export const AGENT_MODEL = 'claude-opus-4-8'
