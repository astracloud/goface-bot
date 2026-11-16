import OpenAI from 'openai'
import { createSEOPullRequest, type Change } from './update-file'
import { getThreadMessages } from './slack'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

export interface SeoSuggestion {
  field: 'title' | 'description' | 'h1'
  original: string
  replacement: string
}

export interface SeoReviewResult {
  url: string
  slackText: string
  suggestions: SeoSuggestion[]
}

interface SeoAnalysisResponse {
  analysis: string
  suggestions: Array<{ field: string; original: string; replacement: string }>
  extraNotes?: string
  priority: string
}

/**
 * 抓取網頁內容，用 OpenAI 分析 SEO 並回覆建議
 * 不直接開 PR；但會把能精準比對到原文的建議（title/description/h1）整理成
 * 結構化的 suggestions，供使用者之後回覆「套用」時直接組成 PR
 */
export async function reviewPageSEO(url: string): Promise<SeoReviewResult> {
  // 1. 抓取頁面內容
  let title = ''
  let description = ''
  let h1 = ''
  let h2List: string[] = []

  try {
    const res = await fetch(url)
    const html = await res.text()

    title = html.match(/<title>(.*?)<\/title>/i)?.[1] || ''
    description = html.match(/name="description"[^>]*content="([^"]+)"/i)?.[1] || ''
    h1 = html.match(/<h1[^>]*>(.*?)<\/h1>/i)?.[1] || ''
    h2List = [...html.matchAll(/<h2[^>]*>(.*?)<\/h2>/gi)].map(m => m[1]).slice(0, 5)
  } catch {
    return {
      url,
      slackText: '無法抓取頁面內容，請確認網址是否正確且公開可存取。',
      suggestions: [],
    }
  }

  const pageContent = `
Title: ${title || '找不到'}
Meta Description: ${description || '找不到'}
H1: ${h1 || '找不到'}
H2 列表: ${h2List.join(' / ') || '找不到'}
  `.trim()

  // 2. 呼叫 OpenAI 分析，回傳結構化 JSON
  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    max_tokens: 1200,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: `你是一位專業 SEO 顧問，專精於繁體中文市場。請審查頁面並回傳 JSON，格式：
{
  "analysis": "🔍 現況分析\\n（Title、Meta Description、標題結構的問題點，markdown 格式文字）",
  "suggestions": [
    {"field": "title", "original": "必須完全照抄使用者提供的 Title 原文", "replacement": "建議的新標題"},
    {"field": "description", "original": "必須完全照抄使用者提供的 Meta Description 原文", "replacement": "建議的新描述"},
    {"field": "h1", "original": "必須完全照抄使用者提供的 H1 原文", "replacement": "建議的新 H1"}
  ],
  "extraNotes": "💡 其他建議（無法直接套用、需人工調整，例如整組 H2 重新發想），markdown 格式文字，若無則回傳空字串",
  "priority": "📊 優先順序\\n（哪個最重要，先改哪個，markdown 格式文字）"
}

規則：
- suggestions 裡的 "original" 一定要是使用者提供的頁面資訊裡「逐字完全一樣」的文字，不可以意譯、摘要或加標點。如果某欄位顯示「找不到」，或你不建議修改它，就不要放進 suggestions。
- 只有 title / description / h1 這三種「單一欄位、有明確原文」的建議能放進 suggestions。像「重新設計全部 H2 標題」這種沒有單一明確原文、屬於整體重新發想的建議，一律寫進 extraNotes，不要放進 suggestions。
- 只回傳 JSON，不要其他文字、不要加 markdown code block 標記。`,
      },
      {
        role: 'user',
        content: `請審查以下頁面的 SEO 狀況：\n\n網址：${url}\n\n頁面資訊：\n${pageContent}`,
      },
    ],
  })

  const raw = response.choices[0]?.message?.content || '{}'
  let parsed: SeoAnalysisResponse
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { url, slackText: '無法生成分析，請稍後再試。', suggestions: [] }
  }

  // 只收下「原文」真的能在抓到的頁面資訊裡逐字比對到的建議，
  // 避免 GPT 編造或改寫原文，導致之後套用時在 src 裡找不到對應文字
  const pageValues: Record<string, string> = { title, description, h1 }
  const suggestions: SeoSuggestion[] = (parsed.suggestions || [])
    .filter(s => ['title', 'description', 'h1'].includes(s.field))
    .filter(s => pageValues[s.field] && pageValues[s.field] === s.original)
    .map(s => ({ field: s.field as SeoSuggestion['field'], original: s.original, replacement: s.replacement }))

  const fieldLabel: Record<SeoSuggestion['field'], string> = {
    title: 'Title',
    description: 'Meta Description',
    h1: 'H1',
  }

  const suggestionLines = suggestions.length
    ? suggestions
        .map((s, i) => `${i + 1}. [${fieldLabel[s.field]}]\n   原文：${s.original}\n   建議：${s.replacement}`)
        .join('\n')
    : '（這次沒有可直接套用的修改建議）'

  const applyHint = suggestions.length
    ? `\n💬 回覆「@goface-bot 套用 ${suggestions.map((_, i) => i + 1).join(',')}」或「@goface-bot 全部套用」，我就直接幫你組成修改、開 PR 給工程師 review。`
    : ''

  const slackText = [
    parsed.analysis,
    '',
    '✏️ 具體修改建議',
    suggestionLines,
    parsed.extraNotes ? `\n${parsed.extraNotes}` : '',
    '',
    parsed.priority,
    applyHint,
  ].filter(Boolean).join('\n')

  return { url, suggestions, slackText }
}

/**
 * 解析「套用 1,3」「全部套用」等指令
 */
export function parseApplyCommand(text: string): { all: boolean; indices: number[] } | null {
  const clean = text.trim()
  if (/^(全部套用|套用全部|套用所有)$/.test(clean)) return { all: true, indices: [] }

  const m = clean.match(/^套用\s*([\d,，、\s]+)$/)
  if (!m) return null
  const indices = [...m[1].matchAll(/\d+/g)].map(x => parseInt(x[0], 10)).filter(n => n > 0)
  if (indices.length === 0) return null
  return { all: false, indices }
}

const SEO_REVIEW_EVENT_TYPE = 'goface_seo_review'

/**
 * 把 SEO 審查的結構化建議存進這則 Slack 訊息的 metadata（使用者看不到）
 */
export function buildSeoReviewMetadata(url: string, suggestions: SeoSuggestion[]) {
  return { event_type: SEO_REVIEW_EVENT_TYPE, event_payload: { url, suggestions } }
}

/**
 * 在 thread 裡往回找最近一次 SEO 審查存的結構化建議（給「套用」指令用）
 */
export async function findSeoReviewInThread(
  channel: string,
  threadTs: string
): Promise<{ url: string; suggestions: SeoSuggestion[] } | null> {
  const messages = await getThreadMessages(channel, threadTs)
  for (let i = messages.length - 1; i >= 0; i--) {
    const metadata: any = (messages[i] as any).metadata
    if (metadata?.event_type === SEO_REVIEW_EVENT_TYPE) {
      return metadata.event_payload as { url: string; suggestions: SeoSuggestion[] }
    }
  }
  return null
}

/**
 * 把使用者挑選的 SEO 建議轉成 update_file 的 Change，直接重用 createSEOPullRequest 開 PR
 */
export async function applySeoSuggestions(params: {
  url: string
  suggestions: SeoSuggestion[]
  slackUser: string
}): Promise<{ prUrl: string; prNumber: number }> {
  const changes: Change[] = params.suggestions.map(s => ({
    url: params.url,
    original: s.original,
    replacement: s.replacement,
    metaField: s.field === 'title' || s.field === 'description' ? s.field : undefined,
  }))
  return createSEOPullRequest({ changes, slackUser: params.slackUser })
}
