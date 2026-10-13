/**
 * 本地数据层（同步存储，读写都在本地，保证 UI 永远秒开）
 * 云端只作为「提醒」与「备份」的通道，见 utils/cloud.js
 */
const dateUtil = require('./date')

const KEYS = {
  PLANS: 'ck_plans_v1',
  RECORDS: 'ck_records_v1',
  SETTINGS: 'ck_settings_v1',
  INITED: 'ck_inited_v1'
}

/* ------------------------------------------------------------------ */
/* 底层读写                                                            */
/* ------------------------------------------------------------------ */

function read(key, fallback) {
  try {
    const v = wx.getStorageSync(key)
    if (v === '' || v === null || v === undefined) return fallback
    return v
  } catch (e) {
    return fallback
  }
}

function write(key, value) {
  try {
    wx.setStorageSync(key, value)
    return true
  } catch (e) {
    wx.showToast({ title: '存储失败', icon: 'none' })
    return false
  }
}

/* ------------------------------------------------------------------ */
/* 打卡项                                                              */
/* ------------------------------------------------------------------ */

function newId(prefix) {
  return (prefix || 'p_') + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

function getPlans(includeArchived) {
  const list = read(KEYS.PLANS, [])
  if (!Array.isArray(list)) return []
  return includeArchived ? list.slice() : list.filter((p) => !p.archived)
}

function savePlans(list) {
  return write(KEYS.PLANS, Array.isArray(list) ? list : [])
}

function getPlan(id) {
  const list = getPlans(true)
  for (let i = 0; i < list.length; i++) {
    if (list[i].id === id) return list[i]
  }
  return null
}

function createPlan(data) {
  const now = Date.now()
  const plan = Object.assign(
    {
      id: newId(),
      name: '',
      emoji: '✅',
      color: '#3b7cff',
      remindTime: '09:00',
      remindEnabled: true,
      repeat: { type: 'daily', days: [0, 1, 2, 3, 4, 5, 6] },
      note: '',
      archived: false,
      sort: now,
      createdAt: now,
      updatedAt: now
    },
    data || {}
  )
  const list = getPlans(true)
  list.push(plan)
  savePlans(list)
  return plan
}

function updatePlan(id, patch) {
  const list = getPlans(true)
  for (let i = 0; i < list.length; i++) {
    if (list[i].id === id) {
      list[i] = Object.assign({}, list[i], patch, { id: id, updatedAt: Date.now() })
      savePlans(list)
      return list[i]
    }
  }
  return null
}

function removePlan(id) {
  savePlans(getPlans(true).filter((p) => p.id !== id))
  const all = getRecords()
  if (all[id]) {
    delete all[id]
    saveRecords(all)
  }
}

/* ------------------------------------------------------------------ */
/* 打卡记录   { [planId]: { 'YYYY-MM-DD': timestamp } }                */
/* ------------------------------------------------------------------ */

function getRecords() {
  const r = read(KEYS.RECORDS, {})
  return r && typeof r === 'object' ? r : {}
}

function saveRecords(r) {
  return write(KEYS.RECORDS, r || {})
}

function getPlanRecords(planId) {
  return getRecords()[planId] || {}
}

function isChecked(planId, dateStr) {
  const m = getPlanRecords(planId)
  return !!m[dateStr]
}

function checkTime(planId, dateStr) {
  return getPlanRecords(planId)[dateStr] || 0
}

/** 打卡；已打卡则返回 false */
function check(planId, dateStr, at) {
  const all = getRecords()
  if (!all[planId]) all[planId] = {}
  if (all[planId][dateStr]) return false
  all[planId][dateStr] = at || Date.now()
  saveRecords(all)
  return true
}

/** 取消打卡；本来就没打卡返回 false */
function uncheck(planId, dateStr) {
  const all = getRecords()
  if (all[planId] && all[planId][dateStr]) {
    delete all[planId][dateStr]
    if (!Object.keys(all[planId]).length) delete all[planId]
    saveRecords(all)
    return true
  }
  return false
}

function toggle(planId, dateStr) {
  if (isChecked(planId, dateStr)) {
    uncheck(planId, dateStr)
    return false
  }
  check(planId, dateStr)
  return true
}

/* ------------------------------------------------------------------ */
/* 统计                                                                */
/* ------------------------------------------------------------------ */

/** 某天需要打卡的项 */
function activePlansOn(dateStr) {
  return getPlans().filter((p) => dateUtil.isActiveOn(p, dateStr))
}

/**
 * 批量统计多天的完成情况，只读一次存储。
 * 月历一次要算 42 天，逐个调用 dayStats 会产生几百次同步读，这里统一优化。
 * @param {string[]} dates
 * @param {string} [planId] 传了只统计这一个打卡项，否则统计全部
 * @returns {Object} { 'YYYY-MM-DD': { total, done, percent } }
 */
function dayStatsBatch(dates, planId) {
  const list = dates || []
  const records = getRecords()
  const plans = planId ? [] : getPlans()
  const single = planId ? getPlan(planId) : null
  const out = {}

  list.forEach((ds) => {
    let done = 0
    let total = 0
    if (planId) {
      if (single && dateUtil.isActiveOn(single, ds)) {
        total = 1
        const m = records[planId]
        if (m && m[ds]) done = 1
      }
    } else {
      for (let i = 0; i < plans.length; i++) {
        const p = plans[i]
        if (!dateUtil.isActiveOn(p, ds)) continue
        total++
        const m = records[p.id]
        if (m && m[ds]) done++
      }
    }
    out[ds] = {
      total: total,
      done: done,
      percent: total ? Math.round((done * 100) / total) : 0
    }
  })
  return out
}

/** 某天的完成情况 */
function dayStats(dateStr) {
  const ds = dateStr || dateUtil.todayStr()
  return dayStatsBatch([ds])[ds]
}

/** 首页列表数据 */
function todayList(dateStr) {
  const ds = dateStr || dateUtil.todayStr()
  const records = getRecords()
  return getPlans()
    .slice()
    .sort((a, b) => {
      const ta = dateUtil.timeToMinutes(a.remindTime)
      const tb = dateUtil.timeToMinutes(b.remindTime)
      if (ta !== tb) return (ta < 0 ? 1440 : ta) - (tb < 0 ? 1440 : tb)
      return (a.sort || 0) - (b.sort || 0)
    })
    .map((p) => {
      const m = records[p.id] || {}
      return {
        id: p.id,
        plan: p,
        active: dateUtil.isActiveOn(p, ds),
        checked: !!m[ds],
        checkedAt: m[ds] || 0
      }
    })
}

/** 当前连续天数：从今天（或昨天）往前推，跳过不需要打卡的日子 */
function currentStreak(planId) {
  const plan = getPlan(planId)
  if (!plan) return 0
  const rec = getPlanRecords(planId)
  let cursor = dateUtil.todayStr()
  if (!rec[cursor]) {
    // 今天还没打卡不算断，从昨天开始算
    cursor = dateUtil.shiftDateStr(cursor, -1)
  }
  let n = 0
  let skip = 0
  while (skip < 400) {
    if (!dateUtil.isActiveOn(plan, cursor)) {
      cursor = dateUtil.shiftDateStr(cursor, -1)
      skip++
      continue
    }
    if (rec[cursor]) {
      n++
      cursor = dateUtil.shiftDateStr(cursor, -1)
    } else {
      break
    }
  }
  return n
}

/** 历史最长连续天数 */
function bestStreak(planId) {
  const plan = getPlan(planId)
  if (!plan) return 0
  const rec = getPlanRecords(planId)
  const days = Object.keys(rec).sort()
  if (!days.length) return 0
  let cursor = days[0]
  const today = dateUtil.todayStr()
  let best = 0
  let cur = 0
  let guard = 0
  while (cursor <= today && guard++ < 4000) {
    if (dateUtil.isActiveOn(plan, cursor)) {
      if (rec[cursor]) {
        cur++
        if (cur > best) best = cur
      } else {
        cur = 0
      }
    }
    cursor = dateUtil.shiftDateStr(cursor, 1)
  }
  return best
}

/** 区间完成率 { done, total, percent } */
function rangeStats(planId, startDateStr, endDateStr) {
  const plan = getPlan(planId)
  if (!plan) return { done: 0, total: 0, percent: 0 }
  const rec = getPlanRecords(planId)
  let done = 0
  let total = 0
  let cursor = startDateStr
  let guard = 0
  const today = dateUtil.todayStr()
  while (cursor <= endDateStr && guard++ < 4000) {
    if (dateUtil.isActiveOn(plan, cursor)) {
      total++
      if (rec[cursor]) done++
    }
    cursor = dateUtil.shiftDateStr(cursor, 1)
  }
  return { done: done, total: total, percent: total ? Math.round((done * 100) / total) : 0 }
}

/** 全局概览 */
function overview() {
  const plans = getPlans()
  const records = getRecords()
  let totalChecks = 0
  let activeDays = 0
  Object.keys(records).forEach((pid) => {
    const m = records[pid] || {}
    const n = Object.keys(m).length
    totalChecks += n
    if (n > 0) activeDays++
  })

  const today = dateUtil.todayStr()
  const monthStart = today.slice(0, 8) + '01'
  let monthStats = { done: 0, total: 0, percent: 0 }
  plans.forEach((p) => {
    const s = rangeStats(p.id, monthStart, today)
    monthStats.done += s.done
    monthStats.total += s.total
  })
  monthStats.percent = monthStats.total
    ? Math.round((monthStats.done * 100) / monthStats.total)
    : 0

  let maxCurrent = 0
  plans.forEach((p) => {
    const s = currentStreak(p.id)
    if (s > maxCurrent) maxCurrent = s
  })

  return {
    planCount: plans.length,
    totalChecks: totalChecks,
    activeDays: activeDays,
    monthStats: monthStats,
    maxCurrentStreak: maxCurrent,
    today: dayStats(today)
  }
}

/* ------------------------------------------------------------------ */
/* 设置                                                                */
/* ------------------------------------------------------------------ */

const DEFAULT_SETTINGS = {
  /** 每次打开小程序静默补充订阅消息次数 */
  autoSubscribe: true,
  /** 打卡时震动反馈 */
  vibrate: true,
  /** 上次成功同步到云的时间 */
  lastSyncAt: 0,
  /** 上次全量同步的日期（每天首次同步会上传近 60 天记录） */
  lastFullSyncDate: '',
  /** 上次请求订阅的时间 */
  lastSubscribeAt: 0,
  /** 用户是否已开启订阅提醒 */
  pushEnabled: false,
  /** 云函数反馈：订阅额度用完了，需要重新订阅 */
  needResubscribe: false
}

function getSettings() {
  const s = read(KEYS.SETTINGS, {})
  return Object.assign({}, DEFAULT_SETTINGS, s && typeof s === 'object' ? s : {})
}

function saveSettings(patch) {
  const next = Object.assign({}, getSettings(), patch || {})
  write(KEYS.SETTINGS, next)
  return next
}

/* ------------------------------------------------------------------ */
/* 导入导出                                                            */
/* ------------------------------------------------------------------ */

function exportAll() {
  return {
    app: 'checkin-assistant',
    version: 1,
    exportedAt: new Date().toISOString(),
    plans: getPlans(true),
    records: getRecords(),
    settings: getSettings()
  }
}

/**
 * 导入数据
 * @param {object} data exportAll() 的产物
 * @param {'merge'|'replace'} mode
 */
function importAll(data, mode) {
  if (!data || typeof data !== 'object') throw new Error('数据格式不正确')
  if (!Array.isArray(data.plans)) throw new Error('缺少 plans 字段')

  if (mode === 'replace') {
    savePlans(data.plans)
    saveRecords(data.records && typeof data.records === 'object' ? data.records : {})
    if (data.settings) write(KEYS.SETTINGS, Object.assign({}, DEFAULT_SETTINGS, data.settings))
    return { plans: data.plans.length, added: 0 }
  }

  // merge：同名打卡项视为同一个
  const existing = getPlans(true)
  const byName = {}
  const existingIds = {}
  existing.forEach((p) => {
    byName[p.name] = p
    existingIds[p.id] = true
  })
  let added = 0
  const idMap = {}
  data.plans.forEach((p) => {
    const hit = byName[p.name]
    if (hit) {
      idMap[p.id] = hit.id
      return
    }
    const id = p.id && !existingIds[p.id] ? p.id : newId()
    idMap[p.id] = id
    const np = Object.assign({}, p, { id: id })
    existing.push(np)
    byName[np.name] = np
    existingIds[id] = true
    added++
  })
  // 记录合并
  const records = getRecords()
  const incoming = data.records || {}
  Object.keys(incoming).forEach((pid) => {
    const targetId = idMap[pid] || pid
    if (!records[targetId]) records[targetId] = {}
    Object.assign(records[targetId], incoming[pid] || {})
  })
  savePlans(existing)
  saveRecords(records)
  return { plans: data.plans.length, added: added }
}

function clearAll() {
  savePlans([])
  saveRecords({})
  write(KEYS.SETTINGS, Object.assign({}, DEFAULT_SETTINGS))
}

/* ------------------------------------------------------------------ */
/* 首次启动示例数据                                                    */
/* ------------------------------------------------------------------ */

function seedSamples() {
  const now = Date.now()
  const samples = [
    {
      id: newId(),
      name: '早起',
      emoji: '🌅',
      color: '#ff9f0a',
      remindTime: '07:00',
      repeat: { type: 'daily', days: [0, 1, 2, 3, 4, 5, 6] },
      sort: now
    },
    {
      id: newId(),
      name: '喝水 8 杯',
      emoji: '💧',
      color: '#3b7cff',
      remindTime: '10:30',
      repeat: { type: 'daily', days: [0, 1, 2, 3, 4, 5, 6] },
      sort: now + 1
    },
    {
      id: newId(),
      name: '健身 30 分钟',
      emoji: '🏃',
      color: '#22c55e',
      remindTime: '19:30',
      repeat: { type: 'weekdays', days: [1, 2, 3, 4, 5] },
      sort: now + 2
    },
    {
      id: newId(),
      name: '读书 20 页',
      emoji: '📖',
      color: '#a855f7',
      remindTime: '22:00',
      repeat: { type: 'daily', days: [0, 1, 2, 3, 4, 5, 6] },
      sort: now + 3
    }
  ].map((p) =>
    Object.assign(
      {
        remindEnabled: true,
        note: '',
        archived: false,
        createdAt: now,
        updatedAt: now
      },
      p
    )
  )
  savePlans(samples)
}

function init() {
  if (read(KEYS.INITED, false)) return
  write(KEYS.INITED, true)
  if (!getPlans(true).length) seedSamples()
}

module.exports = {
  KEYS,
  init,
  newId,
  // plans
  getPlans,
  savePlans,
  getPlan,
  createPlan,
  updatePlan,
  removePlan,
  // records
  getRecords,
  saveRecords,
  getPlanRecords,
  isChecked,
  checkTime,
  check,
  uncheck,
  toggle,
  // stats
  activePlansOn,
  dayStats,
  dayStatsBatch,
  todayList,
  currentStreak,
  bestStreak,
  rangeStats,
  overview,
  // settings
  DEFAULT_SETTINGS,
  getSettings,
  saveSettings,
  // data
  exportAll,
  importAll,
  clearAll,
  seedSamples
}
