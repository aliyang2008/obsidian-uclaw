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
  private token: string
  private chatCallbacks: ChatCallbacks | null = null
  private statusListeners: Array<(status: string) => void> = []
  private logListeners: Array<(log: string) => void> = []
  private currentStatus: 'stopped' | 'running' = 'stopped'
  private reqCounter = 0

  constructor(port = 18789, token = 'uclaw') {
    this.port = port
    this.token = token
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
      // 空配对码提醒
      if (!this.token) {
        this.setStatus('stopped')
        this.log('⚠ 未设置配对码，请在插件设置中填入与 UClawDesktop 一致的配对码')
        return false
      }

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

    try {
      const res = await requestUrl({
        url: `http://127.0.0.1:${this.port}/v1/chat/completions`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.token}`,
          'x-openclaw-agent-id': agentId
        },
        body: JSON.stringify({
          model: `openclaw:${agentId}`,
          messages,
          stream,
          user: this.token || 'obsidian-uclaw'
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
            errMsg = '配对码不一致，请设置！'
          }
        } catch {}
        if (cbs) cbs.onError(reqId, errMsg)
        return reqId
      }

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
      if (cbs) cbs.onError(reqId, isAuthErr ? '配对码不一致，请设置！' : rawMsg)
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
    this.setStatus('stopped')
  }
}