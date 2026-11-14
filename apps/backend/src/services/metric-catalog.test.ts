import {
  isValidMetric,
  metricCatalogGroups,
  type StoredMetricCatalog,
  type StoredMetricCatalogEntry,
  storedMetricCatalogSchema,
} from '@aurboda/api-spec'
import { describe, expect, test } from 'vitest'

import { normalizeCatalogText } from './activity-type-catalog.ts'
import {
  catalogMetricDefinition,
  catalogUnitSpellings,
  convertCatalogValue,
  findCatalogMetric,
  getCatalogMetric,
  isCatalogUnit,
  loadMetricCatalog,
  normalizeUnit,
  sameUnit,
  searchMetricCatalog,
  toMetricCatalogEntry,
} from './metric-catalog.ts'

const catalog = loadMetricCatalog()

const entry = (name: string): StoredMetricCatalogEntry => {
  const found = getCatalogMetric(catalog, name)
  if (!found) throw new Error(`no catalogue metric ${name}`)
  return found
}

const allUnitSpellings = (e: StoredMetricCatalogEntry): string[] => [
  e.unit,
  ...(e.unit_aliases ?? []),
  ...e.units.flatMap((unit) => [unit.unit, ...(unit.aliases ?? [])]),
]

describe('the shipped catalogue', () => {
  test('parses', () => {
    expect(storedMetricCatalogSchema.safeParse(catalog).success).toBe(true)
  })

  test('names are unique', () => {
    const names = catalog.entries.map((e) => e.name)
    expect(new Set(names).size).toBe(names.length)
  })

  test('no name, display name or alias points at two entries', () => {
    const owner = new Map<string, string>()
    const clashes: string[] = []
    for (const e of catalog.entries) {
      for (const label of new Set([e.name, e.display_name, ...e.aliases].map(normalizeCatalogText))) {
        const other = owner.get(label)
        if (other !== undefined && other !== e.name) clashes.push(`${label}: ${other}, ${e.name}`)
        owner.set(label, e.name)
      }
    }
    expect(clashes).toEqual([])
  })

  test('no name or alias is a built-in metric name', () => {
    const builtIn = catalog.entries
      .flatMap((e) => [e.name, ...e.aliases])
      .filter((label) => isValidMetric(label))
    expect(builtIn).toEqual([])
  })

  test('every unit string is at most 20 characters', () => {
    const long = catalog.entries.flatMap(allUnitSpellings).filter((unit) => unit.length > 20)
    expect(long).toEqual([])
  })

  test('within an entry no two units normalise to the same string', () => {
    const clashes = catalog.entries.flatMap((e) => {
      const normalised = allUnitSpellings(e).map(normalizeUnit)
      return normalised
        .filter((unit, i) => normalised.indexOf(unit) !== i)
        .map((unit) => `${e.name}: ${unit}`)
    })
    expect(clashes).toEqual([])
  })

  test('every group is declared and used', () => {
    const declared = catalog.groups.map((group) => group.key)
    expect([...declared].sort()).toEqual([...metricCatalogGroups].sort())
    const used = new Set(catalog.entries.map((e) => e.group))
    expect([...used].sort()).toEqual([...declared].sort())
  })
})

const gramsPerLitre: Record<string, number> = {
  'mg/dL': 1e-2,
  'mg/L': 1e-3,
  'ng/dL': 1e-8,
  'ng/mL': 1e-6,
  'pg/mL': 1e-9,
  'µg/dL': 1e-5,
  'µg/L': 1e-6,
}

const molesPerLitre: Record<string, number> = {
  'mmol/L': 1e-3,
  'nmol/L': 1e-9,
  'pmol/L': 1e-12,
  'µmol/L': 1e-6,
}

const molarMasses: Array<[name: string, unit: string, molarMass: number]> = [
  ['total_cholesterol', 'mg/dL', 386.65],
  ['ldl_cholesterol', 'mg/dL', 386.65],
  ['hdl_cholesterol', 'mg/dL', 386.65],
  ['non_hdl_cholesterol', 'mg/dL', 386.65],
  ['triglycerides', 'mg/dL', 885.4],
  ['fasting_glucose', 'mg/dL', 180.16],
  ['iron', 'µg/dL', 55.845],
  ['tibc', 'µg/dL', 55.845],
  ['vitamin_d', 'ng/mL', 400.64],
  ['vitamin_b12', 'pg/mL', 1355.4],
  ['folate', 'ng/mL', 441.4],
  ['magnesium', 'mg/dL', 24.305],
  ['calcium', 'mg/dL', 40.078],
  ['phosphate', 'mg/dL', 30.974],
  ['zinc', 'µg/dL', 65.38],
  ['zinc', 'µg/L', 65.38],
  ['zinc', 'mg/L', 65.38],
  ['copper', 'µg/dL', 63.546],
  ['copper', 'µg/L', 63.546],
  ['copper', 'mg/L', 63.546],
  ['selenium', 'µg/L', 78.971],
  ['selenium', 'µg/dL', 78.971],
  ['free_t4', 'ng/dL', 776.87],
  ['free_t4', 'pg/mL', 776.87],
  ['free_t3', 'pg/mL', 650.97],
  ['free_t3', 'ng/dL', 650.97],
  ['testosterone', 'ng/dL', 288.42],
  ['testosterone', 'ng/mL', 288.42],
  ['free_testosterone', 'pg/mL', 288.42],
  ['free_testosterone', 'ng/dL', 288.42],
  ['estradiol', 'pg/mL', 272.38],
  ['progesterone', 'ng/mL', 314.46],
  ['cortisol', 'µg/dL', 362.46],
  ['dhea_s', 'µg/dL', 368.5],
  ['bilirubin', 'mg/dL', 584.66],
  ['creatinine', 'mg/dL', 113.12],
  ['uric_acid', 'mg/dL', 168.11],
  ['urea', 'mg/dL', 60.06],
  ['homocysteine', 'mg/L', 135.18],
  ['c_peptide', 'ng/mL', 3020],
]

describe('conversion factors', () => {
  test.each(molarMasses)('%s from %s agrees with the molar mass %d', (name, unit, molarMass) => {
    const e = entry(name)
    const factor = e.units.find((u) => u.unit === unit)?.factor
    const expected = gramsPerLitre[unit] / molarMass / molesPerLitre[e.unit]
    expect(factor).toBeDefined()
    expect(Math.abs(factor! / expected - 1)).toBeLessThan(0.005)
  })
})

describe('convertCatalogValue', () => {
  test('LDL 100 mg/dL is 2.586 mmol/L', () => {
    expect(convertCatalogValue(entry('ldl_cholesterol'), 100, 'mg/dL', 'mmol/L')).toBe(2.586)
  })

  test('glucose does not carry float noise', () => {
    expect(convertCatalogValue(entry('fasting_glucose'), 180, 'mg/dL', 'mmol/L')).toBe(9.9918)
  })

  test('HbA1c 6.5 % is 47.5 mmol/mol and back', () => {
    const ifcc = convertCatalogValue(entry('hba1c'), 6.5, '%', 'mmol/mol')
    expect(ifcc).toBeCloseTo(47.5, 0)
    expect(Math.abs(ifcc! - 47.5)).toBeLessThan(0.1)
    expect(convertCatalogValue(entry('hba1c'), ifcc!, 'mmol/mol', '%')).toBeCloseTo(6.5, 4)
  })

  test('ALT 0.5 µkat/L is 30 U/L', () => {
    expect(convertCatalogValue(entry('alt'), 0.5, 'µkat/L', 'U/L')).toBe(30)
    expect(convertCatalogValue(entry('alt'), 0.5, 'ukat/l', 'IU/L')).toBe(30)
  })

  test('waist 34 in is 86.36 cm', () => {
    expect(convertCatalogValue(entry('waist_circumference'), 34, 'in', 'cm')).toBe(86.36)
    expect(convertCatalogValue(entry('waist_circumference'), 34, 'inches', 'cm')).toBe(86.36)
  })

  test('converts between two non-stored units through the stored unit', () => {
    expect(convertCatalogValue(entry('hemoglobin'), 14, 'g/dL', 'mmol/L')).toBe(
      Number((140 / 16.11).toPrecision(6)),
    )
  })

  test('ug/L, μg/L and mcg/L are the stored µg/L', () => {
    const ferritin = entry('ferritin')
    for (const spelling of ['ug/L', 'μg/L', 'mcg/L', ' µg / l ']) {
      expect(isCatalogUnit(ferritin, spelling)).toBe(true)
      expect(convertCatalogValue(ferritin, 55, spelling, 'µg/L')).toBe(55)
    }
  })

  test('a unit that is not the entry’s gives undefined', () => {
    expect(convertCatalogValue(entry('ferritin'), 1, 'mmol/L', 'µg/L')).toBeUndefined()
    expect(convertCatalogValue(entry('ferritin'), 1, 'µg/L', 'kg')).toBeUndefined()
  })
})

describe('normalizeUnit', () => {
  test('U/L is not µL, and IU/L stays', () => {
    expect(normalizeUnit('U/L')).toBe('u/l')
    expect(normalizeUnit('IU/L')).toBe('iu/l')
    expect(normalizeUnit('/uL')).toBe('/µl')
    expect(sameUnit('U/L', 'µL')).toBe(false)
  })

  test('micro prefixes', () => {
    expect(normalizeUnit('umol/L')).toBe('µmol/l')
    expect(normalizeUnit('uIU/mL')).toBe('µiu/ml')
    expect(normalizeUnit('mcg/dL')).toBe('µg/dl')
    expect(normalizeUnit('mU/L')).toBe('mu/l')
  })

  test('percent and celsius', () => {
    expect(sameUnit('percent', '%')).toBe(true)
    expect(sameUnit('celsius', '°C')).toBe(true)
  })

  test('keeps superscripts', () => {
    expect(normalizeUnit('10⁹/L')).toBe('10⁹/l')
  })
})

describe('lookup and search', () => {
  test('finds by name, display name and alias', () => {
    expect(findCatalogMetric(catalog, 'ldl_cholesterol')?.name).toBe('ldl_cholesterol')
    expect(findCatalogMetric(catalog, 'LDL cholesterol')?.name).toBe('ldl_cholesterol')
    expect(findCatalogMetric(catalog, 'LDL')?.name).toBe('ldl_cholesterol')
    expect(findCatalogMetric(catalog, 'nothing like it')).toBeUndefined()
  })

  test('getCatalogMetric takes only the name', () => {
    expect(getCatalogMetric(catalog, 'ldl')).toBeUndefined()
  })

  test('searches word prefixes in file order', () => {
    const tiny: StoredMetricCatalog = {
      entries: [
        {
          aliases: ['ldl'],
          display_name: 'LDL cholesterol',
          group: 'lipids',
          name: 'ldl_cholesterol',
          unit: 'mmol/L',
          units: [],
        },
        {
          aliases: [],
          display_name: 'Ferritin',
          group: 'blood_count',
          name: 'ferritin',
          unit: 'µg/L',
          units: [],
        },
      ],
      groups: [],
      version: 'test',
    }
    expect(searchMetricCatalog(tiny, 'chol').map((e) => e.name)).toEqual(['ldl_cholesterol'])
    expect(searchMetricCatalog(tiny, undefined).map((e) => e.name)).toEqual(['ldl_cholesterol', 'ferritin'])
    expect(searchMetricCatalog(tiny, 'xyz')).toEqual([])
  })

  test('catalogUnitSpellings lists canonical units, stored first', () => {
    expect(catalogUnitSpellings(entry('ferritin'))).toEqual(['µg/L', 'ng/mL'])
  })
})

describe('toMetricCatalogEntry and catalogMetricDefinition', () => {
  test('in use carries the unit of the user’s metric', () => {
    expect(toMetricCatalogEntry(entry('ferritin'), { name: 'ferritin', unit: 'ng/mL' })).toMatchObject({
      in_use: true,
      in_use_unit: 'ng/mL',
    })
    const unused = toMetricCatalogEntry(entry('ferritin'), undefined)
    expect(unused.in_use).toBe(false)
    expect(unused).not.toHaveProperty('in_use_unit')
  })

  test('the custom metric a catalogue metric becomes', () => {
    expect(catalogMetricDefinition(entry('ldl_cholesterol'))).toEqual({
      aggregation: 'avg',
      description: 'LDL cholesterol',
      include_in_daily_summary: false,
      name: 'ldl_cholesterol',
      unit: 'mmol/L',
    })
  })
})
