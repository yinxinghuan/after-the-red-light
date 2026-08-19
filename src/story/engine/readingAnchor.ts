import type { StoryBlock } from '../types'

function isPlayerAction(block: StoryBlock): boolean {
  return block.kind === 'event' && block.id.startsWith('action-')
}

function isReadableContext(block: StoryBlock): boolean {
  return block.kind !== 'image' && block.kind !== 'change'
}

export function latestReadingAnchorId(blocks: StoryBlock[]): string | undefined {
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    if (isPlayerAction(blocks[index])) return blocks[index].id
  }
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    if (isReadableContext(blocks[index])) return blocks[index].id
  }
  return undefined
}
