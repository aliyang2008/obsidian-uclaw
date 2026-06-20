# UClaw AI Chat — Obsidian 插件

[![Version](https://img.shields.io/badge/version-1.0.5-blue)](manifest.json)
[![Obsidian](https://img.shields.io/badge/Obsidian-%3E%3D1.5.0-7c3aed)](manifest.json)

将 UClawDesktop AI 对话能力嵌入 Obsidian 右侧面板，通过本地 OpenClaw HTTP 网关实现流式 AI 聊天。

---

## 核心特性

- **右侧面板集成** — 不离开 Obsidian 即可与 AI 对话
- **多会话管理** — Tab 切换，消息独立持久化
- **文件附件** — 支持图片、PDF、Markdown、Word 等文件上传
- **流式输出** — 打字机效果逐字显示 AI 回复
- **Markdown 渲染** — 代码块、加粗、斜体、行内代码
- **主题自适应** — 跟随 Obsidian CSS 变量，深色/浅色模式无缝切换
- **快捷消息** — 可自定义预设提示词（翻译、总结、润色等）

---

## 快速安装

1. 下载 `main.js`、`manifest.json`、`styles.css`
2. 放入 Obsidian 仓库的插件目录：

   ```
   {仓库}/.obsidian/plugins/obsidian-uclaw/
   ├── main.js
   ├── manifest.json
   └── styles.css
   ```

3. 打开 Obsidian → 设置 → 第三方插件 → 启用 **UClaw AI Chat**

---

## 前置条件

插件依赖本地运行的 **OpenClaw 网关服务**（默认 `127.0.0.1:18790`）：

| 接口 | 说明 |
|------|------|
| `GET /health` | 健康检查 |
| `POST /v1/chat/completions` | 聊天补全（OpenAI 兼容 API） |

认证方式：Bearer Token，默认值为 `uclaw`。

---

## 界面

```
┌─────────────────────────────────┐
│  ● 已连接    [1] [2] [+][−]      │  ← 状态 + 会话 Tab
├─────────────────────────────────┤
│  AI: 你好，有什么可以帮助你的？    │
│                                  │  ← 消息区域
│      你: 帮我总结这篇笔记          │
├─────────────────────────────────┤
│  📎 photo.png  ×                │  ← 附件栏
├─────────────────────────────────┤
│  [📎] [________________] [发送]  │  ← 输入区
└─────────────────────────────────┘
```

---

## 基本操作

| 操作 | 方法 |
|------|------|
| 打开面板 | 点击左侧 Ribbon 💬 图标，或 `Ctrl+P` 搜索「UClaw」 |
| 发送消息 | 输入内容后按 `Enter`（`Shift+Enter` 换行） |
| 停止回复 | 发送过程中点击红色 **停止** 按钮 |
| 新建会话 | 点击 `+` 按钮 |
| 删除会话 | 点击 `−` 按钮（需 ≥2 个会话） |
| 上传附件 | 点击 📎 按钮选择文件 |
| 检测网关 | 点击状态指示器，或命令面板搜索「检测网关」 |

---

## 设置

进入 设置 → 第三方插件 → UClaw AI Chat → ⚙：

| 设置项 | 默认值 | 说明 |
|--------|--------|------|
| 网关端口 | `18789` | OpenClaw 本地 HTTP 端口 |
| 配对码 | — | 与 UClawDesktop 渠道插件中的配对码一致 |
| 快捷消息 | 6 条预设 | 可自定义最多 12 条快捷提示 |

---

## 开发构建

```bash
npm install
npm run dev    # 开发模式（监听 + sourcemap）
npm run build  # 生产构建（压缩 + 类型检查）
```

技术栈：TypeScript + esbuild，通过 Obsidian 内置 `requestUrl` 绕过 CORS/CSP。

---

## 文档

完整操作手册见 [OPERATION_GUIDE.md](./OPERATION_GUIDE.md)，涵盖：
- 详细安装步骤
- 多会话与附件操作
- 命令与快捷键
- 技术架构与通信协议
- 故障排除
