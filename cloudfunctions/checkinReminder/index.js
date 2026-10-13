/**
 * 云函数：checkinReminder
 * 由定时触发器每分钟调用一次：扫描所有开启提醒的用户，
 * 对「此刻该打卡、且今天还没打卡」的项目发送订阅消息。
 *
 * 触发配置见同目录 config.json（cron 为 7 位：秒 分 时 日 月 周 年）。
 * 建议在云开发控制台把本函数超时时间调大一些（例如 20 秒），用户量上来后更稳。
 */
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

const COL_USERS = 'ck_users'
const COL_CHECKINS = 'ck_checkins'

// 当前版本：developer=开发版 / trial=体验版 / formal=正式版
// 必须与用户实际打开的版本一致，否则微信不投递（日志却显示发送成功）
// 当前使用：体验版
const MINIPROGRAM_STATE = 'trial'
const DEFAULT_PAGE = 'pages/index/index'
const DEFAULT_FIELDS = { title: 'thing1', time: 'time2', remark: 'thing3' }

/** 单次执行的时间预算（毫秒），留出余量避免云函数超时 */
const TIME_BUDGET = 15000
/** 每次抓取的用户数 */
const PAGE_SIZE = 100
/** 已推送标记保留天数 */
const KEEP_PUSH_KEYS_DAYS = 7

/**
 * 本次执行开始时间。
 * 注意：云函数容器会被复用（热启动），模块级变量会跨调用保留，
 * 所以必须在每次 main 入口重新赋值，不能写成模块级的 Date.now() 常量。
 */
let startedAt = 0

function elapsed() {
  return Date.now() - startedAt
}

/* ------------------------------------------------------------------ */
/* 时间工具（云函数容器时区是 UTC，统一按北京时间换算）                  */
/* ------------------------------------------------------------------ */

function pad2(n) {
  return n < 10 ? '0' + n : '' + n
}

function beijingNow() {
  return new Date(Date.now() + 8 * 3600 * 1000)
}

function beijingContext() {
  const d = beijingNow()
  const y = d.getUTCFullYear()
  const m = pad2(d.getUTCMonth() + 1)
  const day = pad2(d.getUTCDate())
  return {
    hhmm: pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes()),
    date: y + '-' + m + '-' + day,
    weekday: d.getUTCDay() // 0=周日
  }
}

function weekdayOfDateStr(dateStr) {
  const p = String(dateStr).split('-')
  return new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2]))).getUTCDay()
}

/** '9:05' -> '09:05'，与小程序端 dateUtil.padTime 保持一致 */
function padTime(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''))
  if (!m) return ''
  return pad2(Number(m[1])) + ':' + m[2]
}

/* ------------------------------------------------------------------ */
/* 业务规则（与小程序端 utils/date.js 的 isActiveOn 保持一致）           */
/* ------------------------------------------------------------------ */

function isActiveOn(plan, dateStr, weekday) {
  if (!plan || plan.archived) return false
  if (plan.startDate && dateStr < plan.startDate) return false
  if (plan.endDate && dateStr > plan.endDate) return false

  const r = plan.repeat || { type: 'daily' }
  const wd = weekday === undefined ? weekdayOfDateStr(dateStr) : weekday

  switch (r.type) {
    case 'daily':
      return true
    case 'weekdays':
      return wd >= 1 && wd <= 5
    case 'weekend':
      return wd === 0 || wd === 6
    case 'custom':
      return (r.days || []).indexOf(wd) >= 0
    case 'once':
      return dateStr === r.date
    default:
      return true
  }
}

/** 按字段类型做兜底格式化，避免 thing 类字段超长导致发送失败 */
function buildTemplateValue(fieldId, value) {
  const id = String(fieldId || '')
  const s = String(value === undefined || value === null ? '' : value)
  if (id.indexOf('time') === 0) return s.slice(0, 20)
  if (id.indexOf('date') === 0) return s.slice(0, 20)
  if (id.indexOf('number') === 0) return s.replace(/[^\d.]/g, '').slice(0, 20) || '1'
  if (id.indexOf('phrase') === 0) return s.slice(0, 5)
  if (id.indexOf('character_string') === 0) return s.replace(/[^0-9a-zA-Z]/g, '').slice(0, 32)
  return s.slice(0, 20)
}

async function hasCheckedIn(openid, planId, dateStr) {
  try {
    const res = await db
      .collection(COL_CHECKINS)
      .doc(openid + '_' + planId + '_' + dateStr)
      .get()
    return !!(res && res.data)
  } catch (e) {
    return false
  }
}

/* ------------------------------------------------------------------ */
/* 单个用户                                                            */
/* ------------------------------------------------------------------ */

async function handleUser(user, ctx) {
  const plans = Array.isArray(user.plans) ? user.plans : []
  const fields = user.templateFields || DEFAULT_FIELDS
  const page = user.subscribePage || DEFAULT_PAGE
  const pushedKeys = user.pushedKeys || {}

  const due = plans.filter(
    (p) =>
      p &&
      !p.archived &&
      p.remindEnabled !== false &&
      padTime(p.remindTime) === ctx.hhmm &&
      isActiveOn(p, ctx.date, ctx.weekday)
  )

  if (!due.length) {
    return { sent: 0, needResubscribe: false, pushedKeys: null }
  }

  let sent = 0
  let needResubscribe = false
  let changed = false

  for (let i = 0; i < due.length; i++) {
    if (elapsed() > TIME_BUDGET) break

    const plan = due[i]
    const key = plan.id + '_' + ctx.date
    if (pushedKeys[key]) continue

    const checked = await hasCheckedIn(user.openid || user._id, plan.id, ctx.date)
    if (checked) {
      // 已经打过卡了，留个标记避免后面重复查询
      pushedKeys[key] = -1
      changed = true
      continue
    }

    const data = {}
    const fieldIds = Object.keys(fields)
    fieldIds.forEach((k) => {
      const v =
        k === 'title'
          ? plan.name
          : k === 'time'
          ? plan.remindTime
          : k === 'remark'
          ? plan.note || '记得完成今天的打卡哦'
          : plan.name
      data[fields[k]] = { value: buildTemplateValue(fields[k], v) }
    })

    try {
      await cloud.openapi.subscribeMessage.send({
        touser: user.openid || user._id,
        templateId: user.templateId,
        page: page,
        miniprogramState: MINIPROGRAM_STATE,
        lang: 'zh_CN',
        data: data
      })
      pushedKeys[key] = Date.now()
      changed = true
      sent++
    } catch (err) {
      const code = err && (err.errCode || err.errcode)
      if (code === 43101) {
        // 用户没有订阅额度了，标记一下让小程序端提示重新授权
        needResubscribe = true
        break
      }
      console.error('[checkinReminder] 发送失败', plan.id, code, err && err.errMsg)
    }
  }

  const patch = {}
  if (changed) {
    patch.pushedKeys = prunePushKeys(pushedKeys, ctx.date)
  }
  if (sent > 0) patch.lastPushAt = Date.now()
  if (needResubscribe && !user.needResubscribe) patch.needResubscribe = true

  if (Object.keys(patch).length) {
    await db
      .collection(COL_USERS)
      .doc(user._id)
      .update({ data: patch })
      .catch((e) => console.error('[checkinReminder] 更新用户失败', user._id, e && e.errMsg))
  }

  return { sent: sent, needResubscribe: needResubscribe, pushedKeys: patch.pushedKeys || null }
}

/** 只保留最近 N 天的推送标记，防止文档无限变大 */
function prunePushKeys(keys, today) {
  const limit = new Date(
    Date.UTC(
      Number(today.slice(0, 4)),
      Number(today.slice(5, 7)) - 1,
      Number(today.slice(8, 10)) - KEEP_PUSH_KEYS_DAYS
    )
  )
  const limitStr =
    limit.getUTCFullYear() +
    '-' +
    pad2(limit.getUTCMonth() + 1) +
    '-' +
    pad2(limit.getUTCDate())

  const out = {}
  Object.keys(keys).forEach((k) => {
    const datePart = k.slice(-10)
    if (datePart >= limitStr) out[k] = keys[k]
  })
  return out
}

/* ------------------------------------------------------------------ */
/* 入口                                                                */
/* ------------------------------------------------------------------ */

exports.main = async () => {
  startedAt = Date.now()
  const ctx = beijingContext()

  // SOURCE === 'wx_trigger' 表示这次是定时触发器自动调用的；
  // 在控制台点「云端测试」手动跑时会是其它值。日志里带上它能一眼区分。
  let source = 'unknown'
  try {
    const wxContext = cloud.getWXContext()
    source = (wxContext && wxContext.SOURCE) || 'unknown'
  } catch (e) {
    /* 拿不到就保持 unknown */
  }

  const summary = {
    at: ctx.date + ' ' + ctx.hhmm,
    source: source,
    users: 0,
    sent: 0,
    needResubscribe: 0,
    truncated: false
  }

  let skip = 0
  while (true) {
    if (elapsed() > TIME_BUDGET) {
      summary.truncated = true
      break
    }

    let list = []
    try {
      // 只按 _id 排序分页（_id 一定有索引），pushEnabled 在代码里过滤，
      // 避免 where + orderBy 组合触发组合索引要求。
      const res = await db
        .collection(COL_USERS)
        .orderBy('_id', 'asc')
        .skip(skip)
        .limit(PAGE_SIZE)
        .get()
      list = (res && res.data) || []
    } catch (err) {
      console.error('[checkinReminder] 查询用户失败', err && err.errMsg)
      break
    }

    if (!list.length) break

    for (let i = 0; i < list.length; i++) {
      const user = list[i]
      if (!user.pushEnabled || !user.templateId) continue
      if (elapsed() > TIME_BUDGET) {
        summary.truncated = true
        break
      }
      try {
        const r = await handleUser(user, ctx)
        summary.users++
        summary.sent += r.sent
        if (r.needResubscribe) summary.needResubscribe++
      } catch (err) {
        console.error('[checkinReminder] 处理用户失败', user._id, err && err.errMsg)
      }
    }

    if (summary.truncated) break
    if (list.length < PAGE_SIZE) break
    skip += PAGE_SIZE
  }

  console.log('[checkinReminder] ' + JSON.stringify(summary))
  return summary
}
