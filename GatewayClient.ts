/**
 * GatewayClient — 通过 Obsidian requestUrl 连接到本地 OpenClaw 网关
 * 
 * 使用 Obsidian 内置 requestUrl（绕过 Chromium CORS/CSP 限制），
 * 非流式请求 + 客户端打字机效果模拟流式输出。
 * 
 * 协议：OpenAI 兼容 HTTP API
 *   POST http://127.0.0.1:{port}/v1/chat/completions
 */

import { requestUrl } from 'obsidian'

export interface GwMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface ChatCallbacks {
  onDelta: (reqId: string, delta: string) => void
  onDone: (reqId: string) => void
  onError: (reqId: string, err: string) => void
}

export interface ChatSendOptions {
  messages: GwMessage[]
  agentId?: string
  stream?: boolean
}

export class GatewayClient {
  private port: number
  private chatCallbacks: ChatCallbacks | null = null
  private statusListeners: Array<(status: string) => void> = []
  private logListeners: Array<(log: string) => void> = []
  private currentStatus: 'stopped' | 'running' = 'stopped'
  private reqCounter = 0
  private gatewayToken: string = 'uclaw'

  // 每日限流（非会员默认 10 条/天，0 表示无限制）
  private dailyMessageLimit: number = 10
  private dailyMessageCount: number = 0
  private dailyResetDate: string = ''
  private quotaCallback: ((remaining: number, max: number) => void) | null = null

  constructor(port = 18789, gatewayToken = 'uclaw') {
    this.port = port
    this.gatewayToken = gatewayToken
    this.resetDailyIfNeeded()
    // 定时从 UClawDesktop 同步许可状态
    this.startLicenseSync()
  }

  private licenseSyncTimer: ReturnType<typeof setInterval> | null = null
  private _syncing = false

  /** 启动定时同步，每 30 秒从 UClawDesktop 拉取许可状态 */
  private startLicenseSync() {
    this.licenseSyncTimer = setInterval(() => {
      this.syncLicenseFromDesktop()
    }, 30_000)
  }

  /** 从 UClawDesktop 许可端点拉取最新限额（防并发） */
  private async syncLicenseFromDesktop() {
    if (this._syncing) return
    this._syncing = true
    try {
      const res = await requestUrl({
        url: 'http://127.0.0.1:18788/license-status',
        method: 'GET'
      })
      if (res.status === 200 && res.json) {
        const data = res.json as { dailyLimit?: number; dailyRemaining?: number }
        if (typeof data.dailyLimit === 'number') {
          this.dailyMessageLimit = data.dailyLimit
          // 同步剩余条数（取较严格的值）
          if (typeof data.dailyRemaining === 'number' && data.dailyRemaining >= 0) {
            const syncedUsed = Math.max(0, data.dailyLimit - data.dailyRemaining)
            if (syncedUsed > this.dailyMessageCount) {
              this.dailyMessageCount = syncedUsed
            }
          }
          this.emitQuota()
        }
      }
    } catch {
      // UClawDesktop 未启动或端点不可达，使用本地默认值
    } finally {
      this._syncing = false
    }
  }

  /** 设置每日限额（会员传 0 不限，免费用户传对应额度） */
  setDailyLimit(limit: number) {
    this.dailyMessageLimit = limit
  }

  /** 设置限额变化回调（用于 UI 更新剩余条数） */
  onQuotaChange(cb: (remaining: number, max: number) => void) {
    this.quotaCallback = cb
    // 立即推送当前状态
    this.emitQuota()
  }

  /** 获取当日剩余可用条数 */
  getDailyRemaining(): number {
    this.resetDailyIfNeeded()
    if (this.dailyMessageLimit <= 0) return -1 // -1 = 无限制
    return Math.max(0, this.dailyMessageLimit - this.dailyMessageCount)
  }

  private resetDailyIfNeeded() {
    const today = new Date().toISOString().slice(0, 10) // YYYY-MM-DD
    if (this.dailyResetDate !== today) {
      this.dailyMessageCount = 0
      this.dailyResetDate = today
      this.emitQuota()
    }
  }

  private recordMessage() {
    this.resetDailyIfNeeded()
    this.dailyMessageCount++
    this.emitQuota()
    // 异步通知 UClawDesktop 扣除配额，不阻塞
    this.reportMessageToGateway()
  }

  /** 通知 UClawDesktop 记录一条消息（共享配额） */
  private async reportMessageToGateway() {
    try {
      const res = await requestUrl({
        url: 'http://127.0.0.1:18788/record-message',
        method: 'POST'
      })
      if (res.status === 200) {
        this.log(`配额已同步: 剩余 ${(res.json as any)?.dailyRemaining ?? '?'} 条`)
      }
    } catch (e: any) {
      this.log(`配额同步失败: ${e.message || e}`)
    }
  }

  private emitQuota() {
    if (this.quotaCallback) {
      this.quotaCallback(this.getDailyRemaining(), this.dailyMessageLimit)
    }
  }

  get status(): string {
    return this.currentStatus
  }

  setChatCallbacks(cbs: ChatCallbacks | null) {
    this.chatCallbacks = cbs
  }

  onStatus(cb: (status: string) => void): () => void {
    this.statusListeners.push(cb)
    return () => {
      this.statusListeners = this.statusListeners.filter(l => l !== cb)
    }
  }

  onLog(cb: (log: string) => void): () => void {
    this.logListeners.push(cb)
    return () => {
      this.logListeners = this.logListeners.filter(l => l !== cb)
    }
  }

  private setStatus(s: 'stopped' | 'running') {
    this.currentStatus = s
    for (const l of this.statusListeners) l(s)
  }

  private log(msg: string) {
    for (const l of this.logListeners) l(msg)
  }

  /** 检测网关连通性 */
  async checkHealth(): Promise<boolean> {
    try {
      const res = await requestUrl({
        url: `http://127.0.0.1:${this.port}/health`,
        method: 'GET'
      })

      if (res.status !== 200) {
        this.setStatus('stopped')
        this.log(`网关响应异常: HTTP ${res.status}`)
        return false
      }

      this.setStatus('running')
      this.log('✅ 网关连接正常')
      return true
    } catch (e: any) {
      this.setStatus('stopped')
      this.log(`网关连接失败: ${e.message || '未知错误'}`)
      return false
    }
  }

  /** 发送聊天消息（支持流式/非流式，通过 requestUrl） */
  async chatSend(options: ChatSendOptions): Promise<string> {
    const { messages, agentId = 'main', stream = false } = options
    const reqId = `req-${++this.reqCounter}-${Date.now().toString(36)}`
    const cbs = this.chatCallbacks

    // 每日限额检查
    this.resetDailyIfNeeded()
    if (this.dailyMessageLimit > 0 && this.dailyMessageCount >= this.dailyMessageLimit) {
      const errMsg = `今日消息已达上限（${this.dailyMessageLimit} 条），请升级会员或明天再试`
      this.log(errMsg)
      if (cbs) cbs.onError(reqId, errMsg)
      return reqId
    }

    try {
      const res = await requestUrl({
        url: `http://127.0.0.1:${this.port}/v1/chat/completions`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.gatewayToken}`,
          'x-openclaw-agent-id': agentId
        },
        body: JSON.stringify({
          model: `openclaw:${agentId}`,
          messages,
          stream,
          user: 'obsidian-uclaw'
        })
      })

      if (res.status !== 200) {
        let errMsg = `HTTP ${res.status}: ${res.text?.substring(0, 300) || ''}`
        try {
          const body = res.json
          const isAuthErr = body?.error?.type === 'authentication_error'
            || body?.error?.code === 'invalid_api_key'
            || (typeof body?.error === 'string' && /unauthorized|invalid.*token|authentication/i.test(body.error))
          if (res.status === 401 || res.status === 403 || isAuthErr) {
            errMsg = '网关认证失败，请检查网关 Token 配置'
          }
        } catch {}
        if (cbs) cbs.onError(reqId, errMsg)
        return reqId
      }

      // 请求成功，记录每日用量
      this.recordMessage()

      // 流式响应：解析 SSE 格式
      if (stream) {
        const text = res.text
        const fullContent = this.parseSSE(text)
        if (!fullContent) {
          if (cbs) cbs.onDone(reqId)
          return reqId
        }
        if (cbs) this.typewrite(fullContent, (chunk) => cbs.onDelta(reqId, chunk), () => cbs.onDone(reqId))
        return reqId
      }

      // 非流式响应：解析 JSON
      let data: any
      try {
        data = res.json
      } catch {
        // JSON 解析失败，尝试作为文本
        const raw = (res.text || '').substring(0, 500)
        if (cbs) cbs.onError(reqId, `响应解析失败: ${raw}`)
        return reqId
      }
      const fullContent: string = data?.choices?.[0]?.message?.content || ''

      if (!fullContent) {
        // 空回复：输出原始 JSON 帮助诊断
        const raw = JSON.stringify(data).substring(0, 500) || (res.text || '').substring(0, 500)
        if (cbs) cbs.onError(reqId, `网关返回空内容: ${raw}`)
        return reqId
      }

      if (cbs) this.typewrite(fullContent, (chunk) => cbs.onDelta(reqId, chunk), () => cbs.onDone(reqId))
    } catch (e: any) {
      const rawMsg = e.message || '请求失败'
      const isAuthErr = /401|403|unauthorized|invalid.*(token|key|api)|authentication/i.test(rawMsg)
      if (cbs) cbs.onError(reqId, isAuthErr ? '网关认证失败，请检查网关 Token 配置' : rawMsg)
    }

    return reqId
  }

  /** 解析 SSE 文本，提取完整内容 */
  private parseSSE(text: string): string {
    const parts: string[] = []
    const lines = text.split('\n')
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const jsonStr = line.slice(6).trim()
      if (jsonStr === '[DONE]') continue
      try {
        const data = JSON.parse(jsonStr)
        const delta = data?.choices?.[0]?.delta?.content
        if (delta) parts.push(delta)
      } catch {}
    }
    return parts.join('')
  }

  /** 打字机效果 */
  private typewrite(
    text: string,
    onChunk: (chunk: string) => void,
    onDone: () => void
  ) {
    let i = 0
    const step = () => {
      if (i < text.length) {
        const chunkSize = Math.min(1 + Math.floor(Math.random() * 3), text.length - i)
        const chunk = text.substring(i, i + chunkSize)
        i += chunkSize
        onChunk(chunk)
        setTimeout(step, 10 + Math.floor(Math.random() * 20))
      } else {
        onDone()
      }
    }
    step()
  }

  /** 取消当前请求（非流式模式下无需取消） */
  chatCancel() {
    // requestUrl 不支持取消，但打字机效果可以通过重置状态来实现
    // 此方法保留用于 API 兼容性
  }

  disconnect() {
    if (this.licenseSyncTimer) {
      clearInterval(this.licenseSyncTimer)
      this.licenseSyncTimer = null
    }
    this.setStatus('stopped')
  }
}