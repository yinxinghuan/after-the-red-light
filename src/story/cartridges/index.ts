import { afterTheRedLight, afterTheRedLightEn } from './afterTheRedLight'
import type { Locale, StoryCartridge } from '../types'

export const DEFAULT_CARTRIDGE_ID = 'after-the-red-light'
export const CARTRIDGES: Record<string, StoryCartridge> = { 'after-the-red-light': afterTheRedLight }
export const CARTRIDGES_EN: Record<string, StoryCartridge> = { 'after-the-red-light': afterTheRedLightEn }
export function listCartridges(locale: Locale): StoryCartridge[] { return [locale === 'en' ? afterTheRedLightEn : afterTheRedLight] }
export function resolveCartridge(_id: string | null | undefined, locale: Locale = 'zh'): StoryCartridge { return locale === 'en' ? afterTheRedLightEn : afterTheRedLight }
