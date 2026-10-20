// dsh-voice —— Node host half.
//
// Routes:
//  1. GET /dsh-voice/hf/*   — proxy HuggingFace model files (hf-mirror.com)
//     same-origin, so the in-browser Whisper never hits a CORS wall.
//  2. POST /dsh-voice/asr   — iFlytek (讯飞) 语音听写: receives 16kHz/16bit
//     mono PCM as base64, calls the iFlytek IAT WebSocket API server-side,
//     returns { text }. Credentials never reach the browser.
//  3. GET/POST /dsh-voice/config — 讯飞 API 凭据配置接口（参考 modsearch 规范）
//     GET: 读取凭据状态（脱敏安全返回，绝不泄露密钥明文）
//     POST: 保存凭据到本地用户配置 (~/.dsh-voice/config.json) 并实时热更新内存生效

import { createHmac } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'dsh-voice'
export const inject = ['webServer']

// =====================================================================
// 🎛️ 头部规则与调试配置区 (靠前区域统一管理)
// =====================================================================
// 🎲 调试日志总开关（可选值：false / true）
const 调试日志_开关 = true

/**
 * 统一调试日志打印函数 (带标识，杜绝各处重复书写)
 * @param {string} 消息内容 - 要打印的调试文本
 * @param {any} [附加数据] - 可选的附加对象或错误
 */
function 打印_调试日志(消息内容, 附加数据) {
  if (!调试日志_开关) return
  if (附加数据 !== undefined) {
    console.log('[dsh-voice] 🧪 ' + 消息内容, 附加数据)
  } else {
    console.log('[dsh-voice] 🧪 ' + 消息内容)
  }
}

// ---------------------------------------------------------------------
// 讯飞凭据读取顺序：环境变量 > 本地用户配置 (~/.dsh-voice/config.json) > 空。
// 注册 https://www.xfyun.cn/ → 控制台「我的应用」创建应用，
// 拿到 APPID / APIKey / APISecret 后，二选一：
//  1. 环境变量：XFYUN_APPID / XFYUN_APIKEY / XFYUN_APISECRET
//  2. 选项页设置：在 DSH 插件列表进入 dsh-voice 详情页，可视化输入并保存
// ---------------------------------------------------------------------
/**
 * 📂 获取讯飞本地持久化配置文件路径 (~/.dsh-voice/config.json)
 * 采用独立的用户主目录，避免插件升级重装时配置文件被覆盖丢失（对齐 modsearch 规范）
 * @returns {string} 绝对文件路径
 */
function 获取_配置文件路径() {
  return join(homedir(), '.dsh-voice', 'config.json')
}

/**
 * 📂 获取旧版已废弃的插件目录配置文件路径（仅用于平滑迁移）
 * @returns {string} 旧版绝对文件路径
 */
function 获取_旧版废弃配置文件路径() {
  return fileURLToPath(new URL('./xfyun.secret.json', import.meta.url))
}

/**
 * 📖 读取本地讯飞配置 (优先读取用户主目录配置；支持平滑单向迁移旧版 xfyun.secret.json)
 * @returns {object}
 */
function 读取_讯飞本地配置() {
  const 新路径 = 获取_配置文件路径()
  try {
    if (existsSync(新路径)) {
      return JSON.parse(readFileSync(新路径, 'utf8'))
    }
  } catch (err) {
    打印_调试日志('读取本地配置文件异常:', err && err.message ? err.message : err)
    return {}
  }

  // 🔄 向后兼容：平滑检查旧版 xfyun.secret.json，若存在则自动单向迁移至新路径
  try {
    const 旧路径 = 获取_旧版废弃配置文件路径()
    if (existsSync(旧路径)) {
      const 旧配置文本 = readFileSync(旧路径, 'utf8')
      const 旧配置对象 = JSON.parse(旧配置文本)
      if (旧配置对象 && typeof 旧配置对象 === 'object') {
        打印_调试日志('检测到旧版废弃凭据文件，自动平滑迁移至新配置路径: ' + 新路径)
        安全写入_讯飞凭据配置(旧配置对象)
        return 旧配置对象
      }
    }
  } catch (迁移异常) {
    打印_调试日志('迁移旧版凭据配置失败:', 迁移异常 && 迁移异常.message ? 迁移异常.message : 迁移异常)
  }

  return {}
}

let XFYUN_SECRET = 读取_讯飞本地配置()

// 📍 运行期全局生效的讯飞凭据对象 (支持热更新，无须重启服务)
const XFYUN = {
  appId: process.env.XFYUN_APPID || XFYUN_SECRET.appId || '',
  apiKey: process.env.XFYUN_APIKEY || XFYUN_SECRET.apiKey || '',
  apiSecret: process.env.XFYUN_APISECRET || XFYUN_SECRET.apiSecret || '',
}

/**
 * 🔄 热更新讯飞生效凭据 (当 Web 端配置保存后调用)
 */
function 重新计算_生效凭据() {
  XFYUN_SECRET = 读取_讯飞本地配置()
  XFYUN.appId = process.env.XFYUN_APPID || XFYUN_SECRET.appId || ''
  XFYUN.apiKey = process.env.XFYUN_APIKEY || XFYUN_SECRET.apiKey || ''
  XFYUN.apiSecret = process.env.XFYUN_APISECRET || XFYUN_SECRET.apiSecret || ''
  const 是否_就绪 = !!(XFYUN.appId && XFYUN.apiKey && XFYUN.apiSecret)
  打印_调试日志('讯飞凭据已热更新，当前状态: ' + (是否_就绪 ? '✅全部就绪' : '⚠️部分未配置'))
}

/**
 * 🧼 安全清洗凭据字符串（去除换行、制表符、双引号等危险字符，防请求头注入）
 * @param {any} 输入文本 
 * @returns {string}
 */
function 安全清洗_凭据字段(输入文本) {
  if (typeof 输入文本 !== 'string') return ''
  // 💡 过滤换行符、制表符、双引号，限制最大长度为 64 位，防止 WebSocket 请求头格式被破坏
  return 输入文本.replace(/[\r\n\t"]/g, '').trim().slice(0, 64)
}

/**
 * 💾 安全原子持久化写入本地用户配置 (~/.dsh-voice/config.json)
 * 采用临时文件写入 + 原子重命名机制，强制 CRLF 换行
 * @param {object} 新配置对象 - 包含 appId, apiKey, apiSecret 的对象
 */
function 安全写入_讯飞凭据配置(新配置对象) {
  const 目标路径 = 获取_配置文件路径()
  const 目录路径 = dirname(目标路径)
  if (!existsSync(目录路径)) {
    mkdirSync(目录路径, { recursive: true })
  }
  const 唯一临时文件名 = '.config.' + process.pid + '.' + Date.now() + '.tmp'
  const 临时文件路径 = join(目录路径, 唯一临时文件名)
  // 保持 Windows CRLF 规范换行
  const 格式化文本 = JSON.stringify(新配置对象, null, 2).split('\n').join('\r\n') + '\r\n'

  try {
    writeFileSync(临时文件路径, 格式化文本, 'utf8')
    renameSync(临时文件路径, 目标路径)
    打印_调试日志('讯飞凭据已成功原子写入用户配置: ' + 目标路径)
  } catch (写入异常) {
    try {
      if (existsSync(临时文件路径)) unlinkSync(临时文件路径)
    } catch {}
    throw new Error('写入凭据文件失败: ' + (写入异常 && 写入异常.message ? 写入异常.message : String(写入异常)))
  }
}

/**
 * 🛡️ 获取面向前端 UI 的安全脱敏配置摘要
 * 绝不向前端暴露真实的密钥明文，只提供存在状态与来源（对齐 modsearch 规范）
 */
function 获取_安全配置摘要() {
  return {
    appId: XFYUN.appId ? (XFYUN.appId.length > 4 ? XFYUN.appId.slice(0, 2) + '****' + XFYUN.appId.slice(-2) : '****') : '',
    hasAppId: Boolean(XFYUN.appId),
    appIdSource: process.env.XFYUN_APPID ? 'env' : (XFYUN_SECRET.appId ? 'file' : null),
    hasApiKey: Boolean(XFYUN.apiKey),
    apiKeySource: process.env.XFYUN_APIKEY ? 'env' : (XFYUN_SECRET.apiKey ? 'file' : null),
    hasApiSecret: Boolean(XFYUN.apiSecret),
    apiSecretSource: process.env.XFYUN_APISECRET ? 'env' : (XFYUN_SECRET.apiSecret ? 'file' : null),
    configured: Boolean(XFYUN.appId && XFYUN.apiKey && XFYUN.apiSecret),
  }
}

// ---------------------------------------------------------------------
// ⏱️ 静音检测增强：讯飞后端点静音毫秒数（官方默认 2000，允许范围 0-10000）。
// 静音超过该值引擎即断句。旧版为防「中途停顿丢字」拉满到上限 10000ms，
// 代价是长静音/杂音期间云端持续解码，把呼吸声与底噪识别成「嗯/啊/呃」。
// 现在前端已用 VAD/能量门控裁掉静音与噪声，收回 3000ms 即可：
// 中途停顿仍远低于断句线（不会丢字），残余噪声不再被长时间硬解。
// ---------------------------------------------------------------------
const XFYUN_VAD_EOS = 3000

const HF_BASE = 'https://hf-mirror.com'
const HF_ROUTE = '/dsh-voice/hf'
const ASR_ROUTE = '/dsh-voice/asr'
const CONFIG_ROUTE = '/dsh-voice/config'

// ---------------------------------------------------------------------
// Route 1: HuggingFace model proxy (Whisper fallback engine).
// ---------------------------------------------------------------------
function hfHandler(req, res) {
  const raw = String(req.url || '').split('?')[0]
  const rel = raw.startsWith(HF_ROUTE) ? raw.slice(HF_ROUTE.length) : raw
  const target = HF_BASE + (rel.startsWith('/') ? rel : '/' + rel)

  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), 600000)

  fetch(target, { signal: ac.signal, redirect: 'follow' })
    .then(async (up) => {
      clearTimeout(timer)
      const headers = {
        'content-type': up.headers.get('content-type') || 'application/octet-stream',
        'cache-control': 'public, max-age=86400',
        'access-control-allow-origin': '*',
      }
      const length = up.headers.get('content-length')
      if (length) headers['content-length'] = length
      res.writeHead(up.status, headers)
      if (req.method === 'HEAD') {
        res.end()
        return
      }
      const reader = up.body.getReader()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        res.write(Buffer.from(value))
      }
      res.end()
    })
    .catch((err) => {
      clearTimeout(timer)
      if (res.headersSent) {
        res.end()
        return
      }
      res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('dsh-voice proxy error: ' + (err && err.message ? err.message : String(err)))
    })
}

// ---------------------------------------------------------------------
// Route 2: iFlytek 语音听写（IAT，WebSocket）。
// ---------------------------------------------------------------------
async function readJsonBody(req, limit = 12 * 1024 * 1024) {
  let size = 0
  const chunks = []
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw new Error('请求体过大')
    chunks.push(chunk)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  return JSON.parse(text || '{}')
}

function iatUrl() {
  const host = 'iat-api.xfyun.cn'
  const date = new Date().toUTCString()
  const signatureOrigin = 'host: ' + host + '\ndate: ' + date + '\nGET /v2/iat HTTP/1.1'
  const signature = createHmac('sha256', XFYUN.apiSecret)
    .update(signatureOrigin)
    .digest('base64')
  const authorizationOrigin =
    'api_key="' + XFYUN.apiKey + '", algorithm="hmac-sha256", headers="host date request-line", signature="' + signature + '"'
  const authorization = Buffer.from(authorizationOrigin).toString('base64')
  return (
    'wss://' + host + '/v2/iat?authorization=' + encodeURIComponent(authorization) +
    '&date=' + encodeURIComponent(date) + '&host=' + host
  )
}

function iatBusiness() {
  return {
    language: 'zh_cn',
    domain: 'iat',
    accent: 'mandarin',
    // ⏱️ 静音后端点检测：改用头部常量 XFYUN_VAD_EOS（默认 3000ms，取舍见文件顶部注释）。
    // 配合前端静音检测增强：长静音已在浏览器端裁掉，无需再用上限 10000ms 硬扛，
    // 残余噪声不会被云端长时间持续解码成「嗯/啊」。
    // 严禁添加未知字段（如 bos/vad_bos/eos），否则讯飞云端会报 10163 参数验证错误
    vad_eos: XFYUN_VAD_EOS,
    dwa: 'wpgs',
    ptt: 0,
  }
}

/**
 * Send 16kHz/16bit mono PCM (Int16 bytes) to iFlytek IAT and resolve the text.
 */
function iatTranscribe(pcm) {
  return new Promise((resolve, reject) => {
    let ws
    let settled = false
    // 🎙️ 讯飞标准分句容器：按句子序号 sn 严格隔离存储每句文字，绝不抛弃停顿前后的任何一段文本
    const 分句字典 = {}
    // 总超时延长至 60 秒（覆盖讯飞单次最大允许时长）
    const timer = setTimeout(() => finish(new Error('讯飞识别超时')), 60000)

    function finish(err, text) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        ws && ws.close()
      } catch {}
      if (err) reject(err)
      else resolve(text)
    }

    try {
      ws = new WebSocket(iatUrl())
    } catch (err) {
      finish(err)
      return
    }

    ws.onopen = () => {
      try {
        const FRAME = 1280
        if (pcm.length === 0) {
          ws.send(JSON.stringify({
            common: { app_id: XFYUN.appId },
            business: iatBusiness(),
            data: { status: 2, format: 'audio/L16;rate=16000', encoding: 'raw', audio: '' },
          }))
          return
        }
        let offset = 0
        let status = 0
        while (offset < pcm.length) {
          const end = Math.min(offset + FRAME, pcm.length)
          const chunk = pcm.subarray(offset, end)
          if (end >= pcm.length) status = 2
          ws.send(JSON.stringify({
            common: { app_id: XFYUN.appId },
            business: iatBusiness(),
            data: { status, format: 'audio/L16;rate=16000', encoding: 'raw', audio: chunk.toString('base64') },
          }))
          offset = end
          if (status === 0) status = 1
        }
      } catch (err) {
        finish(err)
      }
    }

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(String(event.data))
        if (msg.code !== 0) {
          finish(new Error('讯飞错误 ' + msg.code + '：' + (msg.message || '未知')))
          return
        }
        const data = msg.data
        if (!data) return
        const result = data.result
        if (result) {
          const 句号 = typeof result.sn === 'number' ? result.sn : 1
          // 如果开启动态修正并且指示替换前置范围
          if (result.pgs === 'rpl' && Array.isArray(result.rg)) {
            for (let r = result.rg[0]; r <= result.rg[1]; r++) {
              delete 分句字典[r]
            }
          }
          let 本片文字 = ''
          if (Array.isArray(result.ws)) {
            本片文字 = result.ws
              .map((item) => (item.cw || []).map((c) => c.w || '').join(''))
              .join('')
          }
          // 在同一个 sn 句子内累加文字
          分句字典[句号] = (分句字典[句号] || '') + 本片文字
        }

        // 最终消息（ls=true 或 status=2）到达，将所有分句按序号升序完整拼装
        if ((result && result.ls === true) || (data && data.status === 2)) {
          const 排序序号列表 = Object.keys(分句字典).map(Number).sort((a, b) => a - b)
          const 完整合并文本 = 排序序号列表.map((k) => 分句字典[k] || '').join('')
          finish(null, 完整合并文本)
        }
      } catch (err) {
        finish(err)
      }
    }

    ws.onerror = () => {
      finish(new Error('讯飞 WebSocket 连接失败（检查凭据与网络）'))
    }

    ws.onclose = () => {
      finish(new Error('讯飞连接已关闭，未收到识别结果'))
    }
  })
}

async function asrHandler(req, res) {
  if (req.method !== 'POST') {
    res.writeHead(405, { allow: 'POST' })
    res.end()
    return
  }
  try {
    if (!XFYUN.appId || !XFYUN.apiKey || !XFYUN.apiSecret) {
      res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ error: '讯飞凭据未配置：请在 DSH 插件设置页配置 APPID / APIKey / APISecret 或配置环境变量' }))
      return
    }
    const body = await readJsonBody(req)
    if (typeof body.audio !== 'string' || body.audio.length === 0) {
      res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ error: '缺少 audio 字段（base64 PCM 16k/16bit）' }))
      return
    }
    const pcm = Buffer.from(body.audio, 'base64')
    const text = await iatTranscribe(pcm)
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ text }))
  } catch (err) {
    res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ error: err && err.message ? err.message : String(err) }))
  }
}

// ---------------------------------------------------------------------
// Route 3: 讯飞凭据配置管理 (参考 modsearch 的保存 api 系统规范)
// ---------------------------------------------------------------------
async function configHandler(req, res) {
  const 发送响应 = (状态码, 数据体) => {
    res.writeHead(状态码, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify(数据体))
  }

  if (req.method === 'GET') {
    try {
      发送响应(200, 获取_安全配置摘要())
    } catch (err) {
      发送响应(500, { error: '获取讯飞配置摘要异常: ' + (err && err.message ? err.message : String(err)) })
    }
    return
  }

  if (req.method !== 'POST') {
    res.writeHead(405, { allow: 'GET, POST' }).end()
    return
  }

  try {
    const 请求体 = await readJsonBody(req, 64 * 1024)
    const 现有配置 = 读取_讯飞本地配置()
    const 合并后配置 = { ...现有配置 }

    // 💡 遵循 modsearch 的「留空即不改动」安全原则：
    // 只有传入有效非空字符串才覆盖已有凭据，若显式传入 null 则支持清空凭据
    if (请求体.appId === null) {
      delete 合并后配置.appId
    } else if (typeof 请求体.appId === 'string' && 请求体.appId.trim() !== '') {
      合并后配置.appId = 安全清洗_凭据字段(请求体.appId)
    }

    if (请求体.apiKey === null) {
      delete 合并后配置.apiKey
    } else if (typeof 请求体.apiKey === 'string' && 请求体.apiKey.trim() !== '') {
      合并后配置.apiKey = 安全清洗_凭据字段(请求体.apiKey)
    }

    if (请求体.apiSecret === null) {
      delete 合并后配置.apiSecret
    } else if (typeof 请求体.apiSecret === 'string' && 请求体.apiSecret.trim() !== '') {
      合并后配置.apiSecret = 安全清洗_凭据字段(请求体.apiSecret)
    }

    安全写入_讯飞凭据配置(合并后配置)
    重新计算_生效凭据()
    发送响应(200, 获取_安全配置摘要())
  } catch (err) {
    发送响应(400, { error: err && err.message ? err.message : String(err) })
  }
}

export function apply(ctx) {
  // 🔍 host 侧配置自检日志：浏览器控制台看不到这里，去 dsh 服务端日志查看本行。
  // 凭据状态只报「已配置/未配置」，绝不打印密钥内容本身。
  const credOk = !!(XFYUN.appId && XFYUN.apiKey && XFYUN.apiSecret)
  console.log(
    '[dsh-voice] 🧪 host 配置: 讯飞凭据 ' + (credOk ? '✅已配置' : '❌未配置（xfyun 引擎将不可用）') +
    ' | 讯飞vad_eos=' + XFYUN_VAD_EOS + 'ms' +
    ' | HF代理路由=' + HF_ROUTE + ' | 讯飞识别路由=' + ASR_ROUTE + ' | 配置路由=' + CONFIG_ROUTE,
  )
  const disposeHf = ctx.webServer.register({ kind: 'prefix', path: HF_ROUTE, handler: hfHandler })
  const disposeAsr = ctx.webServer.register({ kind: 'exact', path: ASR_ROUTE, handler: asrHandler })
  const disposeConfig = ctx.webServer.register({ kind: 'exact', path: CONFIG_ROUTE, handler: configHandler })
  // ctx.effect 的回调体会被立即执行，必须「返回清理函数」，
  // 否则刚注册的路由会被当场销毁。
  ctx.effect(() => () => {
    disposeHf()
    disposeAsr()
    disposeConfig()
  })
}

// Exported for the standalone connectivity test (test/iat-test.mjs).
export { iatTranscribe }
