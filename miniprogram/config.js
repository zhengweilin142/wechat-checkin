/**
 * 全局配置 —— 首次运行前请把下面两项填好
 *
 * cloudEnv：云开发环境 ID。
 *   微信开发者工具 → 云开发 → 设置 → 环境 ID（形如 release-1g9xxxxx）。
 *   留空表示「不使用云开发」，小程序会退化成纯本地版本（提醒只能在打开小程序时看到）。
 *
 * subscribeTemplateId：订阅消息模板 ID。
 *   微信公众平台 → 功能 → 订阅消息 → 公共模板库 → 搜索「打卡提醒」→ 选用。
 *   选用后把模板 ID 填到这里，并确认下方 TEMPLATE_FIELDS 与模板里的字段一致。
 */
const config = {
  // 基础库版本要求：>= 2.2.3（云开发），订阅消息要求 >= 2.4.4
  cloudEnv: '',
  subscribeTemplateId: '',

  // 是否启用云开发同步 / 定时提醒能力
  enableCloud: true,

  /**
   * 订阅消息模板字段映射。
   * 打开微信公众平台的模板详情，能看到类似：
   *   打卡项目  {{thing1.DATA}}
   *   提醒时间  {{time2.DATA}}
   *   温馨提示  {{thing3.DATA}}
   * 把 key 换成你自己的字段编号即可（字段类型必须匹配，thing 类最多 20 个字符）。
   */
  templateFields: {
    title: 'thing4',
    time: 'time24',
    remark: 'thing13'
  },

  // 云函数名称（如需改名，记得同步 cloudfunctions 下的目录名）
  apiFunctionName: 'checkinApi',

  // 订阅消息点击后跳转的小程序页面
  subscribePage: 'pages/index/index',

  // 自动补充订阅次数的节流间隔（毫秒），默认 6 小时
  autoSubscribeInterval: 6 * 60 * 60 * 1000
}

module.exports = config
