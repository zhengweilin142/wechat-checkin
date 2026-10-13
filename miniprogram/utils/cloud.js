/**
 * 云开发通道：把本地数据同步到云端（供定时云函数读取），并负责订阅消息授权。
 * 云开发不可用时，所有方法都会安全降级，不影响本地打卡功能。
 */
const config = require('../config')
const store = require('./store')
const dateUtil = require('./date')

function app() {
  try {
    return getApp()
  } catch (e) {
    return null
  }
}

function ready() {
  const a = app()
  return !!(a && a.globalData && a.globalData.cloudReady)
}

function errText(err) {
  if (!err) return '未知错误'
  return err.errMsg || err.message || String(err)
}

/** 调用云函数，统一返回 result 对象 */
function call(action, data) {
  if (!ready()) {
    return Promise.reject(new Error('云开发未就绪'))
  }
  return wx.cloud
    .callFunction({
      name: config.apiFunctionName,
      data: Object.assign({ action: action }, data || {})
    })
    .then((res) => {
      const r = res && res.result
      if (r && r.ok === false) throw new Error(r.message || '云函数返回失败')
      return r || {}
    })
}

/* ------------------------------------------------------------------ */
/* 同步                                                                */
/* ------------------------------------------------------------------ */

/** 组装要上传的打卡项列表 */
function basePayload() {
  const plans = store.getPlans(true).map((p) => {
    const repeat = p.repeat || { type: 'daily' }
    return {
      id: p.id,
      name: p.name,
      emoji: p.emoji,
      remindTime: dateUtil.padTime(p.remindTime),
      remindEnabled: p.remindEnabled !== false && !!p.remindTime && repeat.type !== 'once',
      repeat: repeat,
      note: p.note || '',
      archived: !!p.archived
    }
  })
  return {
    plans: plans,
    templateId: config.subscribeTemplateId || '',
    templateFields: config.templateFields || {},
    subscribePage: config.subscribePage
  }
}

/** 收集 >= sinceDateStr 的打卡记录 */
function collectRecords(sinceDateStr) {
  const out = []
  const all = store.getRecords()
  Object.keys(all).forEach((pid) => {
    const m = all[pid] || {}
    Object.keys(m).forEach((d) => {
      if (!sinceDateStr || d >= sinceDateStr) out.push({ planId: pid, date: d, at: m[d] })
    })
  })
  return out
}

/**
 * 组装同步数据。
 * todayRecords（近两天）每次都传，量很小；
 * records（近 60 天）只在全量同步时传，避免每次打卡都写几百条文档。
 */
function buildPayload(extra) {
  const today = dateUtil.todayStr()
  const payload = Object.assign(basePayload(), {
    todayRecords: collectRecords(dateUtil.shiftDateStr(today, -1))
  })
  if (extra && extra.full) {
    payload.records = collectRecords(dateUtil.shiftDateStr(today, -59))
  }
  return Object.assign(payload, extra || {})
}

/** 立即把本地数据推到云端；每天首次同步会自动带上最近 60 天记录 */
function syncNow(extra) {
  const s = store.getSettings()
  const today = dateUtil.todayStr()
  const opts = Object.assign({}, extra || {})
  if (s.lastFullSyncDate !== today) opts.full = true

  const payload = buildPayload(opts)
  return call('sync', payload).then((res) => {
    store.saveSettings({ lastSyncAt: Date.now(), lastFullSyncDate: today })
    return res
  })
}

/** 拉取云端状态（订阅额度、上次推送时间等） */
function fetchState() {
  return call('getState', {})
}

/* ------------------------------------------------------------------ */
/* 订阅消息                                                            */
/* ------------------------------------------------------------------ */

function hasReminderPlans() {
  return store.getPlans().some((p) => p.remindEnabled !== false && !!p.remindTime)
}

/**
 * 请求订阅消息授权。
 * 必须在用户点击手势里调用才会弹窗；返回 'accept' | 'reject' | 'ban' | 'filter'
 */
function requestSubscribe() {
  return new Promise((resolve, reject) => {
    const tmplId = config.subscribeTemplateId
    if (!tmplId) {
      reject(new Error('NO_TEMPLATE'))
      return
    }
    wx.requestSubscribeMessage({
      tmplIds: [tmplId],
      success(res) {
        resolve(res[tmplId] || 'unknown')
      },
      fail(err) {
        reject(err)
      }
    })
  })
}

/** 用户主动点击「开启提醒」 */
function subscribeByUser() {
  return requestSubscribe()
    .then((result) => {
      const accepted = result === 'accept'
      store.saveSettings({
        lastSubscribeAt: Date.now(),
        pushEnabled: accepted,
        needResubscribe: accepted ? false : store.getSettings().needResubscribe
      })
      if (ready()) {
        return syncNow({ subscribeResult: result, pushEnabled: accepted }).then(() => ({
          result: result,
          accepted: accepted
        }))
      }
      return { result: result, accepted: accepted }
    })
    .catch((err) => {
      if (err && err.message === 'NO_TEMPLATE') {
        throw new Error('还没在 config.js 里填写订阅消息模板 ID')
      }
      throw err
    })
}

/**
 * 静默补充订阅次数（一次性订阅每授权一次只能发一条，
 * 用户在弹窗里勾选「总是保持以上选择」后，每次调用会静默累积额度）。
 * 已按 autoSubscribeInterval 节流；任何失败都静默吞掉。
 */
function autoSubscribe() {
  const s = store.getSettings()
  if (!s.autoSubscribe || !config.subscribeTemplateId) return Promise.resolve('skip')
  if (!hasReminderPlans()) return Promise.resolve('no-plan')
  if (Date.now() - (s.lastSubscribeAt || 0) < config.autoSubscribeInterval) {
    return Promise.resolve('throttled')
  }
  return requestSubscribe()
    .then((result) => {
      store.saveSettings({ lastSubscribeAt: Date.now() })
      if (result === 'accept') {
        store.saveSettings({ pushEnabled: true, needResubscribe: false })
      }
      return ready() ? syncNow({ subscribeResult: result }).then(() => result) : result
    })
    .catch(() => 'fail')
}

/** 立即给自己发一条测试提醒（需要在「我的」页面点按钮触发） */
function sendTestPush() {
  return call('testPush', {})
}

module.exports = {
  ready,
  errText,
  call,
  buildPayload,
  syncNow,
  fetchState,
  hasReminderPlans,
  requestSubscribe,
  subscribeByUser,
  autoSubscribe,
  sendTestPush
}
