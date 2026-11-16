import * as dotenv from 'dotenv'
dotenv.config()

const { applySeoSuggestions } = require('./review-seo')

// 用剛剛 test-review-seo.ts 實際跑出來、通過「原文逐字比對」驗證的 Title 建議，
// 固定寫死，避免重新呼叫 GPT 導致兩次結果不一致
async function run() {
  const url = 'https://www.goface.me/zh-TW/blog/zh-TW/b82.html'
  const suggestions = [
    {
      field: 'title' as const,
      original: '2027 企業門禁考勤系統汰換指南：傳統刷卡 vs. 雲端人臉辨識成本與效益比較｜GoFace',
      replacement: '2027 年門禁考勤系統汰換指南：刷卡 vs. 人臉辨識成本效益比較',
    },
  ]

  try {
    const { prUrl, prNumber } = await applySeoSuggestions({ url, suggestions, slackUser: 'ching-test' })
    console.log(`✅ PR #${prNumber}: ${prUrl}`)
  } catch (err: any) {
    console.error('❌ 錯誤：', err.message)
  }
}

run()
