const config = require('./config')
const store = require('./utils/store')
const cloud = require('./utils/cloud')

App({
  globalData: {
    /** 云开发是否可用 */
    cloudReady: false,
    cloudError: '',
    envId: config.cloudEnv || '',
    openid: '',
    /** 从「我的」页面点开订阅说明后置位，首页会提示一次 */
    pendingResubscribe: false,
    systemInfo: null
  },

  onLaunch() {
    store.init()
    this.initSystemInfo()
    this.initCloud()
  },

  onShow() {
    // 回到前台时，如果开启了自动补订阅，静默补充一次订阅额度
    if (!this.globalData.cloudReady) return
    setTimeout(() => {
      cloud.autoSubscribe().catch(() => {})
    }, 1200)
  },

  initSystemInfo() {
    try {
      const info = wx.getWindowInfo
        ? Object.assign({}, wx.getWindowInfo(), wx.getDeviceInfo ? wx.getDeviceInfo() : {})
        : wx.getSystemInfoSync()
      this.globalData.systemInfo = info
    } catch (e) {
      this.globalData.systemInfo = null
    }
  },

  initCloud() {
    const g = this.globalData
    if (!config.enableCloud) {
      g.cloudError = '未启用云开发（config.js 中 enableCloud = false）'
      return
    }
    if (!config.cloudEnv) {
      g.cloudError = '未填写云开发环境 ID，当前为纯本地模式'
      return
    }
    if (!wx.cloud) {
      g.cloudError = '当前基础库不支持云开发，请把基础库调整到 2.2.3 以上'
      return
    }
    try {
      wx.cloud.init({ env: config.cloudEnv, traceUser: true })
      g.cloudReady = true
    } catch (e) {
      g.cloudError = '云开发初始化失败：' + (e && e.message ? e.message : e)
      return
    }
    // 拿到 openid，方便调试与云函数侧对账
    cloud
      .call('getState')
      .then((res) => {
        if (res && res.openid) g.openid = res.openid
      })
      .catch((err) => {
        g.cloudError = '云函数调用失败，请确认已上传部署 cloudfunctions：' + cloud.errText(err)
      })
  }
})
