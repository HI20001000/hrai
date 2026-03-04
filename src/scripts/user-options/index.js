const defaultUserIcon = '🙂'
const defaultUserIconBg = '#e2e8f0'

export const normalizeUserOption = (user = {}) => {
  const mail = user?.mail || ''
  const username =
    user?.username ||
    user?.name ||
    user?.display_name ||
    user?.nickname ||
    (mail ? mail.split('@')[0] : '') ||
    'user'
  return {
    ...user,
    mail,
    username,
    icon: user?.icon || defaultUserIcon,
    icon_bg: user?.icon_bg || user?.iconBg || defaultUserIconBg,
  }
}

export const normalizeUserOptions = (users = []) =>
  Array.isArray(users) ? users.map((user) => normalizeUserOption(user)) : []

export const filterUserOptions = (users = [], query = '') => {
  const normalized = normalizeUserOptions(users)
  const keyword = query.trim().toLowerCase()
  if (!keyword) return normalized
  return normalized.filter((user) =>
    `${user.username || ''}${user.mail || ''}`.toLowerCase().includes(keyword)
  )
}

