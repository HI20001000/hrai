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
  assert.equal(
    extractCandidateNameFromFileName('【中级软件测试工程师_珠海 8-10K】张文辉 25年应届生.pdf'),
    '张文辉'
  )
  assert.equal(
    extractCandidateNameFromFileName('【中级软件测试工程师_珠海 8-10K】赵海洋 1年 -- 應屆 實習1年.pdf'),
    '赵海洋'
  )
})

test('finds names near contact lines when resume starts with job or company text', () => {
  assert.equal(
    extractCandidateNameFromText([
      '诚迈科技（南京）股份有限公司',
      '测试工程师（项目TE）',
      '2025.02-2025.05',
      '梁嘉成',
      '男',
      '13226908356',
      '365173627@qq.com',
    ].join('\n')),
    '梁嘉成'
  )

  assert.equal(
    extractCandidateNameFromText([
      '个人优势',
      '熟悉Oracle、Mysql 等主流关系型数据库的开发与使用',
      '意向岗位：数据开发工程师',
      '胡俊光',
      '年龄：27',
      '电话：17358829954',
      '邮箱：hujunguang2lq@163.com',
    ].join('\n')),
    '胡俊光'
  )
})

test('does not treat resume section titles or job titles as names', () => {
  assert.equal(isLikelyCandidateName('个人优势'), false)
  assert.equal(isLikelyCandidateName('软件测试'), false)
  assert.equal(isLikelyCandidateName('大专'), false)
  assert.equal(isLikelyCandidateName('求职'), false)
})

test('ignores education dates while finding names near contact lines', () => {
  assert.equal(
    extractCandidateNameFromText([
      '广东科学技术职业学院',
      '大专',
      '软件测试技术',
      '2022-2025',
      '珠海金山软件园',
      '软件测试',
      '2024.07-至今',
      '张健伟',
      '男 | 21岁',
      '19924670292',
      '2927432638@qq.com',
    ].join('\n')),
    '张健伟'
  )
})

test('does not truncate job-seeking labels into names', () => {
  assert.equal(
    extractCandidateNameFromText([
      '张文辉',
      '求职岗位：自动化测试、运维',
      '男',
      '汉族',
      '13580095425',
      '1870194282@qq.com',
    ].join('\n')),
    '张文辉'
  )

  assert.equal(
    extractCandidateNameFromText([
      '赵海洋',
      '求职岗位：软件测试工程师',
      '性别：男',
      '年龄：22',
      '邮箱：2034115904@qq.com',
      '电话：18103982195（微信同号）',
    ].join('\n')),
    '赵海洋'
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

test('keeps credible AI fullName when LLM extraction succeeds', () => {
  const resolved = applyCandidateFullNameResolution(
    {
      extracted: {
        fullName: '张文辉',
        profile: {},
      },
      missingFields: [],
    },
    '赵海洋\n电话：18103982195',
    '【中级软件测试工程师_珠海 8-10K】赵海洋 1年 -- 應屆 實習1年.pdf',
    { preferCurrentName: true }
  )

  assert.equal(resolved.extracted.fullName, '张文辉')
  assert.equal(resolved.missingFields.includes('fullName'), false)
})

test('falls back when AI fullName is not credible', () => {
  const resolved = applyCandidateFullNameResolution(
    {
      extracted: {
        fullName: '求职',
        profile: {},
      },
      missingFields: [],
    },
    '赵海洋\n求职岗位：软件测试工程师\n电话：18103982195',
    '【中级软件测试工程师_珠海 8-10K】赵海洋 1年 -- 應屆 實習1年.pdf',
    { preferCurrentName: true }
  )

  assert.equal(resolved.extracted.fullName, '赵海洋')
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
