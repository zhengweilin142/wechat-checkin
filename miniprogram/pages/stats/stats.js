const store = require('../../utils/store')
const dateUtil = require('../../utils/date')
const ui = require('../../utils/ui')

const LEVEL_STYLE = {
  '-1': { bg: '#f7f8fb', color: '#c8cedb' },
  0: { bg: '#eef1f7', color: '#9aa0ac' },
  1: { bg: 'rgba(34,197,94,0.20)', color: '#15803d' },
  2: { bg: 'rgba(34,197,94,0.45)', color: '#14532d' },
  3: { bg: 'rgba(34,197,94,0.72)', color: '#ffffff' },
  4: { bg: '#22c55e', color: '#ffffff' }
}

function levelOf(done, total) {
  if (!total) return -1
  if (!done) return 0
  const r = done / total
  if (r >= 1) return 4
  if (r >= 0.67) return 3
  if (r >= 0.34) return 2
  return 1
}

Page({
  data: {
    plans: [],
    planPickerLabels: [],
    planIndex: 0,
    scopeLabel: '全部打卡项',

    overview: null,

    weekBars: [],
    weekRangeText: '',

    monthCursor: '',
    monthTitle: '',
    canGoNext: false,
    weeks: [],
    monthSummary: '',

    planRows: [],
    hasData: false
  },

  onLoad() {
    this.setData({ monthCursor: dateUtil.todayStr().slice(0, 7) })
  },

  onShow() {
    this.refresh()
  },

  onPullDownRefresh() {
    this.refresh()
    wx.stopPullDownRefresh()
  },

  refresh() {
    const plans = store.getPlans()
    const labels = ['全部打卡项'].concat(plans.map((p) => p.emoji + ' ' + p.name))
    let planIndex = this.data.planIndex
    if (planIndex < 0 || planIndex >= labels.length) planIndex = 0

    // setData 后 this.data 会同步更新，后面可以直接读
    this.setData({
      plans: plans,
      planPickerLabels: labels,
      planIndex: planIndex,
      scopeLabel: labels[planIndex],
      overview: store.overview(),
      hasData: plans.length > 0
    })

    this.render(this.currentPlanId())
    this.buildPlanRows()
  },

  currentPlanId() {
    const idx = this.data.planIndex
    if (idx <= 0) return ''
    const p = this.data.plans[idx - 1]
    return p ? p.id : ''
  },

  onScopeChange(e) {
    const planIndex = Number(e.detail.value)
    this.setData({
      planIndex: planIndex,
      scopeLabel: this.data.planPickerLabels[planIndex]
    })
    this.render(this.currentPlanId())
  },

  /** 近 7 天柱状图 + 月历热力，一次批量算完，避免几百次同步读 */
  render(planId) {
    const today = dateUtil.todayStr()
    const days = dateUtil.recentDays(7)

    const cursor = this.data.monthCursor || today.slice(0, 7)
    const year = Number(cursor.slice(0, 4))
    const month = Number(cursor.slice(5, 7))
    const matrix = dateUtil.monthMatrix(year, month)

    const monthDates = []
    matrix.forEach((row) =>
      row.forEach((cell) => {
        if (cell.inMonth) monthDates.push(cell.date)
      })
    )

    const statsMap = store.dayStatsBatch(days.concat(monthDates), planId)

    /* ---- 近 7 天 ---- */
    const bars = days.map((ds) => {
      const s = statsMap[ds] || { total: 0, done: 0, percent: 0 }
      return {
        date: ds,
        label: dateUtil.WEEK_LABELS[dateUtil.weekdayOf(ds)],
        day: Number(ds.slice(8, 10)),
        done: s.done,
        total: s.total,
        percent: s.percent,
        height: s.total ? Math.max(8, s.percent) : 4,
        isToday: ds === today,
        isFull: s.total > 0 && s.done >= s.total
      }
    })

    /* ---- 月历 ---- */
    let mDone = 0
    let mTotal = 0
    const weeks = matrix.map((row, wi) => ({
      key: 'w' + wi,
      cells: row.map((cell) => {
        const s = cell.inMonth
          ? statsMap[cell.date] || { total: 0, done: 0, percent: 0 }
          : { total: 0, done: 0, percent: 0 }
        if (cell.inMonth) {
          mDone += s.done
          mTotal += s.total
        }
        const style = LEVEL_STYLE[String(levelOf(s.done, s.total))]
        return {
          date: cell.date,
          day: cell.day,
          inMonth: cell.inMonth,
          isToday: cell.isToday,
          isFuture: cell.isFuture,
          done: s.done,
          total: s.total,
          bg: style.bg,
          color: cell.inMonth ? style.color : '#d5dae4'
        }
      })
    }))

    this.setData({
      weekBars: bars,
      weekRangeText: days[0].slice(5).replace('-', '/') + ' - ' + days[6].slice(5).replace('-', '/'),
      weeks: weeks,
      monthTitle: year + ' 年 ' + month + ' 月',
      canGoNext: cursor < today.slice(0, 7),
      monthSummary: mTotal
        ? '本月完成 ' +
          mDone +
          ' / ' +
          mTotal +
          ' 项，完成率 ' +
          Math.round((mDone * 100) / mTotal) +
          '%'
        : '本月没有需要打卡的项目'
    })
  },

  buildPlanRows() {
    const today = dateUtil.todayStr()
    const monthStart = today.slice(0, 8) + '01'
    const rows = store.getPlans().map((p) => {
      const s = store.rangeStats(p.id, monthStart, today)
      const color = p.color || '#3b7cff'
      return {
        id: p.id,
        name: p.name,
        emoji: p.emoji,
        softColor: ui.softBg(color),
        color: color,
        done: s.done,
        total: s.total,
        percent: s.percent,
        streak: store.currentStreak(p.id),
        best: store.bestStreak(p.id)
      }
    })
    this.setData({ planRows: rows })
  },

  shiftMonth(delta) {
    const cursor = this.data.monthCursor || dateUtil.todayStr().slice(0, 7)
    let year = Number(cursor.slice(0, 4))
    let month = Number(cursor.slice(5, 7)) + delta
    if (month < 1) {
      month = 12
      year--
    } else if (month > 12) {
      month = 1
      year++
    }
    const next = year + '-' + dateUtil.pad2(month)
    if (next > dateUtil.todayStr().slice(0, 7)) return
    this.setData({ monthCursor: next })
    this.render(this.currentPlanId())
  },

  onPrevMonth() {
    this.shiftMonth(-1)
  },

  onNextMonth() {
    this.shiftMonth(1)
  },

  /** 点日历格子看当天明细 */
  onCellTap(e) {
    const ds = e.currentTarget.dataset.date
    if (!ds) return

    const planId = this.currentPlanId()
    let content = ''

    if (planId) {
      const plan = store.getPlan(planId)
      if (!plan || !dateUtil.isActiveOn(plan, ds)) {
        content = '这天不需要打卡'
      } else if (store.isChecked(planId, ds)) {
        content = '已完成，打卡时间 ' + dateUtil.stampToTime(store.checkTime(planId, ds))
      } else {
        content = '未打卡'
      }
    } else {
      const list = store.activePlansOn(ds)
      if (!list.length) {
        content = '这天没有需要打卡的项目'
      } else {
        content = list
          .map((p) => (store.isChecked(p.id, ds) ? '✅ ' : '⬜️ ') + p.emoji + ' ' + p.name)
          .join('\n')
      }
    }

    wx.showModal({
      title: dateUtil.humanDate(ds) + '（' + ds + '）',
      content: content,
      showCancel: false,
      confirmText: '知道了'
    })
  }
})
