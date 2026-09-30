// 名單匯出的 CSV 組裝（純函式，無 I/O）。
//
// 兩種格式：
//   newsleopard  給電子豹匯入寄開發信，只收有 Email 的人
//   full         完整備份，所有欄位、所有人
//
// 兩個必守的細節：
//   1. 開頭要加 UTF-8 BOM，否則 Excel 開起來中文全是亂碼
//   2. 名片內容來自 OCR（他人可控），以 = + - @ 開頭的欄位要中和，
//      否則試算表可能當成公式執行（CSV 注入）

export interface ExportRow {
  email: string
  name: string
  company: string
  title: string
  industry: string
  source: string
  mobile: string
  score: number
  category: string
  status: string
  notes: string[]
}

export const UTF8_BOM = '﻿'

/** 中和試算表公式注入：以 = + - @ 開頭的值前面加單引號 */
export function neutralize(value: string): string {
  return /^[=+\-@]/.test(value) ? `'${value}` : value
}

/** 單一儲存格轉 CSV：先中和公式，再處理引號、逗號、換行 */
export function csvCell(value: string | number): string {
  const s = neutralize(String(value ?? ''))
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function toCsv(headers: string[], rows: Array<Array<string | number>>): string {
  const body = [headers, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n')
  return UTF8_BOM + body + '\r\n'
}

/** 電子豹匯入用：只收有 Email 的人，欄位精簡到可直接對應自訂欄位 */
export function buildNewsleopardCsv(rows: ExportRow[]): { csv: string; included: number; skipped: number } {
  const withEmail = rows.filter(r => r.email.includes('@'))
  const csv = toCsv(
    ['email', '姓名', '公司', '職稱', '產業', '認識場合'],
    withEmail.map(r => [r.email, r.name, r.company, r.title, r.industry, r.source])
  )
  return { csv, included: withEmail.length, skipped: rows.length - withEmail.length }
}

/** 完整備份：所有人、所有欄位，筆記用分號串起來避免撐爆欄位 */
export function buildFullCsv(rows: ExportRow[]): string {
  return toCsv(
    ['姓名', '公司', '職稱', '手機', 'Email', '產業', '認識場合', '評分', '分類', '狀態', '筆記'],
    rows.map(r => [
      r.name, r.company, r.title, r.mobile, r.email,
      r.industry, r.source, r.score, r.category, r.status,
      (r.notes ?? []).join('；'),
    ])
  )
}
