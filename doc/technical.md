# Technical

## 1. 技术栈

- React 18 + TypeScript 5.6 + Less + Vite 5，`base: './'`，构建产物为 `dist/`。
- 叙事采用冻结的 stateful story engine standalone 导出；本游戏只注册 `after-the-red-light` Cartridge，中英文构建共享同一规则表。
- 状态由 reducer 与结构化命令共同维护，模型正文不能直接改变数值、物品、人物、地点或危险。
- 存档使用 `useGameSave` 与 `alteruLocalStorage`，以部署 session UUID 隔离；媒体生成只调用 AlterU 公共媒体服务客户端。
- 静态入口图、封面和海报底图由 AlterU Media Service v1 以本游戏 UUID `0f817d1b-a6e4-4cf6-aee3-b37cd07c6bcd` 生成；采用的入口任务为 `mt_ae7ba371db151d59ea04ca7e94998b8b`，封面任务为 `mt_9a8c06b55957933c5ef76be51e3edfa5`。海报标题在无文字封面画面上本地排版，避免生成伪文字。

## 2. 目录结构

```text
src/
  main.tsx                         # React 入口
  game-id.ts                       # 可替换的永久游戏 UUID
  story/
    StoryShell.tsx                 # 阅读、选择、抽屉、检查点与错误恢复 UI
    useStoryEngine.ts              # 回合编排、存档、适配器与媒体生命周期
    story.less                     # 响应式纸面/旅馆界面
    cartridges/
      afterTheRedLight.ts          # 双语世界、状态、角色、事件、开局与原子规则
      index.ts                     # 唯一 Cartridge 注册表
    engine/                        # 协议、reducer、连续性、危险、地点、选项与图片导演
    adapters/                      # 平台远端、Aigram 与本地 mock 适配器
    img/worlds/                    # 入口图与封面
  shared/
    runtime/                       # 平台桥、游戏 UUID 与公共媒体客户端
    save/                          # UUID 云存档与本地镜像
public/
  alteru-storage-scope.js          # 同域 session 存储隔离
  poster.png                       # 1024×1024 英文海报
worker/
  index.js                         # 自托管部署器入口与只读健康检查
_qa/                               # 冻结引擎回归与本游戏世界合同
doc/                               # 需求、视觉、技术和世界 brief
```

## 3. 核心模块

- `afterTheRedLight.ts` 是本游戏内容真源。`build('zh' | 'en')` 定义三项状态、六个初始地点、三名成人角色、八个预设事件、五类地点绑定危险与三个确定性开局。
- `turnPipeline.ts` 先校验候选回合，再原子提交正文、选择和状态；不完整或矛盾回合不会写入存档。`turnConsistency.ts` 过滤过期地点、断头路、重复行动和与当前事件无关的推荐项；没有结构化权威进展时，还会剔除围绕同一对象的语义改写重试。
- `authoredTurns.ts` 把固定行动视为带地点、人物或工作前置的作用域合同。Cartridge 已为大厅、二层走廊与九号房门外的所有确定性行动声明地点；旧标签出现在错误现场时既不能执行，也不能进入下一组选项。
- reducer 的 `applyConsistencyRecovery()` 使用 `consistency-quarantine-v2` 隔离失败推荐：不提交世界变化，删除该动作，保留可信同级选项；没有同级选项时保持快捷栏为空并交给自由输入。`repairLegacyConsistencyRecovery()` 从上一份真实选择记录恢复可信同级项，清除旧“查看这里能做的事 / 放弃原计划”菜单，并通过版本事实保证迁移幂等；`normalizeSave()` 不会在读档时重新补回目标按钮。
- `continuity.ts` 的 grounding 以当前已经建立的人、地点、物品和上下文证据为准，不要求未来行动逐字复述正文；长期目标不会直接成为按钮。真实抵达新地点后，只要存在本地行动，系统不会把“立即返回刚离开的地点”留作主要推荐。
- `domainRules.ts` 执行火柴、休息、镇定归零恢复与边界规则；匹配、前置、数值和物品变化都由本地规则一次完成。玩家明确点燃前不会扣火柴。
- `authorityShadow.ts` 只在 QA 参数 `?authority_shadow=1` 下把新旧候选分类记录到页面内存；它不改界面、不写存档、不上传数据。真实生成 QA 覆盖 3 条分支、9 个回合，最终为 0 空选项、0 一致性恢复和 0 即时地点折返。
- `dangerDirector.ts` 保持 warning → confrontation → resolution 的同一威胁线程；无身体战斗，危险只能在声明地点出现，并始终提供说出变化、进入亮处或点燃火柴等可验证方法。生成结果及一次修复都不合格时，`createDangerFallbackScene()` 以本地确定性结果推进原威胁；`repairLegacyDangerLoopChoices()` 只迁移旧版通用恢复循环和带引号的旧危险菜单，不覆盖正常作者选项。
- `domainRules.ts` 的 `dangerPolicy: 'advance'` 与 reducer 的受限 encounter 通道共同保证：点燃红色火柴等原子行动在扣除物品、应用数值后同回合推进危险阶段，模型协议不能附带第二次状态修改。
- `characterContinuity.ts` 阻止隐藏人物提前出现在关系、队伍或选项里；可见外形、名字来源和意图成立后才允许稳定 ID 入库。
- `imageDirector.ts` 按普通场景均衡、重要对话第一人称、新地点第三人称进行构图；第一人称不附带玩家头像，角色和地点元数据必须与正文一致。
- `useGameSave.ts` 负责平台云存档与本地镜像；`alteru-storage-scope.js` 把真实浏览器 key 写为当前部署 session 前缀，Remix 后不会继承源游戏缓存。
- `worker/index.js` 仅提供 `/api/health` 与同构静态部署入口；不创建第二套存档、关系或叙事数据库。
- 音频由 `StorySynth.ts` 和 `useStoryAudio.ts` 在首次手势后创建；静音、后台或 Web Audio 失败不阻塞剧情。
- 语言由 `i18n.ts` 与双语 Cartridge 决定，支持中文和英文；所有本游戏固定可见内容在 Cartridge 中提供双语版本。

## 4. 扩展点

- 改故事、角色、地点、事件、数值或成人内容边界：编辑 `src/story/cartridges/afterTheRedLight.ts`，并同步 `doc/world-brief.json` 与 `_qa/world-contract.ts`。
- 增加原子动作：在 Cartridge 的 `domainRules` 增加唯一规则 ID、前置、结果、叙事和恢复选择；不要在正文里手写数值后果。
- 调整推荐选项质量：优先改 Cartridge 的目标、地点 capability、危险方法与 authored turn；共享过滤器只有在能惠及所有游戏且带原始候选回放时才修改。运行 `npm run test:choice-quality`、`npm run test:authority-replay` 与 `npm run test:loop-escape`，验证未来行动改写、目标复述、抵达折返、资源同义词、连续失败不复生、语义重试过滤和中英固定行动作用域。
- 换入口图、封面或海报：替换 `src/story/img/worlds/after-the-red-light-entry.webp`、`after-the-red-light.webp` 和 `public/poster.png`；运行时场景继续使用 `src/shared/runtime/media.ts` 的公共服务合同。
- 改视觉与响应式：编辑 `src/story/story.less`，保持 44×44 触控目标、320×568/390×844 无横向溢出与阅读锚点。
- 加后端：游戏内容层不得写死旧 UUID 或私有媒体接口；平台接口继续走 bridge，自有 Worker 才按 `/<GAME_ID>/api/*` 合同接入。
- 发布前至少运行 `npm run test:world`、`npm run test:red-light-loop`、`npm run test:loop-escape`、冻结引擎回归、统一 validator、secret/storage/API-base 审计和真实浏览器双尺寸验收；浏览器路径必须包含“进入二层 → 点燃火柴 → 直接应对 → 继续调查”，并断言没有 `consistency-recovery` 场景。失败推荐回归还必须覆盖：保留同级选项、连续失败集合单调缩小、零快捷项读档不复生、旧存档一次迁移、错误地点固定行动不可执行。
## 2026-08-23 混合音频升级

`src/story/audio/` 现在使用本作专属的成人心理恐怖主题与酒店夜间环境声，精确操作与危险反馈仍由 Web Audio 负责。自动播放失败、静音、后台切换或音频缺失都不会推进、回滚或阻塞权威故事状态。

## 2026-08-23 阅读优先 A/B 配乐

常规段落使用极低密度的空间底乐 A；只有关键揭示、关系转折和阶段收束使用更具音乐性的 B。B 不与 A 重叠，结束后恢复 A，并有 180 秒同源冷却；静音、后台或播放失败都不会延迟或改变故事状态。
