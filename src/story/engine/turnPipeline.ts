import type { DangerDirective, ParsedScene, StoryCartridge, StorySave } from '../types'
import { canonicalizePaymentMetadata, validatePaymentConsistency } from './paymentConsistency'
import { canCommitGeneratedTurnWithoutReplies, canonicalizeTurnMetadata, validateTurnConsistency } from './turnConsistency'

export interface PreparedTurnCandidate {
  parsed: ParsedScene
  imagePrompt?: string
  dangerDirective?: DangerDirective
  discardedImage: boolean
  paymentViolations: string[]
  turnViolations: string[]
  violations: string[]
  canCommitWithoutReplies: boolean
}

/** One canonical boundary for every generated or authored turn draft. */
export function prepareTurnCandidate(options: {
  save: StorySave
  parsed: ParsedScene
  cartridge: StoryCartridge
  action: string
  imagePrompt?: string
  dangerDirective?: DangerDirective
  trustedAuthored?: boolean
  skipTurnValidation?: boolean
}): PreparedTurnCandidate {
  const paymentSafe = canonicalizePaymentMetadata(options.save, options.parsed, options.cartridge, options.action)
  const canonical = canonicalizeTurnMetadata(
    options.save, paymentSafe, options.cartridge, options.imagePrompt, options.action, options.trustedAuthored,
  )
  const paymentViolations = validatePaymentConsistency(options.save, canonical.parsed, options.cartridge, options.action)
  const turnViolations = options.skipTurnValidation && !options.dangerDirective
    ? []
    : validateTurnConsistency(options.save, canonical.parsed, options.cartridge, canonical.imagePrompt, options.action, options.dangerDirective)
  const violations = [...paymentViolations, ...turnViolations]
  return {
    parsed: canonical.parsed,
    imagePrompt: canonical.imagePrompt,
    dangerDirective: options.dangerDirective,
    discardedImage: canonical.discardedImage,
    paymentViolations,
    turnViolations,
    violations,
    canCommitWithoutReplies: canCommitGeneratedTurnWithoutReplies(violations),
  }
}
