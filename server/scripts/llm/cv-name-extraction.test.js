import assert from 'node:assert/strict'
import test from 'node:test'

import {
  applyCandidateFullNameResolution,
  extractCandidateNameFromFileName,
} from './cv-extractor.js'
import {
  extractCandidateInfoByRegexText,
  extractCandidateNameFromText,
  isLikelyCandidateName,
} from './parsers.js'

const splitNameLabelCvText = [
  '个人简历',
  '【基本信息】',
  '姓',
  '名',
  '丁洁',
  '性',
  '别',
  '女',
  '工作年限',
  '7',
  '【自我评价】',
  '工作以来参与过多个银行项目，擅长Oracle/Hive/MySQL 等数据库',
].join('\n')

test('extracts candidate name from split Chinese name label', () => {
  assert.equal(extractCandidateNameFromText(splitNameLabelCvText), '丁洁')
  assert.equal(extractCandidateInfoByRegexText(splitNameLabelCvText).extracted.fullName, '丁洁')
})

test('does not treat self-evaluation or technical stack sentence as a name', () => {
  const sentence = '工作以来参与过多个银行项目，擅长Oracle/Hive/MySQL 等数据库'

  assert.equal(isLikelyCandidateName(sentence), false)
  assert.equal(isLikelyCandidateName('具备多干系人'), false)
  assert.equal(extractCandidateNameFromText(sentence), '')
})

test('extracts candidate name from simple hyphenated BOSS file name', () => {
  assert.equal(
    extractCandidateNameFromFileName('丁洁-数据库开发工程师-10年以上-Boss-20260602.pdf'),
    '丁洁'
  )
})

test('overrides wrong LLM fullName when CV text contains a high-confidence name', () => {
  const resolved = applyCandidateFullNameResolution(
    {
      extracted: {
        fullName: '工作以来参与过多个银行项目，擅长Oracle',
        profile: {},
      },
      missingFields: [],
    },
    splitNameLabelCvText,
    '丁洁-数据库开发工程师-10年以上-Boss-20260602.pdf'
  )

  assert.equal(resolved.extracted.fullName, '丁洁')
  assert.equal(resolved.missingFields.includes('fullName'), false)
})

test('uses file name when current extracted fullName is not credible and text has no name', () => {
  const resolved = applyCandidateFullNameResolution(
    {
      extracted: {
        fullName: '具备多干系人',
        profile: {},
      },
      missingFields: [],
    },
    '专业技能\n具备多干系人协调能力',
    '1777968028655-142356d3-何竞锋_20260414.pdf'
  )

  assert.equal(resolved.extracted.fullName, '何竞锋')
  assert.equal(resolved.missingFields.includes('fullName'), false)
})

test('marks fullName missing when neither text nor file name has a credible name', () => {
  const resolved = applyCandidateFullNameResolution(
    {
      extracted: {
        fullName: '具备多干系人',
        profile: {},
      },
      missingFields: [],
    },
    '专业技能\n具备多干系人协调能力',
    '数据库开发工程师-Boss-20260602.pdf'
  )

  assert.equal(resolved.extracted.fullName, '')
  assert.equal(resolved.missingFields.includes('fullName'), true)
})

test('keeps existing normal name formats working', () => {
  assert.equal(extractCandidateNameFromText('姓名：张三\n电话：13800000000'), '张三')
  assert.equal(extractCandidateNameFromText('姓名\n李小明\n手机：13800000000'), '李小明')
  assert.equal(extractCandidateNameFromText('王小明 / Wang Xiaoming\nEmail: wang@example.com'), '王小明')
  assert.equal(extractCandidateNameFromText('John Smith\nEmail: john@example.com'), 'John Smith')
})
