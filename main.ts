import { Plugin, WorkspaceLeaf, PluginSettingTab, Setting, App } from 'obsidian'
import { UClawChatView, UCLAW_CHAT_VIEW_TYPE, PresetMessage } from './UClawChatView'
import { GatewayClient } from './GatewayClient'

interface UClawSettings {
  gatewayPort: number
  gatewayToken: string
  presets: PresetMessage[]
}

const DEFAULT_PRESETS: PresetMessage[] = [
  { name: '翻译为英文', content: '请将以下内容翻译为英文：\n' },
  { name: '总结要点', content: '请总结以下内容的要点：\n' },
  { name: '润色文字', content: '请润色以下文字，使其更流畅自然：\n' },
  { name: '解释概念', content: '请用通俗易懂的方式解释以下概念：\n' },
  { name: '写邮件回复', content: '请帮我写一封邮件回复，内容如下：\n' },
  { name: '代码审查', content: '请审查以下代码，指出潜在问题：\n' }
]

const DEFAULT_SETTINGS: UClawSettings = {
  gatewayPort: 18789,
  gatewayToken: 'uclaw',
  presets: DEFAULT_PRESETS
}

export default class UClawPlugin extends Plugin {
  settings: UClawSettings = DEFAULT_SETTINGS
  client: GatewayClient = new GatewayClient()
  private chatView: UClawChatView | null = null

  async onload() {
    await this.loadSettings()

    // 初始化网关客户端
    this.client = new GatewayClient(this.settings.gatewayPort, this.settings.gatewayToken)

    // 注册视图
    this.registerView(
      UCLAW_CHAT_VIEW_TYPE,
      (leaf: WorkspaceLeaf) => {
        const view = new UClawChatView(leaf, this.client)
        view.setPresets(this.settings.presets)
        this.chatView = view
        return view
      }
    )

    // 添加左侧 ribbon 图标，点击时在右侧面板打开
    this.addRibbonIcon('message-square', 'UClaw AI Chat', () => {
      this.activateView()
    })

    // 添加命令：打开 UClaw AI Chat
    this.addCommand({
      id: 'open-uclaw-chat',
      name: '打开 UClaw AI 对话',
      callback: () => {
        this.activateView()
      }
    })

    // 添加命令：检测网关
    this.addCommand({
      id: 'uclaw-healthcheck',
      name: '检测 OpenClaw 网关连接',
      callback: async () => {
        await this.client.checkHealth()
      }
    })

    // 添加设置面板
    this.addSettingTab(new UClawSettingsTab(this.app, this))

    // 启动时自动打开视图（视图内部会自动检测网关）
    this.app.workspace.onLayoutReady(() => {
      this.activateView()
    })
  }

  onunload() {
    this.client.disconnect()
  }

  /** 在右侧面板激活视图 */
  async activateView() {
    const { workspace } = this.app

    // 检查是否已有视图
    let leaf = workspace.getLeavesOfType(UCLAW_CHAT_VIEW_TYPE)[0]

    if (!leaf) {
      // 在右侧边栏创建新 leaf
      leaf = workspace.getRightLeaf(false)
      if (leaf) {
        await leaf.setViewState({
          type: UCLAW_CHAT_VIEW_TYPE,
          active: true
        })
      }
    }

    // 聚焦视图
    if (leaf) {
      workspace.revealLeaf(leaf)
    }
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData())
  }

  async saveSettings() {
    await this.saveData(this.settings)
    // 更新客户端端口
    this.client = new GatewayClient(this.settings.gatewayPort, this.settings.gatewayToken)
    // 同步预设到视图
    if (this.chatView) {
      this.chatView.setPresets(this.settings.presets)
    }
  }
}

/** 设置面板 */
class UClawSettingsTab extends PluginSettingTab {
  plugin: UClawPlugin

  constructor(app: App, plugin: UClawPlugin) {
    super(app, plugin)
    this.plugin = plugin
  }

  display(): void {
    const { containerEl } = this
    containerEl.empty()

    const headerRow = containerEl.createDiv({ cls: 'uclaw-settings-header' })
    headerRow.createEl('h2', { text: 'UClaw AI Chat 设置' })
    headerRow.createEl('a', {
      text: '使用教程',
      href: 'https://jinwuyun.feishu.cn/wiki/T078wlmowirvXjk15OecOeCnnce'
    })

    new Setting(containerEl)
      .setName('网关端口')
      .setDesc('OpenClaw 本地网关的 HTTP 端口（默认 18790）')
      .addText(text => text
        .setPlaceholder('18790')
        .setValue(String(this.plugin.settings.gatewayPort))
        .onChange(async (value) => {
          const port = parseInt(value, 10)
          if (!isNaN(port) && port > 0 && port < 65536) {
            this.plugin.settings.gatewayPort = port
            await this.plugin.saveSettings()
          }
        }))

    containerEl.createEl('div', {
      text: '💡 提示：修改端口需要切换视图后重连网关。',
      cls: 'setting-item-description'
    })

    new Setting(containerEl)
      .setName('网关 Token')
      .setDesc('与 OpenClaw 网关配置中的 Token 保持一致（默认 uclaw）')
      .addText(text => text
        .setPlaceholder('uclaw')
        .setValue(this.plugin.settings.gatewayToken || 'uclaw')
        .onChange(async (value) => {
          this.plugin.settings.gatewayToken = value.trim() || 'uclaw'
          await this.plugin.saveSettings()
        }))

    containerEl.createEl('div', {
      text: '💡 提示：如果网关返回 401 错误，请确认 Token 与网关配置一致。',
      cls: 'setting-item-description'
    })

    // ---- 快捷消息 ----
    containerEl.createEl('h3', { text: '快捷消息' })
    containerEl.createEl('p', {
      text: '在聊天面板底部显示的快捷消息按钮，点击后填入输入框。',
      cls: 'setting-item-description'
    })

    const presetContainer = containerEl.createDiv('uclaw-preset-editor')

    const renderPresetEditor = () => {
      presetContainer.empty()
      const presets = [...this.plugin.settings.presets]

      for (let i = 0; i < presets.length; i++) {
        const preset = presets[i]
        const row = presetContainer.createDiv('uclaw-preset-edit-row')

        new Setting(row)
          .setName(`#${i + 1}`)
          .addText(text => text
            .setPlaceholder('名称（如：翻译为英文）')
            .setValue(preset.name)
            .onChange(async (value) => {
              this.plugin.settings.presets[i].name = value
              await this.plugin.saveSettings()
            })
          )
          .addText(text => {
            text.setPlaceholder('消息内容')
              .setValue(preset.content)
            text.inputEl.style.width = '240px'
            text.onChange(async (value) => {
              this.plugin.settings.presets[i].content = value
              await this.plugin.saveSettings()
            })
            return text
          })
          .addButton(btn => btn
            .setIcon('trash')
            .setTooltip('删除')
            .onClick(async () => {
              this.plugin.settings.presets.splice(i, 1)
              await this.plugin.saveSettings()
              renderPresetEditor()
            })
          )
      }

      // 添加按钮
      if (presets.length < 12) {
        const addRow = presetContainer.createDiv('uclaw-preset-add-row')
        new Setting(addRow)
          .setName('')
          .addButton(btn => btn
            .setButtonText('+ 添加快捷消息')
            .setCta()
            .onClick(async () => {
              this.plugin.settings.presets.push({ name: '', content: '' })
              await this.plugin.saveSettings()
              renderPresetEditor()
            })
          )
      }
    }

    renderPresetEditor()
  }
}