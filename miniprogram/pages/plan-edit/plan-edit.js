const store = require('../../utils/store')
const dateUtil = require('../../utils/date')
const ui = require('../../utils/ui')
const cloud = require('../../utils/cloud')
const config = require('../../config')

const REPEAT_OPTIONS = [
  { type: 'daily', label: '每天' },
  { type: 'weekdays', label: '工作日' },
  { type: 'weekend', label: '周末' },
  { type: 'custom', label: '自定义' }
]

/** WXML 里不能调用方法，星期选中态只能提前算好 */
function buildWeekCells(selected) {
  const days = selected || []
  return dateUtil.WEEK_LABELS.map((label, day) => ({
    day: day,
    label: label,
    active: days.indexOf(day) >= 0
  }))
}

Page({
  data: {
    id: '',
    isEdit: false,

    name: '',
    emoji: '✅',
    color: '#3b7cff',
    remindTime: '09:00',
    remindEnabled: true,
    repeatType: 'daily',
    customDays: [1, 2, 3, 4, 5],
    note: '',

    emojis: ui.EMOJIS,
    colors: ui.COLORS,
    timePresets: ui.TIME_PRESETS,
    weekCells: buildWeekCells([1, 2, 3, 4, 5]),
    repeatOptions: REPEAT_OPTIONS,

    softColor: ui.softBg('#3b7cff'),

    cloudenvReady: false,
    templateReady: false,
    saving: false
  },

  onLoad(options) {
    const app = getApp()
    const id = (options && options.id) || ''

    if (id) {
      const plan = store.getPlan(id)
      if (!plan) {
        wx.showToast({ title: '打卡项不存在', icon: 'none' })
        setTimeout(() => wx.navigateBack(), 800)
        return
      }
      const repeat = plan.repeat || { type: 'daily' }
      const customDays =
        repeat.days && repeat.days.length ? repeat.days.slice() : [1, 2, 3, 4, 5]
      wx.setNavigationBarTitle({ title: '编辑打卡项' })
      this.setData({
        id: id,
        isEdit: true,
        name: plan.name || '',
        emoji: plan.emoji || '✅',
        color: plan.color || '#3b7cff',
        remindTime: plan.remindTime || '09:00',
        remindEnabled: plan.remindEnabled !== false,
        repeatType: repeat.type || 'daily',
        customDays: customDays,
        weekCells: buildWeekCells(customDays),
        note: plan.note || '',
        softColor: ui.softBg(plan.color || '#3b7cff'),
        cloudenvReady: cloud.ready(),
        templateReady: !!config.subscribeTemplateId
      })
    } else {
      wx.setNavigationBarTitle({ title: '新建打卡项' })
      this.setData({
        cloudenvReady: cloud.ready(),
        templateReady: !!config.subscribeTemplateId
      })
    }

    if (app && app.globalData) {
      this.setData({ cloudenvReady: !!app.globalData.cloudReady })
    }
  },

  onNameInput(e) {
    this.setData({ name: e.detail.value })
  },

  onNoteInput(e) {
    this.setData({ note: e.detail.value })
  },

  onPickEmoji(e) {
    this.setData({ emoji: e.currentTarget.dataset.emoji })
  },

  onPickColor(e) {
    const color = e.currentTarget.dataset.color
    this.setData({ color: color, softColor: ui.softBg(color) })
  },

  onTimeChange(e) {
    this.setData({ remindTime: e.detail.value, remindEnabled: true })
  },

  onPickPreset(e) {
    this.setData({ remindTime: e.currentTarget.dataset.time, remindEnabled: true })
  },

  onRemindToggle(e) {
    this.setData({ remindEnabled: e.detail.value })
  },

  onRepeatChange(e) {
    this.setData({ repeatType: e.currentTarget.dataset.type })
  },

  onToggleDay(e) {
    const day = Number(e.currentTarget.dataset.day)
    const days = this.data.customDays.slice()
    const idx = days.indexOf(day)
    if (idx >= 0) days.splice(idx, 1)
    else days.push(day)
    days.sort()
    this.setData({ customDays: days, weekCells: buildWeekCells(days) })
  },

  buildRepeat() {
    const t = this.data.repeatType
    if (t === 'custom') {
      return { type: 'custom', days: this.data.customDays.slice().sort() }
    }
    return { type: t, days: [0, 1, 2, 3, 4, 5, 6] }
  },

  onSave() {
    if (this.data.saving) return
    const name = (this.data.name || '').trim()
    if (!name) {
      wx.showToast({ title: '请填写打卡项名称', icon: 'none' })
      return
    }
    if (this.data.repeatType === 'custom' && !this.data.customDays.length) {
      wx.showToast({ title: '请至少选择一天', icon: 'none' })
      return
    }

    const payload = {
      name: name,
      emoji: this.data.emoji,
      color: this.data.color,
      remindTime: dateUtil.padTime(this.data.remindTime),
      remindEnabled: this.data.remindEnabled,
      repeat: this.buildRepeat(),
      note: (this.data.note || '').trim()
    }

    this.setData({ saving: true })

    if (this.data.isEdit) {
      store.updatePlan(this.data.id, payload)
    } else {
      store.createPlan(payload)
    }

    const done = (msg) => {
      wx.showToast({ title: msg, icon: 'success' })
      setTimeout(() => wx.navigateBack(), 600)
    }

    // 新增了带提醒的打卡项但还没授权订阅消息时，顺手申请一次授权
    const needSubscribe =
      payload.remindEnabled && this.data.cloudenvReady && this.data.templateReady

    const finish = () => {
      if (cloud.ready()) cloud.syncNow().catch(() => {})
      done(this.data.isEdit ? '已保存' : '已创建')
    }

    if (needSubscribe && !store.getSettings().pushEnabled) {
      cloud
        .subscribeByUser()
        .then(finish)
        .catch(() => {
          wx.showToast({ title: '已保存，提醒未授权', icon: 'none' })
          setTimeout(() => wx.navigateBack(), 900)
        })
    } else {
      finish()
    }
  },

  onDelete() {
    if (!this.data.isEdit) return
    wx.showModal({
      title: '删除打卡项',
      content: '「' + this.data.name + '」及其全部打卡记录都会被删除，且无法恢复。',
      confirmText: '删除',
      confirmColor: '#ff5c5c',
      success: (res) => {
        if (!res.confirm) return
        store.removePlan(this.data.id)
        if (cloud.ready()) cloud.syncNow().catch(() => {})
        wx.showToast({ title: '已删除', icon: 'none' })
        setTimeout(() => wx.navigateBack(), 600)
      }
    })
  }
})
