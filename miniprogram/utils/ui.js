/** 界面用的小工具与配色方案 */

const EMOJIS = [
  '✅', '🌅', '💧', '🏃', '📖', '🧘', '🥗', '😴', '💪', '🚶',
  '✍️', '🎧', '🧹', '💰', '🌱', '🎹', '🖌️', '🦷', '🧴', '☀️',
  '🌙', '🍎', '🚭', '📝', '🧠', '🏊', '🚴', '🍵', '🐶', '🎯'
]

const COLORS = [
  { name: '蓝', value: '#3b7cff' },
  { name: '绿', value: '#22c55e' },
  { name: '橙', value: '#ff9f0a' },
  { name: '紫', value: '#a855f7' },
  { name: '红', value: '#ff5c5c' },
  { name: '青', value: '#06b6d4' },
  { name: '粉', value: '#ec4899' },
  { name: '灰蓝', value: '#64748b' }
]

const TIME_PRESETS = [
  { label: '07:00', value: '07:00' },
  { label: '08:00', value: '08:00' },
  { label: '09:00', value: '09:00' },
  { label: '12:00', value: '12:00' },
  { label: '18:00', value: '18:00' },
  { label: '20:00', value: '20:00' },
  { label: '21:30', value: '21:30' },
  { label: '22:30', value: '22:30' }
]

function hexToRgb(hex) {
  let h = String(hex || '').replace('#', '').trim()
  if (h.length === 3) {
    h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
  }
  if (h.length !== 6 || /[^0-9a-fA-F]/.test(h)) return { r: 59, g: 124, b: 255 }
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16)
  }
}

/** '#3b7cff' + 0.12 -> 'rgba(59,124,255,0.12)' */
function hexToRgba(hex, alpha) {
  const c = hexToRgb(hex)
  const a = alpha === undefined ? 1 : alpha
  return 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + a + ')'
}

/** 卡片上的浅色底 */
function softBg(hex) {
  return hexToRgba(hex, 0.12)
}

module.exports = {
  EMOJIS,
  COLORS,
  TIME_PRESETS,
  hexToRgb,
  hexToRgba,
  softBg
}
