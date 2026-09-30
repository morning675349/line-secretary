import assert from 'node:assert'
import { test } from 'node:test'
import { neutralize, csvCell, buildNewsleopardCsv, buildFullCsv, UTF8_BOM } from './csv.ts'
import type { ExportRow } from './csv.ts'

const mk = (over: Partial<ExportRow>): ExportRow => ({
  email: 'a@b.com', name: '王大明', company: '大展精密', title: '總經理',
  industry: '製造業', source: '五金展', mobile: '0912345678',
  score: 8, category: '潛在客戶', status: '待跟進', notes: [], ...over,
})

test('公式注入會被中和', () => {
  assert.equal(neutralize('=SUM(A1)'), "'=SUM(A1)")
  assert.equal(neutralize('+886912345678'), "'+886912345678")
  assert.equal(neutralize('-100'), "'-100")
  assert.equal(neutralize('@handle'), "'@handle")
  assert.equal(neutralize('正常文字'), '正常文字')
})

test('含逗號引號換行的值會正確包裝', () => {
  assert.equal(csvCell('大展, 精密'), '"大展, 精密"')
  assert.equal(csvCell('他說「讚」'), '他說「讚」')
  assert.equal(csvCell('有"引號"'), '"有""引號"""')
  assert.equal(csvCell('第一行\n第二行'), '"第一行\n第二行"')
})

test('電子豹格式只收有 Email 的人', () => {
  const r = buildNewsleopardCsv([
    mk({ email: 'a@b.com' }),
    mk({ email: '', name: '沒信箱' }),
    mk({ email: 'c@d.com' }),
  ])
  assert.equal(r.included, 2)
  assert.equal(r.skipped, 1)
  assert.ok(!r.csv.includes('沒信箱'))
})

test('CSV 開頭有 BOM 讓 Excel 不亂碼', () => {
  assert.ok(buildNewsleopardCsv([mk({})]).csv.startsWith(UTF8_BOM))
  assert.ok(buildFullCsv([mk({})]).startsWith(UTF8_BOM))
})

test('完整名單包含筆記且用分號串接', () => {
  const csv = buildFullCsv([mk({ notes: ['做車床', '想找自動化'] })])
  assert.match(csv, /做車床；想找自動化/)
})

test('空名單仍輸出表頭', () => {
  const r = buildNewsleopardCsv([])
  assert.match(r.csv, /email,姓名,公司/)
  assert.equal(r.included, 0)
})
