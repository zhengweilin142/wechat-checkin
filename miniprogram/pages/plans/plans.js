const store = require('../../utils/store')
const dateUtil = require('../../utils/date')
const ui = require('../../utils/ui')
const cloud = require('../../utils/cloud')

Page({
  data: {
    list: [],
    total: 0
  },

  onShow() {
    this.refresh()
  },

  refresh() {
    const today = dateUtil.todayStr()
    const monthStart = today.slice(0, 8) + '01'
    const list = store.getPlans().map((p) => {
      const color = p.color || '#3b7cff'
      const rec = store.getPlanRecords(p.id)
      const totalChecks = Object.keys(rec).length
      const month = store.rangeStats(p.id, monthStart, today)
      const meta = []
      meta.push(dateUtil.repeatText(p.repeat))
      if (p.remindEnabled !== false && p.remindTime) meta.push('⏰ ' + p.remindTime)
      meta.push('本月 ' + month.done + '/' + month.total)
      meta.push('累计 ' + totalChecks + ' 次')
      return {
        id: p.id,
        plan: p,
        softColor: ui.softBg(color),
        streak: store.currentStreak(p.id),
        metaText: meta.join(' · ')
      }
    })
    this.setData({ list: list, total: list.length })
  },

  onAdd() {
    wx.navigateTo({ url: '/pages/plan-edit/plan-edit' })
  },

  onEdit(e) {
    wx.navigateTo({ url: '/pages/plan-edit/plan-edit?id=' + e.currentTarget.dataset.id })
  },

  onDelete(e) {
    const id = e.currentTarget.dataset.id
    const plan = store.getPlan(id)
    if (!plan) return
    wx.showModal({
      title: '删除打卡项',
      content: '「' + plan.name + '」及其全部打卡记录都会被删除，且无法恢复。',
      confirmText: '删除',
      confirmColor: '#ff5c5c',
      success: (res) => {
        if (!res.confirm) return
        store.removePlan(id)
        this.refresh()
        if (cloud.ready()) cloud.syncNow().catch(() => {})
        wx.showToast({ title: '已删除', icon: 'none' })
      }
    })
  }
})
