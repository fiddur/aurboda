import { describe, expect, test } from 'vitest'

import { formatValue } from './sql.ts'

describe('formatValue', () => {
  describe('arrays', () => {
    test('formats string array with PostgreSQL array syntax', () => {
      expect(formatValue(['a', 'b', 'c'])).toBe(`'{ "a","b","c" }'`)
    })

    test('formats empty array', () => {
      expect(formatValue([])).toBe(`'{ "" }'`)
    })

    test('formats single element array', () => {
      expect(formatValue(['only'])).toBe(`'{ "only" }'`)
    })
  })

  describe('numbers', () => {
    test('formats integer', () => {
      expect(formatValue(42)).toBe('42')
    })

    test('formats float', () => {
      expect(formatValue(3.14159)).toBe('3.14159')
    })

    test('formats zero', () => {
      expect(formatValue(0)).toBe('0')
    })

    test('formats negative number', () => {
      expect(formatValue(-100)).toBe('-100')
    })
  })

  describe('booleans', () => {
    test('formats true', () => {
      expect(formatValue(true)).toBe('true')
    })

    test('formats false', () => {
      expect(formatValue(false)).toBe('false')
    })
  })

  describe('null', () => {
    test('formats null as SQL NULL', () => {
      expect(formatValue(null)).toBe('NULL')
    })
  })

  describe('strings', () => {
    test('formats simple string with quotes', () => {
      expect(formatValue('hello')).toBe("'hello'")
    })

    test('escapes single quotes in string', () => {
      expect(formatValue("it's")).toBe("'it''s'")
    })

    test('escapes multiple single quotes', () => {
      expect(formatValue("it's a 'test'")).toBe("'it''s a ''test'''")
    })

    test('formats empty string', () => {
      expect(formatValue('')).toBe("''")
    })
  })

  describe('objects', () => {
    test('formats object as JSON string', () => {
      expect(formatValue({ key: 'value' })).toBe(`'{"key":"value"}'`)
    })

    test('escapes quotes in JSON values', () => {
      expect(formatValue({ msg: "it's" })).toBe(`'{"msg":"it''s"}'`)
    })

    test('formats nested object', () => {
      expect(formatValue({ outer: { inner: 1 } })).toBe(`'{"outer":{"inner":1}}'`)
    })

    test('formats object with array', () => {
      expect(formatValue({ items: [1, 2, 3] })).toBe(`'{"items":[1,2,3]}'`)
    })
  })
})
