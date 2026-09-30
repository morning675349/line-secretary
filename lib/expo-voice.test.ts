// 展場語音分流測試。執行：npm test
import assert from 'node:assert'
import { test } from 'node:test'
import { classifyExpoVoice } from './expo-voice.ts'

const note = (s: string) => assert.equal(classifyExpoVoice(s), 'note', `應判為筆記：${s}`)
const cmd = (s: string) => assert.equal(classifyExpoVoice(s), 'command', `應判為指令：${s}`)

test('現場觀察一律當筆記', () => {
  note('這家做精密車床，想找自動化')
  note('對方是採購經理，決策要問老闆')
  note('他們有三條產線，明年要擴廠')
  note('聊得不錯，對 DobBiz 有興趣')
})

test('含敏感詞但語意是筆記的，不可誤判', () => {
  note('找時間再約他喝咖啡')          // 有「找」但不是搜尋指令
  note('這家要再跟進')                // 有「跟進」但不是查名單
  note('他行程很滿，下個月才有空')    // 有「行程」但不是查日曆
  note('他說有在看展場的其他攤位')    // 有「展場」但不是模式操作
  note('這單簽案金額大概五十萬')      // 有「簽案」但不是查業務進度
})

test('展場模式操作判為指令', () => {
  cmd('結束展場模式')
  cmd('展場結束了')
  cmd('收攤了')
  cmd('現在掃了幾張')
  cmd('掃幾張了')
  cmd('展場戰果')
})

test('整句就是查詢指令的判為指令', () => {
  cmd('找大展精密')
  cmd('待跟進')
  cmd('跟進名單')
  cmd('今天的行程')
  cmd('業務進度')
  cmd('統計')
  cmd('匯出名單')
  cmd('幫我寫跟進訊息給林志明')
})

test('空字串交給 agent', () => {
  cmd('')
  cmd('   ')
})
