import { describe, expect, it } from 'vitest'

import { formValues } from './form-values.ts'

function formWith(markup: string): HTMLFormElement {
  const form = document.createElement('form')
  form.innerHTML = markup
  return form
}

describe('formValues', () => {
  it('reads every named field as text, by its name', () => {
    const form = formWith(
      '<input name="email" value="a@example.com"><input name="password" value="pw">',
    )

    expect(formValues(form)).toEqual({ email: 'a@example.com', password: 'pw' })
  })

  it('leaves out files, which are not text', () => {
    const form = formWith('<input name="name" value="x"><input name="upload" type="file">')

    expect(formValues(form)).toEqual({ name: 'x' })
  })

  it('has nothing for a form with nothing named', () => {
    expect(formValues(formWith('<input value="x">'))).toEqual({})
  })
})
