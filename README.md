# 🎤 dsh-voice

> DeepSeek Harness (dsh) 语音转文字插件：输入框右下角一个麦克风按钮，说完话，文字直接进输入框。

<p align="center">
  <b>点一下说话 · 再点一下出字 · 三种识别引擎可切换 · 液态玻璃风格</b>
</p>
<img src="./images/01.png" style="zoom: 80%;" /> 

<img src="./images/02.png" style="zoom: 80%;" /> 

## ✨ 功能特性

- 🎙️ **一键语音输入**：输入框右下角（发送键左侧）的麦克风按钮，点一下开始录音、再点一下停止并转写，结果**追加**进输入框；
- 🔁 **三种识别引擎**（改一个常量切换）：
  | 引擎 | 说明 | 费用 |
  |---|---|---|
  | `webspeech`（默认） | 浏览器自带语音识别，装完即用、零配置（Edge 走微软云端，国内可用；Chrome 走谷歌，国内可能不通） | 免费 |
  | `xfyun` | 讯飞语音听写，中文效果最好、秒级返回，密钥只存在本机服务端 | 免费额度/按量 |
  | `whisper` | 浏览器本地 Whisper（small q8），音频不出机器、可离线 | 免费 |
- 🎚️ **麦克风设备选择下拉框**：列出所有音频输入设备，选择持久化（`localStorage`），不再被浏览器的默认麦克风坑（Web Speech 引擎不支持指定设备，该模式下自动隐藏）；
- 📈 **自动增益**：安静麦克风录出的低音量语音会自动放大再识别，避免"没检测到声音"；
- 🔇 **静音/过短拦截**：完全无声或不足 0.25 秒的录音直接本地拦截，不浪费云端配额；
- 🧠 **Silero VAD 静音检测增强**：录音先用浏览器内神经网络 VAD（约 2MB 模型，缓存后离线可用）判定「真的在说话」，只把语音段送识别——呼吸声/风扇底噪不再被识别成「嗯嗯啊啊」；VAD 加载失败自动降级为零依赖的能量门控；
- 🕳️ **语气词保险网**：识别结果整条只由「嗯/啊/哦/哈…」构成时判为噪声丢弃，夹在真话里的语气词不受影响（可关）；
- 📝 **长句完整拼接**：讯飞按 VAD 把长语音切成多段，插件会把所有段落按顺序拼回，不会只出后半句；
- ⌨️ **空格键上屏**：录音中按空格键 = 停止录音并立即转写上屏（等同点击麦克风按钮），三种引擎统一手势；录音中悬浮麦克风按钮会提示「按空格键让文字上屏」。输入法选词、Ctrl/Alt/Shift/Meta 组合键、按住不放的自动重复、下拉框焦点时空格不会被劫持，正常打字零影响；
- 🪟 **液态玻璃主题**：按钮用 `--dsw-*` 设计令牌 + `--lg-glass-blur` 毛玻璃效果，与 [dsh-liquid-glass](https://github.com/xingyingyuzhui/dsh-liquid-glass) 主题一致。

## 🚀 安装

```sh
dsh plugin --profile web add git+https://github.com/charlie-pan/dsh-voice.git
客户端：
原版(感谢大佬开发)：github:charlie-pan/dsh-voice
fix版（卸载后再更新）：github:Karanoyo/dsh-voice#main
```

重启 dsh web 并硬刷新，打开一个会话即可在输入框右下角看到麦克风按钮。

## 🛠️ 配置

改 `client.js` 顶部的常量：

| 常量 | 默认 | 说明 |
|---|---|---|
| `ASR_ENGINE` | `'webspeech'` | `'webspeech'` / `'xfyun'` / `'whisper'` |
| `WEBSpeech_LANG` | `'zh-CN'` | Web Speech 引擎的语言 |
| `MODEL_ID` | `onnx-community/whisper-small` | Whisper 引擎的模型；中文想更好可换 medium |
| `TRANSCRIBE_LANGUAGE` | `'chinese'` | Whisper 引擎的转写语言；`null` = 自动检测 |
| `VAD_ENABLE` | `true` | Silero VAD 总开关：浏览器内语音活动检测，裁掉非语音段；`false` = 只用能量门控 |
| `VAD_SPEECH_THRESHOLD` | `0.5` | VAD 判定阈值（与 whisper.cpp 同名参数一致），环境噪声大可降到 0.4 |
| `VAD_MIN_SPEECH_MS` | `250` | 最短语音时长（ms），短于此的孤立声音（咳嗽/碰桌）不算说话 |
| `VAD_SPEECH_PAD_MS` | `30` | 语音段前后保留缓冲（ms），防止裁剪掐头去尾 |
| `ENERGY_GATE_ENABLE` | `true` | 能量门控兜底开关（VAD 关闭/加载失败时按自适应底噪裁剪） |
| `MIN_SPEECH_SEC` | `0.25` | 整段录音最少有效语音秒数，低于则判定「没说话」不送识别 |
| `FILLER_FILTER_ENABLE` | `true` | 语气词保险网开关：整条结果全是语气词 → 丢弃 |
| `FILLER_CHARS` | `'嗯恩啊哦噢哈…'` | 语气词表（可自行增删字符） |
| `WHISPER_NO_SPEECH_THRESHOLD` | `0.6` | Whisper 无语音概率阈值（openai/whisper 官方默认） |
| `SPACE_COMMIT_ENABLE` | `true` | 空格键上屏开关：录音中按空格 = 停止录音并立即转写上屏（等同点击麦克风按钮）；`false` = 不劫持空格键、悬浮提示也不显示 |
| `SPACE_COMMIT_HINT` | `'按空格键让文字上屏'` | 录音中悬浮提示文案（拼接在「点击停止并转写」后显示） |
| `DEBUG_LOG_ENABLE` | `false` | 调试日志总开关（**默认值，默认关闭**）：每次录音开始打「功能状态总览」，各功能生效/跳过/失败的原因日志；**全部** 🧪 调试日志（含 VAD 裁剪、xfyun 返回、识别结果、写回内容）与 **[dsh-voice-track] 光标追踪**统一受它控制。插件选项页的「开启调试日志」开关保存后写入 localStorage 记忆并**在启动时覆盖此默认值**。**关闭 = 完全不执行**（绝非只隐藏）：追踪会话不挂监听器、插桩点短路（参数里的 DOM 采样构造不求值）、console.log 不执行；开关与头部常量**同变量同级别**。异常类日志（warn/error）不受此开关控制，永远输出 |
| `CURSOR_TRACK_ENABLE` | `true` | 光标追踪**专项逃生口**：跟随 `DEBUG_LOG_ENABLE` 总开关联动（总开关开=追踪输出完整日志，关=追踪零执行）；想保留 🧪 日志但单独关掉追踪时改 `false` |
| `DEBUG_LOG_STORAGE_KEY` | `'dsh-voice.debugLog'` | 调试开关的 localStorage 记忆键（选项页设置卡片「保存」时写入） |

### ⚙️ 插件选项页的「开启调试日志」卡片（1:1 复刻 Univer Office 样式）

进入 DSH 侧栏「插件」列表，点击 **dsh-voice** 名字进入详情页，在描述与组件清单之间即可看到设置卡片：

- **精致外观**：12px 圆角边框卡片、36×20px 胶囊开关（120ms 平滑动画）、右下角「放弃修改 / 保存」按钮栏；全量采用 DSH 官方设计令牌（`var(--dsw-alias-*)`），深浅色主题自动适配，并尊重系统「减少动态效果」设置；
- **草稿确认交互**：拨动开关进入草稿态，「放弃修改」复位、「保存」才真正写入；写入失败（隐私模式/存储被禁）时绝不假装成功——零提交 + 记 warn，按钮保持可用可重试；
- **持久记忆**：点击保存后写入 `localStorage`，重启 dsh web、硬刷新、浏览器重启后依然保留你的选择；
- **官方规范**：通过官方 `plugins.bundle.config` slot（key=`dsh-voice`）挂载，随插件启用而注册、禁用而撤销。

### 讯飞凭据（使用 `xfyun` 引擎时）

1. 注册 [讯飞开放平台](https://www.xfyun.cn/) → 控制台 →「我的应用」→ 创建应用（开通**语音听写**），拿到 **APPID / APIKey / APISecret**；
2. 二选一配置（密钥只存在本机，不进浏览器、不要提交到仓库）：
   - **环境变量**：`XFYUN_APPID` / `XFYUN_APIKEY` / `XFYUN_APISECRET`；
   - **本地文件**：在插件目录放一个 `xfyun.secret.json`（已被 `.gitignore` 忽略）：`C:\Users\%username%\.dsh\profiles\desktop\node_modules\dsh-voice\`

```json
{ "appId": "…", "apiKey": "…", "apiSecret": "…" }
```

3. 重启 dsh web（host 半在启动时加载）。

## ❓ 常见问题

- **点麦克风没反应/没声音**：检查设备下拉框选的是不是正在用的麦克风；`webspeech` 引擎用的是浏览器默认麦克风，需在浏览器设置里改默认设备。
- **Chrome 下 Web Speech 报 `network` 错误**：国内 Chrome 走谷歌服务不可用，换 Edge（或 WebView2 内核），或改用 `xfyun` 引擎。
- **识别出"you/thank you"等英文乱码（whisper 引擎）**：`TRANSCRIBE_LANGUAGE` 已默认强制中文；换其他语言改它即可。
- **长句只出后半段（xfyun 引擎）**：已修复（多段拼接）；若仍出现请反馈。
- **语音输入没出字但讯飞用量增加**：录音太安静被 VAD 判为无人说话——自动增益已解决大部分情况；建议在 Windows 声音设置里调高麦克风输入音量。
- **不说话也识别出「嗯嗯啊啊好哈」**：已通过四层修复——Silero VAD 裁剪（只送真语音段）、能量门控兜底、讯飞 `vad_eos` 收回 3000ms（`host.js` 顶部 `XFYUN_VAD_EOS`）、语气词保险网；没说话时直接本地拦截，讯飞配额也不再消耗。若真实语音被误过滤：调低 `VAD_SPEECH_THRESHOLD`（如 0.4）、调低 `MIN_SPEECH_SEC`，或关闭 `FILLER_FILTER_ENABLE` 排查。

## 🧱 插件结构

```
dsh-voice/
├── package.json        # dsh.bundle.patch + dsh.client(web)
├── cordis.patch.yml    # 插入插件行
├── host.js             # Node 半：/dsh-voice/asr（讯飞）+ /dsh-voice/hf（模型代理）
├── client.js           # 浏览器半：按钮/下拉框/录音/转写/写回
├── README.md · LICENSE · .gitignore
```

## 🔧 开发

```sh
# 本地迭代（改 client.js 刷新即可生效；改 host.js 需重启 dsh）
dsh plugin --profile web add link:<本目录绝对路径>
```

## 📄 License

[MIT](LICENSE)
