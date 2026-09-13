import { describe, expect, it } from 'vitest'

import { expectNoAccessibilityViolations } from './axe.ts'

describe('expectNoAccessibilityViolations', () => {
  it('passes a container with no violation', async () => {
    const container = document.createElement('div')
    container.innerHTML = '<button type="button">Save</button>'
    document.body.append(container)

    await expect(expectNoAccessibilityViolations(container)).resolves.toBeUndefined()
    container.remove()
  })

  it('fails with a readable report naming the rule and the offending element', async () => {
    const container = document.createElement('div')
    // An image with no alt text is a reliable, deterministic axe violation
    // (`image-alt`) that needs no layout, unlike most other rules.
    container.innerHTML = '<img src="a.png">'
    document.body.append(container)

    await expect(expectNoAccessibilityViolations(container)).rejects.toThrow(
      /image-alt.*<img src="a\.png">/s,
    )
    container.remove()
  })
})
