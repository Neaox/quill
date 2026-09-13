import { describe, expect, it } from 'vitest'
import {
  copyFixtureGroup,
  fixtureFiles,
  readFixedFile,
  runRule,
} from '../test-support/run-oxlint.ts'

describe('quill/prefer-variant-classname', () => {
  it('accepts cx() of literals, merged variant results, and the direct className form', () => {
    const result = runRule(
      'prefer-variant-classname',
      fixtureFiles('prefer-variant-classname', 'valid'),
    )
    expect(result.diagnostics).toEqual([])
  })

  it('flags cx() wrapping a single variant call with a passed-through className', () => {
    const result = runRule(
      'prefer-variant-classname',
      fixtureFiles('prefer-variant-classname', 'invalid'),
    )
    expect(result.diagnostics).toHaveLength(9)
    for (const diagnostic of result.diagnostics) {
      expect(diagnostic.message).toContain('tailwind-variants accepts `className` directly')
    }
  })

  it('fixes a zero-argument variant call with a className identifier to shorthand', () => {
    const { targetPath } = copyFixtureGroup(
      'prefer-variant-classname',
      'invalid',
      'zero-args-shorthand.tsx',
    )
    runRule('prefer-variant-classname', [targetPath], { fix: true })
    expect(readFixedFile(targetPath)).toBe(
      'declare function cx(...args: unknown[]): string\n' +
        'declare function buttonStyles(): string\n\n' +
        'export function Widget({ className }: { className?: string }) {\n' +
        '  return <button className={buttonStyles({ className })}>go</button>\n' +
        '}\n',
    )
  })

  it('fixes a zero-argument variant call with a member expression to className: <expr>', () => {
    const { targetPath } = copyFixtureGroup(
      'prefer-variant-classname',
      'invalid',
      'zero-args-expr.tsx',
    )
    runRule('prefer-variant-classname', [targetPath], { fix: true })
    expect(readFixedFile(targetPath)).toBe(
      'declare function cx(...args: unknown[]): string\n' +
        'declare const styles: { root: (props?: { className?: string }) => string }\n\n' +
        'export function Widget({ props }: { props: { className: string } }) {\n' +
        '  return <div className={styles.root({ className: props.className })}>go</div>\n' +
        '}\n',
    )
  })

  it('appends className shorthand inside an existing object argument', () => {
    const { targetPath } = copyFixtureGroup(
      'prefer-variant-classname',
      'invalid',
      'object-arg-shorthand.tsx',
    )
    runRule('prefer-variant-classname', [targetPath], { fix: true })
    expect(readFixedFile(targetPath)).toBe(
      'declare function cx(...args: unknown[]): string\n' +
        'declare function buttonStyles(props: { variant: string }): string\n\n' +
        'export function Widget({ className, variant }: { className?: string; variant: string }) {\n' +
        '  return <button className={buttonStyles({ variant, className })}>go</button>\n' +
        '}\n',
    )
  })

  it('appends className: <expr> inside an existing object argument', () => {
    const { targetPath } = copyFixtureGroup(
      'prefer-variant-classname',
      'invalid',
      'object-arg-expr.tsx',
    )
    runRule('prefer-variant-classname', [targetPath], { fix: true })
    expect(readFixedFile(targetPath)).toBe(
      'declare function cx(...args: unknown[]): string\n' +
        'declare const styles: { root: (props?: { size?: string; className?: string }) => string }\n\n' +
        'export function Widget({ bodyClassName, size }: { bodyClassName?: string; size?: string }) {\n' +
        '  return <div className={styles.root({ size, className: bodyClassName })}>go</div>\n' +
        '}\n',
    )
  })

  it('fixes a slot call (tabsStyles().root()) the same way', () => {
    const { targetPath } = copyFixtureGroup('prefer-variant-classname', 'invalid', 'slot-call.tsx')
    runRule('prefer-variant-classname', [targetPath], { fix: true })
    expect(readFixedFile(targetPath)).toBe(
      'declare function cx(...args: unknown[]): string\n' +
        'declare const tabsStyles: () => { root: (props?: { className?: string }) => string }\n\n' +
        'export function Widget({ bodyClassName }: { bodyClassName?: string }) {\n' +
        '  return <div className={tabsStyles().root({ className: bodyClassName })}>go</div>\n' +
        '}\n',
    )
  })

  it('fixes a string-literal second argument the same way as a passed-through prop', () => {
    const { targetPath } = copyFixtureGroup(
      'prefer-variant-classname',
      'invalid',
      'literal-second.tsx',
    )
    runRule('prefer-variant-classname', [targetPath], { fix: true })
    expect(readFixedFile(targetPath)).toBe(
      'declare function cx(...args: unknown[]): string\n' +
        'declare const styles: { root: (props?: { className?: string }) => string }\n\n' +
        'export function Widget() {\n' +
        "  return <div className={styles.root({ className: 'always-visible' })}>go</div>\n" +
        '}\n',
    )
  })

  it('reports without a fix when the variant already sets className, uses a spread, or a non-object argument', () => {
    for (const name of [
      'unfixable-existing-classname.tsx',
      'unfixable-spread.tsx',
      'unfixable-nonobject-arg.tsx',
    ]) {
      const { targetPath } = copyFixtureGroup('prefer-variant-classname', 'invalid', name)
      const before = readFixedFile(targetPath)
      runRule('prefer-variant-classname', [targetPath], { fix: true })
      expect(readFixedFile(targetPath)).toBe(before)
    }
  })
})
