import * as dotenv from 'dotenv'
dotenv.config()

const { reviewPageSEO, parseApplyCommand } = require('./review-seo')

async function run() {
  console.log('--- parseApplyCommand ---')
  console.log('套用 1,3        →', parseApplyCommand('套用 1,3'))
  console.log('套用1、2、3      →', parseApplyCommand('套用1、2、3'))
  console.log('全部套用        →', parseApplyCommand('全部套用'))
  console.log('套用全部        →', parseApplyCommand('套用全部'))
  console.log('你好            →', parseApplyCommand('你好'))

  const url = process.argv[2] || 'https://www.goface.me/zh-TW/blog/zh-TW/b82.html'
  console.log(`\n--- reviewPageSEO(${url}) ---`)
  const result = await reviewPageSEO(url)

  console.log('\n[slackText 會長這樣]\n')
  console.log(result.slackText)

  console.log('\n[結構化 suggestions（藏進 metadata 的部分）]\n')
  console.log(JSON.stringify(result.suggestions, null, 2))
}

run().catch(err => {
  console.error('❌ 錯誤：', err)
  process.exit(1)
})
