import { describe, expect, test } from 'vitest'

import { createResolver, readExercises } from './convert-bodybuild.ts'
import { parseDart, stripComments } from './dart-reader.ts'

const tweakSource = `
  import 'package:bodybuild/data/dataset/assign.dart';
  class Tweak {
    final String name;
    const Tweak(this.name, this.defaultVal, this.opts, {this.desc = ''});
    String get label => name.isEmpty ? '' : name;
  }
  const rom = Tweak('ROM', 'full', {
    'full': Option({}, 'full range'),
    'partial': Option({ProgramGroup.soleus: Assign(1)}, 'partial'),
  });
  final grsq = Tweak("grip", "wide", {
    ...rom.opts,
    'wide': Option({ProgramGroup.lats: Assign(0.5), ProgramGroup.abs: Assign(0.25)}, 'wide', equipment: Equipment.barbell),
  });
  const Tweak noDefault = Tweak('x', 'missing', {'a': Option({ProgramGroup.biceps: Assign(1)}, 'a')});
  Tweak hipFlexion(String defaultValue) => Tweak(
    'hip flexion angle',
    defaultValue,
    {
      '0': const Option({ProgramGroup.gluteMax: Assign(0.25), ProgramGroup.gluteMed: Assign(1)}, 'straight'),
      '90': const Option({ProgramGroup.gluteMax: Assign(1), ProgramGroup.gluteMed: Assign(0.5)}, 'bent'),
    },
    desc: 'angle',
  );
`

const resolver = (volumeAssignment: string) => createResolver({ tweak: tweakSource, volumeAssignment })

const resolveIn = (volumeSource: string, name: string) =>
  Object.fromEntries(resolver(volumeSource).volume({ kind: 'ref', name }))

const recruitmentOf = (volumeSource: string, va: string, tweaks: string) => {
  const parsed = parseDart(`final x = Ex(${va}, "id", [], ${tweaks});`).assignment('x')
  if (parsed.kind !== 'call') throw new Error('fixture is not a call')
  const [vaNode, , , tweaksNode] = parsed.args.map((a) => a.value)
  if (!vaNode) throw new Error('fixture has no volume assignment')
  return Object.fromEntries(resolver(volumeSource).recruitment(vaNode, tweaksNode))
}

describe('stripComments', () => {
  test('drops line and block comments but keeps // inside strings', () => {
    const src = `a('https://x.y/z') // gone\n/* also /* nested */ gone */ b("it's // kept")`
    expect(stripComments(src)).toBe(`a('https://x.y/z')  \n  b("it's // kept")`)
  })

  test('leaves quotes inside comments alone', () => {
    expect(stripComments(`x /* "Y888b. don't */ y`).replaceAll(/\s+/g, ' ')).toBe('x y')
  })
})

describe('volume assignment resolution', () => {
  const volume = `
    const wrist = {
      ProgramGroup.wristFlexors: Assign(0.25, 'isometric'),
    };
    const base = {
      ProgramGroup.hams: Assign(1, 'hip extension, see https://example.org/a'), // comment
      ProgramGroup.gluteMax: Assign(1),
      ...wrist,
    };
    final derived = {
      ...base,
      ProgramGroup.hams: const Assign(0.75, 'later key wins'),
      ProgramGroup.soleus: const Assign(0),
    };
    final overridden = {
      ProgramGroup.hams: Assign(0.3),
      ...base,
    };
  `

  test('spreads resolve recursively and later keys win', () => {
    expect(resolveIn(volume, 'derived')).toEqual({ gluteMax: 1, hams: 0.75, soleus: 0, wristFlexors: 0.25 })
  })

  test('a spread after a key overrides it', () => {
    expect(resolveIn(volume, 'overridden')).toMatchObject({ hams: 1 })
  })

  test('a spread of a tweak function option resolves through tweak.dart', () => {
    const src = `final straight = { ...hipFlexion('0').opts['0']!.va };`
    expect(resolveIn(src, 'straight')).toEqual({ gluteMax: 0.25, gluteMed: 1 })
  })

  test('an unresolved identifier is a hard error naming it', () => {
    expect(() => resolveIn(`const a = { ...missingMap };`, 'a')).toThrow('Unresolved identifier: missingMap')
  })

  test('an unknown function spread is a hard error', () => {
    expect(() => resolveIn(`final a = { ...other('1').opts['1']!.va };`, 'a')).toThrow(
      "Unresolved tweak: other('1')",
    )
  })

  test('a name declared in both files is a hard error', () => {
    expect(() => resolver(`const rom = {};`)).toThrow('Duplicate declaration: rom')
  })
})

describe('tweak default options', () => {
  const volume = `const vaX = { ProgramGroup.abs: Assign(1), ProgramGroup.lats: Assign(1) };`

  test("a shared tweak's default option adds its muscles", () => {
    expect(recruitmentOf(volume, '{ProgramGroup.biceps: Assign(1)}', '[grsq]')).toEqual({
      abs: 0.25,
      biceps: 1,
      lats: 0.5,
    })
  })

  test('an inline tweak literal contributes its default option', () => {
    const inline = `[Tweak('t', 'b', {'a': Option({ProgramGroup.abs: Assign(1)}, 'a'), 'b': Option({ProgramGroup.obliques: Assign(0.5)}, 'b')})]`
    expect(recruitmentOf(volume, 'vaX', inline)).toEqual({ abs: 1, lats: 1, obliques: 0.5 })
  })

  test('a tweak overrides the volume assignment and later tweaks override earlier ones', () => {
    expect(recruitmentOf(volume, 'vaX', '[grsq]')).toEqual({ abs: 0.25, lats: 0.5 })
    const later = `[grsq, Tweak('t', 'a', {'a': Option({ProgramGroup.lats: Assign(0)}, 'a')})]`
    expect(recruitmentOf(volume, 'vaX', later)).toEqual({ abs: 0.25, lats: 0 })
  })

  test('a function-call tweak takes its argument as the default option key', () => {
    expect(recruitmentOf(volume, '{}', `[hipFlexion('90')]`)).toEqual({ gluteMax: 1, gluteMed: 0.5 })
  })

  test('a default missing from the options, or an empty option, contributes nothing', () => {
    expect(recruitmentOf(volume, 'vaX', '[noDefault, rom]')).toEqual({ abs: 1, lats: 1 })
  })

  test('an unresolvable tweak is a hard error naming it', () => {
    expect(() => recruitmentOf(volume, 'vaX', '[nowhere]')).toThrow('Unresolved identifier: nowhere')
    expect(() => recruitmentOf(volume, 'vaX', '[mystery(1)]')).toThrow('Unresolved tweak: mystery(1)')
  })
})

describe('readExercises', () => {
  const volume = `const vaX = { ProgramGroup.abs: Assign(1) };`
  const ex = `
    class Ex { const Ex(this.a, this.b); String? get d => x.isEmpty ? null : 'aka: \${x.join(', ')}'; }
    final List<Ex> exes = [
      const Ex(vaX, "first", [Equipment.barbell], [rom, grsq]),
      Ex(
        {...vaX, ProgramGroup.obliques: Assign(0.25, "nested {map}")},
        "second",
        [Equipment.cableTower, Equipment.ezbar],
        [rom, Tweak('t', 'a', {'a': Option({ProgramGroup.lats: Assign(1)}, 'aka x, see [v](https://y.z/?a=1)')})],
        ratingX.toList(),
        ['alias one', "alias two"],
        '''multi
line // not a comment''',
        [TweakConstraint(('t', {'a'}), ('u', {'b'}))],
      ),
      const Ex({}, "third", []),
    ];
  `

  test('splits positional arguments with nested literals, comments and URLs', () => {
    expect(readExercises(ex, { tweak: tweakSource, volumeAssignment: volume })).toEqual([
      { equipment: ['barbell'], id: 'first', muscles: { abs: 0.25, lats: 0.5 }, search_aliases: [] },
      {
        equipment: ['cable', 'ez_bar'],
        id: 'second',
        muscles: { abs: 1, lats: 1, obliques: 0.25 },
        search_aliases: ['alias one', 'alias two'],
      },
      { equipment: [], id: 'third', muscles: {}, search_aliases: [] },
    ])
  })

  test('an unknown equipment is a hard error', () => {
    const bad = `final exes = [Ex(vaX, "x", [Equipment.spaceship])];`
    expect(() => readExercises(bad, { tweak: tweakSource, volumeAssignment: volume })).toThrow(
      'Unresolved equipment: Equipment.spaceship',
    )
  })
})

describe('enumValues', () => {
  test('lists enum values with constructor arguments', () => {
    const src = `enum E {\n  a("A", 1),\n  // b("B")\n  c('C', x: 2);\n  final String n;\n}`
    expect(parseDart(src).enumValues('E')).toEqual(['a', 'c'])
  })
})
