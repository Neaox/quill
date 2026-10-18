import { describe, expect, it, vi } from 'vitest'

import { OutboundRequestError } from './outbound-client.ts'
import type {
  FetchLike,
  OutboundFetchInit,
  OutboundFetchResponse,
  ResolveHost,
} from './outbound-client.ts'
import { createOpenWebClient, imageRequest, jsonRequest, pageRequest } from './open-web-client.ts'
import type { FetchEvent, OpenWebClientOptions, UrlPermit } from './open-web-client.ts'

const PUBLIC_ADDRESS = '93.184.216.34'
const text = (value: string) => new TextEncoder().encode(value)

function html(body: string, headers: Record<string, string> = {}): Response {
  return new Response(body, { status: 200, headers: { 'content-type': 'text/html', ...headers } })
}

/** A body that yields each chunk, then stays open as a slow host would. */
function dripping(chunks: readonly string[], headers: Record<string, string> = {}): Response {
  let sent = 0
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[sent]
      if (chunk === undefined) return new Promise(() => undefined)
      sent += 1
      controller.enqueue(text(chunk))
      return undefined
    },
  })
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/html', ...headers } })
}

/** A body of the given chunks that ends normally. */
function chunked(chunks: readonly string[], headers: Record<string, string> = {}): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(text(chunk))
      controller.close()
    },
  })
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/html', ...headers } })
}

function redirect(location: string | null, status = 302): Response {
  return new Response(null, { status, headers: location === null ? {} : { location } })
}

function setUp(overrides: Partial<OpenWebClientOptions> = {}) {
  const fetchMock = vi.fn<FetchLike>(async () => html('<title>hi</title>'))
  const resolve = vi.fn<ResolveHost>(async () => [PUBLIC_ADDRESS])
  const client = createOpenWebClient({
    userAgent: 'QuillBot/1 (+https://quill.example/bot)',
    resolve,
    fetch: fetchMock,
    ...overrides,
  })
  return { client, fetchMock, resolve }
}

async function failureOf(work: Promise<unknown>): Promise<string> {
  try {
    await work
  } catch (error) {
    if (error instanceof OutboundRequestError) return error.reason
    throw error
  }
  return 'no failure'
}

describe('createOpenWebClient: reaching any public host', () => {
  it('fetches a host nobody listed, and reports what it found', async () => {
    const { client, fetchMock } = setUp()
    const response = await client.get(pageRequest('https://anywhere.example/post'))
    expect(response).toMatchObject({
      status: 200,
      url: 'https://anywhere.example/post',
      mediaType: 'text/html',
      charset: null,
      truncated: false,
    })
    expect(new TextDecoder().decode(response.body)).toBe('<title>hi</title>')
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('introduces itself honestly, asks for what it accepts, and refuses compression', async () => {
    const { client, fetchMock } = setUp()
    await client.get(pageRequest('https://anywhere.example/'))
    const init = fetchMock.mock.calls[0]?.[1] as OutboundFetchInit
    expect(init.headers).toMatchObject({
      'user-agent': 'QuillBot/1 (+https://quill.example/bot)',
      accept: 'text/html, application/xhtml+xml, application/json',
      'accept-encoding': 'identity',
    })
  })

  it('lets a request override a default header, as a reviewed fallback user agent does', async () => {
    const { client, fetchMock } = setUp()
    await client.get({
      ...pageRequest('https://a.example/'),
      headers: { 'user-agent': 'facebookexternalhit/1.1' },
    })
    const init = fetchMock.mock.calls[0]?.[1] as OutboundFetchInit
    expect(init.headers['user-agent']).toBe('facebookexternalhit/1.1')
  })

  it('reports the media type and charset from the header', async () => {
    const { client, fetchMock } = setUp()
    fetchMock.mockResolvedValueOnce(
      html('x', { 'content-type': 'Text/HTML; Charset="ISO-8859-1"' }),
    )
    expect(await client.get(pageRequest('https://a.example/'))).toMatchObject({
      mediaType: 'text/html',
      charset: 'iso-8859-1',
    })
  })

  it('returns a failing status without reading or judging its body', async () => {
    const { client, fetchMock } = setUp()
    fetchMock.mockResolvedValueOnce(
      new Response('gone', { status: 404, headers: { 'content-type': 'application/pdf' } }),
    )
    expect(await client.get(pageRequest('https://a.example/'))).toMatchObject({
      status: 404,
      mediaType: '',
      body: new Uint8Array(0),
    })
  })
})

describe('createOpenWebClient: addresses', () => {
  it('connects only to the addresses it checked', async () => {
    const { client, fetchMock } = setUp({
      resolve: async () => ['93.184.216.34', '2606:2800:220:1::1'],
    })
    await client.get(pageRequest('https://a.example/'))
    const init = fetchMock.mock.calls[0]?.[1] as OutboundFetchInit
    expect(init.addresses).toEqual(['93.184.216.34', '2606:2800:220:1::1'])
  })

  it.each([
    ['loopback', '127.0.0.1'],
    ['private', '10.0.0.5'],
    ['the metadata service', '169.254.169.254'],
    ['carrier-grade NAT', '100.64.1.1'],
    ['IPv4 hidden in IPv6', '::ffff:7f00:1'],
    ['unique-local IPv6', 'fd00::1'],
  ])('refuses a host that resolves to %s', async (_name, address) => {
    const { client, fetchMock } = setUp({ resolve: async () => [address] })
    expect(await failureOf(client.get(pageRequest('https://a.example/')))).toBe('private_address')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses a host with even one private answer among public ones', async () => {
    const { client } = setUp({ resolve: async () => [PUBLIC_ADDRESS, '10.0.0.5'] })
    expect(await failureOf(client.get(pageRequest('https://a.example/')))).toBe('private_address')
  })

  it('refuses an address written as the host', async () => {
    const { client } = setUp({ resolve: async (host) => [host] })
    expect(await failureOf(client.get(pageRequest('http://127.0.0.1/')))).toBe('private_address')
    expect(await failureOf(client.get(pageRequest('http://[::1]/')))).toBe('private_address')
  })

  it('reports a host that does not resolve', async () => {
    const { client } = setUp({
      resolve: async () => {
        throw new Error('ENOTFOUND')
      },
    })
    expect(await failureOf(client.get(pageRequest('https://nowhere.example/')))).toBe('dns_failure')
  })
})

describe('createOpenWebClient: the default resolver', () => {
  it('uses the system resolver, which refuses an address written as the host', async () => {
    const client = createOpenWebClient({ userAgent: 'QuillBot/1' })
    expect(await failureOf(client.get(pageRequest('http://127.0.0.1/')))).toBe('private_address')
  })
})

describe('createOpenWebClient: credentials', () => {
  it.each(['Authorization', 'proxy-authorization', 'COOKIE', 'X-Api-Key'])(
    'refuses to send a %s header to a host nobody vetted',
    async (name) => {
      const { client, fetchMock } = setUp()
      expect(
        await failureOf(
          client.get({ ...pageRequest('https://a.example/'), headers: { [name]: 'secret' } }),
        ),
      ).toBe('credentials_in_request')
      expect(fetchMock).not.toHaveBeenCalled()
    },
  )
})

describe('createOpenWebClient: which URLs', () => {
  it.each([
    ['ftp://a.example/file', 'scheme_not_allowed'],
    ['file:///etc/passwd', 'scheme_not_allowed'],
    ['https://user:secret@a.example/', 'credentials_in_url'],
    ['https://user@a.example/', 'credentials_in_url'],
    ['https://a.example:8443/', 'port_not_allowed'],
    ['http://a.example:22/', 'port_not_allowed'],
    ['not a url', 'invalid_url'],
  ])('refuses %s', async (url, reason) => {
    const { client, fetchMock } = setUp()
    expect(await failureOf(client.get(pageRequest(url)))).toBe(reason)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('allows the explicit default ports', async () => {
    const { client } = setUp()
    expect((await client.get(pageRequest('https://a.example:443/'))).status).toBe(200)
    expect((await client.get(pageRequest('http://a.example:80/'))).status).toBe(200)
  })
})

describe('createOpenWebClient: redirects', () => {
  it('follows a redirect, resolving a relative Location, and reports the final URL', async () => {
    const { client, fetchMock } = setUp()
    fetchMock.mockResolvedValueOnce(redirect('/moved'))
    const response = await client.get(pageRequest('https://a.example/old'))
    expect(response.url).toBe('https://a.example/moved')
  })

  it('checks the address again on every hop, so a redirect cannot reach the inside', async () => {
    const resolve = vi.fn<ResolveHost>(async (host) =>
      host === 'evil.example' ? ['10.0.0.9'] : [PUBLIC_ADDRESS],
    )
    const { client, fetchMock } = setUp({ resolve })
    fetchMock.mockResolvedValueOnce(redirect('https://evil.example/'))
    expect(await failureOf(client.get(pageRequest('https://a.example/')))).toBe('private_address')
    expect(resolve).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('re-resolves each hop, so a rebinding answer on the second hop is caught', async () => {
    const answers = [[PUBLIC_ADDRESS], ['169.254.169.254']]
    const resolve = vi.fn<ResolveHost>(async () => answers.shift() ?? [])
    const { client, fetchMock } = setUp({ resolve })
    fetchMock.mockResolvedValueOnce(redirect('https://a.example/again'))
    expect(await failureOf(client.get(pageRequest('https://a.example/')))).toBe('private_address')
  })

  it('refuses a redirect to another scheme, port or credentials', async () => {
    for (const [location, reason] of [
      ['ftp://a.example/', 'scheme_not_allowed'],
      ['https://a.example:6379/', 'port_not_allowed'],
      ['https://u:p@a.example/', 'credentials_in_url'],
    ] as const) {
      const { client, fetchMock } = setUp()
      fetchMock.mockResolvedValueOnce(redirect(location))
      expect(await failureOf(client.get(pageRequest('https://a.example/')))).toBe(reason)
    }
  })

  it('stops after the redirect cap', async () => {
    const { client, fetchMock } = setUp({ maxRedirects: 5 })
    fetchMock.mockImplementation(async () => redirect('/again'))
    expect(await failureOf(client.get(pageRequest('https://a.example/')))).toBe(
      'too_many_redirects',
    )
    expect(fetchMock).toHaveBeenCalledTimes(6)
  })

  it('refuses a redirect with no Location, or one that is not a URL', async () => {
    const { client, fetchMock } = setUp()
    fetchMock.mockResolvedValueOnce(redirect(null))
    expect(await failureOf(client.get(pageRequest('https://a.example/')))).toBe(
      'redirect_without_location',
    )
    fetchMock.mockResolvedValueOnce(redirect('http://['))
    expect(await failureOf(client.get(pageRequest('https://a.example/')))).toBe('invalid_url')
  })

  it('releases the connection of a response it redirects away from', async () => {
    const { client, fetchMock } = setUp()
    const cancelled = vi.fn<() => void>()
    const body = new ReadableStream<Uint8Array>({ cancel: cancelled })
    fetchMock.mockResolvedValueOnce(
      new Response(body, { status: 301, headers: { location: '/next' } }),
    )
    await client.get(pageRequest('https://a.example/'))
    expect(cancelled).toHaveBeenCalled()
  })
})

describe('createOpenWebClient: a body that will not close', () => {
  it('still follows a redirect when cancelling the old body fails', async () => {
    const { client, fetchMock } = setUp()
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        throw new Error('already destroyed')
      },
    })
    fetchMock.mockResolvedValueOnce(
      new Response(body, { status: 301, headers: { location: '/next' } }),
    )
    expect((await client.get(pageRequest('https://a.example/'))).url).toBe('https://a.example/next')
  })
})

describe('createOpenWebClient: media types and encodings', () => {
  it.each([
    ['application/pdf'],
    ['video/mp4'],
    ['application/octet-stream'],
    ['application/xml'], // XML oEmbed is refused
    ['text/plain'],
    [''],
  ])('refuses %s from a page request, before reading the body', async (mediaType) => {
    const { client, fetchMock } = setUp()
    const cancelled = vi.fn<() => void>()
    const body = new ReadableStream<Uint8Array>({ cancel: cancelled })
    fetchMock.mockResolvedValueOnce(
      new Response(body, {
        status: 200,
        headers: mediaType === '' ? {} : { 'content-type': mediaType },
      }),
    )
    expect(await failureOf(client.get(pageRequest('https://a.example/')))).toBe(
      'content_type_not_allowed',
    )
    expect(cancelled).toHaveBeenCalled()
  })

  it('accepts JSON for a page request, and any image subtype for an image request', async () => {
    const { client, fetchMock } = setUp()
    fetchMock.mockResolvedValueOnce(
      new Response('{}', { headers: { 'content-type': 'application/json; charset=utf-8' } }),
    )
    expect((await client.get(pageRequest('https://a.example/'))).mediaType).toBe('application/json')
    fetchMock.mockResolvedValueOnce(
      new Response('png', { headers: { 'content-type': 'image/webp' } }),
    )
    expect((await client.get(imageRequest('https://a.example/i'))).mediaType).toBe('image/webp')
  })

  it('refuses an image request that is answered with HTML', async () => {
    const { client } = setUp()
    expect(await failureOf(client.get(imageRequest('https://a.example/i')))).toBe(
      'content_type_not_allowed',
    )
  })

  it('refuses a compressed body, since the cap would then count the wrong bytes', async () => {
    for (const encoding of ['gzip', 'br', 'deflate']) {
      const { client, fetchMock } = setUp()
      fetchMock.mockResolvedValueOnce(html('x', { 'content-encoding': encoding }))
      expect(await failureOf(client.get(pageRequest('https://a.example/')))).toBe(
        'content_encoding_not_allowed',
      )
    }
  })

  it('accepts an explicit identity encoding', async () => {
    const { client, fetchMock } = setUp()
    fetchMock.mockResolvedValueOnce(html('x', { 'content-encoding': 'identity' }))
    expect((await client.get(pageRequest('https://a.example/'))).status).toBe(200)
  })
})

/** A body that would never end: reading any of it would hang, so the test proves it is not read. */
function endless(headers: Record<string, string>): { response: Response; cancelled: () => void } {
  const cancelled = vi.fn<() => void>()
  const body = new ReadableStream<Uint8Array>({
    pull: () => new Promise(() => undefined),
    cancel: cancelled,
  })
  return { response: new Response(body, { status: 200, headers }), cancelled }
}

describe('createOpenWebClient: a file, answered from its headers', () => {
  const FILES = ['application/pdf', 'video/*', 'image/*']

  it('reports the type, the declared size and the suggested name, and reads no body', async () => {
    const { client, fetchMock } = setUp()
    const { response, cancelled } = endless({
      'content-type': 'application/pdf',
      'content-length': '482113',
      'content-disposition': 'attachment; filename="q3.pdf"',
    })
    fetchMock.mockResolvedValueOnce(response)
    const result = await client.get({
      ...pageRequest('https://files.example/q3'),
      headersOnly: FILES,
    })
    expect(result).toMatchObject({
      status: 200,
      mediaType: 'application/pdf',
      declaredBytes: 482_113,
      disposition: 'attachment; filename="q3.pdf"',
      truncated: false,
    })
    expect(result.body.byteLength).toBe(0)
    // The transfer is stopped, not left running in the background.
    expect(cancelled).toHaveBeenCalled()
  })

  it('matches a family, and says nothing about a size the host did not declare', async () => {
    const { client, fetchMock } = setUp()
    fetchMock.mockResolvedValueOnce(endless({ 'content-type': 'video/mp4' }).response)
    const result = await client.get({
      ...pageRequest('https://files.example/clip'),
      headersOnly: FILES,
    })
    expect(result).toMatchObject({ mediaType: 'video/mp4', declaredBytes: null, disposition: null })
  })

  it('does not take a declared size that is not a whole number', async () => {
    const { client, fetchMock } = setUp()
    fetchMock.mockResolvedValueOnce(
      endless({ 'content-type': 'application/pdf', 'content-length': '12e3' }).response,
    )
    const result = await client.get({ ...pageRequest('https://a.example/'), headersOnly: FILES })
    expect(result.declaredBytes).toBeNull()
  })

  it('still reads a page as a page, for a request that also accepts files', async () => {
    const { client } = setUp()
    const result = await client.get({ ...pageRequest('https://a.example/'), headersOnly: FILES })
    expect(new TextDecoder().decode(result.body)).toBe('<title>hi</title>')
    expect(result.declaredBytes).toBeUndefined()
  })

  it('refuses a type that is neither a page nor one of the files asked for', async () => {
    const { client, fetchMock } = setUp()
    const { response, cancelled } = endless({ 'content-type': 'application/octet-stream' })
    fetchMock.mockResolvedValueOnce(response)
    expect(
      await failureOf(client.get({ ...pageRequest('https://a.example/'), headersOnly: FILES })),
    ).toBe('content_type_not_allowed')
    expect(cancelled).toHaveBeenCalled()
  })

  it('checks the address and the policy on every hop, as for any other request', async () => {
    const permit = vi.fn<UrlPermit>(() => false)
    const { client, fetchMock } = setUp()
    expect(
      await failureOf(
        client.get({ ...pageRequest('https://a.example/f'), headersOnly: FILES, permit }),
      ),
    ).toBe('blocked_by_policy')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('follows a redirect to the file, and reports where it ended', async () => {
    const { client, fetchMock } = setUp()
    fetchMock
      .mockResolvedValueOnce(redirect('https://cdn.example/final.pdf'))
      .mockResolvedValueOnce(endless({ 'content-type': 'application/pdf' }).response)
    const result = await client.get({
      ...pageRequest('https://go.example/r'),
      headersOnly: FILES,
    })
    expect(result.url).toBe('https://cdn.example/final.pdf')
  })

  it('does not ask for files unless the caller does', async () => {
    const { client, fetchMock } = setUp()
    fetchMock.mockResolvedValueOnce(endless({ 'content-type': 'application/pdf' }).response)
    expect(await failureOf(client.get(pageRequest('https://a.example/')))).toBe(
      'content_type_not_allowed',
    )
  })
})

describe('createOpenWebClient: how much is read', () => {
  it('stops at </head> and does not read the body of the page', async () => {
    const { client, fetchMock } = setUp()
    const cancelled = vi.fn<() => void>()
    const head = text('<html><head><title>T</title></HEAD><body>')
    let sent = false
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent) return new Promise(() => undefined)
        sent = true
        controller.enqueue(head)
        return undefined
      },
      cancel: cancelled,
    })
    fetchMock.mockResolvedValueOnce(
      new Response(body, { headers: { 'content-type': 'text/html' } }),
    )
    const response = await client.get(pageRequest('https://a.example/'))
    expect(new TextDecoder().decode(response.body)).toBe('<html><head><title>T</title></HEAD>')
    expect(response.truncated).toBe(true)
    expect(cancelled).toHaveBeenCalled()
  })

  it('finds a </head> split across chunks, and keeps nothing after it', async () => {
    const { client, fetchMock } = setUp()
    fetchMock.mockResolvedValueOnce(chunked(['<head><title>T</title></he', 'ad><body>never read']))
    const response = await client.get(pageRequest('https://a.example/'))
    expect(new TextDecoder().decode(response.body)).toBe('<head><title>T</title></head>')
  })

  it('finds a marker split at every possible boundary', async () => {
    const page = '<head>x</head><body>'
    for (let cut = 1; cut < page.length; cut += 1) {
      const { client, fetchMock } = setUp()
      fetchMock.mockResolvedValueOnce(chunked([page.slice(0, cut), page.slice(cut)]))
      const response = await client.get(pageRequest('https://a.example/'))
      expect(new TextDecoder().decode(response.body)).toBe('<head>x</head>')
    }
  })

  it('reads a page with no </head> to its end', async () => {
    const { client, fetchMock } = setUp()
    fetchMock.mockResolvedValueOnce(chunked(['<title>a</title>', 'plain text']))
    const response = await client.get(pageRequest('https://a.example/'))
    expect(new TextDecoder().decode(response.body)).toBe('<title>a</title>plain text')
    expect(response.truncated).toBe(false)
  })

  it('truncates an oversized page at the cap and returns what it has', async () => {
    const { client, fetchMock } = setUp()
    const chunk = 'a'.repeat(100 * 1024)
    fetchMock.mockResolvedValueOnce(chunked(Array.from({ length: 8 }, () => chunk)))
    const response = await client.get(pageRequest('https://a.example/'))
    expect(response.body.byteLength).toBe(512 * 1024)
    expect(response.truncated).toBe(true)
  })

  it('does not trust a lying content-length when truncating', async () => {
    const { client, fetchMock } = setUp()
    fetchMock.mockResolvedValueOnce(chunked(['a'.repeat(600 * 1024)], { 'content-length': '10' }))
    const response = await client.get(pageRequest('https://a.example/'))
    expect(response.body.byteLength).toBe(512 * 1024)
  })

  it('rejects an oversized image or JSON document outright', async () => {
    const { client, fetchMock } = setUp()
    fetchMock.mockResolvedValueOnce(
      chunked(['a'.repeat(3 * 1024 * 1024), 'a'.repeat(3 * 1024 * 1024)], {
        'content-type': 'image/png',
      }),
    )
    expect(await failureOf(client.get(imageRequest('https://a.example/i')))).toBe(
      'response_too_large',
    )
    fetchMock.mockResolvedValueOnce(
      chunked(['a'.repeat(300 * 1024)], { 'content-type': 'application/json' }),
    )
    expect(await failureOf(client.get(jsonRequest('https://a.example/o')))).toBe(
      'response_too_large',
    )
  })

  it('rejects an image whose declared length is already over the cap, without reading it', async () => {
    const { client, fetchMock } = setUp()
    const cancelled = vi.fn<() => void>()
    const body = new ReadableStream<Uint8Array>({ cancel: cancelled })
    fetchMock.mockResolvedValueOnce(
      new Response(body, {
        headers: { 'content-type': 'image/png', 'content-length': String(6 * 1024 * 1024) },
      }),
    )
    expect(await failureOf(client.get(imageRequest('https://a.example/i')))).toBe(
      'response_too_large',
    )
    expect(cancelled).toHaveBeenCalled()
  })

  it('returns an empty body for a success that has none', async () => {
    const { client, fetchMock } = setUp()
    fetchMock.mockResolvedValueOnce(
      new Response(null, { headers: { 'content-type': 'application/json' } }),
    )
    const response = await client.get(jsonRequest('https://a.example/'))
    expect(response.body.byteLength).toBe(0)
    expect(response.truncated).toBe(false)
  })
})

describe('createOpenWebClient: time', () => {
  it('times out a host that drips a body forever, counting the body in the budget', async () => {
    const { client, fetchMock } = setUp({ timeoutMs: 40 })
    fetchMock.mockResolvedValueOnce(dripping(['<title>slow</title>']))
    expect(await failureOf(client.get(pageRequest('https://a.example/')))).toBe('timeout')
  })

  it('times out a host that never answers, even one that ignores the abort signal', async () => {
    const { client, fetchMock } = setUp({ timeoutMs: 40 })
    fetchMock.mockImplementationOnce(() => new Promise<OutboundFetchResponse>(() => undefined))
    expect(await failureOf(client.get(pageRequest('https://a.example/')))).toBe('timeout')
  })

  it('times out a DNS lookup that hangs', async () => {
    const { client } = setUp({ timeoutMs: 40, resolve: () => new Promise(() => undefined) })
    expect(await failureOf(client.get(pageRequest('https://a.example/')))).toBe('timeout')
  })

  it('shares one budget across redirects', async () => {
    const { client, fetchMock } = setUp({ timeoutMs: 60 })
    fetchMock.mockImplementation(async () => {
      await new Promise((done) => setTimeout(done, 25))
      return redirect('/again')
    })
    expect(await failureOf(client.get(pageRequest('https://a.example/')))).toBe('timeout')
  })

  it('aborts the transport when the budget runs out', async () => {
    const { client, fetchMock } = setUp({ timeoutMs: 30 })
    let signal: AbortSignal | undefined
    fetchMock.mockImplementationOnce((_url, init) => {
      signal = init.signal
      return new Promise<OutboundFetchResponse>(() => undefined)
    })
    await failureOf(client.get(pageRequest('https://a.example/')))
    expect(signal?.aborted).toBe(true)
  })

  it('reports a transport error as a network error, not a timeout', async () => {
    const { client, fetchMock } = setUp()
    fetchMock.mockRejectedValueOnce(new Error('ECONNRESET'))
    expect(await failureOf(client.get(pageRequest('https://a.example/')))).toBe('network_error')
  })

  it('reports a body that errors mid-stream as a network error', async () => {
    const { client, fetchMock } = setUp()
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(text('<title>'))
        controller.error(new Error('socket hang up'))
      },
    })
    fetchMock.mockResolvedValueOnce(
      new Response(body, { headers: { 'content-type': 'text/html' } }),
    )
    expect(await failureOf(client.get(pageRequest('https://a.example/')))).toBe('network_error')
  })
})

const only = (host: string) => (url: URL) => url.hostname === host

describe('createOpenWebClient: policy', () => {
  it('asks the policy about the first URL, before any lookup or connection', async () => {
    const { client, fetchMock, resolve } = setUp()
    expect(
      await failureOf(
        client.get({ ...pageRequest('https://blocked.example/'), permit: only('ok.example') }),
      ),
    ).toBe('blocked_by_policy')
    expect(resolve).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('asks the policy about every redirect, so a redirect cannot walk around it', async () => {
    const { client, fetchMock } = setUp()
    fetchMock.mockResolvedValueOnce(redirect('https://blocked.example/inside'))
    const permit = vi.fn<UrlPermit>(only('ok.example'))
    expect(await failureOf(client.get({ ...pageRequest('https://ok.example/'), permit }))).toBe(
      'blocked_by_policy',
    )
    expect(permit.mock.calls.map(([url]) => url.hostname)).toEqual([
      'ok.example',
      'blocked.example',
    ])
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('lets a permitted request through', async () => {
    const { client } = setUp()
    const response = await client.get({
      ...pageRequest('https://ok.example/'),
      permit: only('ok.example'),
    })
    expect(response.status).toBe(200)
  })

  it('does not ask the policy about a URL that is refused anyway', async () => {
    const { client } = setUp()
    const permit = vi.fn<UrlPermit>(() => true)
    expect(await failureOf(client.get({ ...pageRequest('ftp://ok.example/'), permit }))).toBe(
      'scheme_not_allowed',
    )
    expect(permit).not.toHaveBeenCalled()
  })
})

describe('createOpenWebClient: load', () => {
  it('refuses work beyond its queue as busy, rather than opening another connection', async () => {
    const { client, fetchMock } = setUp({ maxConcurrent: 1, maxQueued: 0 })
    const gate = Promise.withResolvers<OutboundFetchResponse>()
    fetchMock.mockImplementationOnce(() => gate.promise)
    const first = client.get(pageRequest('https://a.example/'))
    expect(await failureOf(client.get(pageRequest('https://b.example/')))).toBe('too_busy')
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    gate.resolve(html('<title>slow</title>'))
    expect((await first).status).toBe(200)
  })

  it('does not count the time spent waiting for a slot against the budget', async () => {
    const { client, fetchMock } = setUp({ maxConcurrent: 1, maxQueued: 4, timeoutMs: 120 })
    fetchMock.mockImplementationOnce(async () => {
      await new Promise((done) => setTimeout(done, 90))
      return html('<title>first</title>')
    })
    const first = client.get(pageRequest('https://a.example/'))
    const second = client.get(pageRequest('https://b.example/'))
    expect((await first).status).toBe(200)
    expect((await second).status).toBe(200)
  })
})

describe('createOpenWebClient: the record of a fetch', () => {
  it('tells the observer how it went, with the host and nothing of the address after it', async () => {
    const observe = vi.fn<(event: FetchEvent) => void>()
    const { client } = setUp({ observe })
    await client.get(pageRequest('https://blog.example/secret/path?token=abc123#frag'))
    expect(observe).toHaveBeenCalledOnce()
    const event = observe.mock.calls[0]?.[0]
    expect(event).toMatchObject({
      host: 'blog.example',
      purpose: 'page',
      outcome: 'ok',
      status: 200,
      redirects: 0,
      bytes: '<title>hi</title>'.length,
    })
    expect(event?.durationMs).toBeGreaterThanOrEqual(0)
    expect(JSON.stringify(event)).not.toContain('abc123')
    expect(JSON.stringify(event)).not.toContain('secret')
  })

  it('says what each request was for', async () => {
    const observe = vi.fn<(event: FetchEvent) => void>()
    const { client, fetchMock } = setUp({ observe })
    fetchMock.mockResolvedValueOnce(
      new Response('{}', { headers: { 'content-type': 'application/json' } }),
    )
    await client.get(jsonRequest('https://blog.example/oembed'))
    fetchMock.mockResolvedValueOnce(
      new Response('png', { headers: { 'content-type': 'image/png' } }),
    )
    await client.get(imageRequest('https://blog.example/i.png'))
    expect(observe.mock.calls.map(([event]) => event.purpose)).toEqual(['oembed', 'image'])
  })

  it('counts redirects, and reports the status it ended on', async () => {
    const observe = vi.fn<(event: FetchEvent) => void>()
    const { client, fetchMock } = setUp({ observe })
    fetchMock.mockResolvedValueOnce(redirect('/a'))
    fetchMock.mockResolvedValueOnce(redirect('/b'))
    await client.get(pageRequest('https://blog.example/'))
    expect(observe.mock.calls[0]?.[0]).toMatchObject({ redirects: 2, status: 200 })
  })

  it('reports why a fetch failed, as the reason and nothing more', async () => {
    const observe = vi.fn<(event: FetchEvent) => void>()
    const { client } = setUp({ observe, resolve: async () => ['10.0.0.1'] })
    await failureOf(client.get(pageRequest('https://internal.example/x?token=zzz')))
    expect(observe.mock.calls[0]?.[0]).toMatchObject({
      host: 'internal.example',
      outcome: 'private_address',
      status: null,
      bytes: 0,
    })
    expect(JSON.stringify(observe.mock.calls)).not.toContain('zzz')
  })

  it('reports a fetch that was refused before it began, with a host it could not read as a marker', async () => {
    const observe = vi.fn<(event: FetchEvent) => void>()
    const { client } = setUp({ observe })
    await failureOf(client.get(pageRequest('not a url')))
    expect(observe.mock.calls[0]?.[0]).toMatchObject({
      host: '[invalid url]',
      outcome: 'invalid_url',
    })
  })

  it('does not let a failing observer break the fetch it describes', async () => {
    const { client } = setUp({
      observe: () => {
        throw new Error('log disk full')
      },
    })
    expect((await client.get(pageRequest('https://blog.example/'))).status).toBe(200)
  })

  it('works without an observer', async () => {
    const { client } = setUp()
    expect((await client.get(pageRequest('https://blog.example/'))).status).toBe(200)
  })
})
