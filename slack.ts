import { WebClient } from '@slack/web-api'

const slack = new WebClient(process.env.SLACK_BOT_TOKEN)

export async function replyToSlack(
  channel: string,
  threadTs: string,
  text: string,
  // 給 SEO 審查用：把結構化建議藏在訊息 metadata 裡（使用者看不到），
  // 之後使用者回覆「套用」時，從 thread 裡讀回來，不用另外存資料庫
  metadata?: { event_type: string; event_payload: Record<string, any> }
): Promise<void> {
  await slack.chat.postMessage({
    channel,
    thread_ts: threadTs, // 回覆在同一個 thread
    text,
    mrkdwn: true,
    metadata,
  })
}

// 讀整個 thread 的訊息（含每則訊息自己帶的 metadata），
// 用於「套用」指令回頭找上一次 SEO 審查存的結構化建議
export async function getThreadMessages(channel: string, threadTs: string) {
  const res = await slack.conversations.replies({
    channel,
    ts: threadTs,
    include_all_metadata: true,
  })
  return res.messages || []
}
