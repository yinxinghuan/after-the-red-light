import assert from 'node:assert/strict'
import { isGenericSuggestedChoice, repeatsCurrentAction, repeatsCurrentObjective } from '../src/story/engine/turnConsistency'

for (const label of [
  '和同伴商量怎么办',
  '观察新变化',
  '等待',
  '继续当前任务',
  '换一种方式处理当前局面',
]) assert.equal(isGenericSuggestedChoice(label, 'zh'), true, `generic Chinese suggestion must be rejected: ${label}`)

for (const label of [
  'Discuss what to do with the companions',
  'Observe what changed',
  'Wait and see',
  'Continue the current task',
  'Try another way',
]) assert.equal(isGenericSuggestedChoice(label, 'en'), true, `generic English suggestion must be rejected: ${label}`)

for (const label of [
  '把货箱推到破损门闩后',
  '隔着仓门要求营救者撤退',
  '询问巡逻员为何封锁桥面',
]) assert.equal(isGenericSuggestedChoice(label, 'zh'), false, `concrete Chinese action must remain: ${label}`)

for (const label of [
  'Push the cargo behind the broken latch',
  'Demand through the warehouse door that the rescuers withdraw',
  'Ask the patrol officer why the bridge is sealed',
]) assert.equal(isGenericSuggestedChoice(label, 'en'), false, `concrete English action must remain: ${label}`)

assert.equal(repeatsCurrentAction('再次检查仓门', '检查仓门', 'zh'), true)
assert.equal(repeatsCurrentAction('继续检查仓门', '检查仓门', 'zh'), true)
assert.equal(repeatsCurrentAction('Retry checking the warehouse door', 'Check the warehouse door', 'en'), true)
assert.equal(repeatsCurrentAction('Push cargo behind the warehouse door', 'Check the warehouse door', 'en'), false)
assert.equal(repeatsCurrentObjective('查明房卡为何能打开不存在的房间', '查明房卡为何能打开不存在的房间', 'zh'), true)
assert.equal(repeatsCurrentObjective('检查房卡背面的压痕', '查明房卡为何能打开不存在的房间', 'zh'), false)
assert.equal(repeatsCurrentObjective('Learn why the key opens the missing room', 'Learn why the key opens the missing room', 'en'), true)

console.log(JSON.stringify({ ok: true, checks: ['generic-placeholder-filter', 'concrete-action-preserved', 'immediate-repeat-filter', 'objective-is-not-an-action', 'zh-en'] }))
