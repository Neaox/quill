import {
  defaultOrganisationSettings,
  encodeSettings,
  ORGANISATION_SETTINGS_VERSION,
} from '@quill/application'
import type { LinkPreviewSettings } from '@quill/application'
import { createFakeSettings } from '@quill/application/test-support'
import { describe, expect, it } from 'vitest'

import { linkDefaultDisplay, linkPublicPolicy, linkSettingsPolicy } from './link-settings.ts'
import { readLinkPreviewSettings } from './link-settings.ts'

const CAREFUL: LinkPreviewSettings = {
  mode: 'text',
  publicSite: false,
  defaultDisplay: 'compact',
  allow: ['docs.example'],
  block: ['ads.example'],
}

async function settingsWith(linkPreviews?: LinkPreviewSettings) {
  const settings = createFakeSettings()
  settings.place(
    'organisation',
    encodeSettings({
      ...defaultOrganisationSettings(),
      ...(linkPreviews === undefined ? {} : { linkPreviews }),
    }),
  )
  return settings
}

describe('the organisation’s link settings, as the server reads them', () => {
  it('are the shipped defaults for an organisation that never saved any', async () => {
    expect(await readLinkPreviewSettings(createFakeSettings())).toEqual({
      mode: 'rich',
      publicSite: true,
      defaultDisplay: 'inline',
      allow: [],
      block: [],
    })
    expect(await readLinkPreviewSettings(await settingsWith())).toMatchObject({ mode: 'rich' })
  })

  it('are what the organisation saved', async () => {
    expect(await readLinkPreviewSettings(await settingsWith(CAREFUL))).toEqual(CAREFUL)
  })

  it('fail closed when the file cannot be read: previews off, nothing on the public site', async () => {
    const settings = createFakeSettings()
    settings.place('organisation', `version: ${ORGANISATION_SETTINGS_VERSION + 40}\nname: Later\n`)
    expect(await readLinkPreviewSettings(settings)).toMatchObject({
      mode: 'off',
      publicSite: false,
      defaultDisplay: 'inline',
    })
  })

  it('make the policy members are held to, and the display links start with', async () => {
    const settings = await settingsWith(CAREFUL)
    expect(await linkSettingsPolicy(settings)).toEqual({
      mode: 'text',
      allow: ['docs.example'],
      block: ['ads.example'],
    })
    expect(await linkDefaultDisplay(settings)).toBe('compact')
  })

  it('give the public site the same policy, unless the organisation switched it off there', async () => {
    expect(await linkPublicPolicy(await settingsWith({ ...CAREFUL, publicSite: true }))).toEqual({
      mode: 'text',
      allow: ['docs.example'],
      block: ['ads.example'],
    })
    expect(await linkPublicPolicy(await settingsWith(CAREFUL))).toEqual({
      mode: 'off',
      allow: [],
      block: [],
    })
  })
})
