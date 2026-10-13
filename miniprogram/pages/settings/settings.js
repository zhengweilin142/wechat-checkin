const store = require('../../utils/store')
const dateUtil = require('../../utils/date')
const cloud = require('../../utils/cloud')
const config = require('../../config')

const VERSION = '1.0.0'

function prettyTime(stamp) {
  if (!stamp) return '从未'
  const d = new Date(stamp)
  return (
    d.getMonth() +
    1 +
    '月' +
    d.getDate() +
    '日 ' +
    dateUtil.pad2(d.getHours()) +
    ':' +
    dateUtil.pad2(d.getMinutes())
  )
}

Page({
  data: {
    version: VERSION,

    cloudReady: false,
    cloudError: '',
    envId: '',
    openid: '',
    lastSyncText: '从未',
    cloudState: null,
    cloudPlanCount: 0,
    lastPushText: '—',
    syncing: false,

    pushEnabled: false,
    needResubscribe: false,
    autoSubscribe: true,
    vibrate: true,
    templateReady: false,
    remindPlanCount: 0,

    planCount: 0,
    recordCount: 0
  },

  onShow() {
    this.refresh()
  },

  refresh() {
    const app = getApp()
    const g = (app && app.globalData) || {}
    const s = store.getSettings()

    let recordCount = 0
    const rec = store.getRecords()
    Object.keys(rec).forEach((pid) => {
      recordCount += Object.keys(rec[pid] || {}).length
    })

    const remindPlanCount = store
      .getPlans()
      .filter((p) => p.remindEnabled !== false && !!p.remindTime).length

    const cs = this.data.cloudState

    this.setData({
      cloudReady: !!g.cloudReady,
      cloudError: g.cloudError || '',
      envId: config.cloudEnv || '（未填写）',
      openid: g.openid || '',
      lastSyncText: prettyTime(s.lastSyncAt),
      cloudPlanCount: cs ? cs.planCount || 0 : 0,
      lastPushText: cs ? prettyTime(cs.lastPushAt) : '—',
      pushEnabled: !!s.pushEnabled,
      needResubscribe: !!s.needResubscribe,
      autoSubscribe: !!s.autoSubscribe,
      vibrate: !!s.vibrate,
      templateReady: !!config.subscribeTemplateId,
      remindPlanCount: remindPlanCount,
      planCount: store.getPlans().length,
      recordCount: recordCount
    })
  },

  /* ---------------- 提醒 ---------------- */

  onSubscribe() {
    if (!config.subscribeTemplateId) {
      wx.showModal({
        title: '还没配置模板',
        content:
          '请先在微信公众平台申请「打卡提醒」订阅消息模板，把模板 ID 填到 miniprogram/config.js 的 subscribeTemplateId 里。',
        showCancel: false
      })
      return
    }
    if (!cloud.ready()) {
      wx.showToast({ title: '请先配置云开发', icon: 'none' })
      return
    }
    cloud
      .subscribeByUser()
      .then((res) => {
        if (res.accepted) {
          wx.showToast({ title: '提醒已开启', icon: 'success' })
        } else {
          wx.showToast({ title: '未授权，收不到提醒', icon: 'none' })
        }
        this.refresh()
      })
      .catch((err) => {
        wx.showModal({ title: '授权失败', content: cloud.errText(err), showCancel: false })
      })
  },

  onTestPush() {
    if (!cloud.ready()) {
      wx.showToast({ title: '云开发未就绪', icon: 'none' })
      return
    }
    wx.showLoading({ title: '发送中' })
    cloud
      .sendTestPush()
      .then((res) => {
        wx.hideLoading()
        wx.showModal({
          title: '发送结果',
          content:
            (res && res.message) ||
            '已发送，请留意微信「服务通知」。若没收到，多半是订阅额度用完了，重新授权一次即可。',
          showCancel: false
        })
        this.refresh()
      })
      .catch((err) => {
        wx.hideLoading()
        wx.showModal({ title: '发送失败', content: cloud.errText(err), showCancel: false })
      })
  },

  onToggleAutoSubscribe(e) {
    store.saveSettings({ autoSubscribe: e.detail.value })
    this.refresh()
  },

  onToggleVibrate(e) {
    store.saveSettings({ vibrate: e.detail.value })
    this.refresh()
  },

  /* ---------------- 云同步 ---------------- */

  onSyncNow() {
    if (!cloud.ready()) {
      wx.showModal({
        title: '云开发未就绪',
        content:
          (this.data.cloudError || '未知原因') +
          '\n\n请参考项目根目录 README.md 完成云开发配置，并部署 cloudfunctions 下的云函数。',
        showCancel: false
      })
      return
    }
    if (this.data.syncing) return
    this.setData({ syncing: true })
    wx.showLoading({ title: '同步中' })
    cloud
      .syncNow()
      .then(() => cloud.fetchState())
      .then((state) => {
        wx.hideLoading()
        this.setData({ syncing: false, cloudState: state })
        this.refresh()
        wx.showToast({ title: '同步成功', icon: 'success' })
      })
      .catch((err) => {
        wx.hideLoading()
        this.setData({ syncing: false })
        wx.showModal({ title: '同步失败', content: cloud.errText(err), showCancel: false })
      })
  },

  /* ---------------- 数据 ---------------- */

  onExport() {
    const data = JSON.stringify(store.exportAll())
    wx.setClipboardData({
      data: data,
      success: () => {
        wx.showModal({
          title: '已复制到剪贴板',
          content:
            '共导出 ' + store.getPlans(true).length + ' 个打卡项。建议粘贴到备忘录或电脑上保存。',
          showCancel: false
        })
      },
      fail: () => wx.showToast({ title: '复制失败', icon: 'none' })
    })
  },

  onImport() {
    wx.getClipboardData({
      success: (res) => {
        let parsed = null
        try {
          parsed = JSON.parse(res.data)
        } catch (e) {
          wx.showToast({ title: '剪贴板不是有效数据', icon: 'none' })
          return
        }
        if (!parsed || parsed.app !== 'checkin-assistant' || !Array.isArray(parsed.plans)) {
          wx.showToast({ title: '数据格式不匹配', icon: 'none' })
          return
        }
        wx.showActionSheet({
          itemList: ['合并导入（保留现有数据）', '覆盖导入（清空后导入）'],
          success: (r) => {
            const mode = r.tapIndex === 0 ? 'merge' : 'replace'
            try {
              store.importAll(parsed, mode)
              this.refresh()
              if (cloud.ready()) cloud.syncNow().catch(() => {})
              wx.showToast({ title: '导入成功', icon: 'success' })
            } catch (err) {
              wx.showModal({
                title: '导入失败',
                content: err && err.message ? err.message : '未知错误',
                showCancel: false
              })
            }
          }
        })
      },
      fail: () => wx.showToast({ title: '读取剪贴板失败', icon: 'none' })
    })
  },

  onRestoreSamples() {
    wx.showModal({
      title: '恢复示例数据',
      content: '会新增 4 个示例打卡项（不会删除你已有的数据）。',
      success: (res) => {
        if (!res.confirm) return
        store.seedSamples()
        this.refresh()
        wx.showToast({ title: '已恢复示例', icon: 'none' })
      }
    })
  },

  onClearAll() {
    wx.showModal({
      title: '清空所有数据',
      content: '所有打卡项和打卡记录都会被删除，且无法恢复。建议先导出备份。',
      confirmText: '清空',
      confirmColor: '#ff5c5c',
      success: (res) => {
        if (!res.confirm) return
        store.clearAll()
        this.refresh()
        wx.showToast({ title: '已清空', icon: 'none' })
      }
    })
  },

  onCopyOpenid() {
    if (!this.data.openid) return
    wx.setClipboardData({ data: this.data.openid })
  },

  onAbout() {
    wx.showModal({
      title: '关于打卡助手',
      content:
        'v' +
        VERSION +
        '\n\n打卡数据保存在手机本地，开启云开发后会同步到你的微信云环境，仅你自己可见。\n提醒依赖微信订阅消息：一次性订阅每授权一次只能推送一条，建议在弹窗里勾选「总是保持以上选择」，之后小程序会自动帮你补充次数。',
      showCancel: false
    })
  }
})
