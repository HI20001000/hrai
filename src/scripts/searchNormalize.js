import * as OpenCC from 'opencc-js/core'
import * as Locale from 'opencc-js/preset/t2cn'

const toSimplified = OpenCC.ConverterBuilder(Locale)({ from: 't', to: 'cn' })

const normalizeBaseText = (value) =>
  String(value ?? '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')

export const normalizeSearchText = (value) => {
  const text = normalizeBaseText(value)
  if (!text) return ''

  try {
    return toSimplified(text)
  } catch {
    return text
  }
}
