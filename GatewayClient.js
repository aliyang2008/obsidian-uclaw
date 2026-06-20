"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// GatewayClient.ts
var GatewayClient_exports = {};
__export(GatewayClient_exports, {
  GatewayClient: () => GatewayClient
});
module.exports = __toCommonJS(GatewayClient_exports);
var import_obsidian = require("obsidian");
var GatewayClient = class {
  constructor(port = 18789, pairingCode = "", gatewayToken = "uclaw") {
    this.chatCallbacks = null;
    this.statusListeners = [];
    this.logListeners = [];
    this.currentStatus = "stopped";
    this.reqCounter = 0;
    this.port = port;
    this.pairingCode = pairingCode;
    this.gatewayToken = gatewayToken;
  }
  get status() {
    return this.currentStatus;
  }
  setChatCallbacks(cbs) {
    this.chatCallbacks = cbs;
  }
  onStatus(cb) {
    this.statusListeners.push(cb);
    return () => {
      this.statusListeners = this.statusListeners.filter((l) => l !== cb);
    };
  }
  onLog(cb) {
    this.logListeners.push(cb);
    return () => {
      this.logListeners = this.logListeners.filter((l) => l !== cb);
    };
  }
  setStatus(s) {
    this.currentStatus = s;
    for (const l of this.statusListeners) l(s);
  }
  log(msg) {
    for (const l of this.logListeners) l(msg);
  }
  /** 检测网关连通性 */
  async checkHealth() {
    try {
      if (!this.pairingCode) {
        this.setStatus("stopped");
        this.log("\u26A0 \u672A\u8BBE\u7F6E\u914D\u5BF9\u7801\uFF0C\u8BF7\u5728\u63D2\u4EF6\u8BBE\u7F6E\u4E2D\u586B\u5165\u4E0E UClawDesktop \u4E00\u81F4\u7684\u914D\u5BF9\u7801");
        return false;
      }
      const res = await (0, import_obsidian.requestUrl)({
        url: `http://127.0.0.1:${this.port}/health`,
        method: "GET"
      });
      if (res.status !== 200) {
        this.setStatus("stopped");
        this.log(`\u7F51\u5173\u54CD\u5E94\u5F02\u5E38: HTTP ${res.status}`);
        return false;
      }
      this.setStatus("running");
      this.log("\u2705 \u7F51\u5173\u8FDE\u63A5\u6B63\u5E38");
      return true;
    } catch (e) {
      this.setStatus("stopped");
      this.log(`\u7F51\u5173\u8FDE\u63A5\u5931\u8D25: ${e.message || "\u672A\u77E5\u9519\u8BEF"}`);
      return false;
    }
  }
  /** 发送聊天消息（支持流式/非流式，通过 requestUrl） */
  async chatSend(options) {
    const { messages, agentId = "main", stream = false } = options;
    const reqId = `req-${++this.reqCounter}-${Date.now().toString(36)}`;
    const cbs = this.chatCallbacks;
    try {
      const res = await (0, import_obsidian.requestUrl)({
        url: `http://127.0.0.1:${this.port}/v1/chat/completions`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.gatewayToken}`,
          "x-openclaw-pairing-code": this.pairingCode,
          "x-openclaw-agent-id": agentId
        },
        body: JSON.stringify({
          model: `openclaw:${agentId}`,
          messages,
          stream,
          user: "obsidian-uclaw"
        })
      });
      if (res.status !== 200) {
        let errMsg = `HTTP ${res.status}: ${res.text?.substring(0, 300) || ""}`;
        try {
          const body = res.json;
          const isAuthErr = body?.error?.type === "authentication_error" || body?.error?.code === "invalid_api_key" || typeof body?.error === "string" && /unauthorized|invalid.*token|authentication/i.test(body.error);
          if (res.status === 401 || res.status === 403 || isAuthErr) {
            errMsg = "\u914D\u5BF9\u7801\u4E0D\u4E00\u81F4\uFF0C\u8BF7\u8BBE\u7F6E\uFF01";
          }
        } catch {
        }
        if (cbs) cbs.onError(reqId, errMsg);
        return reqId;
      }
      if (stream) {
        const text = res.text;
        const fullContent2 = this.parseSSE(text);
        if (!fullContent2) {
          if (cbs) cbs.onDone(reqId);
          return reqId;
        }
        if (cbs) this.typewrite(fullContent2, (chunk) => cbs.onDelta(reqId, chunk), () => cbs.onDone(reqId));
        return reqId;
      }
      let data;
      try {
        data = res.json;
      } catch {
        const raw = (res.text || "").substring(0, 500);
        if (cbs) cbs.onError(reqId, `\u54CD\u5E94\u89E3\u6790\u5931\u8D25: ${raw}`);
        return reqId;
      }
      const fullContent = data?.choices?.[0]?.message?.content || "";
      if (!fullContent) {
        const raw = JSON.stringify(data).substring(0, 500) || (res.text || "").substring(0, 500);
        if (cbs) cbs.onError(reqId, `\u7F51\u5173\u8FD4\u56DE\u7A7A\u5185\u5BB9: ${raw}`);
        return reqId;
      }
      if (cbs) this.typewrite(fullContent, (chunk) => cbs.onDelta(reqId, chunk), () => cbs.onDone(reqId));
    } catch (e) {
      const rawMsg = e.message || "\u8BF7\u6C42\u5931\u8D25";
      const isAuthErr = /401|403|unauthorized|invalid.*(token|key|api)|authentication/i.test(rawMsg);
      if (cbs) cbs.onError(reqId, isAuthErr ? "\u914D\u5BF9\u7801\u4E0D\u4E00\u81F4\uFF0C\u8BF7\u8BBE\u7F6E\uFF01" : rawMsg);
    }
    return reqId;
  }
  /** 解析 SSE 文本，提取完整内容 */
  parseSSE(text) {
    const parts = [];
    const lines = text.split("\n");
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const jsonStr = line.slice(6).trim();
      if (jsonStr === "[DONE]") continue;
      try {
        const data = JSON.parse(jsonStr);
        const delta = data?.choices?.[0]?.delta?.content;
        if (delta) parts.push(delta);
      } catch {
      }
    }
    return parts.join("");
  }
  /** 打字机效果 */
  typewrite(text, onChunk, onDone) {
    let i = 0;
    const step = () => {
      if (i < text.length) {
        const chunkSize = Math.min(1 + Math.floor(Math.random() * 3), text.length - i);
        const chunk = text.substring(i, i + chunkSize);
        i += chunkSize;
        onChunk(chunk);
        setTimeout(step, 10 + Math.floor(Math.random() * 20));
      } else {
        onDone();
      }
    };
    step();
  }
  /** 取消当前请求（非流式模式下无需取消） */
  chatCancel() {
  }
  disconnect() {
    this.setStatus("stopped");
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  GatewayClient
});
