/**
 * 云函数：checkinApi
 * 职责：小程序端的数据同步入口 + 测试推送
 *
 * 需要的基础库/服务端 SDK：wx-server-sdk（package.json 已声明）
 * 数据库集合：ck_users（每个用户一条文档）、ck_checkins（每条打卡记录一条文档）
 * 首次调用会自动创建集合，无需手工建表。
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

let ensured = false

async function ensureCollections() {
  if (ensured) return
  const names = [COL_USERS, COL_CHECKINS]
  for (let i = 0; i < names.length; i++) {
    try {
      await db.createCollection(names[i])
    } catch (e) {
      // -501001 / ResourceExists：集合已存在，忽略
    }
  }
  ensured = true
}

/* ------------------------------------------------------------------ */
/* 工具                                                                */
/* ------------------------------------------------------------------ */

function pad2(n) {
  return n < 10 ? '0' + n : '' + n
}

/** 北京时间（云函数容器是 UTC） */
function beijingNow() {
  return new Date(Date.now() + 8 * 3600 * 1000)
}

function beijingTimeText() {
  const d = beijingNow()
  return pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes())
}

function beijingDateText() {
  const d = beijingNow()
  return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate())
}

/** 把值塞进订阅消息模板字段，按字段类型做兜底格式化 */
function buildTemplateValue(fieldId, value) {
  const id = String(fieldId || '')
  const s = String(value === undefined || value === null ? '' : value)
  if (id.indexOf('time') === 0) return s.slice(0, 20)
  if (id.indexOf('date') === 0) return s.slice(0, 20)
  if (id.indexOf('number') === 0) return s.replace(/[^\d.]/g, '').slice(0, 20) || '1'
  if (id.indexOf('phrase') === 0) return s.slice(0, 5)
  if (id.indexOf('character_string') === 0) return s.replace(/[^0-9a-zA-Z]/g, '').slice(0, 32)
  // thing / 其它：最多 20 个字符
  return s.slice(0, 20)
}

async function getUser(openid) {
  try {
    const res = await db.collection(COL_USERS).doc(openid).get()
    return res && res.data ? res.data : null
  } catch (e) {
    return null
  }
}

async function sendSubscribeMessage(openid, templateId, fields, data, page) {
  const payload = {}
  Object.keys(data).forEach((key) => {
    const fieldId = fields[key]
    if (!fieldId) return
    payload[fieldId] = { value: buildTemplateValue(fieldId, data[key]) }
  })

  return cloud.openapi.subscribeMessage.send({
    touser: openid,
    templateId: templateId,
    page: page || DEFAULT_PAGE,
    miniprogramState: MINIPROGRAM_STATE,
    lang: 'zh_CN',
    data: payload
  })
}

/* ------------------------------------------------------------------ */
/* actions                                                             */
/* ------------------------------------------------------------------ */

async function actionGetState(openid) {
  const user = await getUser(openid)
  return {
    ok: true,
    openid: openid,
    exists: !!user,
    pushEnabled: user ? !!user.pushEnabled : false,
    needResubscribe: user ? !!user.needResubscribe : false,
    planCount: user && Array.isArray(user.plans) ? user.plans.length : 0,
    lastPushAt: user ? user.lastPushAt || 0 : 0,
    lastSyncAt: user ? user.updatedAt || 0 : 0
  }
}

async function actionSync(openid, event) {
  const now = Date.now()
  const plans = Array.isArray(event.plans) ? event.plans : []
  const templateId = event.templateId || ''
  const fields = event.templateFields || DEFAULT_FIELDS
  const page = event.subscribePage || DEFAULT_PAGE

  const pushEnabled = plans.some(
    (p) => p && p.remindEnabled !== false && !!p.remindTime && !p.archived
  )

  const user = await getUser(openid)
  const patch = {
    openid: openid,
    plans: plans,
    pushEnabled: pushEnabled,
    templateId: templateId,
    templateFields: fields,
    subscribePage: page,
    updatedAt: now
  }
  if (event.subscribeResult) {
    patch.lastSubscribeResult = event.subscribeResult
    patch.lastSubscribeAt = now
  }
  if (event.subscribeResult === 'accept') {
    patch.needResubscribe = false
  }

  if (user) {
    await db.collection(COL_USERS).doc(openid).update({ data: patch })
  } else {
    await db
      .collection(COL_USERS)
      .doc(openid)
      .set({
        data: Object.assign(
          {
            createdAt: now,
            needResubscribe: false,
            lastPushAt: 0,
            pushedKeys: {}
          },
          patch
        )
      })
  }

  // 打卡记录：todayRecords 每次都传（很小），records 只在全量同步时传
  const checkins = []
    .concat(Array.isArray(event.todayRecords) ? event.todayRecords : [])
    .concat(Array.isArray(event.records) ? event.records : [])

  const seen = {}
  const unique = []
  checkins.forEach((r) => {
    if (!r || !r.planId || !r.date) return
    const id = openid + '_' + r.planId + '_' + r.date
    if (seen[id]) return
    seen[id] = true
    unique.push({ docId: id, openid: openid, planId: r.planId, date: r.date, at: r.at || now })
  })

  // 分批写入，避免单次并发过高。_id 由 doc() 指定，不能出现在 data 里
  const CHUNK = 20
  for (let i = 0; i < unique.length; i += CHUNK) {
    const slice = unique.slice(i, i + CHUNK)
    await Promise.all(
      slice.map((doc) =>
        db
          .collection(COL_CHECKINS)
          .doc(doc.docId)
          .set({
            data: {
              openid: doc.openid,
              planId: doc.planId,
              date: doc.date,
              at: doc.at
            }
          })
          .catch(() => null)
      )
    )
  }

  return {
    ok: true,
    openid: openid,
    planCount: plans.length,
    recordCount: unique.length,
    pushEnabled: pushEnabled
  }
}

async function actionTestPush(openid) {
  const user = await getUser(openid)
  if (!user) {
    return { ok: false, message: '云端还没有你的数据，请先在「我的」页面点一次「立即同步到云端」' }
  }
  if (!user.templateId) {
    return { ok: false, message: '云端没有记录模板 ID，请确认 miniprogram/config.js 里填了 subscribeTemplateId' }
  }

  const fields = user.templateFields || DEFAULT_FIELDS
  const today = beijingDateText()
  try {
    await sendSubscribeMessage(
      openid,
      user.templateId,
      fields,
      {
        title: '测试提醒',
        time: beijingTimeText(),
        remark: '收到说明提醒可用'
      },
      user.subscribePage || DEFAULT_PAGE
    )
    await db
      .collection(COL_USERS)
      .doc(openid)
      .update({ data: { lastPushAt: Date.now(), needResubscribe: false } })
    return { ok: true, message: '测试提醒已发送（' + today + '），请查看微信「服务通知」' }
  } catch (err) {
    const code = err && (err.errCode || err.errcode)
    if (code === 43101) {
      await db
        .collection(COL_USERS)
        .doc(openid)
        .update({ data: { needResubscribe: true } })
        .catch(() => null)
      return { ok: false, message: '订阅次数已用完，请在「我的」页面重新授权提醒' }
    }
    return { ok: false, message: '发送失败：' + (err && err.errMsg ? err.errMsg : String(err)) }
  }
}

/* ------------------------------------------------------------------ */

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  if (!openid) {
    return { ok: false, message: '无法获取 openid，请从小程序内调用' }
  }

  await ensureCollections()

  const action = (event && event.action) || 'getState'
  try {
    if (action === 'getState') return await actionGetState(openid)
    if (action === 'sync') return await actionSync(openid, event)
    if (action === 'testPush') return await actionTestPush(openid)
    return { ok: false, message: '未知 action：' + action }
  } catch (err) {
    console.error('[checkinApi] ' + action + ' 失败', err)
    return {
      ok: false,
      message: (err && err.errMsg ? err.errMsg : String(err)) || '云函数执行失败'
    }
  }
}
