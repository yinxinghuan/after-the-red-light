import type { Choice } from '../types'

export function resolveNumberedChoiceInput(value: string, choices: Choice[]): string {
  const trimmed = value.trim()
  if (!/^0*[1-9]\d*$/.test(trimmed)) return trimmed
  const index = Number(trimmed) - 1
  return choices[index]?.label ?? trimmed
}

export function encodeChoiceRecord(choices: Choice[]): string {
  return JSON.stringify(choices.map((choice) => choice.label))
}

export function decodeChoiceRecord(value: string): string[] {
  try {
    const labels = JSON.parse(value) as unknown
    return Array.isArray(labels) ? labels.filter((label): label is string => typeof label === 'string' && Boolean(label.trim())).slice(0, 5) : []
  } catch {
    return []
  }
}
