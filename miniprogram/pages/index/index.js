const store = require('../../utils/store')
const dateUtil = require('../../utils/date')
const cloud = require('../../utils/cloud')
const ui = require('../../utils/ui')
const config = require('../../config')

function greetingOf(hour) {
  if (hour < 5) return '夜深了，早点休息 🌙'
  if (hour < 9) return '早上好，新的一天开始啦 ☀️'
  if (hour < 12) return '上午好，保持节奏 💪'
  if (hour < 14) return '中午好，记得休息一下 🍚'
  if (hour < 18) return '下午好，继续加油 🚀'
  if (hour < 23) return '晚上好，今天做得怎么样？🌆'
  return '夜深了，别忘了收尾 🌙'
}

Page({
  data: {
    dateStr: '',
    humanDate: '',
    weekday: '',
    greeting: '',
    list: [],
    stats: { total: 0, done: 0, percent: 0 },
    allDone: false,
    tip: '',
    cloudReady: false,
    needResubscribe: false,
    showBanner: false
  },

  onLoad() {
    this.refresh()
  },

  onShow() {
    this.refresh()
  },

  onPullDownRefresh() {
    this.refresh()
    wx.stopPullDownRefresh()
  },

  refresh() {
    const ds = dateUtil.todayStr()
    const raw = store.todayList(ds)
    const list = raw.map((it) => ({
      id: it.id,
      plan: it.plan,
      active: it.active,
      checked: it.checked,
      checkedTime: it.checkedAt ? dateUtil.stampToTime(it.checkedAt) : '',
      repeatText: dateUtil.repeatText(it.plan.repeat),
      streak: store.currentStreak(it.id),
      color: it.plan.color || '#3b7cff',
      softColor: ui.softBg(it.plan.color || '#3b7cff')
    }))

    const stats = store.dayStats(ds)
    const allDone = stats.total > 0 && stats.done >= stats.total
    let tip = ''
    if (!stats.total) tip = '还没有打卡项，点右下角「＋」添加一个'
    else if (allDone) tip = '今天全部完成，给自己一个赞 🎉'
    else tip = '还差 ' + (stats.total - stats.done) + ' 项就完成今天的任务'

    const settings = store.getSettings()
    const now = new Date()

    this.setData({
      dateStr: ds,
      humanDate: dateUtil.humanDate(ds),
      weekday: dateUtil.weekdayLabel(ds),
      greeting: greetingOf(now.getHours()),
      list: list,
      stats: stats,
      allDone: allDone,
      tip: tip,
      cloudReady: cloud.ready(),
      needResubscribe: !!settings.needResubscribe,
      showBanner: !!settings.needResubscribe || (!cloud.ready() && !!config.cloudEnv)
    })
  },

  onToggle(e) {
    const index = e.currentTarget.dataset.index
    const item = this.data.list[index]
    if (!item) return
    if (!item.active) {
      wx.showToast({ title: '今天不需要打卡', icon: 'none' })
      return
    }

    if (item.checked) {
      wx.showModal({
        title: '取消打卡',
        content: '确定要取消「' + item.plan.name + '」今天的打卡吗？',
        confirmText: '取消打卡',
        confirmColor: '#ff5c5c',
        success: (res) => {
          if (!res.confirm) return
          store.uncheck(item.id, this.data.dateStr)
          this.afterChange()
        }
      })
      return
    }

    store.check(item.id, this.data.dateStr)
    const settings = store.getSettings()
    if (settings.vibrate) {
      try {
        wx.vibrateShort({ type: 'medium' })
      } catch (err) {
        /* 部分机型不支持，忽略 */
      }
    }
    // 打卡是明确的用户点击手势，此刻申请订阅授权一定能弹出面板
    cloud.autoSubscribe()
    this.afterChange()
  },

  afterChange() {
    const prevDone = this.data.stats.done
    const prevTotal = this.data.stats.total
    this.refresh()
    const now = this.data.stats
    if (now.total > 0 && now.done >= now.total && prevDone < prevTotal) {
      wx.showToast({ title: '今日全部完成 🎉', icon: 'none' })
    }
    this.pushToCloud()
  },

  /** 本地一变就异步同步到云端，失败不打扰用户 */
  pushToCloud() {
    if (!cloud.ready()) return
    cloud.syncNow().catch(() => {})
  },

  goDetail(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: '/pages/plan-edit/plan-edit?id=' + id })
  },

  goPlans() {
    wx.navigateTo({ url: '/pages/plans/plans' })
  },

  goAdd() {
    wx.navigateTo({ url: '/pages/plan-edit/plan-edit' })
  },

  onBannerTap() {
    if (!cloud.ready()) {
      wx.showModal({
        title: '云开发未就绪',
        content:
          '提醒需要在 miniprogram/config.js 里填写云开发环境 ID，并上传部署 cloudfunctions。详见项目根目录 README.md。',
        showCancel: false
      })
      return
    }
    cloud
      .subscribeByUser()
      .then((res) => {
        if (res.accepted) {
          wx.showToast({ title: '提醒已开启', icon: 'success' })
          store.saveSettings({ needResubscribe: false })
        } else {
          wx.showToast({ title: '未授权，无法收到提醒', icon: 'none' })
        }
        this.refresh()
      })
      .catch((err) => {
        wx.showModal({ title: '开启失败', content: cloud.errText(err), showCancel: false })
      })
  }
})
