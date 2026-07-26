import { toFile } from 'openai'
import { openai } from './ai'

// LINE 語音訊息（m4a/AAC）轉文字。
export async function transcribeAudio(audioBuffer: Buffer): Promise<string> {
  const file = await toFile(audioBuffer, 'voice.m4a', { type: 'audio/m4a' })
  const result = await openai.audio.transcriptions.create({
    file,
    model: 'whisper-1',
    language: 'zh',
    prompt: '以下是台灣繁體中文的商務對話，內容可能包含人名、公司名、行程與跟進事項。',
  })
  return result.text.trim()
}
