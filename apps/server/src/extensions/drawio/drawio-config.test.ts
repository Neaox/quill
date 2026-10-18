import { describe, expect, it } from 'vitest'

import { drawioFrameSources, loadDrawioConfig } from './drawio-config.ts'

const APP = 'http://localhost:3000'

describe('drawioFrameSources', () => {
  it('lets the app frame the editor’s origin, or nothing', () => {
    expect(drawioFrameSources(loadDrawioConfig({}, true, APP))).toEqual(['http://localhost:8080'])
    expect(drawioFrameSources({ editor: null })).toEqual([])
  })
})

describe('loadDrawioConfig', () => {
  it('uses the self-hosted editor in Compose while the app is in development', () => {
    expect(loadDrawioConfig({}, true, APP)).toEqual({
      editor: { url: 'http://localhost:8080/', origin: 'http://localhost:8080', thirdParty: false },
    })
  })

  it('offers no editor in a real deployment that names none, or one that turns it off', () => {
    expect(loadDrawioConfig({}, false, APP)).toEqual({ editor: null })
    expect(loadDrawioConfig({ DRAWIO_URL: 'off' }, true, APP)).toEqual({ editor: null })
  })

  it('takes a self-hosted editor on a path of its own', () => {
    expect(
      loadDrawioConfig({ DRAWIO_URL: 'https://draw.example.com/drawio/' }, false, APP),
    ).toEqual({
      editor: {
        url: 'https://draw.example.com/drawio/',
        origin: 'https://draw.example.com',
        thirdParty: false,
      },
    })
  })

  it('refuses diagrams.net unless the operator accepts sending it every diagram', () => {
    expect(() =>
      loadDrawioConfig({ DRAWIO_URL: 'https://embed.diagrams.net/' }, false, APP),
    ).toThrow(/sends every diagram opened in it to diagrams\.net.*DRAWIO_ALLOW_THIRD_PARTY=true/)
    expect(
      loadDrawioConfig(
        { DRAWIO_URL: 'https://embed.diagrams.net/', DRAWIO_ALLOW_THIRD_PARTY: 'true' },
        false,
        APP,
      ),
    ).toEqual({
      editor: {
        url: 'https://embed.diagrams.net/',
        origin: 'https://embed.diagrams.net',
        thirdParty: true,
      },
    })
  })

  it('refuses an address that is not one, not the web, or plaintext in production', () => {
    expect(() => loadDrawioConfig({ DRAWIO_URL: 'drawio' }, true, APP)).toThrow(
      'DRAWIO_URL must be an absolute URL, received "drawio"',
    )
    expect(() => loadDrawioConfig({ DRAWIO_URL: 'javascript:alert(1)' }, true, APP)).toThrow(
      'DRAWIO_URL must be http or https',
    )
    expect(() => loadDrawioConfig({ DRAWIO_URL: 'http://draw.example.com/' }, false, APP)).toThrow(
      'DRAWIO_URL must be https outside development',
    )
  })

  it('refuses the app’s own origin, where a sandboxed frame could lift its sandbox', () => {
    expect(() => loadDrawioConfig({ DRAWIO_URL: `${APP}/drawio/` }, true, APP)).toThrow(
      'DRAWIO_URL must be on its own origin',
    )
  })
})

describe('the development default', () => {
  it('stands aside for an app that took its port', () => {
    expect(loadDrawioConfig({}, true, 'http://localhost:8080')).toEqual({ editor: null })
  })
})
