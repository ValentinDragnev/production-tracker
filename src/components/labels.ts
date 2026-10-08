import type { EntryLabels } from '../data/types'
import type { MessageKey } from '../i18n/messages'
import type { Unit } from '../lib/units'

/** Message keys for the two daily product numbers, by the business's wording. */
export function entryLabelKeys(labels: EntryLabels): { produced: MessageKey; wasted: MessageKey } {
  return labels === 'sent_returned' ? { produced: 'sent', wasted: 'returned' } : { produced: 'produced', wasted: 'wasted' }
}

/** Short unit after a number: "бр.", "кг". */
export const UNIT_SHORT: Record<Unit, MessageKey> = {
  pcs: 'unitPcs',
  kg: 'unitKg',
  l: 'unitL',
  bag: 'unitBag',
  box: 'unitBox',
}

/** Unit name for pickers: "Килограми". */
export const UNIT_NAME: Record<Unit, MessageKey> = {
  pcs: 'unitNamePcs',
  kg: 'unitNameKg',
  l: 'unitNameL',
  bag: 'unitNameBag',
  box: 'unitNameBox',
}
