import { describe, expect, it } from 'vitest'
import { cleanQuantityInput, formatQuantity, parseQuantity } from './units'

describe('quantities', () => {
  it('counts pieces, bags and boxes in whole numbers', () => {
    expect(parseQuantity('12', 'pcs')).toBe(12)
    expect(parseQuantity('2,5', 'box')).toBe(25) // separators are dropped for whole units
    expect(cleanQuantityInput('1a2', 'bag')).toBe('12')
  })

  it('weighs kilograms and litres with up to two decimals', () => {
    expect(parseQuantity('2,5', 'kg')).toBe(2.5)
    expect(parseQuantity('0.75', 'l')).toBe(0.75)
    expect(parseQuantity('1,234', 'kg')).toBe(1.23)
    expect(cleanQuantityInput('2,', 'kg')).toBe('2,') // so typing "2,5" works
    expect(cleanQuantityInput('2,5,1', 'kg')).toBe('2,51')
  })

  it('treats empty or junk input as zero and caps big numbers', () => {
    expect(parseQuantity('', 'kg')).toBe(0)
    expect(parseQuantity(',', 'kg')).toBe(0)
    expect(parseQuantity('1234567', 'pcs')).toBe(99999)
  })

  it('formats with a decimal comma in Bulgarian', () => {
    expect(formatQuantity(2.5, 'kg', 'bg-BG')).toBe('2,5')
    expect(formatQuantity(3, 'kg', 'bg-BG')).toBe('3')
    expect(formatQuantity(1200, 'pcs', 'bg-BG')).toBe('1200')
  })
})
