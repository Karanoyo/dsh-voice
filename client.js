// dsh-voice —— Browser client half.
//
// Renders a microphone button in the composer's tool row (bottom-right, just
// before the send button) via the `conversation.input.right` slot. Click to
// record, click again to stop; audio is resampled to 16 kHz mono in-browser
// and transcribed with Whisper (small) through transformers.js. The result is
// appended to the composer draft via `inputActions.setDraft`.
//
// Styled to match the Liquid Glass theme: `--dsw-*` design tokens plus the
// `--lg-glass-blur` backdrop-filter variable that dsh-liquid-glass sets.
window.__ModuleLoader__.load({
  id: 'dsh-voice',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    var React = require('react')
    var el = React.createElement

    // ==================================================================
    // 📦 DSH 插件版本升级与市场识别规范（官方内核机制对齐手册）
    //
    // 📊 数据结构设计图：
    //   ┌──────────────────────────────────────────────────────────────┐
    //   │ package.json 规范声明                                         │
    //   │   ├── <version>: '2.1.0' ────▶ 遵循语义化版本 (SemVer)        │
    //   │   ├── <engines.dsh>: '>=0.2.0' ──▶ 声明宿主兼容版本约束       │
    //   │   └── <files>: [...] ────────▶ 打包白名单 (严禁漏填资源目录)   │
    //   └──────────────────────────────┬───────────────────────────────┘
    //                                  │ npm publish / 市场索引推送
    //                                  ▼
    //   ┌──────────────────────────────────────────────────────────────┐
    //   │ DSH 官方插件市场内核 (@deepseek-ai/dsh-plugin-market)         │
    //   │   ├── listingOf() ──▶ 解析市场索引并评估 compatibilityOf()    │
    //   │   └── installationOf() ──▶ 严格比对已安装版本与市场版本       │
    //   └──────────────────────────────┬───────────────────────────────┘
    //                                  │
    //         ┌────────────────────────┴────────────────────────┐
    //         ▼                                                 ▼
    //   semver.gt(市场版本, 已安装版本) === true               版本相同或更低
    //         │                                                 │
    //         ▼                                                 ▼
    //   status: 'update-available' ✅                     status: 'installed' ⏹️
    //   Web 界面点亮「有更新」徽标与升级按钮              显示「已安装」保持不变
    //
    // 💡 逻辑解释（DSH 客户端如何识别升级）：
    //   • 核心对比机制：DSH 插件市场在加载时调用 installationOf 函数，使用 SemVer
    //     进行严格比较：semver.valid(已安装版本) !== null && semver.gt(市场新版本, 已安装版本)。
    //   • 兼容性硬约束：新版本必须通过 evaluatePluginCompatibility 校验，其 <engines.dsh>
    //     声明必须能包容当前 DSH 运行时（如 >=0.2.0 包容 v0.2.1-rc.2 及未来版本），否则不判定为可用升级。
    //   • 打包严格白名单：npm 打包只提取 <files> 声明的文件与目录，若遗漏如 <images> 文件夹，
    //     下载安装后物理文件就会缺失。每次增加目录必须同步更新 <files> 字段。
    //
    // 🛠️ 为什么这样写/升级插件的正确流程：
    //   • 步骤一：完成插件代码编写、本地调试与回归测试，确保无残留 BUG。
    //   • 步骤二：更新 package.json 中的 <version> 字段进行版本号递增（如 2.1.0 升至 2.1.1）。
    //   • 步骤三：核对 package.json 的 <files> 数组，确保新增资源目录（如 images）在白名单内。
    //   • 步骤四：执行发布（npm publish 或更新市场 Index 仓库）。
    //   • 步骤五：DSH 客户端刷新市场即可自动识别新版本并提示在线覆盖升级。
    // ==================================================================
    // ------------------------------------------------------------------
    // Configuration. Edit these before rebuilding/installing.
    // ------------------------------------------------------------------
    var TRANSFORMERS_ESM =
      'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/+esm'
    var MODEL_ID = 'onnx-community/whisper-small' // 本地 Whisper small
    // 强制转写语言。Whisper 对中文的自动检测不稳：会把中文误判成英文，
    // 输出 "you / thank you" 之类的垃圾词。默认锁定中文；
    // 说英文时改成 'english'，或设 null 恢复自动检测。
    var TRANSCRIBE_LANGUAGE = 'chinese'
    // 识别引擎（三选一）：
    //  'webspeech' = 浏览器自带语音识别（无需密钥/无需模型，用浏览器默认麦克风；
    //                Edge 走微软云端、Chrome 走谷歌，不支持指定设备）
    //  'xfyun'     = 讯飞云端（中文效果好、秒级返回；密钥只在本机 host 半）
    //  'whisper'   = 浏览器本地 Whisper（免费离线，small 中文一般）
    var ASR_ENGINE = 'xfyun'
    var WEBSpeech_LANG = 'zh-CN'
    // 📝 识别结果追加到输入框已有内容末尾时的分隔符（🎲 可选值开关）:
    //   ''  = 直接拼接（什么都不加） | ' ' = 追加一个空格 | '，' = 追加中文逗号 | '\n' = 追加一个换行
    var APPEND_SEPARATOR = ''
    var XFYUN_ASR_URL =
      (typeof window !== 'undefined' ? window.location.origin : 'http://127.0.0.1:3080') +
      '/dsh-voice/asr'
    // 模型文件经 dsh host 的同源代理路由（/dsh-voice/hf）转发到 hf-mirror.com，
    // 规避浏览器的 CORS 限制（hf-mirror.com 不带 CORS 头，huggingface.co 又直连不通）。
    var HF_REMOTE_HOST =
      (typeof window !== 'undefined' ? window.location.origin : 'http://127.0.0.1:3080') +
      '/dsh-voice/hf'
    var SLOT_NAME = 'conversation.input.right' // 输入框工具行右端、发送键左侧
    var SLOT_ID = 'dsh-voice-mic'
    var STYLE_ID = 'dsh-voice-css'
    var MIC_STORAGE_KEY = 'dsh-voice.micDeviceId' // localStorage 记住选择的麦克风
    // 🎚️ 麦克风设备下拉框尺寸（📐 单位 px，可自行调大/调小）：
    //   高度     = 框体高度，默认高度（原 30）
    //   宽度上限 = 设备名过长时的封顶宽度，默认宽度（原 150）
    var MIC_SELECT_HEIGHT = 30
    var MIC_SELECT_MAX_WIDTH = 97

    // ------------------------------------------------------------------
    // 🔇 静音检测增强配置区（2025-12 新增）：不说话/纯噪声不出「嗯嗯啊啊」
    // 四层防御：Silero VAD 裁剪 → 能量门控兜底 → 引擎参数收紧 → 语气词保险网
    // ------------------------------------------------------------------
    // 🎛️ Silero VAD 总开关（🎲 可选值 False/True）：浏览器内跑神经网络语音活动检测，
    //     能精准区分「呼吸/底噪/风扇声」与「真人说话」。仅对 xfyun / whisper 引擎生效
    //     （webspeech 引擎浏览器自带 VAD 自动跳过）；CDN 加载失败自动降级能量门控，不阻断录音。
    var VAD_ENABLE = true
    // 📦 vad-web / onnxruntime-web 的 CDN 固定版本（与 transformers.js 同为 jsDelivr 加载，
    //     首次约 2MB 模型，浏览器缓存后离线可用）
    var VAD_CDN_VERSION = '0.0.29'
    var ORT_CDN_VERSION = '1.22.0'
    var VAD_CDN = 'https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@' + VAD_CDN_VERSION + '/dist/'
    var ORT_CDN = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@' + ORT_CDN_VERSION + '/dist/'
    // 🎚️ VAD 判定阈值：单帧语音概率高于该值视为说话（whisper.cpp 同名参数默认 0.5）
    var VAD_SPEECH_THRESHOLD = 0.5
    // ⏱️ 最短语音时长 ms：短于该值的孤立声音（咳嗽/碰桌声）不算说话（whisper.cpp 默认 250）
    var VAD_MIN_SPEECH_MS = 250
    // ⏱️ 结束一段语音需连续静音 ms：说话中途的短停顿不断句
    var VAD_MIN_SILENCE_MS = 100
    // ✂️ 语音段前后保留缓冲 ms：防止裁剪掐头去尾（whisper.cpp 默认 30）
    var VAD_SPEECH_PAD_MS = 30
    // 🎛️ 能量门控兜底开关（🎲 可选值 False/True）：VAD 关闭/加载失败时，按自适应底噪
    //     裁掉首尾非语音段并校验有效语音时长，没说话就不送识别（省讯飞配额）
    var ENERGY_GATE_ENABLE = true
    // 📏 整段录音中最少有效语音秒数：低于则判定「没说话」，本地拦截不送识别
    var MIN_SPEECH_SEC = 0.25
    // 🔊 能量门控底噪安全倍数：阈值 = 噪声底噪 × 该倍数（且不低于 0.012 绝对下限）
    var ENERGY_GATE_FLOOR_RATIO = 3
    // 🎛️ 语气词保险网开关（🎲 可选值 False/True）：识别结果「整条」只由语气词构成时丢弃，
    //     夹在真话里的语气词一个不动（FnFlow 实测 1295 条零误杀原则）
    var FILLER_FILTER_ENABLE = true
    // 📝 语气词表（可自行增删字符）：整条结果全在这些字里 → 判为噪声丢弃
    var FILLER_CHARS = '嗯恩啊哦噢哈呵呃唉哎诶呀咦唔呜哇嘿咯喽好'
    // 🎚️ Whisper 无语音过滤参数（openai/whisper 官方默认：0.6 / -1.0）：
    //     无语音概率高于阈值且文本置信度低于阈值 → 该段视为静音，抑制幻觉输出
    var WHISPER_NO_SPEECH_THRESHOLD = 0.6
    var WHISPER_NO_SPEECH_LOGPROB = -1.0
    // 🎛️ 调试日志总开关（🎲 可选值 False/True）：控制所有 🧪 调试日志——
    //     每次录音开始打「功能状态总览」、各功能生效/跳过/失败的原因日志。
    //     排查期默认开；⚠️ 异常类日志（console.warn/error）
    //     不受此开关控制，永远输出，保证出问题必留痕。
    //     🧠 这只是「默认值」：插件选项页（plugins.bundle.config slot 挂的设置卡片）
    //     的「开启调试日志」开关写入 localStorage 记忆后，apply 启动时读取记忆
    //     覆盖它（无记忆/记忆非法时才用这里的默认）。
    //     🛡️ 2025-12 审查修复：此前有 19 处日志直接 console.log 绕过本开关，导致
    //     「面板关了控制台还在刷」——已全部收编走 debugLog 统一受控。
    var DEBUG_LOG_ENABLE = true
    // 💾 调试开关的 localStorage 记忆键（命名对齐 MIC_STORAGE_KEY 风格）：
    //     选项页设置卡片「保存」时写入，apply 启动时读取覆盖上面的默认值
    var DEBUG_LOG_STORAGE_KEY = 'dsh-voice.debugLog'

    // 🎛️ 光标事件追踪开关（🎲 可选值 False/True）：专查「插入后光标跳末尾再跳回」
    //     与「新行插入多一个换行」两个悬案。开启后每次写回识别文本时，在短窗口内
    //     全量监听 selectionchange/scroll/focus/blur/input 事件，带时间戳输出
    //     [dsh-voice-track] 前缀日志，并同步收集到 window.__dshVoiceTrack 数组
    //     （控制台敲 copy(window.__dshVoiceTrack) 可整份导出）。
    //     ⚠️ 只读观察、绝不修改选区/文本/滚动，零行为影响。
    //     🧠 联动语义（2025-12 修正）：追踪跟随 DEBUG_LOG_ENABLE 总开关联动——
    //     选项页「开启调试日志」开 = 🧪 日志 + track 追踪日志完整输出（与旧版
    //     完整日志一致）；总开关关 = 追踪会话完全不挂载，零开销零输出。
    //     本常量只是「追踪专项逃生口」：想保留 🧪 日志但单独关掉追踪时改 False。
    var CURSOR_TRACK_ENABLE = true
    // ⏱️ 追踪观察尾窗 ms：恢复光标(内部延时 60ms) 之后再多盯这么久，
    //     让「跳回原位」和迟到的事件也进时间线
    var CURSOR_TRACK_TAIL_MS = 200

    // 🚀 光标处原生插入开关（🎲 可选值 False/True）：识别文本用 execCommand('insertText')
    //     在光标处原地插入，走 Lexical 的 beforeinput 通道——不整体重建 DOM，
    //     从根上消灭「滚到底部 + 光标跳末尾 + 60ms 回跳」与「换行繁殖」两类问题。
    //     插入条件不满足/验证未生效时自动回退老 setDraft 路径；
    //     ⚠️ 若实测有异常，改 False 即完整恢复旧行为。
    var NATIVE_INSERT_ENABLE = true

    // ------------------------------------------------------------------
    // ⌨️ 空格键上屏配置区（2026-10 新增）：录音中按空格 = 停止录音并立即
    //     转写上屏，等同点击麦克风按钮——三种引擎统一手势（Webspeech/讯飞/
    //     Whisper 都是停止后才出字，空格即「我说完了，上屏」）。
    // ------------------------------------------------------------------
    // 🎛️ 空格键上屏开关（🎲 可选值 False/True）：False = 录音中完全不劫持
    //     空格键，悬浮提示也不显示（绝不出现「提示了却没功能」）。防误伤放行
    //     规则见 keydown 监听器注释：输入法合成中/组合键/自动重复/下拉框焦点
    //     的空格永远不劫持，正常打字零影响。
    var SPACE_COMMIT_ENABLE = true
    // 📝 录音中悬浮提示文案（拼接在「点击停止并转写」后显示）
    var SPACE_COMMIT_HINT = '按空格键让文字上屏'

    // ------------------------------------------------------------------
    // 🔍 统一调试日志函数（DRY：所有调试输出走这一个口，受 DEBUG_LOG_ENABLE 控制）
    // 💡 为什么封装：① 一处改格式全局生效 ② 头部开关免注释代码 ③ 调用处只写正文
    // ⚠️ 仅用于正常流程的「状态/生效/跳过」日志；异常与警告仍直接用
    //    console.warn / console.error，不受开关控制（出问题必留痕）。
    // 🛡️ 同级别契约（2025-12 用户规约）：选项页「保存」写的就是 DEBUG_LOG_ENABLE
    //    本尊（saveChanges 里直接赋值），与改头部常量**同一个变量、同一行拦截**，
    //    关闭时 console.log 完全不执行——绝非"输出后隐藏"。
    //    （调用方参数拼接的求值语义与头部开关时代逐字节一致，两级开关在此完全同级）
    // ------------------------------------------------------------------
    function debugLog(message) {
      if (DEBUG_LOG_ENABLE) console.log('[dsh-voice] 🧪 ' + message)
    }

    // ------------------------------------------------------------------
    // 🧠 调试开关的 localStorage 记忆读写（供选项页设置卡片与 apply 启动使用）
    // 🛡️ 整个函数体必须包进 try：浏览器「阻止所有 Cookie」等配置下，访问
    //     window.localStorage 属性本身（含 typeof 解析）就会抛 SecurityError——
    //     裸露在外会让 apply 抛异常拖垮整个插件（dsh-plugin-scroll-memory 审查
    //     中翻过同款车，此处为已验证的修复形态）。
    // ------------------------------------------------------------------
    function readDebugPref() {
      try {
        if (typeof localStorage === 'undefined' || localStorage === null) return null
        var raw = localStorage.getItem(DEBUG_LOG_STORAGE_KEY)
        if (raw === '1') return true
        if (raw === '0') return false
        return null // 无记录/值非法 → null（调用方用头部默认值）
      } catch (err) {
        console.warn('[dsh-voice] 读取调试开关记忆失败：' + err)
        return null
      }
    }

    // 💾 写入调试开关记忆。📤 返回 true=落库成功 / false=失败——供「保存」按钮做
    //    「先落库再提交」的防假成功判定：写失败时绝不提交任何 UI 状态，按钮保持
    //    可用可重试，UI 永不假装成功。
    function writeDebugPref(value) {
      try {
        if (typeof localStorage === 'undefined' || localStorage === null) return false
        localStorage.setItem(DEBUG_LOG_STORAGE_KEY, value === true ? '1' : '0')
        return true
      } catch (err) {
        console.warn('[dsh-voice] 写入调试开关记忆失败：' + err)
        return false
      }
    }
    // 🧮 生成「功能状态总览」字符串：✅生效 | ❌关闭 | ➖不适用（连原因一起说清）
    // 💡 为什么动态拼接：各功能的适用性随 ASR_ENGINE 变化，静态表说不准「为什么没生效」
    function buildFeatureSummary() {
      var parts = []
      parts.push('引擎=' + ASR_ENGINE)
      // ⚠️ 运算符 in / 开关判断注释：以下全部是布尔开关，O(1) 判断
      parts.push('Silero VAD ' + (ASR_ENGINE === 'webspeech' ? '➖跳过(浏览器自带VAD)' : VAD_ENABLE ? '✅开' : '❌关'))
      parts.push('能量门控 ' + (ASR_ENGINE === 'webspeech' ? '➖跳过(浏览器自带VAD)' : ENERGY_GATE_ENABLE ? '✅开(兜底)' : '❌关'))
      parts.push('语气词保险网 ' + (FILLER_FILTER_ENABLE ? '✅开' : '❌关'))
      parts.push('最低语音 ' + MIN_SPEECH_SEC + 's')
      if (ASR_ENGINE === 'whisper') {
        parts.push('Whisper幻觉抑制 ✅开(阈值' + WHISPER_NO_SPEECH_THRESHOLD + ')')
      } else {
        parts.push('Whisper幻觉抑制 ➖不适用(非whisper引擎)')
      }
      if (ASR_ENGINE === 'xfyun') {
        parts.push('讯飞vad_eos ✅host侧3000ms(见服务端日志)')
      } else {
        parts.push('讯飞vad_eos ➖不适用(非xfyun引擎)')
      }
      // ⌨️ 2026-10 空格上屏：开关状态进总览，录音开始一眼可见本功能是否上阵
      parts.push('空格上屏 ' + (SPACE_COMMIT_ENABLE ? '✅开(录音中空格=停止并转写)' : '❌关'))
      return parts.join(' | ')
    }

    // ------------------------------------------------------------------
    // transformers.js lazy loader (ESM dynamic import of the jsDelivr
    // `+esm` bundle — the official web entry, with onnxruntime-web inlined).
    // ------------------------------------------------------------------
    var transformersReady = null
    function loadTransformers() {
      if (transformersReady === null) {
        transformersReady = import(TRANSFORMERS_ESM).then(function (mod) {
          var tf = mod
          if (!tf || typeof tf.pipeline !== 'function') {
            tf = mod && mod.default ? mod.default : mod
          }
          if (!tf || typeof tf.pipeline !== 'function') {
            throw new Error('transformers.js 模块导出异常')
          }
          return tf
        })
      }
      return transformersReady
    }

    // Model download/init progress, shared with the mic button (single reader).
    var progressState = { status: 'idle', progress: 0, file: '' }
    var progressListeners = new Set()
    function publishProgress(next) {
      progressState = next
      progressListeners.forEach(function (fn) {
        fn(next)
      })
    }
    function subscribeProgress(fn) {
      progressListeners.add(fn)
      fn(progressState)
      return function () {
        progressListeners.delete(fn)
      }
    }

    // Model pipeline is created once and reused across recordings.
    var pipelinePromise = null
    function getPipeline() {
      if (pipelinePromise === null) {
        pipelinePromise = loadTransformers().then(function (tf) {
          var env = tf.env
          if (env) {
            env.remoteHost = HF_REMOTE_HOST
            env.allowLocalModels = false
          }
          // q8 = quantized (half size, faster). Remove `dtype` for fp32 if the
          // quantized weights are unavailable for a given model.
          return tf.pipeline('automatic-speech-recognition', MODEL_ID, {
            dtype: 'q8',
            progress_callback: function (info) {
              var st = info && info.status
              if (st === 'progress' && typeof info.progress === 'number') {
                publishProgress({ status: 'progress', progress: info.progress, file: info.file || '' })
              } else if (st === 'initiate') {
                publishProgress({ status: 'initiate', progress: 0, file: info.file || '' })
              } else if (st === 'done') {
                publishProgress({ status: 'done', progress: 100, file: info.file || '' })
              } else if (st === 'ready') {
                publishProgress({ status: 'ready', progress: 100, file: '' })
              } else if (st === 'error') {
                publishProgress({ status: 'error', progress: 0, file: info.file || '' })
              }
            },
          })
        })
      }
      return pipelinePromise
    }

    // One-time warmup: the FIRST forward creates the ONNX sessions, which in
    // browser WASM takes ~1-2 minutes (native CPU ~30s). Run it during the
    // loading phase so the user waits upfront, not after recording.
    var warmupDone = false
    function warmup(pipe) {
      if (warmupDone) return Promise.resolve()
      var t = Date.now()
      debugLog('首次初始化模型（创建 ONNX 会话，浏览器 WASM 约 1–2 分钟）…')
      var dummy = new Float32Array(1600) // 0.1s 静音
      return pipe(dummy, TRANSCRIBE_LANGUAGE ? { language: TRANSCRIBE_LANGUAGE } : undefined).then(function () {
        warmupDone = true
        debugLog('模型就绪（' + ((Date.now() - t) / 1000).toFixed(1) + 's）')
      })
    }

    // ------------------------------------------------------------------
    // Audio: decode the recorded blob and resample to 16 kHz mono Float32.
    // ------------------------------------------------------------------
    async function decodeTo16kMono(blob) {
      var arrayBuffer = await blob.arrayBuffer()
      var Ctx = window.AudioContext || window.webkitAudioContext
      var actx = new Ctx()
      try {
        var decoded = await actx.decodeAudioData(arrayBuffer)
        var rate = 16000
        var length = Math.max(1, Math.ceil(decoded.duration * rate))
        var Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext
        var offline = new Offline(1, length, rate)
        var src = offline.createBufferSource()
        src.buffer = decoded
        src.connect(offline.destination)
        src.start(0)
        var rendered = await offline.startRendering()
        return rendered.getChannelData(0)
      } finally {
        if (actx.close) actx.close().catch(function () {})
      }
    }

    function extractText(result) {
      if (!result) return ''
      if (typeof result.text === 'string') return result.text
      if (Array.isArray(result) && result.length && typeof result[0].text === 'string') {
        return result[0].text
      }
      return ''
    }

    // ------------------------------------------------------------------
    // iFlytek (讯飞) path: float samples -> 16-bit PCM -> base64 -> POST to
    // the host half, which talks to the iFlytek IAT WebSocket API.
    // ------------------------------------------------------------------
    // 自动增益：安静麦克风录出的低音量语音，讯飞 VAD 会判为"无人说话"，
    // 白白消耗配额却返回空结果。这里把峰值拉升到 0.8（最多放大 20 倍）。
    function normalizeAudio(samples, targetPeak, maxGain) {
      targetPeak = targetPeak === undefined ? 0.8 : targetPeak
      maxGain = maxGain === undefined ? 20 : maxGain
      var peak = 0
      for (var i = 0; i < samples.length; i++) {
        var a = Math.abs(samples[i])
        if (a > peak) peak = a
      }
      if (peak <= 0) return samples
      var gain = Math.min(maxGain, targetPeak / peak)
      if (gain < 1.02) return samples
      var out = new Float32Array(samples.length)
      for (var j = 0; j < samples.length; j++) {
        out[j] = samples[j] * gain
      }
      return out
    }

    // ------------------------------------------------------------------
    // 🎙️ 智能静音压缩：用户在说话过程中停顿思考（如停顿 5 秒）时，
    // 原始音频中会有漫长的空白。讯飞等云端识别在遇到长静音时极易触发分句截断或丢字。
    // 该函数在保证声音毫无损耗的前提下，将超过 0.6 秒的冗余连续静音平滑压缩到 0.35 秒，
    // 使得云端收到的音频自然连贯，彻底消除中途停顿导致的文本丢失！
    // ------------------------------------------------------------------
    function compressSilence(samples, threshold, maxSilenceSec) {
      if (!samples || samples.length === 0) return samples
      threshold = threshold === undefined ? 0.012 : threshold
      maxSilenceSec = maxSilenceSec === undefined ? 0.35 : maxSilenceSec

      var sampleRate = 16000
      var blockSize = 1600 // 100ms 一个检测块
      var maxSilenceBlocks = Math.max(1, Math.round((maxSilenceSec * sampleRate) / blockSize))

      var keptBlocks = []
      var consecutiveSilence = 0

      for (var offset = 0; offset < samples.length; offset += blockSize) {
        var end = Math.min(offset + blockSize, samples.length)
        var block = samples.subarray(offset, end)

        // 计算该 100ms 块的能量峰值
        var peak = 0
        for (var i = 0; i < block.length; i++) {
          var abs = Math.abs(block[i])
          if (abs > peak) peak = abs
        }

        var isSilence = peak < threshold
        if (isSilence) {
          consecutiveSilence++
          if (consecutiveSilence <= maxSilenceBlocks) {
            keptBlocks.push(block)
          }
          // 超过最大静音块数的长停顿被平滑过滤，杜绝触发云端截断
        } else {
          consecutiveSilence = 0
          keptBlocks.push(block)
        }
      }

      var totalLen = 0
      for (var b = 0; b < keptBlocks.length; b++) {
        totalLen += keptBlocks[b].length
      }

      if (totalLen >= samples.length || totalLen < 1600) {
        return samples
      }

      var out = new Float32Array(totalLen)
      var writeOffset = 0
      for (var k = 0; k < keptBlocks.length; k++) {
        out.set(keptBlocks[k], writeOffset)
        writeOffset += keptBlocks[k].length
      }
      debugLog(
        '静音压缩完成: 原时长 ' + (samples.length / 16000).toFixed(1) + 's -> 压缩后 ' +
        (out.length / 16000).toFixed(1) + 's (成功消除停顿，杜绝丢字)',
      )
      return out
    }

    // ------------------------------------------------------------------
    // 🔇 静音检测增强：Silero VAD 离线裁剪 / 能量门控兜底 / 语气词保险网。
    // 📊 数据结构设计图：
    //   [录音 16k Float32] → Silero VAD 逐帧判定 → 语音段列表 [{start,end}...]
    //        ├─ 无有效语音 → 返回 null → 本地拦截（不送识别、省配额）
    //        └─ 有语音段   → 按段裁剪 ± speech-pad → 送后续增益/压缩
    //   [识别文本] → isPureFiller 整条匹配 → 全是语气词 → 丢弃
    // 💡 为什么这样设计：whisper.cpp / openai whisper 社区共识——静音检测必须
    //    发生在引擎「之外」，噪声根本不送识别，而不是指望云端事后清理。
    // ------------------------------------------------------------------
    // 📝 语气词查找集合：模块加载时构建一次（💡 基于哈希的 O(1) 查找，效率极高！
    //    比较是完整匹配模式），避免每次调用在循环内重建 Set 造成浪费
    var FILLER_CHAR_SET = new Set(FILLER_CHARS.split(''))

    // 已加载完成的脚本 URL 表：防止重复注入 <script> 标签
    var scriptLoadedMap = {}
    function loadScript(src) {
      if (scriptLoadedMap[src]) return Promise.resolve()
      return new Promise(function (resolve, reject) {
        var s = document.createElement('script')
        s.src = src
        s.async = true
        s.onload = function () {
          scriptLoadedMap[src] = true
          resolve()
        }
        s.onerror = function () {
          s.remove() // 清理失败的标签，下次重试不留垃圾
          reject(new Error('脚本加载失败: ' + src))
        }
        document.head.appendChild(s)
      })
    }

    // 📦 vad-web 懒加载：首次用到才加载，只加载一次（Promise 缓存）
    var vadWebPromise = null
    function loadVadWeb() {
      if (vadWebPromise === null) {
        var p = (async function () {
          // 顺序：onnxruntime-web 运行时 → vad-web 官方 bundle（均固定 CDN 版本）
          await loadScript(ORT_CDN + 'ort.wasm.min.js')
          await loadScript(VAD_CDN + 'bundle.min.js')
          if (!window.vad || !window.vad.NonRealTimeVAD) {
            throw new Error('vad-web 加载异常（NonRealTimeVAD 未导出）')
          }
          return window.vad
        })()
        p.catch(function () {
          vadWebPromise = null // 失败即复位，下次录音重试，不让一次性网络抖动永久禁用 VAD
        })
        vadWebPromise = p
      }
      return vadWebPromise
    }

    // 🧠 Silero VAD 离线裁剪：整段录音逐帧判定 → 只保留语音段（±缓冲）
    // 返回 Float32Array（裁剪后音频）或 null（无有效语音 → 判定「没说话」）
    var vadInstance = null // 🧠 VAD 实例缓存：ONNX 会话创建要几百毫秒，复用实例避免每次录音重建
    async function vadTrim(samples) {
      var vad = await loadVadWeb()
      if (vadInstance === null) {
        var initStart = Date.now()
        vadInstance = await vad.NonRealTimeVAD.new({
          baseAssetPath: VAD_CDN,
          onnxWASMBasePath: ORT_CDN,
          positiveSpeechThreshold: VAD_SPEECH_THRESHOLD,
          // 迟滞阈值（正负阈值差）：防止说话/静音边界处来回抖动产生碎片段
          negativeSpeechThreshold: Math.max(0.01, VAD_SPEECH_THRESHOLD - 0.15),
          // ⚠️ frameSamples 保持官方默认 1536 采样 @16k（96ms/帧），Silero 官方警告勿改；
          // 头部 ms 配置统一按 96ms/帧 换算成帧数（旧版误按 32ms/帧换算导致参数错位）
          minSpeechFrames: Math.max(1, Math.round(VAD_MIN_SPEECH_MS / 96)),
          preSpeechPadFrames: Math.max(0, Math.round(VAD_SPEECH_PAD_MS / 96)),
          redemptionFrames: Math.max(1, Math.round(VAD_MIN_SILENCE_MS / 96)),
        })
        // 🧪 VAD 初始化成功证据：首次加载耗时 + 版本（失败会走 catch → warn，不留静默路径）
        debugLog('Silero VAD 初始化成功: vad-web@' + VAD_CDN_VERSION + '，首次耗时 ' + (Date.now() - initStart) + 'ms')
      } else {
        // 🧪 复用证据：区分「首次冷启动」与「常规复用」，排查性能问题时有用
        debugLog('Silero VAD 复用缓存实例')
      }
      var myvad = vadInstance
      try {
        // 🚨 官方 API：run() 是「异步生成器」，必须 for await 逐段取
        //    {audio, start, end}：audio = 该语音段音频（16k Float32，已含 pad），
        //    start/end = 毫秒（不是秒！）。
        //    ⚠️ 教训：写成 `await myvad.run(samples)` 只会拿到生成器对象本身，
        //    读它的 .speech 永远 undefined → 一切录音都被误判「没说话」！
        var segAudioList = []
        var speechMs = 0
        var segCount = 0
        for await (var seg of myvad.run(samples, 16000)) {
          var segAudio = seg && seg.audio
          if (segAudio && segAudio.length > 0) {
            segAudioList.push(segAudio)
            segCount++
            speechMs += (typeof seg.start === 'number' && typeof seg.end === 'number' && seg.end >= seg.start)
              ? (seg.end - seg.start) // 官方时间戳单位：毫秒
              : (segAudio.length / 16) // 无时间戳兜底：16 采样 = 1ms @16k
          }
        }
        // 有效语音总秒数：低于 MIN_SPEECH_SEC → 没说话，不送识别（省讯飞配额）
        var speechSec = speechMs / 1000
        if (speechSec < MIN_SPEECH_SEC) {
          // 📡 日志盲区修复：判「没说话」时也留下证据，不再静默返回
          console.warn(
            '[dsh-voice] Silero VAD 判定无有效语音: 录音 ' + (samples.length / 16000).toFixed(1) +
            's，语音段 ' + segCount + ' 个共 ' + speechSec.toFixed(2) + 's（最低要求 ' + MIN_SPEECH_SEC + 's）',
          )
          return null
        }
        // 官方 audio 段已含 preSpeechPad 缓冲，直接顺序拼接成裁剪后音频
        var outLen = 0
        for (var n = 0; n < segAudioList.length; n++) outLen += segAudioList[n].length
        var out = new Float32Array(outLen)
        var w = 0
        for (var p = 0; p < segAudioList.length; p++) {
          out.set(segAudioList[p], w)
          w += segAudioList[p].length
        }
        debugLog(
          'Silero VAD 裁剪: 原始 ' + (samples.length / 16000).toFixed(1) + 's -> 语音 ' +
          speechSec.toFixed(1) + 's（' + segCount + ' 段），实际送识别 ' + (out.length / 16000).toFixed(1) + 's',
        )
        return out
      } catch (err) {
        vadInstance = null // 实例异常 → 丢弃重建，避免带病复用
        throw err
      }
    }

    // 🔊 能量门控兜底（零依赖）：自适应噪声底噪估算 + 首尾裁剪 + 有效语音时长校验
    // 💡 为什么自适应：固定阈值 0.012 在增益后/嘈杂环境会失效；改用本次录音
    //    分块峰值的 25 分位数当噪声底噪 × 安全倍数，贴合每支麦克风的实际底噪
    function energyGateTrim(samples) {
      var BLOCK = 1600 // 100ms 检测块（与 compressSilence 同块宽，语义一致）
      var peaks = []
      for (var offset = 0; offset < samples.length; offset += BLOCK) {
        var end = Math.min(offset + BLOCK, samples.length)
        var peak = 0
        for (var i = offset; i < end; i++) {
          var abs = Math.abs(samples[i])
          if (abs > peak) peak = abs
        }
        peaks.push(peak)
      }
      // 🧮 噪声底噪 = 分块峰值的 25 分位数（假设录音大部分时间是环境噪声）
      var sorted = peaks.slice().sort(function (a, b) { return a - b })
      var noiseFloor = sorted.length ? sorted[Math.floor(sorted.length * 0.25)] : 0
      var threshold = Math.max(0.012, noiseFloor * ENERGY_GATE_FLOOR_RATIO)
      // 找出所有「说话块」与首末位置
      var firstSpeech = -1
      var lastSpeech = -1
      var speechBlocks = 0
      for (var b = 0; b < peaks.length; b++) {
        if (peaks[b] >= threshold) {
          speechBlocks++
          if (firstSpeech < 0) firstSpeech = b
          lastSpeech = b
        }
      }
      // 🧪 能量门控生效证据：说话块数/总块数 + 底噪 + 阈值，跑没跑、判得准不准一眼可见
      debugLog('能量门控判定: 说话块 ' + speechBlocks + '/' + peaks.length + '，底噪 ' + noiseFloor.toFixed(4) + '，阈值 ' + threshold.toFixed(4))
      // 有效语音时长不足 → 判定「没说话」，不送识别
      if (speechBlocks * 0.1 < MIN_SPEECH_SEC) {
        // 📡 日志盲区修复：能量门控判「没说话」也留证据（此前 return null 无任何日志）
        console.warn(
          '[dsh-voice] 能量门控判定无有效语音: 说话块 ' + speechBlocks + ' 个共 ' +
          (speechBlocks * 0.1).toFixed(1) + 's（最低要求 ' + MIN_SPEECH_SEC + 's）',
        )
        return null
      }
      // 首尾裁剪：各保留一个上下文块（相当于 speech-pad），中间停顿交给 compressSilence
      var startBlock = Math.max(0, firstSpeech - 1)
      var endBlock = Math.min(peaks.length - 1, lastSpeech + 1)
      var from = startBlock * BLOCK
      var to = Math.min(samples.length, (endBlock + 1) * BLOCK)
      if (from === 0 && to === samples.length) return samples // 首尾无需裁剪 → 原样返回
      debugLog(
        '能量门控裁剪: 掐头 ' + (from / 16000).toFixed(1) + 's / 去尾 ' +
        ((samples.length - to) / 16000).toFixed(1) + 's（底噪 ' + noiseFloor.toFixed(4) + ' 阈值 ' + threshold.toFixed(4) + '）',
      )
      return samples.subarray(from, to)
    }

    // 🕳️ 语气词保险网：仅当「整条结果」全部由语气词构成时判为噪声
    // 💡 为什么只认整条：「嗯，我觉得这个方案可以」夹着真话，绝不能删；
    //    FnFlow 实践：整句独立出现才删，1295 条录音零误杀
    function isPureFiller(text) {
      if (!text) return false
      // 剥离空白与常见标点（全/半角），只留内容字符参与判定
      var stripped = String(text).replace(/[\s\u3000，。！？、；：,.!?;:…～~·「」『』]/g, '')
      if (!stripped) return false
      //💡 基于哈希的 O(1) 查找，效率极高！比较是完整匹配模式（Set.has）
      for (var i = 0; i < stripped.length; i++) {
        if (!FILLER_CHAR_SET.has(stripped[i])) return false
      }
      return true
    }

    // 🎯 统一语音检测入口：返回裁剪后音频；null = 判定「没说话」
    // 💡 分层策略：VAD 优先（神经网络最准）→ 加载失败降级能量门控（零依赖兜底）
    //    webspeech 引擎浏览器自带 VAD，直接原样返回
    async function extractSpeech(samples) {
      // 🧪 引擎分流证据：webspeech 跳过不是「失效」，是浏览器自带 VAD 接管
      if (ASR_ENGINE === 'webspeech') {
        debugLog('语音检测: ➖webspeech 引擎自带 VAD，插件检测层全部跳过')
        return samples
      }
      if (VAD_ENABLE) {
        try {
          var vadResult = await vadTrim(samples)
          // 🧪 VAD 路径证据：VAD 只要正常跑完，能量门控就不会上阵（不是失效）
          debugLog('语音检测: Silero VAD 路径完成' + (vadResult ? '（检出语音）' : '（判定无语音）') + '，能量门控未参与')
          return vadResult
        } catch (err) {
          console.warn('[dsh-voice] Silero VAD 不可用，降级能量门控:', err && err.message ? err.message : err)
        }
      } else {
        debugLog('语音检测: Silero VAD ❌开关关闭，直接走能量门控')
      }
      if (!ENERGY_GATE_ENABLE) {
        // 🧪 两层检测全关 → 音频原样送识别（等于回到旧行为），明确说出来而不是静默
        debugLog('语音检测: VAD 关闭且能量门控关闭，检测层全部跳过，音频原样送识别')
        return samples
      }
      debugLog('语音检测: 走能量门控（原因: ' + (VAD_ENABLE ? 'VAD 加载/运行失败，自动降级' : 'VAD 开关关闭') + '）')
      return energyGateTrim(samples)
    }

    function floatToPcm16(samples) {
      var out = new Int16Array(samples.length)
      for (var i = 0; i < samples.length; i++) {
        var s = Math.max(-1, Math.min(1, samples[i]))
        out[i] = s < 0 ? s * 0x8000 : s * 0x7fff
      }
      return out
    }

    function int16ToBase64(pcm) {
      var bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength)
      var binary = ''
      var CHUNK = 0x8000
      for (var i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK))
      }
      return btoa(binary)
    }

    async function transcribeViaXfyun(samples) {
      var pcm = floatToPcm16(samples)
      var res = await fetch(XFYUN_ASR_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ audio: int16ToBase64(pcm) }),
      })
      debugLog('xfyun HTTP -> ' + res.status)
      var data = await res.json().catch(function () {
        return null
      })
      debugLog('xfyun 返回: ' + JSON.stringify(data))
      if (data && data.error) {
        throw new Error(data.error)
      }
      if (!res.ok || !data) {
        throw new Error('讯飞识别失败（HTTP ' + res.status + '）')
      }
      return String(data.text || '').trim()
    }

    // ------------------------------------------------------------------
    // Icons (inline SVG, no dependencies).
    // ------------------------------------------------------------------
    function MicIcon(recording) {
      if (recording) {
        // Stop square while recording.
        return el(
          'svg',
          { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'currentColor', 'aria-hidden': 'true' },
          el('rect', { x: 6, y: 6, width: 12, height: 12, rx: 2 }),
        )
      }
      return el(
        'svg',
        {
          width: 16,
          height: 16,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 2,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
        },
        el('rect', { x: 9, y: 2, width: 6, height: 12, rx: 3 }),
        el('path', { d: 'M5 10v1a7 7 0 0 0 14 0v-1' }),
        el('line', { x1: 12, y1: 18, x2: 12, y2: 22 }),
      )
    }

    function Spinner() {
      return el('span', {
        'aria-hidden': 'true',
        style: {
          width: 14,
          height: 14,
          borderRadius: '50%',
          border: '2px solid rgba(128, 128, 128, 0.35)',
          borderTopColor: 'currentColor',
          display: 'inline-block',
          boxSizing: 'border-box',
          animation: 'dsh-voice-spin 0.8s linear infinite',
        },
      })
    }

    // ------------------------------------------------------------------
    // 🕵️ 光标事件追踪模块（只观察、不干预）：排查「插入后光标跳末尾再跳回」
    //     与「换行繁殖」。开关在头部 CURSOR_TRACK_ENABLE；会话开启期间用
    //     capture 模式监听 selectionchange/scroll/focus/blur/input，
    //     全部经 光标追踪_输出 统一出口（DRY：时间戳+前缀+控制台+内存收集）。
    // ⚠️ 纪律：本模块只读 DOM，绝不修改选区/文本/滚动；会话结束逐一摘除监听，零残留。
    // ------------------------------------------------------------------
    var 光标追踪_会话进行中 = false // 📍 是否处于一次写回的观察窗口内
    var 光标追踪_监听器表 = [] // 📍 会话期间挂上的临时监听器 [事件名, 处理器]，退出逐一摘除

    // 🛡️ 插桩点守卫（2025-12 用户规约：关闭 = 完全不执行，绝非"跑了再隐藏"）：
    //    所有 光标追踪_输出(...) 插桩点统一包在本守卫后——总开关或追踪开关任一
    //    关闭即短路，右侧调用**连同参数里的 DOM 采样构造**（选区快照/块摘要等）
    //    完全不求值、不执行。JS 参数求值发生在函数拦截之前，只有调用点短路才能
    //    做到真正的零执行（函数内门只防"忘包守卫的新插桩"，双保险）。
    function 光标追踪_守卫() {
      return CURSOR_TRACK_ENABLE === true && DEBUG_LOG_ENABLE === true
    }

    // 💡 统一出口：相对时间戳 + [dsh-voice-track] 前缀 + 控制台 + 内存收集
    //    🛡️ 总开关彻底拦截（2025-12 用户规约）：DEBUG_LOG_ENABLE 关闭时本函数
    //    首行即返回——行构造、内存收集、控制台输出**全部不执行**，绝非"跑了再隐藏"。
    //    语义与头部常量开关完全同级别：CURSOR_TRACK_ENABLE 只是追踪专项逃生口
    //    （想保留 🧪 日志但单独关追踪时改 False）。
    function 光标追踪_输出(内容) {
      if (!CURSOR_TRACK_ENABLE || !DEBUG_LOG_ENABLE) return
      var 行 = '[dsh-voice-track] +' + (performance.now() / 1000).toFixed(3) + 's | ' + 内容
      console.log(行)
      try {
        if (typeof window !== 'undefined') {
          if (!window.__dshVoiceTrack) window.__dshVoiceTrack = []
          window.__dshVoiceTrack.push(行)
          // 💡 上限 500 条，超出丢最旧，防长会话内存膨胀
          if (window.__dshVoiceTrack.length > 500) window.__dshVoiceTrack.shift()
        }
      } catch (e) {}
    }

    // 💡 紧凑描述一个 DOM 节点：标签+class+文本预览（超长截断，日志不刷屏）
    function 光标追踪_节点描述(node) {
      if (!node) return 'null'
      if (node.nodeType === 3) {
        var t = node.nodeValue || ''
        return '#text("' + (t.length > 12 ? t.slice(0, 12) + '…' : t) + '"/len' + t.length + ')'
      }
      var tag = node.tagName || String(node.nodeName)
      var cls = node.className && typeof node.className === 'string' ? '.' + node.className.split(/\s+/).join('.') : ''
      var inner = ''
      try {
        var it = (node.innerText || '').replace(/\s+/g, ' ')
        inner = '"' + (it.length > 16 ? it.slice(0, 16) + '…' : it) + '"'
      } catch (e) {}
      return tag + cls + inner
    }

    // 💡 块摘要：子节点标签链 + outerHTML 截断——一眼看出空段落长啥样、<br> 被谁包裹
    function 光标追踪_块摘要(块) {
      if (!块) return 'null'
      try {
        var 子链 = []
        for (var i = 0; i < 块.childNodes.length && i < 6; i++) {
          var c = 块.childNodes[i]
          子链.push(c.nodeType === 3 ? '#text' : (c.tagName || c.nodeName) + (c.childNodes.length ? '(' + c.childNodes.length + ')' : ''))
        }
        var html = (块.outerHTML || '').replace(/\s+/g, ' ')
        if (html.length > 90) html = html.slice(0, 90) + '…'
        return (块.tagName || 块.nodeName) + '[' + 子链.join(',') + '] ' + html
      } catch (e) {
        return '块摘要失败: ' + (e && e.message)
      }
    }

    // 💡 当前选区 + 可滚祖先状态快照（光标在哪、视口滚到哪，一根线看全）
    function 光标追踪_选区快照() {
      try {
        var sel = window.getSelection ? window.getSelection() : null
        var selStr = '无选区'
        if (sel && sel.rangeCount > 0) {
          selStr = 光标追踪_节点描述(sel.anchorNode) + '@' + sel.anchorOffset
          if (sel.focusNode !== sel.anchorNode || sel.focusOffset !== sel.anchorOffset) {
            selStr += ' → ' + 光标追踪_节点描述(sel.focusNode) + '@' + sel.focusOffset
          }
        }
        var 滚动描述 = []
        var 编辑框 = document.querySelector('[contenteditable="true"], textarea')
        var p = 编辑框
        // 📐 最多上溯 4 层找 overflow 可滚祖先，记录 scrollTop/scrollHeight
        for (var i = 0; i < 4 && p && p !== document.body; i++) {
          var st = null
          try { st = window.getComputedStyle(p) } catch (e) {}
          if (st && /(auto|scroll)/.test(st.overflowY + ' ' + st.overflow)) {
            滚动描述.push(p.tagName + '.scrollTop=' + p.scrollTop + '/' + p.scrollHeight)
          }
          p = p.parentElement
        }
        // 📐 光标所在段落序号：区分「第1行@4」还是「最后一行@4」（同形描述一锤定音）
        var 段落序号 = '?'
        try {
          var an = sel && sel.rangeCount > 0 ? sel.anchorNode : null
          var pg = an ? (an.nodeType === 1 ? an : an.parentElement) : null
          while (pg && pg !== document.body && !(pg.tagName === 'P' || pg.tagName === 'DIV' || pg.tagName === 'LI')) {
            pg = pg.parentElement
          }
          if (pg && pg.parentElement) {
            var 段落列表 = pg.parentElement.children
            for (var pi = 0; pi < 段落列表.length; pi++) {
              if (段落列表[pi] === pg) { 段落序号 = String(pi + 1); break }
            }
          }
        } catch (e) {}
        return '选区[' + selStr + ' 第' + 段落序号 + '行] 滚动[' + (滚动描述.join(' | ') || '无可滚祖先') + ']'
      } catch (e) {
        return '选区快照失败: ' + (e && e.message)
      }
    }

    // 💡 会话事件统一处理器：一个函数管全部事件类型，只换标签（DRY）
    function 光标追踪_事件处理器(事件类型) {
      return function (e) {
        if (!光标追踪_会话进行中) return
        if (事件类型 === 'scroll') {
          var t = e.target
          var st = t === document ? (document.documentElement || {}).scrollTop : t.scrollTop
          if (光标追踪_守卫()) 光标追踪_输出('🖱️ scroll | ' + (t === document ? 'document' : t.tagName || 'root') + '.scrollTop=' + st)
          return
        }
        if (事件类型 === 'input') {
          if (光标追踪_守卫()) 光标追踪_输出('⌨️ input | data=' + JSON.stringify(e.data) + ' type=' + e.inputType + ' | ' + 光标追踪_选区快照())
          return
        }
        if (事件类型 === 'focus' || 事件类型 === 'blur') {
          if (光标追踪_守卫()) 光标追踪_输出('🎯 ' + 事件类型 + ' | ' + 光标追踪_节点描述(e.target))
          return
        }
        // selectionchange：最关键事件——光标去了哪，一看便知
        if (光标追踪_守卫()) 光标追踪_输出('🔁 selectionchange | ' + 光标追踪_选区快照())
      }
    }

    // 💡 开启一次观察会话：挂临时监听 + 记录基线快照（防重入）
    //    🛡️ 总开关彻底拦截（2025-12 用户规约）：DEBUG_LOG_ENABLE 关闭时直接返回，
    //    监听器一个都不挂、DOM 快照一张不拍——会话完全不执行，零开销零残留。
    //    （与头部常量开关同级别：旧版改头部 CURSOR_TRACK_ENABLE=false 的效果，
    //    现在关 UI 总开关即等同达成，且更彻底——连监听器都不挂）
    function 光标追踪_开启会话(标签) {
      if (!CURSOR_TRACK_ENABLE || !DEBUG_LOG_ENABLE || 光标追踪_会话进行中) return
      光标追踪_会话进行中 = true
      if (光标追踪_守卫()) 光标追踪_输出('🚦 ====== 追踪会话开始: ' + 标签 + ' ======')
      var 监听表 = [
        ['selectionchange', 光标追踪_事件处理器('selectionchange')],
        ['scroll', 光标追踪_事件处理器('scroll')],
        ['input', 光标追踪_事件处理器('input')],
        ['focus', 光标追踪_事件处理器('focus')],
        ['blur', 光标追踪_事件处理器('blur')],
      ]
      光标追踪_监听器表 = []
      for (var i = 0; i < 监听表.length; i++) {
        // 📡 capture 捕获模式：scroll/focus 不冒泡也能在 document 层收到
        document.addEventListener(监听表[i][0], 监听表[i][1], true)
        光标追踪_监听器表.push([监听表[i][0], 监听表[i][1]])
      }
      if (光标追踪_守卫()) 光标追踪_输出('📍 基线快照: ' + 光标追踪_选区快照())
    }

    // 💡 结束观察会话：逐一摘除监听器（保证退出后零残留）
    function 光标追踪_结束会话(标签) {
      if (!光标追踪_会话进行中) return
      光标追踪_会话进行中 = false
      for (var i = 0; i < 光标追踪_监听器表.length; i++) {
        document.removeEventListener(光标追踪_监听器表[i][0], 光标追踪_监听器表[i][1], true)
      }
      光标追踪_监听器表 = []
      if (光标追踪_守卫()) 光标追踪_输出('🏁 ====== 追踪会话结束: ' + (标签 || '') + ' | 收尾快照: ' + 光标追踪_选区快照() + ' ======')
    }

    // ------------------------------------------------------------------
    // The mic button. Receives:
    //   input (owner share InputZone) -> current InputState (draft text)
    //   inputActions.setDraft(text)   -> write the draft
    // ------------------------------------------------------------------
    function MicButton(props) {
      var inputActions = props.inputActions
      // Owner share (InputZone) carries the current draft as a point-in-time
      // snapshot re-rendered on every change. Read `input.draft` here (never
      // call the bound `useInput` selector hook — it is not available at this
      // slot entry and throws inside useSyncExternalStore).
      var input = props.input
      var draftRef = React.useRef('')
      draftRef.current = input && typeof input.draft === 'string' ? input.draft : ''
      var 初始文本_引用 = React.useRef('')
      var 光标位置_引用 = React.useRef(-1)
      var 选区终点_引用 = React.useRef(-1)
      var 输入法合成中_引用 = React.useRef(false)
      var 光标恢复版本_引用 = React.useRef(0)

      // 🛡️ Emoji 码点对齐保护：防止 slice 切片从双字节高低代理对中间劈开造成乱码菱形符号
      function 安全截断索引(源文本, 目标索引) {
        if (typeof 目标索引 !== 'number' || 目标索引 <= 0) return 0
        if (!源文本 || 目标索引 >= 源文本.length) return 源文本 ? 源文本.length : 0
        var 字符编码 = 源文本.charCodeAt(目标索引 - 1)
        if (字符编码 >= 0xD800 && 字符编码 <= 0xDBFF) {
          // 当前位置正处于一个双字节 Emoji 的正中间，向后安全顺延 1 个码元
          return 目标索引 + 1
        }
        return 目标索引
      }

      var phasePair = React.useState('idle') // idle | loading | recording | transcribing
      var phase = phasePair[0]
      var setPhase = phasePair[1]
      var errorPair = React.useState(null)
      var error = errorPair[0]
      var setError = errorPair[1]

      var progressPair = React.useState(progressState)
      var progress = progressPair[0]
      var setProgressView = progressPair[1]
      React.useEffect(function () {
        return subscribeProgress(setProgressView)
      }, [])

      var recorderRef = React.useRef(null)
      var chunksRef = React.useRef([])
      var streamRef = React.useRef(null)
      var mimeRef = React.useRef('audio/webm')
      var deviceLabelRef = React.useRef('')
      var speechRecRef = React.useRef(null)
      var speechFinalRef = React.useRef('')
      // ⌨️ 2026-10 空格上屏：录音状态镜像 ref——keydown 监听器（挂载一次、
      //     依赖数组为空）经它读取最新录音状态，规避过期闭包（draftRef 同款模式）
      var 录音中_引用 = React.useRef(false)

      React.useEffect(function () {
        return function () {
          stopStream()
        }
      }, [])

      function stopStream() {
        var s = streamRef.current
        if (s) {
          s.getTracks().forEach(function (t) {
            t.stop()
          })
          streamRef.current = null
        }
      }

      // 🔍 辅助函数：定位当前输入框元素（兼容 DSH 官方 Lexical contenteditable 与原生 textarea）
      function 查找编辑框目标() {
        if (typeof document === 'undefined') return null
        var 麦克风按钮 = document.querySelector('[data-dsh-voice-mic]')
        var 容器 = 麦克风按钮 ? (
          麦克风按钮.closest('[data-composer-card]') ||
          麦克风按钮.closest('form') ||
          麦克风按钮.closest('.composer') ||
          (麦克风按钮.parentElement && 麦克风按钮.parentElement.parentElement)
        ) : null

        // 1. 优先定位 DSH 官方 Lexical 编辑器（contenteditable="true"）
        var 可编辑元素 = 容器 ? 容器.querySelector('[contenteditable="true"]') : null
        if (!可编辑元素) {
          可编辑元素 = document.querySelector('[data-composer-card] [contenteditable="true"], .composer [contenteditable="true"], [contenteditable="true"]')
        }
        if (可编辑元素) return { 模式: 'contenteditable', 节点: 可编辑元素 }

        // 2. 兼容原生 textarea 模式
        var 文本域 = 容器 ? 容器.querySelector('textarea') : null
        if (!文本域) {
          文本域 = document.querySelector('[data-composer-card] textarea, .composer textarea, textarea')
        }
        if (文本域) return { 模式: 'textarea', 节点: 文本域 }

        return null
      }

      // 🔍 辅助函数：实时读取当前编辑框的文本全文与光标字符偏移量
      function 采样文本与光标() {
        var 目标 = 查找编辑框目标()
        if (!目标 || !目标.节点) {
          return { 找到节点: false, 文本: '', 光标: -1 }
        }

        if (目标.模式 === 'textarea') {
          var ta = 目标.节点
          var 全文ta = ta.value || ''
          var posTa = -1
          var endTa = -1
          try {
            if (typeof ta.selectionStart === 'number') {
              posTa = ta.selectionStart
              endTa = typeof ta.selectionEnd === 'number' ? ta.selectionEnd : posTa
            }
          } catch (e) {}
          var 选区折叠ta = posTa >= 0 && (endTa === posTa || endTa === -1)
          return {
            找到节点: true,
            文本: 全文ta,
            光标: posTa,
            选区起点: posTa,
            选区终点: endTa >= 0 ? endTa : posTa,
            选区折叠: 选区折叠ta
          }
        }

        if (目标.模式 === 'contenteditable') {
          var el = 目标.节点
          var BLOCK_TAGS = { P: 1, DIV: 1, LI: 1, H1: 1, H2: 1, H3: 1, H4: 1, H5: 1, H6: 1, BLOCKQUOTE: 1, TR: 1, PRE: 1 }
          var 全文ce = ''
          var posCe = -1
          var foundCaret = false

          try {
            var sel = window.getSelection ? window.getSelection() : null
            var 选区范围 = (sel && sel.rangeCount > 0) ? sel.getRangeAt(0) : null
            // 💡 采用 Range 规范端点：天然避免鼠标反向拖拉选区造成的起点终点颠倒
            var startContainer = 选区范围 ? 选区范围.startContainer : null
            var startOffset = 选区范围 ? 选区范围.startOffset : 0
            var endContainer = 选区范围 ? 选区范围.endContainer : null
            var endOffset = 选区范围 ? 选区范围.endOffset : 0
            var posStart = -1
            var posEnd = -1
            var foundStart = false
            var foundEnd = false

            // 识别顶级块级元素（Lexical 的每行段落 <p> 或 <div>）
            var blocks = []
            if (el.childNodes) {
              for (var bi = 0; bi < el.childNodes.length; bi++) {
                var cnode = el.childNodes[bi]
                var ctag = cnode.tagName ? String(cnode.tagName).toUpperCase() : ''
                if (BLOCK_TAGS[ctag] === 1) {
                  blocks.push(cnode)
                }
              }
            }
            if (blocks.length === 0) {
              blocks = [el]
            }

            // 🧪 监控点 A：块清单全留痕——空段落到底长啥样，此处一锤定音
            if (光标追踪_会话进行中) {
              var 块清单 = []
              for (var tbi = 0; tbi < blocks.length; tbi++) 块清单.push(光标追踪_块摘要(blocks[tbi]))
              if (光标追踪_守卫()) 光标追踪_输出('📐 采样·块清单(' + blocks.length + ' 个): ' + 块清单.join(' ║ '))
            }

            for (var bIdx = 0; bIdx < blocks.length; bIdx++) {
              var currBlock = blocks[bIdx]
              if (bIdx > 0) {
                // 🐞 修复（换行头合并 BUG）：此处原先在 '\n' 计入全文之前抢先判定
                // 「光标位于块分界处」，把光标偏移记成了上一行末尾（换行符之前），
                // 导致插入的识别文本错误合并到上一行末尾。
                // 现在 '\n' 先计入全文，块分界处的光标统一由下方「块起始位置」
                // 分支判定（它在 '\n' 之后执行，posCe 正确指向新行开头）。
                全文ce += '\n'
                // 🧪 监控点 A：块分隔 '\n' 追加溯源（仅追踪会话内输出，日常打字零打扰）
                if (光标追踪_会话进行中) {
                  if (光标追踪_守卫()) 光标追踪_输出('📐 采样·块分隔加\\n: 第' + bIdx + '块=' + 光标追踪_块摘要(currBlock) + ' | 加后全文长=' + 全文ce.length)
                }
              }

              // 如果选区起点/终点位于当前块的起始位置
              if (!foundStart && el === startContainer && bIdx === startOffset) {
                posStart = 全文ce.length
                foundStart = true
              }
              if (!foundEnd && el === endContainer && bIdx === endOffset) {
                posEnd = 全文ce.length
                foundEnd = true
              }

              function walkInBlock(node) {
                if (!node) return
                // 🛡️ 不可编辑卡片防护：跳过 contenteditable="false" 的节点（Mention 胶囊、附件卡片等）
                if (node.nodeType === 1 && node.getAttribute && node.getAttribute('contenteditable') === 'false') {
                  return
                }

                if (node.nodeType === 3) {
                  var 原始文本 = node.nodeValue || ''
                  // 🛡️ CRLF 归一化：前置剔除 \r 并精确折算真实字符偏移，彻底杜绝复制粘贴带 \r\n 文本时的光标向右严重漂移
                  if (!foundStart && node === startContainer) {
                    var 截取子串起点 = 原始文本.slice(0, Math.max(0, Math.min(startOffset, 原始文本.length)))
                    var 子串R数量起点 = (截取子串起点.match(/\r/g) || []).length
                    var 有效偏移起点 = 截取子串起点.length - 子串R数量起点
                    posStart = 全文ce.length + 有效偏移起点
                    foundStart = true
                  }
                  if (!foundEnd && node === endContainer) {
                    var 截取子串终点 = 原始文本.slice(0, Math.max(0, Math.min(endOffset, 原始文本.length)))
                    var 子串R数量终点 = (截取子串终点.match(/\r/g) || []).length
                    var 有效偏移终点 = 截取子串终点.length - 子串R数量终点
                    posEnd = 全文ce.length + 有效偏移终点
                    foundEnd = true
                  }
                  全文ce += 原始文本.replace(/\r/g, '')
                  return
                }

                var ntag = node.tagName ? String(node.tagName).toUpperCase() : ''
                if (ntag === 'BR') {
                  if (!foundStart && node === startContainer) {
                    posStart = 全文ce.length
                    foundStart = true
                  }
                  if (!foundEnd && node === endContainer) {
                    posEnd = 全文ce.length
                    foundEnd = true
                  }
                  // 🐞 修复（空段占位误判/换行繁殖，2026-10 追踪日志实锤）：原判定
                  //     「父节点===块 && 块内唯一子节点」在 dsh 里必然失效——Lexical 的
                  //     <br> 总被 <span data-lexical-text> 包裹，父节点是 span 不是段落，
                  //     每个空行都被误判「行内硬换行」多加一枚幻影 '\n'，随写回落进
                  //     文档并逐轮繁殖。新判定按「块内是否有真实文字」：textContent
                  //     穿透任意包裹层级，无字 → 空段占位不加 '\n'；有字 → 真硬换行加 '\n'。
                  var parentNode = node.parentNode
                  var 块内有文字 = (currBlock.textContent || '').length > 0
                  // 🔍 智能识别末尾占位符 (Trailing BR)：若 BR 处于当前块末尾且其后没有有效文本，
                  //     根据 HTML/Lexical 规范，此 BR 仅充当撑开行高的视觉占位符，不代表独立的换行
                  var 末尾占位BR = null
                  if (currBlock.getElementsByTagName) {
                    var br列表 = currBlock.getElementsByTagName('br')
                    if (br列表 && br列表.length > 0) {
                      末尾占位BR = br列表[br列表.length - 1]
                    }
                  }
                  function 检查节点后是否有有效文本(目标BR, 根节点) {
                    var 已过目标 = false
                    var 有文本 = false
                    function 深度扫描(n) {
                      if (有文本 || !n) return
                      if (n === 目标BR) {
                        已过目标 = true
                        return
                      }
                      if (已过目标 && n.nodeType === 3) {
                        if ((n.nodeValue || '').trim().length > 0) {
                          有文本 = true
                          return
                        }
                      }
                      if (n.childNodes) {
                        for (var si = 0; si < n.childNodes.length; si++) {
                          深度扫描(n.childNodes[si])
                          if (有文本) return
                        }
                      }
                    }
                    深度扫描(根节点)
                    return 有文本
                  }
                  var 是末尾占位BR = Boolean(node === 末尾占位BR && !检查节点后是否有有效文本(node, currBlock))
                  // 💡 空段占位（无文字）或段落末尾的渲染占位符（Trailing BR）均不计入 '\n'
                  var isOnlyChild = !块内有文字 || 是末尾占位BR
                  // 🧪 监控点 A：BR 判定全留痕（精准识别空段占位与末尾渲染占位）
                  if (光标追踪_会话进行中) {
                    if (光标追踪_守卫()) 光标追踪_输出('📐 采样·BR判定: 块内有文字=' + 块内有文字 + ' | 末尾占位=' + 是末尾占位BR + ' | 父=' + (parentNode && parentNode.tagName) + ' | 块子数=' + currBlock.childNodes.length + ' | 判定=' + (isOnlyChild ? '占位符→不加\\n' : '硬换行→加\\n') + ' | 块=' + 光标追踪_块摘要(currBlock))
                  }
                  if (!isOnlyChild) {
                    全文ce += '\n'
                  }
                  return
                }

                if (node.childNodes) {
                  for (var ci = 0; ci < node.childNodes.length; ci++) {
                    if (!foundStart && node === startContainer && ci === startOffset) {
                      posStart = 全文ce.length
                      foundStart = true
                    }
                    if (!foundEnd && node === endContainer && ci === endOffset) {
                      posEnd = 全文ce.length
                      foundEnd = true
                    }
                    walkInBlock(node.childNodes[ci])
                  }
                  if (!foundStart && node === startContainer && startOffset >= node.childNodes.length) {
                    posStart = 全文ce.length
                    foundStart = true
                  }
                  if (!foundEnd && node === endContainer && endOffset >= node.childNodes.length) {
                    posEnd = 全文ce.length
                    foundEnd = true
                  }
                }
              }

              walkInBlock(currBlock)
            }

            // 💡 编辑框末尾光标对齐：确保停留在全文档最末尾处的光标与选区终点被 100% 成功认领
            if (!foundStart && el === startContainer && startOffset >= blocks.length) {
              posStart = 全文ce.length
              foundStart = true
            }
            if (!foundEnd && el === endContainer && endOffset >= blocks.length) {
              posEnd = 全文ce.length
              foundEnd = true
            }

            // 🛡️ 架构图与数据流设计 (空编辑框零污染防护)：
            // ┌────────────────────────────────────────────────────────┐
            // │ DOM树状态: <div contenteditable><p><br></p></div>      │
            // │ 块遍历解析: 块内无文字 -> 占位符BR不计入换行            │
            // │ 初始状态: 全文ce = "" (纯净空字符串，零污染)          │
            // │ 决策分流: 绝对禁止调用 el.innerText 兜底             │
            // │ 根因阻断: Chromium innerText 对 <p><br></p> 会返 "\n" │
            // │ 最终产物: 全文ce 保持 "" -> 避免写回时末尾多出空行    │
            // └────────────────────────────────────────────────────────┘
            // 💡 逻辑解释 (逐行说明)：
            // 1. 块遍历 (walkInBlock) 已通过深度递归遍历 el 内部的所有可见 TextNode。
            // 2. 若全文ce为空字符串，说明编辑框中确实没有任何用户输入的可见字符。
            // 3. 此处彻底拔除旧有的失焦 innerText 兜底分支，坚决不再读取 el.innerText！
            // 💡 为什么这样处理：
            // 避免 Chromium 对空段落 <p><br></p> 自动计算出幻影 '\n' 从而导致写回时末尾多出空行。
          } catch (err) {
            console.warn('[dsh-voice] 获取富文本光标失败:', err && err.message)
            // 💡 异常降级保护：
            // 若发生意外异常跌入 catch，读取文本后若去除空白字符后长度为0（即只有幻影换行），
            // 必须强制归一化为空串 ''，杜绝向文本状态倒灌多余换行符！
            var 异常兜底串 = (el.innerText || el.textContent || '').replace(/\r/g, '')
            全文ce = 异常兜底串.trim().length === 0 ? '' : 异常兜底串
          }

          全文ce = 全文ce.replace(/\r/g, '')
          if (foundStart) {
            posCe = Math.max(0, Math.min(posStart, 全文ce.length))
          }
          var 终点偏移 = foundEnd ? Math.max(0, Math.min(posEnd, 全文ce.length)) : posCe
          var 选区折叠 = Boolean(!选区范围 || 选区范围.collapsed || posCe === 终点偏移)

          // 🧪 监控点 A：采样最终结果（与 dsh 官方 draft 对账用）
          if (光标追踪_会话进行中) {
            if (光标追踪_守卫()) 光标追踪_输出('📐 采样·结果: 光标=' + posCe + (选区折叠 ? '' : ' ~ ' + 终点偏移) + ' 全文=' + JSON.stringify(全文ce))
          }
          return { 找到节点: true, 文本: 全文ce, 光标: posCe, 选区起点: posCe, 选区终点: 终点偏移, 选区折叠: 选区折叠 }
        }

        return { 找到节点: false, 文本: '', 光标: -1, 选区起点: -1, 选区终点: -1, 选区折叠: true }
      }

      // 🧭 实时采样光标与文本（严格忠实反映最新状态，包括清空与删除）
      function 实时采样光标() {
        var 采样结果 = 采样文本与光标()
        if (采样结果.找到节点) {
          // 💡 只要定位到了编辑框DOM，就忠实采纳（哪怕是空串，也表示用户主动删光了内容）
          初始文本_引用.current = 采样结果.文本
          if (采样结果.光标 >= 0) {
            光标位置_引用.current = Math.min(采样结果.光标, 采样结果.文本.length)
            选区终点_引用.current = Math.min(采样结果.选区终点 >= 0 ? 采样结果.选区终点 : 采样结果.光标, 采样结果.文本.length)
          } else {
            // 🛡️ 粘滞光标记忆：编辑框失去焦点时选区脱离，采样结果为 -1；
            //    此时坚决不抹杀记忆！牢牢保留失焦前最后一次停留在编辑框内的有效光标位置与选区范围；
            //    仅做文本长度防越界修正（若用户通过外部改动了文本）
            if (光标位置_引用.current >= 0) {
              光标位置_引用.current = Math.min(光标位置_引用.current, 采样结果.文本.length)
              选区终点_引用.current = Math.min(选区终点_引用.current >= 0 ? 选区终点_引用.current : 光标位置_引用.current, 采样结果.文本.length)
            }
          }
        }
      }

      // 🎧 全生命周期监听：在打字、删除、输入、录音、点击编辑框时全程跟踪光标与文本
      React.useEffect(function () {
        var 节流动画帧ID = null
        function 节流选区变更处理() {
          if (节流动画帧ID) return
          节流动画帧ID = (typeof requestAnimationFrame === 'function' ? requestAnimationFrame : setTimeout)(function () {
            节流动画帧ID = null
            实时采样光标()
          }, 16)
        }
        function 立即采样处理() {
          if (节流动画帧ID) {
            if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(节流动画帧ID)
            else clearTimeout(节流动画帧ID)
            节流动画帧ID = null
          }
          实时采样光标()
        }
        function 输入法合成开始() {
          输入法合成中_引用.current = true
        }
        function 输入法合成结束() {
          输入法合成中_引用.current = false
          立即采样处理()
        }
        function 用户手动交互处理() {
          光标恢复版本_引用.current += 1
          立即采样处理()
        }
        if (typeof document !== 'undefined' && document.addEventListener) {
          document.addEventListener('input', 立即采样处理, true)
          document.addEventListener('selectionchange', 节流选区变更处理, true)
          document.addEventListener('keyup', 立即采样处理, true)
          document.addEventListener('mouseup', 用户手动交互处理, true)
          document.addEventListener('mousedown', 用户手动交互处理, true)
          document.addEventListener('cut', 立即采样处理, true)
          document.addEventListener('paste', 立即采样处理, true)
          document.addEventListener('compositionstart', 输入法合成开始, true)
          document.addEventListener('compositionend', 输入法合成结束, true)
        }
        return function () {
          if (节流动画帧ID) {
            if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(节流动画帧ID)
            else clearTimeout(节流动画帧ID)
          }
          if (typeof document !== 'undefined' && document.removeEventListener) {
            document.removeEventListener('input', 立即采样处理, true)
            document.removeEventListener('selectionchange', 节流选区变更处理, true)
            document.removeEventListener('keyup', 立即采样处理, true)
            document.removeEventListener('mouseup', 用户手动交互处理, true)
            document.removeEventListener('mousedown', 用户手动交互处理, true)
            document.removeEventListener('cut', 立即采样处理, true)
            document.removeEventListener('paste', 立即采样处理, true)
            document.removeEventListener('compositionstart', 输入法合成开始, true)
            document.removeEventListener('compositionend', 输入法合成结束, true)
          }
        }
      }, [])

      // ------------------------------------------------------------------
      // ⌨️ 空格键上屏（2026-10 新增）：录音中按空格 = 停止录音并立即转写上屏
      //
      // 🧠 架构与数据流设计图：
      //   录音中按下空格 ──▶ keydown 捕获监听 ──▶ 五重防误伤放行检查
      //        │                                       │
      //        │             ┌──────────────────────────┴──────────────────┐
      //        │             ▼ 全部通过                                 ▼ 任一不通过
      //        │     preventDefault + stopPropagation           原样放行不劫持
      //        │             │                     （正常打字/拼音选词/下拉框展开）
      //        │             ▼
      //        │     停止录音并转写()  ◀── 鼠标点击麦克风按钮也走同一入口
      //        │             │
      //        │      ┌──────┴──────┐
      //        │      ▼             ▼
      //        │  webspeech引擎  讯飞/Whisper引擎
      //        │  SR.stop()     MediaRecorder.stop()
      //        │  → onend 上屏  → onstop → finish() 转写上屏
      //        │      └──────┬──────┘
      //        └──（识别完成）──▶ appendText(text) → 文字上屏 ✅
      //
      // 🎯【设计初期的核心理念与架构思想】：
      //   • 录音期专属独占：用户开启麦克风进入语音输入状态时，注意力高度集中在说话表达上，
      //     在此期间绝不会进行复杂的多任务打字。空格键作为键盘上键面最大、最便于盲操的按键，
      //     在说话完毕时敲击一下即可顺畅上屏，完全符合搜狗、讯飞等主流语音输入法的人机工程学行业标准。
      //   • 待机态零全局污染：该拦截仅在 <录音中_引用.current === true> 时激活；一旦录音结束
      //     或未录音状态，监听器在入口第 1411 行瞬间短路退出（return），绝不占用全局按键控制权。
      //   • 拼音选词精准保护：由于用户在中文输入法状态下可能需要敲空格选择候选字，
      //     通过 <e.isComposing> 与 <输入法合成中_引用.current> 双保险机制放行，拼音选词零干扰。
      //   • ⚠️ 致后续维护者与代码审查：请勿将录音期间独占空格误判为全局按键冲突隐患！
      //     录音中专一服务于语音录入并独占空格是设计初期的既定预期行为，特此立注防误会。
      // ------------------------------------------------------------------

      // 🛑 停止录音并转写：鼠标点击与空格键共用的停止入口（DRY 零分叉）。
      //     ⚠️ 前置条件：调用方必须已确认处于 recording 状态（onClick 判 phase、
      //     空格监听器判 录音中_引用），此处不重复判断。
      //     - webspeech   → SpeechRecognition.stop()，onend 回调统一上屏
      //     - 讯飞/Whisper → MediaRecorder.stop()，onstop → finish() 转写上屏
      function 停止录音并转写() {
        if (ASR_ENGINE === 'webspeech') {
          var 识别器 = speechRecRef.current
          if (识别器) 识别器.stop()
          return
        }
        var 录音器 = recorderRef.current
        if (录音器 && 录音器.state !== 'inactive') 录音器.stop()
      }

      // ⌨️ 空格键监听：与讯飞/搜狗语音输入的行业惯例一致（说完按空格结束）。
      //     仅录音中把空格劫持为「上屏手势」，五重防误伤（顺序短路）：
      //     ① SPACE_COMMIT_ENABLE 总开关关 → 不劫持
      //     ② 非录音状态 → 不劫持（待机打字零影响）
      //     ③ 输入法合成中（拼音候选空格=选词键）→ 放行
      //     ④ Ctrl/Alt/Shift/Meta 组合键 → 放行（那是别人的快捷键）
      //     ⑤ 按住不放自动重复(e.repeat) / 焦点在下拉框 → 放行
      React.useEffect(function () {
        function 空格键按下处理(e) {
          // ① 总开关（与悬浮提示同一开关：关了就既不劫持也不提示）
          if (!SPACE_COMMIT_ENABLE) return
          // ② 仅录音中生效：经 ref 读最新状态（监听器只挂载一次）
          if (!录音中_引用.current) return
          // 空格键判定：code=物理键位最稳（输入法开启时 key 可能是 'Process'），
          // key=' ' 兜底不报 code 的虚拟键盘等场景
          if (e.code !== 'Space' && e.key !== ' ') return
          // ④ 组合键放行：修饰键按住时空格属于组合键，不是上屏手势
          if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return
          // ⑤ 按住不放的自动重复放行：首次按下已触发停止，重复键不应再触发
          if (e.repeat) return
          // ③ 输入法合成中放行：e.isComposing 是键盘事件标准属性 +
          //    输入法合成中_引用 是 compositionstart/end 全局监听维护的镜像，双保险
          if (e.isComposing || 输入法合成中_引用.current) return
          // ⑤ 下拉框焦点放行：select/option 上空格是原生「展开选项」键
          var 焦点元素 = typeof document !== 'undefined' ? document.activeElement : null
          var 焦点标签 = 焦点元素 && 焦点元素.tagName ? 焦点元素.tagName : ''
          //💡 标签 === 精确匹配，O(1) 字符串比较（非 in 查找）
          if (焦点标签 === 'SELECT' || 焦点标签 === 'OPTION') return
          // 🛡️ preventDefault：阻止空格落入编辑框成字（Lexical/textarea 均生效）
          // 🛡️ stopPropagation：拦断宿主可能的空格全局快捷键，录音中空格语义唯一
          e.preventDefault()
          e.stopPropagation()
          debugLog('🚀 空格上屏: 录音中按下空格 → 停止录音并转写（与点击麦克风同一入口）')
          停止录音并转写()
        }
        if (typeof document !== 'undefined' && document.addEventListener) {
          document.addEventListener('keydown', 空格键按下处理, true)
        }
        return function () {
          if (typeof document !== 'undefined' && document.removeEventListener) {
            document.removeEventListener('keydown', 空格键按下处理, true)
          }
        }
      }, [])

      // 🎯 光标精准定位：识别文本写入后，光标精准停在插入文字后面，绝不跳到行尾
      function 恢复编辑框光标(目标偏移) {
        if (typeof 目标偏移 !== 'number' || 目标偏移 < 0) return
        var 当前排期版本 = ++光标恢复版本_引用.current
        // 🧪 监控点 C：恢复光标被排期（60ms 竞态窗口入场）
        if (光标追踪_会话进行中) {
          if (光标追踪_守卫()) 光标追踪_输出('🎯 恢复光标·排期: 目标偏移=' + 目标偏移 + '（版本 ' + 当前排期版本 + '，延时 60ms 等 React/Lexical 重渲染）')
        }
        // 延时等待 DSH 客户端 React/Lexical 完成 DOM 重新渲染
        setTimeout(function () {
          try {
            // 🛡️ 幽灵吸附竞态保护：若 60ms 内用户产生过新的手动点击或按键，放弃强制拉回，尊重用户最新光标
            if (当前排期版本 !== 光标恢复版本_引用.current) {
              if (光标追踪_会话进行中) {
                if (光标追踪_守卫()) 光标追踪_输出('🎯 恢复光标·放弃: 用户在排期期间产生了新的手动操作，尊重用户最新光标')
              }
              return
            }
            var 目标 = 查找编辑框目标()
            if (!目标 || !目标.节点) return
            // 🧪 监控点 C：60ms 到点——重设选区前的现场（此刻光标在哪、视口滚到哪）
            if (光标追踪_会话进行中) {
              if (光标追踪_守卫()) 光标追踪_输出('🎯 恢复光标·执行(60ms到点): 重设前 | ' + 光标追踪_选区快照())
            }

            // 1. 原生 textarea 模式
            if (目标.模式 === 'textarea') {
              var ta = 目标.节点
              if (typeof ta.setSelectionRange === 'function') {
                try { ta.focus({ preventScroll: true }) } catch (e) { ta.focus() }
                ta.setSelectionRange(目标偏移, 目标偏移)
              }
              return
            }

            // 2. DSH 官方 Lexical contenteditable 模式
            if (目标.模式 === 'contenteditable') {
              var el = 目标.节点
              // 🛡️ 视口硬锁定：预先记录重设光标前的实际滚动条位置
              var 滚动容器 = el
              while (滚动容器 && 滚动容器 !== document.body) {
                try {
                  var 样式 = window.getComputedStyle(滚动容器)
                  if (样式 && /(auto|scroll)/.test(样式.overflowY + ' ' + 样式.overflow)) break
                } catch (e) {}
                滚动容器 = 滚动容器.parentElement
              }
              var 重设前滚动 = 滚动容器 ? 滚动容器.scrollTop : -1

              // 🛡️ 聚焦时不触发浏览器默认的「滚到顶部 (scrollTop=0)」恶疾
              try {
                el.focus({ preventScroll: true })
              } catch (e) {
                el.focus()
              }
              var sel = window.getSelection ? window.getSelection() : null
              if (!sel) return

              var BLOCK_TAGS = { P: 1, DIV: 1, LI: 1, H1: 1, H2: 1, H3: 1, H4: 1, H5: 1, H6: 1, BLOCKQUOTE: 1, TR: 1, PRE: 1 }
              var blocks = []
              if (el.childNodes) {
                for (var bi = 0; bi < el.childNodes.length; bi++) {
                  var cnode = el.childNodes[bi]
                  var ctag = cnode.tagName ? String(cnode.tagName).toUpperCase() : ''
                  if (BLOCK_TAGS[ctag] === 1) blocks.push(cnode)
                }
              }
              if (blocks.length === 0) blocks = [el]

              var charCount = 0
              var found = false
              var range = document.createRange()

              for (var bIdx = 0; bIdx < blocks.length; bIdx++) {
                var currBlock = blocks[bIdx]
                if (bIdx > 0) {
                  charCount += 1
                }

                // 🛡️ 空段落快速命中：穿透 span 等任意包装，无实质文字即为空段
                var 块无实质文字 = (currBlock.textContent || '').length === 0
                if (块无实质文字) {
                  if (目标偏移 <= charCount) {
                    range.setStart(currBlock, 0)
                    range.collapse(true)
                    found = true
                    break
                  }
                  continue
                }

                // 预先识别当前块的末尾占位 BR
                var 当前块内文字长 = (currBlock.textContent || '').length
                var 当前块所有BR = currBlock.getElementsByTagName ? currBlock.getElementsByTagName('br') : []
                var 当前块末尾BR = 当前块所有BR.length > 0 ? 当前块所有BR[当前块所有BR.length - 1] : null

                function 检查节点后是否有文本(目标BR, 根节点) {
                  var 已过目标 = false
                  var 有文本 = false
                  function 深度扫描(n) {
                    if (有文本 || !n) return
                    if (n === 目标BR) { 已过目标 = true; return }
                    if (已过目标 && n.nodeType === 3 && (n.nodeValue || '').trim().length > 0) {
                      有文本 = true
                      return
                    }
                    if (n.childNodes) {
                      for (var si = 0; si < n.childNodes.length; si++) {
                        深度扫描(n.childNodes[si])
                        if (有文本) return
                      }
                    }
                  }
                  深度扫描(根节点)
                  return 有文本
                }

                function findInBlock(node) {
                  if (found || !node) return
                  // 🛡️ 不可编辑卡片防护：跳过 contenteditable="false" 节点，防止光标强行注入抛出 DOMException 导致光标丢失
                  if (node.nodeType === 1 && node.getAttribute && node.getAttribute('contenteditable') === 'false') {
                    return
                  }
                  if (node.nodeType === 3) {
                    var nlen = (node.nodeValue || '').length
                    if (目标偏移 <= charCount + nlen) {
                      var inOffset = Math.max(0, 目标偏移 - charCount)
                      range.setStart(node, inOffset)
                      range.collapse(true)
                      found = true
                      return
                    }
                    charCount += nlen
                  } else if (node.nodeType === 1) {
                    var ntag = node.tagName ? String(node.tagName).toUpperCase() : ''
                    if (ntag === 'BR') {
                      // 💡 镜像对称：与采样器严格一致，非末尾占位符的实体换行在采样时计入 '\n'（占用 1 字符），此处必须同步推进 charCount
                      var 是末尾占位 = Boolean(node === 当前块末尾BR && !检查节点后是否有文本(node, currBlock))
                      var 是实体换行 = (当前块内文字长 > 0) && !是末尾占位
                      if (是实体换行) {
                        if (目标偏移 === charCount) {
                          range.setStartBefore(node)
                          range.collapse(true)
                          found = true
                          return
                        }
                        charCount += 1
                        if (目标偏移 === charCount) {
                          range.setStartAfter(node)
                          range.collapse(true)
                          found = true
                          return
                        }
                      }
                      return
                    }
                    for (var ci = 0; ci < node.childNodes.length; ci++) {
                      findInBlock(node.childNodes[ci])
                      if (found) return
                    }
                  }
                }

                findInBlock(currBlock)
                if (found) break
              }

              if (!found && blocks.length > 0) {
                // 🛡️ 极端兜底安全吸附：若目标偏移略微越界，将光标安全吸附在最后一个有效段落末尾，绝不让光标在屏幕上凭空消失
                try {
                  var 最后一个块 = blocks[blocks.length - 1]
                  range.selectNodeContents(最后一个块)
                  range.collapse(false)
                  found = true
                } catch (fallbackErr) {}
              }

              if (found) {
                sel.removeAllRanges()
                sel.addRange(range)
                // 🧪 监控点 C：选区已重设——验证光标是否精准落回插入点之后
                if (光标追踪_会话进行中) {
                  if (光标追踪_守卫()) 光标追踪_输出('🎯 恢复光标·完成: ' + 光标追踪_选区快照())
                }
                // 🛡️ 视口自适应保护：如果刚才被 focus 误触了归零，立即恢复重设前视口
                if (滚动容器 && 重设前滚动 >= 0) {
                  if (滚动容器.scrollTop !== 重设前滚动) {
                    滚动容器.scrollTop = 重设前滚动
                  }
                }
                // 确保新插入文字所在的行在视口中可见（尤其当输入在文档末尾时，以最小位移保持可见，绝不滚到顶部）
                try {
                  var 光标目标节点 = range.startContainer
                  var 目标行元素 = (光标目标节点 && 光标目标节点.nodeType === 1) ? 光标目标节点 : (光标目标节点 ? 光标目标节点.parentElement : null)
                  while (目标行元素 && 目标行元素 !== el && !(目标行元素.tagName === 'P' || 目标行元素.tagName === 'DIV' || 目标行元素.tagName === 'LI')) {
                    目标行元素 = 目标行元素.parentElement
                  }
                  if (目标行元素 && typeof 目标行元素.scrollIntoView === 'function') {
                    目标行元素.scrollIntoView({ block: 'nearest', inline: 'nearest' })
                  }
                } catch (scrollErr) {}
              }
            }
          } catch (e) {
            console.warn('[dsh-voice] 恢复光标位置失败:', e && e.message)
          }
        }, 60)
      }

      // 🚀 B2 根治：在光标处原生插入识别文本（execCommand('insertText') → beforeinput
      //     → Lexical 自己维护选区/撤销栈/草稿状态）。零全量回填 → 零滚底、零选区重置、
      //     零换行繁殖（不再经历「序列化→拼接→setDraft→重解析」整条失真链）。
      //     返回 true=插入已生效并验证通过；false=调用方回退 setDraft 老路径。
      function 光标处原生插入(采样结果, text) {
        // 🎲 开关关闭 → 直接回退（开关在头部配置区 NATIVE_INSERT_ENABLE）
        if (!NATIVE_INSERT_ENABLE) return false
        // ✂️ 含换行的识别结果 execCommand 行为不可靠（可能插出畸形节点），回退老路径
        if (!text || text.indexOf('\n') !== -1) return false
        try {
          var 目标 = 查找编辑框目标()
          if (!目标 || !目标.节点 || 目标.模式 !== 'contenteditable') return false
          var el = 目标.节点
          // 🎯 前置检查：选区必须存在且落在编辑框内，否则没有可信的插入锚点
          var sel = window.getSelection ? window.getSelection() : null
          if (!sel || sel.rangeCount === 0 || !el.contains(sel.anchorNode)) return false
          try { el.focus({ preventScroll: true }) } catch (e) { el.focus() }
          if (光标追踪_守卫()) 光标追踪_输出('🚀 原生插入·尝试: 插入=' + JSON.stringify(text) + ' | ' + 光标追踪_选区快照())

          var 是元素节点 = Boolean(sel.anchorNode && sel.anchorNode.nodeType === 1)
          var ok = false

          if (是元素节点) {
            // 💡 方案 A 增强：锚点是元素节点（如段落内两个 <br> 之间的空行位 P@2）时，
            //    不再直接回退 setDraft，而是派发现代富文本标准 beforeinput 事件。
            //    Lexical 的 onBeforeInput 监听器会将其包装为带 AST 的 TextNode，绝不会插出裸节点被吞
            try {
              if (typeof InputEvent === 'function') {
                var 插入事件 = new InputEvent('beforeinput', {
                  bubbles: true,
                  cancelable: true,
                  inputType: 'insertText',
                  data: text
                })
                var 派发结果 = el.dispatchEvent(插入事件)
                if (光标追踪_守卫()) 光标追踪_输出('🚀 原生插入·beforeinput 派发完成 (未被取消=' + 派发结果 + ')')
              }
            } catch (evErr) {
              console.warn('[dsh-voice] beforeinput 派发异常:', evErr && evErr.message)
            }
          } else {
            // 锚点是文本节点（占绝大多数）：维持原有高度稳定的 execCommand 路径
            ok = document.execCommand('insertText', false, text)
            if (光标追踪_守卫()) 光标追踪_输出('🚀 原生插入·execCommand 返回: ' + ok)
          }
          // ✅ 验证插入真的生效：计算动态期望长度（兼容折叠光标插入与高亮选中文字替换），
          //     防「execCommand 返回 true 但 Lexical 拦截未写入」的假成功
          var 验证采样 = 采样文本与光标()
          var 选区覆盖长度 = Math.max(0, (采样结果.选区终点 >= 0 ? 采样结果.选区终点 : 采样结果.光标) - 采样结果.光标)
          var 期望长度 = (采样结果.找到节点 ? 采样结果.文本.length : 0) - 选区覆盖长度 + text.length
          var 生效 = Boolean(验证采样.找到节点 && 采样结果.找到节点 &&
            验证采样.文本.length === 期望长度)
          if (光标追踪_守卫()) 光标追踪_输出('🚀 原生插入·验证: 长度 ' + (采样结果.找到节点 ? 采样结果.文本.length : '?') + ' -> ' + (验证采样.找到节点 ? 验证采样.文本.length : '?') + ' | ' + (生效 ? '✅生效' : '❌未生效'))
          return 生效
        } catch (e) {
          console.warn('[dsh-voice] 原生插入异常，回退老路径:', e && e.message)
          return false
        }
      }

      function appendText(text) {
        if (!inputActions || typeof inputActions.setDraft !== 'function') {
          console.warn('[dsh-voice] inputActions 不可用，文字无法写回输入框')
          return
        }

        // 🧪 监控点 A/B 前置：会话必须最先开，写回前的采样与三源对账才能留痕
        //     （首版放在 setDraft 前太晚，错过了最关键的「写回前 DOM 现场」）
        光标追踪_开启会话('appendText·写回')

        // 1. 写回前再次主动采样一次最新状态
        实时采样光标()

        // 2. 真实获取当前编辑框最新文本
        var 采样结果 = 采样文本与光标()
        var 当前文本 = 采样结果.找到节点 ? 采样结果.文本 : (初始文本_引用.current || '')

        // 🧪 监控点 B：三源对账——dsh 官方 draft vs DOM 采样 vs 本地缓存，
        //     谁多算了换行当场现形（采样串 ≠ 官方 draft 即为序列化器嫌疑）
        if (光标追踪_会话进行中) {
          if (光标追踪_守卫()) 光标追踪_输出('⚖️ 三源对账: dsh官方draft=' + JSON.stringify(input && typeof input.draft === 'string' ? input.draft : null) + ' | DOM采样=' + JSON.stringify(采样结果.文本) + ' | 本地缓存=' + JSON.stringify(初始文本_引用.current) + ' | 采样光标=' + 采样结果.光标)
        }

        // 🚀 B2 根治路径：光标处原生插入优先。成功 → Lexical 自维护选区，
        //     无 setDraft 全量重建，也就没有滚底/跳末尾/60ms 回跳/幻影换行。
        //     失败 → 自动落回下方老 setDraft 路径（行为与修复前完全一致）。
        // 📍 先快照光标/文本引用：尝试过程会触发 input/selectionchange 事件，
        //     监听器可能把引用污染成「插入成功后」的中间态（实测 65 被刷成 70）；
        //     一旦尝试失败，必须还原快照，否则老路径会在错误偏移处拼接。
        var 尝试前光标 = 光标位置_引用.current
        var 尝试前文本 = 初始文本_引用.current
        if (光标处原生插入(采样结果, text)) {
          // 📍 原生路径无「setDraft → 60ms 恢复」竞态，只需刷新本地缓存为插入后最新状态
          实时采样光标()
          if (光标追踪_守卫()) 光标追踪_输出('🚀 原生插入·收尾: ' + 光标追踪_选区快照())
          // 🧪 尾窗：盯 CURSOR_TRACK_TAIL_MS 毫秒，确认无滚动、无选区跳变
          setTimeout(function () {
            光标追踪_结束会话('appendText·原生插入')
          }, CURSOR_TRACK_TAIL_MS)
          return
        }
        debugLog('原生插入不可用/未生效，回退 setDraft 全量写回路径')
        // 🪂 还原快照：清除失败尝试期间被中间态污染的光标/文本引用
        //    （Lexical 已把裸文本回滚，引用必须回到尝试前的忠实值再走老路径）
        光标位置_引用.current = 尝试前光标
        初始文本_引用.current = 尝试前文本
        if (光标追踪_守卫()) 光标追踪_输出('🪂 回退 setDraft 路径（原生插入返回 false，光标引用已还原为 ' + 尝试前光标 + '）')

        var 目标起点 = 光标位置_引用.current
        var 目标终点 = 选区终点_引用.current >= 目标起点 ? 选区终点_引用.current : 目标起点
        var 最终拼接文本 = ''
        var 恢复光标位置 = -1

        // 3. 判断插入或拼接逻辑
        if (!当前文本) {
          // 当前编辑框无内容：直接写入新识别内容
          debugLog('当前编辑框无文本，直接写入新识别内容')
          最终拼接文本 = text
          恢复光标位置 = text.length
        } else if (目标起点 >= 0 && 目标起点 <= 当前文本.length) {
          // 在有效光标位置插入文本（支持范围选区覆盖替换与 Emoji 码点防截断保护）
          var 安全起点 = 安全截断索引(当前文本, 目标起点)
          var 安全终点 = 安全截断索引(当前文本, Math.min(目标终点, 当前文本.length))
          debugLog('在光标位置 (' + 安全起点 + (安全终点 > 安全起点 ? ' ~ ' + 安全终点 + ' 覆盖替换' : '') + ') 插入文本, 原文长度: ' + 当前文本.length)
          最终拼接文本 = 当前文本.slice(0, 安全起点) + text + 当前文本.slice(安全终点)
          // 💡 光标精准定在刚刚插入文字的正后方，绝不跳到整段末尾！
          恢复光标位置 = 安全起点 + text.length
        } else {
          // 未检测到有效光标，拼接到末尾
          debugLog('未检测到有效光标（' + 目标起点 + '），拼接到文本末尾')
          最终拼接文本 = 当前文本 + APPEND_SEPARATOR + text
          恢复光标位置 = 最终拼接文本.length
        }

        // 🧪 监控点 C：会话已在函数开头开启（防重入），此处只留 setDraft 前的时间点
        if (光标追踪_守卫()) 光标追踪_输出('📤 setDraft 即将调用: 目标串=' + JSON.stringify(最终拼接文本) + ' 目标光标=' + 恢复光标位置)

        // 🛡️ 视口硬锁定：记录写回前的实际滚动高度，防止 Lexical 重建 DOM 时瞬间下滚到底部
        var 目标容器信息 = 查找编辑框目标()
        var 当前编辑元素 = 目标容器信息 ? 目标容器信息.节点 : null
        var 滚动容器 = 当前编辑元素
        while (滚动容器 && 滚动容器 !== document.body) {
          try {
            var 样式 = window.getComputedStyle(滚动容器)
            if (样式 && /(auto|scroll)/.test(样式.overflowY + ' ' + 样式.overflow)) break
          } catch (e) {}
          滚动容器 = 滚动容器.parentElement
        }
        var 写回前滚动 = 滚动容器 ? 滚动容器.scrollTop : -1

        inputActions.setDraft(最终拼接文本)
        debugLog('已写回输入框最终内容: ' + JSON.stringify(最终拼接文本) + ' 目标光标: ' + 恢复光标位置)
        // 🧪 setDraft 同步返回瞬间（React 尚未重渲染）的选区基线
        if (光标追踪_守卫()) 光标追踪_输出('📤 setDraft 同步返回(React未重渲染): ' + 光标追踪_选区快照())

        // 🛡️ 立即恢复视口滚动高度，压制瞬间置底跳动
        if (滚动容器 && 写回前滚动 >= 0 && 滚动容器.scrollTop !== 写回前滚动) {
          滚动容器.scrollTop = 写回前滚动
        }

        // 4. 精确将光标移动到插入文字后面，不再跳到行尾
        恢复编辑框光标(恢复光标位置)

        // 🧪 观察尾窗：恢复光标(内部延时 60ms) 之后再盯 CURSOR_TRACK_TAIL_MS 毫秒，
        //     让「跳回原位」和迟到事件也进时间线，然后自动收摊摘监听
        setTimeout(function () {
          光标追踪_结束会话('appendText·写回')
        }, 60 + CURSOR_TRACK_TAIL_MS)

        // 5. 更新状态与缓存
        光标位置_引用.current = 恢复光标位置
        初始文本_引用.current = 最终拼接文本
      }

      function onButtonMouseDown(e) {
        // 🛡️ 点击麦克风按钮保焦：阻止 mousedown 默认转移焦点的行为，
        // 确保输入框的光标不失焦、不消失、选区不被清除
        实时采样光标()
        if (e && typeof e.preventDefault === 'function') {
          e.preventDefault()
        }
      }

      async function begin() {
        setError(null)
        // 🧪 功能状态总览：录音开始即列出各功能「生效/关闭/跳过 + 原因」，一眼定位哪层没上阵
        debugLog('功能状态总览: ' + buildFeatureSummary())
        // 🎙️ 录音开始瞬间，锁定并记录当前编辑框内容与光标位置
        实时采样光标()
        // 🛡️ 冷启动状态归一化：若编辑框从未获得过光标（-1）且内部已有文本，主动将其对齐到文本末尾
        if (光标位置_引用.current < 0) {
          var 首次采样 = 采样文本与光标()
          if (首次采样.找到节点 && 首次采样.文本) {
            光标位置_引用.current = 首次采样.文本.length
            选区终点_引用.current = 首次采样.文本.length
          }
        }
        debugLog('录音开始，记录初始光标: ' + 光标位置_引用.current + ' 初始文本: ' + JSON.stringify(初始文本_引用.current))
        try {
          setPhase('loading')
          if (ASR_ENGINE === 'whisper') {
            var pipe = await getPipeline()
            await warmup(pipe)
          }

          if (ASR_ENGINE === 'webspeech') {
            // 浏览器自带识别：不经过 getUserMedia/MediaRecorder，
            // 浏览器自己接管麦克风（使用其默认设备），结果走 onresult 回调。
            var SR = window.SpeechRecognition || window.webkitSpeechRecognition
            if (!SR) {
              throw new Error('当前浏览器不支持 Web Speech API 语音识别')
            }
            var wrec = new SR()
            wrec.lang = WEBSpeech_LANG
            wrec.interimResults = true
            wrec.continuous = true
            speechRecRef.current = wrec
            speechFinalRef.current = ''
            wrec.onresult = function (e) {
              var fin = ''
              for (var i = 0; i < e.results.length; i++) {
                if (e.results[i].isFinal) fin += e.results[i][0].transcript
              }
              speechFinalRef.current = fin
              debugLog('WebSpeech 中间结果: ' + JSON.stringify(fin))
            }
            wrec.onerror = function (e) {
              console.error('[dsh-voice] WebSpeech 错误:', e.error)
              if (e.error !== 'aborted') {
                setError('浏览器语音识别错误: ' + e.error)
              }
            }
            wrec.onend = function () {
              var text = speechFinalRef.current.trim()
              debugLog('WebSpeech 结束，文本: ' + JSON.stringify(text))
              // 🕳️ 语气词保险网同样覆盖 webspeech：整条纯语气词 → 判为噪声丢弃
              if (text && !(FILLER_FILTER_ENABLE && isPureFiller(text))) {
                appendText(text)
              } else if (text) {
                console.warn('[dsh-voice] WebSpeech 纯语气词结果已过滤:', JSON.stringify(text))
              }
              speechRecRef.current = null
              setError(null)
              setPhase('idle')
            }
            wrec.start()
            setPhase('recording')
            return
          }

          var micId = localStorage.getItem(MIC_STORAGE_KEY) || ''
          // 关闭 Chromium 的自动处理（AGC/降噪/回声消除），拿原始信号，
          // 避免它在某些环境里把音量压得过低；低音量由 normalizeAudio 统一补偿。
          var rawAudio = { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
          var constraints = micId
            ? { audio: Object.assign({ deviceId: { exact: micId } }, rawAudio) }
            : { audio: rawAudio }
          var stream = await navigator.mediaDevices.getUserMedia(constraints)
          var audioTrack = stream.getAudioTracks()[0]
          deviceLabelRef.current = audioTrack ? audioTrack.label || '未知设备' : '未知设备'
          debugLog('实际使用的麦克风: ' + deviceLabelRef.current)
          streamRef.current = stream
          chunksRef.current = []

          var mime = ''
          if (window.MediaRecorder) {
            if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) mime = 'audio/webm;codecs=opus'
            else if (MediaRecorder.isTypeSupported('audio/mp4')) mime = 'audio/mp4'
          }
          mimeRef.current = mime || 'audio/webm'

          var rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
          recorderRef.current = rec
          rec.ondataavailable = function (e) {
            if (e.data && e.data.size > 0) chunksRef.current.push(e.data)
          }
          rec.onerror = function () {
            setError('录音出错')
            setPhase('idle')
          }
          rec.onstop = function () {
            finish()
          }
          rec.start()
          setPhase('recording')
        } catch (err) {
          stopStream()
          setError(err && err.message ? err.message : String(err))
          setPhase('idle')
        }
      }

      async function finish() {
        var blob = new Blob(chunksRef.current, { type: mimeRef.current })
        chunksRef.current = []
        stopStream()
        setPhase('transcribing')
        try {
          var samples = await decodeTo16kMono(blob)
          var maxAmp = 0
          for (var i = 0; i < samples.length; i++) {
            var a = Math.abs(samples[i])
            if (a > maxAmp) maxAmp = a
          }
          debugLog(
            '录音: blob=' + blob.size + 'B, ' +
            (samples.length / 16000).toFixed(1) + 's, 最大振幅=' + maxAmp.toFixed(3),
          )
          if (maxAmp < 0.0005) {
            throw new Error('未检测到声音：本次实际使用的设备是「' + deviceLabelRef.current + '」。请在下拉框中选择你正在用的麦克风')
          }
          if (samples.length < 16000 * 0.25) {
            throw new Error('录音太短（不足 0.25 秒），未发送识别')
          }
          // 🔇 静音检测增强：裁掉首尾及段间非语音噪声；「没说话」直接本地拦截，
          // 不送识别（省讯飞配额、杜绝云端把底噪解成嗯嗯啊啊）
          var speechSamples = await extractSpeech(samples)
          if (!speechSamples) {
            throw new Error('未检测到有效说话（本次录音 ' + (samples.length / 16000).toFixed(1) + 's，设备「' + deviceLabelRef.current + '」）——环境噪声已过滤，请对着麦克风说话')
          }
          samples = speechSamples
          if (maxAmp < 0.02) {
            console.warn('[dsh-voice] 音量偏低（振幅 ' + maxAmp.toFixed(4) + '），已自动增益')
          }
          var beforePeak = maxAmp
          samples = normalizeAudio(samples)
          // 🎙️ 在增益后进行智能静音压缩，消除说话中途的漫长停顿，防止云端引擎丢字截断！
          samples = compressSilence(samples)
          var afterPeak = 0
          for (var j = 0; j < samples.length; j++) {
            var b = Math.abs(samples[j])
            if (b > afterPeak) afterPeak = b
          }
          debugLog('增益: 峰值 ' + beforePeak.toFixed(4) + ' -> ' + afterPeak.toFixed(4))
          var text = ''
          if (ASR_ENGINE === 'xfyun') {
            text = await transcribeViaXfyun(samples)
          } else {
            var pipe = await getPipeline()
            // 🛡️ Whisper 无语音/幻觉抑制参数（openai/whisper 社区标准）：
            // 无语音概率高于阈值且文本置信度低于阈值 → 该段视为静音不出字；
            // 不携带上文解码，避免静音段反复复读同一句幻觉
            var genOpts = {
              condition_on_previous_text: false,
              no_speech_threshold: WHISPER_NO_SPEECH_THRESHOLD,
              logprob_threshold: WHISPER_NO_SPEECH_LOGPROB,
            }
            if (TRANSCRIBE_LANGUAGE) genOpts.language = TRANSCRIBE_LANGUAGE
            var result = await pipe(samples, genOpts)
            text = extractText(result).trim()
          }
          debugLog('识别结果: ' + JSON.stringify(text))
          if (text) {
            // 🕳️ 语气词保险网：整条结果只由语气词构成 → 判为噪声输出，丢弃不进输入框
            if (FILLER_FILTER_ENABLE && isPureFiller(text)) {
              throw new Error('识别结果「' + text + '」只含语气词，已按噪声过滤（可在头部 FILLER_FILTER_ENABLE 关闭）')
            }
            // 🧪 保险网放行证据：FILLER_FILTER_ENABLE ❌关闭 → 拦截未启用（放行≠没检测到）
            debugLog('语气词保险网: ' + (FILLER_FILTER_ENABLE ? '✅放行（含正常文本）' : '❌开关关闭，未拦截') + '，结果长度 ' + text.length + ' 字')
            appendText(text)
          } else {
            throw new Error('未识别到内容（录音 ' + (samples.length / 16000).toFixed(1) + 's，振幅 ' + maxAmp.toFixed(3) + '，设备「' + deviceLabelRef.current + '」）——若设备不是你的麦克风，请在下拉框切换')
          }
          setError(null)
          setPhase('idle')
        } catch (err) {
          console.error('[dsh-voice] 转写失败:', err && err.message ? err.message : err)
          setError(err && err.message ? err.message : String(err))
          setPhase('idle')
        }
      }

      function onClick() {
        if (phase === 'recording') {
          // ⌨️ 2026-10 提取共用入口：鼠标点击与空格键走同一停止函数（DRY 零分叉）
          停止录音并转写()
        } else if (phase === 'idle') {
          begin()
        }
      }

      var recording = phase === 'recording'
      // 🎯 2026-10 渲染期同步录音状态进 ref：keydown 监听器依赖数组为空、
      //     只挂载一次，经 ref 读最新录音状态，规避过期闭包（draftRef 同款模式）
      录音中_引用.current = recording
      var busy = phase === 'loading' || phase === 'transcribing'
      var downloading =
        phase === 'loading' && progress.status === 'progress' && typeof progress.progress === 'number'
      var title = error
        ? error
        : recording
          // ⌨️ 2026-10 录音中追加空格上屏悬浮提示；SPACE_COMMIT_ENABLE 关闭时
          //     保持原文案（提示与功能同一开关，绝不出现「提示了却没功能」）
          ? (SPACE_COMMIT_ENABLE ? '点击停止并转写（' + SPACE_COMMIT_HINT + '）' : '点击停止并转写')
          : busy
            ? (phase === 'loading'
              ? (downloading
                ? '下载模型 ' + Math.floor(progress.progress) + '%（首次约 250MB）'
                : progress.status === 'done' || progress.status === 'ready'
                  ? '初始化模型（首次约 1–2 分钟，仅一次）…'
                  : '加载模型…')
              : '转写中…')
            : '语音转文字'

      var style = {
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 30,
        height: 30,
        borderRadius: 999,
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-layer-2)',
        color: 'var(--dsw-alias-label-primary)',
        cursor: 'pointer',
        fontSize: 16,
        lineHeight: 1,
        boxSizing: 'border-box',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08)',
        // 🛡️ 禁用浏览器/宿主的焦点描边环：录音结束后的“黑边框”就是它（下拉框早已同样处理）
        outline: 'none',
        backdropFilter: 'blur(var(--lg-glass-blur, 14px)) saturate(150%)',
        WebkitBackdropFilter: 'blur(var(--lg-glass-blur, 14px)) saturate(150%)',
        transition: 'background 0.15s ease, border-color 0.15s ease, color 0.15s ease, opacity 0.15s ease',
      }
      if (recording) {
        style.borderColor = 'rgba(255,82,82,0.6)'
        style.background = 'rgba(255,82,82,0.16)'
        style.color = '#ff5252'
        style.animation = 'dsh-voice-pulse 1s ease-in-out infinite'
      } else if (error) {
        style.borderColor = 'rgba(255,82,82,0.6)'
        style.color = '#ff5252'
      }
      if (busy) {
        style.cursor = 'progress'
        style.opacity = 0.72
      }

      var content
      if (busy) {
        content = downloading
          ? el('span', { style: { fontSize: 9, fontWeight: 600, lineHeight: 1 } }, String(Math.floor(progress.progress)))
          : Spinner()
      } else {
        content = MicIcon(recording)
      }

      return el(
        'button',
        {
          type: 'button',
          'data-dsh-voice-mic': '',
          'aria-label': title,
          'aria-pressed': recording,
          title: title,
          disabled: busy,
          onMouseDown: onButtonMouseDown,
          onClick: onClick,
          style: style,
        },
        content,
      )
    }

    // ------------------------------------------------------------------
    // 麦克风设备选择器：列出音频输入设备，选择持久化到 localStorage，
    // 录音时用所选 deviceId 精确匹配（不再依赖浏览器的默认麦克风）。
    // ------------------------------------------------------------------
    async function listAudioInputs(unlock) {
      try {
        var list = await navigator.mediaDevices.enumerateDevices()
        var inputs = list.filter(function (d) {
          return d.kind === 'audioinput'
        })
        if (unlock && inputs.length > 0 && inputs.every(function (d) {
          return !d.label
        })) {
          // 标签为空说明还没获得麦克风权限：用户正在操作下拉框（用户手势），
          // 申请一次权限即可解锁设备名，然后立刻释放。
          var stream = await navigator.mediaDevices.getUserMedia({ audio: true })
          stream.getTracks().forEach(function (t) {
            t.stop()
          })
          list = await navigator.mediaDevices.enumerateDevices()
          inputs = list.filter(function (d) {
            return d.kind === 'audioinput'
          })
        }
        var seen = {}
        return inputs.filter(function (d) {
          if (seen[d.deviceId]) return false
          seen[d.deviceId] = true
          return true
        })
      } catch (err) {
        console.warn('[dsh-voice] 枚举麦克风失败:', err && err.message ? err.message : err)
        return []
      }
    }

    function MicDeviceSelect() {
      // 浏览器自带识别（webspeech）不支持指定设备，隐藏选择器。
      if (ASR_ENGINE === 'webspeech') return null
      var devicePair = React.useState([])
      var devices = devicePair[0]
      var setDevices = devicePair[1]
      var valuePair = React.useState(function () {
        try {
          return localStorage.getItem(MIC_STORAGE_KEY) || ''
        } catch {
          return ''
        }
      })
      var value = valuePair[0]
      var setValue = valuePair[1]

      React.useEffect(function () {
        var live = true
        function refresh() {
          listAudioInputs(false).then(function (list) {
            if (live) setDevices(list)
          })
        }
        refresh()
        var onChange = function () {
          refresh()
        }
        if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
          navigator.mediaDevices.addEventListener('devicechange', onChange)
        }
        return function () {
          live = false
          if (navigator.mediaDevices && navigator.mediaDevices.removeEventListener) {
            navigator.mediaDevices.removeEventListener('devicechange', onChange)
          }
        }
      }, [])

      function onFocus() {
        listAudioInputs(true).then(setDevices)
      }

      function onPick(e) {
        var id = e.target.value
        setValue(id)
        try {
          localStorage.setItem(MIC_STORAGE_KEY, id)
        } catch {}
      }

      var options = [el('option', { key: '__default', value: '' }, '默认麦克风')]
      if (devices.length === 0) {
        options.push(el('option', { key: '__hint', value: '__hint', disabled: true }, '未列出设备：点麦克风录一次音后回来刷新'))
      } else {
        devices.forEach(function (d) {
          options.push(el('option', { key: d.deviceId, value: d.deviceId }, d.label || ('设备 ' + d.deviceId.slice(0, 8))))
        })
      }

      return el(
        'select',
        {
          'data-dsh-voice-device': '',
          'aria-label': '选择录音设备',
          title: '选择录音设备',
          value: value,
          onChange: onPick,
          onFocus: onFocus,
          style: {
            height: MIC_SELECT_HEIGHT,
            borderRadius: 999,
            border: '1px solid var(--dsw-alias-border-l2)',
            background: 'var(--dsw-alias-bg-layer-2)',
            color: 'var(--dsw-alias-label-primary)',
            fontSize: 12,
            lineHeight: 1,
            padding: '0 8px',
            cursor: 'pointer',
            boxSizing: 'border-box',
            maxWidth: MIC_SELECT_MAX_WIDTH,
            outline: 'none',
            backdropFilter: 'blur(var(--lg-glass-blur, 14px)) saturate(150%)',
            WebkitBackdropFilter: 'blur(var(--lg-glass-blur, 14px)) saturate(150%)',
          },
        },
        options,
      )
    }

    // 一个槽位里渲染：麦克风按钮 + 设备选择下拉框
    function VoiceControl(props) {
      return el(
        'div',
        { style: { display: 'inline-flex', alignItems: 'center', gap: 6 } },
        el(MicButton, props),
        el(MicDeviceSelect, null),
      )
    }

    // ------------------------------------------------------------------
    // Style injection (keyframes only; the rest uses inline styles) +
    // 选项页设置卡片样式（1:1 复刻 dsh-univer-office 的官方规范，类名以
    // dsh-voice-settings 前缀命名空间化，全走 --dsw-alias-* 官方设计令牌）。
    // ------------------------------------------------------------------
    var CSS =
      '@keyframes dsh-voice-spin{to{transform:rotate(360deg)}}' +
      '@keyframes dsh-voice-pulse{0%,100%{opacity:1}50%{opacity:0.4}}' +
      '.dsh-voice-settingsCard{border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-3);padding:14px 16px}' +
      '.dsh-voice-settingsHead{display:flex;flex-direction:column;gap:4px}' +
      '.dsh-voice-settingsName{font-size:15px;font-weight:600;line-height:1.4;color:var(--dsw-alias-label-primary)}' +
      '.dsh-voice-settingsDescription{font-size:13px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}' +
      '.dsh-voice-settingsBody{border-top:1px solid var(--dsw-alias-border-l2)}' +
      '.dsh-voice-settingsField{display:flex;flex-direction:column;gap:6px;padding:12px 0}' +
      '.dsh-voice-settingsFieldHead{display:flex;align-items:center;gap:8px}' +
      '.dsh-voice-settingsLabel{min-width:0;flex:1;color:var(--dsw-alias-label-primary);font-size:13px;font-weight:500;line-height:1.5}' +
      '.dsh-voice-settingsFieldActions{display:inline-flex;align-items:center;gap:8px}' +
      '.dsh-voice-settingsSwitch{box-sizing:border-box;position:relative;width:36px;height:20px;flex:0 0 auto;padding:2px;border:0;border-radius:10px;background:var(--dsw-alias-border-l3);cursor:pointer;transition:background 120ms ease}' +
      '.dsh-voice-settingsSwitch_on{background:var(--dsw-alias-brand-primary)}' +
      '.dsh-voice-settingsSwitch:disabled{cursor:default;opacity:.5}' +
      '.dsh-voice-settingsSwitch:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}' +
      '.dsh-voice-settingsSwitchThumb{display:block;width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-label-primary-foreground);transition:transform 120ms ease}' +
      '.dsh-voice-settingsSwitch_on .dsh-voice-settingsSwitchThumb{transform:translateX(16px)}' +
      '.dsh-voice-settingsHint{margin:0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.5}' +
      '.dsh-voice-settingsFooter{display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:12px 0 4px;border-top:1px solid var(--dsw-alias-border-l2)}' +
      '.dsh-voice-settingsDiscard,.dsh-voice-settingsSave{padding:5px 14px;appearance:none;border:1px solid transparent;border-radius:8px;font:inherit;font-size:13px;line-height:1.5;cursor:pointer}' +
      '.dsh-voice-settingsDiscard{border-color:var(--dsw-alias-border-l2);background:none;color:var(--dsw-alias-label-secondary)}' +
      '.dsh-voice-settingsDiscard:hover:not(:disabled){border-color:var(--dsw-alias-label-dimmed);color:var(--dsw-alias-label-primary)}' +
      '.dsh-voice-settingsSave{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}' +
      '.dsh-voice-settingsSave:hover:not(:disabled){opacity:.9}' +
      '.dsh-voice-settingsDiscard:disabled,.dsh-voice-settingsSave:disabled{cursor:default;opacity:.4}' +
      '.dsh-voice-settingsDiscard:focus-visible,.dsh-voice-settingsSave:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}' +
      // 🛡️ 减少动效豁免必须同时盖住开关本体与滑块（审查教训：只豁免滑块的话，
      //    开关底色渐变对「减少动态效果」用户照播）
      '@media (prefers-reduced-motion:reduce){.dsh-voice-settingsSwitch,.dsh-voice-settingsSwitchThumb{transition:none}}'

    // ------------------------------------------------------------------
    // ⚙️ 插件选项页设置卡片（官方 plugins.bundle.config slot，key='dsh-voice'）。
    // 1:1 复刻 dsh-univer-office 的官方卡片规范；实现形态移植自
    // dsh-plugin-scroll-memory 经四轮审查验证的 配置组件，携带全部审查成果：
    // ① view:'summary' 防御（官方 keyed 条目契约：摘要位返回单行简介而非整卡）
    // ② 切换开关用函数式更新（杜绝连点/批处理边缘下的过期闭包丢翻转）
    // ③ 「是否有修改」用函数实时比较（渲染期常量会让保存按钮逻辑静默失效）
    // ④ 保存「先落库再提交」防假成功（localStorage 写失败时零提交、按钮保持可重试）
    // ⑤ 渲染期求值用解构值，事件回调内读状态对实时值（防过期闭包）
    // ------------------------------------------------------------------
    function DebugSettingsCard(props) {
      // 🛡️ 官方契约：详情页以 view:'page' 渲染完整表单，摘要位以 view:'summary'
      //    渲染单行简介——缺此分支的话官方一旦在卡片列表渲染摘要，整卡会被塞进列表
      if (props && props.view === 'summary') {
        return el('span', null, '调试日志默认开启；进入本页可关闭，保存后本浏览器记住选择。')
      }

      // 📍 已保存生效的持久化状态（savedVal 仅用于渲染期求值：useState 初值）
      var savedPair = React.useState(DEBUG_LOG_ENABLE === true)
      var savedVal = savedPair[0]
      var setSaved = savedPair[1]
      // 📍 未保存的草稿状态（draftVal 仅用于渲染期求值：开关类名/aria 态；
      //    💡 事件回调内必须读 draftPair[0] 实时值，绝不能用渲染期捕获的 draftVal）
      var draftPair = React.useState(savedVal)
      var draftVal = draftPair[0]
      var setDraft = draftPair[1]

      // 🧮 实时比较（审查成果：算成渲染期常量会让保存/放弃按钮逻辑静默失效）
      function hasChanges() {
        return draftPair[0] !== savedPair[0]
      }

      // 🔁 拨动开关：仅改变草稿状态
      //    💡 必须用函数式更新：读取本次渲染捕获的 draftPair[0] 在 React 连点/批处理
      //    边缘下是过期闭包值，可能丢翻转；函数式让 React 传入最新状态
      function toggleSwitch() {
        setDraft(function (current) { return !(current === true) })
      }

      // 🛑 放弃修改：草稿复位回已存值
      function discardChanges() {
        if (!hasChanges()) return
        setDraft(savedPair[0])
      }

      // 💾 保存修改：先落库，成功才提交（防假成功）
      //    🛡️ 顺序关键：必须「写记忆 → setSaved → 改闭包变量」。写失败（隐私模式/
      //    配额满/被禁）时若先提交 UI，会显示保存成功但记忆没落库——刷新后回到
      //    旧值，用户被"假成功"欺骗；失败时记 warn 后 return，按钮保持可用可重试。
      function saveChanges() {
        if (!hasChanges()) return
        var next = draftPair[0] === true
        if (writeDebugPref(next) !== true) {
          console.warn('[dsh-voice] 保存调试开关失败：记忆写入失败，本次修改未提交（按钮保持可用，可重试）')
          return
        }
        setSaved(next)
        DEBUG_LOG_ENABLE = next
        debugLog('选项页配置保存：调试日志已' + (next ? '开启' : '关闭') + '（已写入 localStorage 记忆）')
      }

      var switchClass = 'dsh-voice-settingsSwitch' + (draftVal ? ' dsh-voice-settingsSwitch_on' : '')

      return el('div', { className: 'dsh-voice-settingsCard' },
        el('div', { className: 'dsh-voice-settingsHead' },
          el('span', { className: 'dsh-voice-settingsName' }, '语音输入 (Voice Input)'),
          el('span', { className: 'dsh-voice-settingsDescription' }, '输入框右下角麦克风按钮：点击录音，再次点击结束，识别文本自动写入输入框。')
        ),
        el('div', { className: 'dsh-voice-settingsBody' },
          el('div', { className: 'dsh-voice-settingsField' },
            el('div', { className: 'dsh-voice-settingsFieldHead' },
              el('span', { className: 'dsh-voice-settingsLabel' }, '开启调试日志'),
              el('div', { className: 'dsh-voice-settingsFieldActions' },
                el('button', {
                  type: 'button',
                  role: 'switch',
                  className: switchClass,
                  'aria-checked': draftVal === true,
                  'aria-label': '开启调试日志',
                  onClick: toggleSwitch
                },
                  el('span', { className: 'dsh-voice-settingsSwitchThumb' })
                )
              )
            ),
            el('p', { className: 'dsh-voice-settingsHint' },
              '在控制台输出 [dsh-voice] 🧪 调试日志（功能状态总览、各功能生效/跳过原因），用于排查识别问题；异常类日志不受此开关控制，永远输出。'
            )
          ),
          el('div', { className: 'dsh-voice-settingsFooter' },
            el('button', {
              type: 'button',
              className: 'dsh-voice-settingsDiscard',
              disabled: !hasChanges(),
              onClick: discardChanges
            }, '放弃修改'),
            el('button', {
              type: 'button',
              className: 'dsh-voice-settingsSave',
              disabled: !hasChanges(),
              onClick: saveChanges
            }, '保存')
          )
        )
      )
    }

    function installStyles() {
      if (document.getElementById(STYLE_ID)) return function () {}
      var style = document.createElement('style')
      style.id = STYLE_ID
      style.textContent = CSS
      document.head.appendChild(style)
      return function () {
        if (style.parentNode) style.parentNode.removeChild(style)
      }
    }

    function apply(ctx) {
      // 🧠 启动时读取用户记忆的调试开关（有记录则覆盖头部默认值；读失败/无记录用默认）
      var savedPref = readDebugPref()
      if (savedPref !== null) DEBUG_LOG_ENABLE = savedPref

      var slots = ctx.get('slots')
      if (!slots || !React) return
      var disposeStyle = installStyles()
      var disposeSlot = slots.inject(SLOT_NAME, function () {
        return slots.register({ name: SLOT_NAME, id: SLOT_ID, order: 0 }, VoiceControl)
      })
      // ⚙️ 注册插件选项页的「开启调试日志」设置卡片（官方 plugins.bundle.config
      //    slot，key=包名；官方 README「配置页」：自带配置的插件把配置渲染在本页）。
      //    🛡️ 注册失败绝不拖垮麦克风主功能：捕获后仅记 warn。
      var disposeSettings = null
      try {
        disposeSettings = slots.inject('plugins.bundle.config', function () {
          return slots.register({ name: 'plugins.bundle.config', key: 'dsh-voice' }, DebugSettingsCard)
        })
        debugLog('选项页设置卡片已注册（plugins.bundle.config，key=dsh-voice）')
      } catch (err) {
        console.warn('[dsh-voice] 注册选项页设置卡片失败：' + err)
      }
      ctx.effect(function () {
        return function () {
          if (disposeSlot) disposeSlot()
          if (disposeSettings) disposeSettings()
          disposeStyle()
        }
      })
    }

    exports.name = 'dsh-voice'
    exports.inject = ['slots']
    exports.apply = apply
    return module.exports
  },
})
