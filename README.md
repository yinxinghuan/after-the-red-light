# After the Red Light Goes Out / 红灯熄灭以后

一款中文/英文双语、面向成年人的轻量心理恐怖 RPG。玩家在暴雨夜进入一间会随红灯熄灭而改变结构的旅馆，通过对话、调查、边界选择和有限火柴追查不存在的九号房。

内容允许克制的情欲张力与成人暧昧，但不包含露骨性行为、未成年人、乱伦、性侵或强迫性行为。拒绝、暂停和保持距离始终有效，不会扣除线索或关系进度。

## Local development

```bash
npm ci
npm run dev
npm run build
```

本项目需要 Node.js 20 或更高版本。

## Verification

```bash
npm run test:world
npm run test:browser
```

冻结引擎的完整验证与构建通过 `build-stateful-story-game` validator 执行；真实浏览器证据位于 `_qa/ui/`。

## Published builds

- 正式主站：<https://game.aiwaves.tech/0f817d1b-a6e4-4cf6-aee3-b37cd07c6bcd/>
- GitHub Pages 镜像：<https://yinxinghuan.github.io/after-the-red-light/>

详细玩法、视觉与实现分别见：

- `doc/requirements.md`
- `doc/visual.md`
- `doc/technical.md`
- `doc/world-brief.json`
