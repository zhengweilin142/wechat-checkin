/**
 * 日期与重复规则工具
 * 约定：日期字符串统一为 'YYYY-MM-DD'，星期 0 = 周日 ... 6 = 周六
 */

function pad2(n) {
  return n < 10 ? '0' + n : '' + n
}

/** Date -> 'YYYY-MM-DD' */
function toDateStr(d) {
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate())
}

/** 'YYYY-MM-DD' -> Date（本地零点） */
function parseDateStr(s) {
  const p = String(s).split('-')
  return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]))
}

function todayStr() {
  return toDateStr(new Date())
}

function addDays(d, n) {
  const nd = new Date(d.getTime())
  nd.setDate(nd.getDate() + n)
  return nd
}

/** 日期字符串加减天数 */
function shiftDateStr(s, n) {
  return toDateStr(addDays(parseDateStr(s), n))
}

/** 0=周日 */
function weekdayOf(s) {
  return parseDateStr(s).getDay()
}

const WEEK_LABELS = ['日', '一', '二', '三', '四', '五', '六']

function weekdayLabel(s) {
  return '周' + WEEK_LABELS[weekdayOf(s)]
}

/** 两个日期相差几天（a - b） */
function diffDays(a, b) {
  const t1 = parseDateStr(a).getTime()
  const t2 = parseDateStr(b).getTime()
  return Math.round((t1 - t2) / 86400000)
}

/** 今天 / 昨天 / 2月14日 */
function humanDate(s) {
  const t = todayStr()
  const d = diffDays(s, t)
  if (d === 0) return '今天'
  if (d === -1) return '昨天'
  if (d === -2) return '前天'
  if (d === 1) return '明天'
  const dt = parseDateStr(s)
  return dt.getMonth() + 1 + '月' + dt.getDate() + '日'
}

/** 'HH:mm' -> 分钟数；非法返回 -1 */
function timeToMinutes(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''))
  if (!m) return -1
  return Number(m[1]) * 60 + Number(m[2])
}

/**
 * 时间补零成 'HH:mm'。
 * picker mode="time" 在不同平台/版本可能返回 '9:05'，统一成 '09:05'，
 * 否则云函数里按字符串比对提醒时间会漏推送。非法输入返回 ''。
 */
function padTime(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''))
  if (!m) return ''
  return pad2(Number(m[1])) + ':' + m[2]
}

/** 时间戳 -> 'HH:mm' */
function stampToTime(stamp) {
  const d = new Date(stamp)
  return pad2(d.getHours()) + ':' + pad2(d.getMinutes())
}

/** 时间戳 -> 'HH:mm:ss'（云函数里按北京时间格式化用） */
function stampToTimeSec(stamp) {
  const d = new Date(stamp)
  return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds())
}

/** 重复规则描述文案 */
function repeatText(repeat) {
  const r = repeat || { type: 'daily' }
  if (r.type === 'daily') return '每天'
  if (r.type === 'weekdays') return '工作日'
  if (r.type === 'weekend') return '周末'
  if (r.type === 'custom') {
    const days = (r.days || []).slice().sort()
    if (!days.length) return '未选择'
    if (days.length === 7) return '每天'
    if (days.length === 5 && days.join(',') === '1,2,3,4,5') return '工作日'
    return days.map((d) => WEEK_LABELS[d]).join('、')
  }
  return '每天'
}

/**
 * 判断某个打卡项在指定日期是否需要打卡。
 * 兼容「在 repeat 之外单独 set 的 startDate / endDate」。
 */
function isActiveOn(plan, dateStr) {
  if (!plan || plan.archived) return false
  if (plan.startDate && dateStr < plan.startDate) return false
  if (plan.endDate && dateStr > plan.endDate) return false

  const r = plan.repeat || { type: 'daily' }
  const wd = weekdayOf(dateStr)

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

/**
 * 生成月历矩阵（用来画打卡日历）。
 * 返回 6 行 x 7 列，每格 { date, day, inMonth, isToday, isFuture }
 */
function monthMatrix(year, month /* 1-12 */) {
  const first = new Date(year, month - 1, 1)
  const firstWeekday = first.getDay() // 0=周日
  const start = addDays(first, -firstWeekday)
  const today = todayStr()
  const rows = []
  for (let w = 0; w < 6; w++) {
    const row = []
    for (let d = 0; d < 7; d++) {
      const cur = addDays(start, w * 7 + d)
      const ds = toDateStr(cur)
      row.push({
        date: ds,
        day: cur.getDate(),
        inMonth: cur.getMonth() === month - 1,
        isToday: ds === today,
        isFuture: ds > today
      })
    }
    rows.push(row)
  }
  return rows
}

/** 最近 n 天的日期数组（含今天，按时间升序） */
function recentDays(n, endDateStr) {
  const end = endDateStr || todayStr()
  const out = []
  for (let i = n - 1; i >= 0; i--) out.push(shiftDateStr(end, -i))
  return out
}

module.exports = {
  pad2,
  toDateStr,
  parseDateStr,
  todayStr,
  addDays,
  shiftDateStr,
  weekdayOf,
  WEEK_LABELS,
  weekdayLabel,
  diffDays,
  humanDate,
  timeToMinutes,
  padTime,
  stampToTime,
  stampToTimeSec,
  repeatText,
  isActiveOn,
  monthMatrix,
  recentDays
}
