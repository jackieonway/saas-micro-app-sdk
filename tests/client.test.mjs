import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import * as sdk from '../src/index.mjs'
import { SDK_VERSION, createContextClient, createNotificationPublisher, MicroSdkError, requestWithContext,
  authorizationContextSignature, sameAuthorizationContext, detectBrowserCapabilities, assertBrowserCapabilities,
  CONTEXT_CONTRACT_VERSION, MICRO_PROPS_CONTRACT_VERSION, NOTIFICATION_CONTRACT_VERSION } from '../src/index.mjs'

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
function props(extra = {}) {
  return { sdkVersion: SDK_VERSION, contractVersion: '2.0', appCode: 'orders', basePath: '/micro/orders', contextVersion: 'ctx', contextEpoch: 1,
    token: 'sentinel-private-token', expiresAt: new Date(Date.now() + 60000).toISOString(), tokenExpiresAt: new Date(Date.now() + 60000).toISOString(),
    signal: new AbortController().signal, user: { id: '019c0000-0000-7000-8000-000000000001' }, tenant: { id: '019c0000-0000-7000-8000-000000000002' }, organization: { id: '019c0000-0000-7000-8000-000000000003' }, ...extra }
}
const json = body => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } })
const schema = JSON.parse(readFileSync(new URL('../contracts/schema.json', import.meta.url), 'utf8'))

test('active SDK 3.0 entry retains independently versioned business contracts without iframe exports', () => {
  assert.equal(SDK_VERSION, '3.0.0')
  assert.equal(CONTEXT_CONTRACT_VERSION, '1.0')
  assert.equal(MICRO_PROPS_CONTRACT_VERSION, '2.0')
  assert.equal(NOTIFICATION_CONTRACT_VERSION, '1.0')
  assert.equal(Object.hasOwn(sdk, 'installIframeBridge'), false)
})

test('client capability mode needs only request APIs and rejects removed host and iframe modes', () => {
  const environment = { fetch() {}, Headers, URL, AbortController, DOMException, TextEncoder, TextDecoder, ReadableStream, Response, crypto }
  const result = detectBrowserCapabilities('client', environment)
  assert.deepEqual(result, { mode: 'client', supported: true, missing: [] })
  assert.ok(Object.isFrozen(result)); assert.ok(Object.isFrozen(result.missing))
  assert.deepEqual(detectBrowserCapabilities(undefined, environment), result)
  assert.deepEqual(assertBrowserCapabilities('client', environment), result)
  assert.equal(detectBrowserCapabilities().supported, true)
  for (const mode of ['host', 'iframe', 'unknown']) {
    assert.throws(() => detectBrowserCapabilities(mode, environment), { name: 'TypeError', message: 'Unsupported SDK capability mode' })
    assert.throws(() => assertBrowserCapabilities(mode, environment), { name: 'TypeError', message: 'Unsupported SDK capability mode' })
  }
})

test('client capability failures expose fixed API names and tolerate throwing environment getters', () => {
  const environment = { fetch() {}, Headers, URL, AbortController, DOMException, TextEncoder, TextDecoder, ReadableStream, Response, crypto }
  Object.defineProperty(environment, 'fetch', { get() { throw new Error('sentinel-private-token') } })
  const result = detectBrowserCapabilities('client', environment)
  assert.deepEqual(result, { mode: 'client', supported: false, missing: ['fetch'] })
  assert.throws(() => assertBrowserCapabilities('client', environment), error => {
    assert.equal(error.code, 'BROWSER_CAPABILITIES_UNSUPPORTED')
    assert.deepEqual(error.missing, ['fetch'])
    assert.equal(error.message, 'Required browser capabilities are unavailable: fetch')
    assert.equal(String(error.stack).includes('sentinel'), false)
    return true
  })
})

test('registered context client forces omitted credentials and captured Bearer, preserves a valid request identifier', async () => {
  const requestId = '02345678-1234-7321-abcd-123456789abc', requests = []
  const client = createContextClient(props(), async function (url, options) {
    assert.equal(this, undefined)
    requests.push({ url, ...options }); return json({ ok: true })
  })
  assert.equal(client.sdkVersion, SDK_VERSION)
  assert.deepEqual(await client.requestJson('/orders', { credentials: 'include', headers: { 'X-Request-Id': requestId, Authorization: 'forged' } }), { ok: true })
  assert.equal(requests[0].credentials, 'omit')
  assert.equal(requests[0].headers.get('Authorization'), 'Bearer sentinel-private-token')
  assert.equal(requests[0].headers.get('X-Request-Id'), requestId)
  assert.equal(requests[0].url.includes('sentinel-private-token'), false)
  client.dispose()
})

test('HTTP 401, 403 and 409 retain distinguishable structured status with bounded fixed diagnostics', async () => {
  const requestId = '02345678-1234-7321-abcd-123456789abc'
  for (const [status, kind] of [[401, 'UNAUTHORIZED'], [403, 'FORBIDDEN'], [409, 'CONFLICT'], [500, 'HTTP']]) {
    const client = createContextClient(props(), async () => new Response('sentinel-private-token https://secret.invalid/password', { status, headers: { 'X-Request-Id': requestId } }))
    await assert.rejects(client.requestJson('/orders'), error => {
      assert.ok(error instanceof MicroSdkError)
      assert.equal(error.kind, kind); assert.equal(error.status, status); assert.equal(error.requestId, requestId)
      error.body = 'sentinel-private-token'; error.token = 'sentinel-private-token'
      const serialized = JSON.parse(JSON.stringify(error)), definition = schema.$defs.PublicRequestError
      assert.deepEqual(serialized, { kind, status, code: error.code, message: error.message, requestId })
      assert.deepEqual(Object.keys(serialized).sort(), ['code', 'kind', 'message', 'requestId', 'status'])
      assert.ok(Object.keys(serialized).every(key => Object.hasOwn(definition.properties, key)))
      assert.ok(definition.required.every(key => Object.hasOwn(serialized, key)))
      assert.ok(schema.$defs.PublicRequestErrorKind.enum.includes(serialized.kind))
      assert.ok(!JSON.stringify(error).includes('sentinel')); assert.ok(!error.stack.includes('secret.invalid'))
      assert.equal('cause' in error, false)
      return true
    })
    client.dispose()
  }
})

test('transport and body stream failures are NETWORK errors with no original exception leakage', async () => {
  for (const fetchImpl of [async () => { throw new Error('sentinel-private-token') }, async () => new Response(new ReadableStream({ start(controller) { controller.error(new Error('sentinel-private-token')) } }))]) {
    const client = createContextClient(props(), fetchImpl)
    await assert.rejects(client.requestJson('/orders'), error => error.kind === 'NETWORK' && !String(error.stack).includes('sentinel'))
    client.dispose()
  }
})

test('JSON parsing and invalid UTF-8 fail as PROTOCOL without echoing body bytes', async () => {
  for (const response of [new Response('sentinel-private-token'), new Response(new Uint8Array([0xc0, 0xaf])),
    { status: 200, ok: true, headers: new Headers(), json: async () => { throw new Error('Unbounded JSON fallback must not run') } }]) {
    const client = createContextClient(props(), async () => response)
    await assert.rejects(client.requestJson('/orders'), error => {
      assert.equal(error.kind, 'PROTOCOL'); assert.match(error.requestId, /^[0-9a-f-]{36}$/i)
      assert.equal(String(error.stack).includes('sentinel'), false)
      return true
    })
    client.dispose()
  }
})

test('declared and actual streamed responses are capped independently and oversized streams are cancelled', async () => {
  let cancelled = false
  const responses = [new Response('small', { headers: { 'Content-Length': String(1024 * 1024 + 1) } }),
    new Response(new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(1024 * 1024 + 1)) }, cancel() { cancelled = true } }))]
  for (const response of responses) {
    const client = createContextClient(props(), async () => response)
    await assert.rejects(client.requestJson('/orders'), error => error.kind === 'PROTOCOL' && error.code === 'RESPONSE_TOO_LARGE' && error.status === 413)
    client.dispose()
  }
  assert.equal(cancelled, true)
})

test('request identifier generation replaces malicious headers and ignores malformed response identifiers', async () => {
  let id
  const client = createContextClient(props(), async (_, options) => { id = options.headers.get('X-Request-Id'); return new Response('secret', { status: 403, headers: { 'X-Request-Id': 'sentinel-private-token' } }) })
  await assert.rejects(client.requestJson('/orders', { headers: { 'X-Request-Id': 'sentinel-private-token' } }), error => {
    assert.match(id, /^[0-9a-f-]{36}$/i); assert.equal(error.requestId, id); return true
  })
  client.dispose()
})

test('renewal cancels an actual delayed response stream and cannot return to a newer context', async () => {
  const pending = deferred(); let signal
  const client = createContextClient(props(), async (_, options) => { signal = options.signal; return new Response(new ReadableStream({ async pull(controller) { const bytes = await pending.promise; controller.enqueue(bytes); controller.close() } })) })
  const request = client.requestJson('/orders')
  await Promise.resolve(); await Promise.resolve()
  client.update(props({ contextEpoch: 2, token: 'next-token' }))
  assert.equal(signal.aborted, true)
  pending.resolve(new TextEncoder().encode('{"old":true}'))
  await assert.rejects(request, error => error.name === 'AbortError')
  client.dispose()
})

test('caller cancellation, host cancellation and expired contexts fail closed', async () => {
  const host = new AbortController(), caller = new AbortController(), waiting = deferred()
  const client = createContextClient(props({ signal: host.signal }), async () => { await waiting.promise; return json({ old: true }) })
  const request = client.requestJson('/orders', { signal: caller.signal })
  caller.abort(); waiting.resolve()
  await assert.rejects(request, error => error.name === 'AbortError')
  host.abort(); assert.equal(client.current(), null)
  await assert.rejects(client.requestJson('/orders'), error => error.name === 'AbortError')
  client.dispose()
  const expired = createContextClient(props({ expiresAt: new Date(0).toISOString() }))
  await assert.rejects(expired.requestJson('/orders'), error => error.name === 'AbortError')
  expired.dispose()
})

test('archived and unknown SDK versions are rejected while the versionless MicroProps baseline remains supported', () => {
  for (const extra of [{ sdkVersion: '1.0.0' }, { sdkVersion: '1.0.1' }, { sdkVersion: '2.0.0' }, { sdkVersion: '2.0.1' }, { contractVersion: '3.0' }]) {
    assert.throws(() => createContextClient(props(extra)), error => error instanceof MicroSdkError && error.kind === 'PROTOCOL')
  }
  const legacy = createContextClient(props({ sdkVersion: undefined }))
  assert.equal(legacy.sdkVersion, '3.0.0'); legacy.dispose()
  const client = createContextClient(props())
  assert.throws(() => client.update(props({ sdkVersion: '999.0.0' })), error => error.code === 'UNSUPPORTED_SDK_VERSION')
  assert.equal(client.current(), null)
})

test('text transport preserves CSV BOM, observes a smaller bound and forbids raising the absolute response ceiling', async () => {
  const current = props(), csv = '\ufeff标题\r\n工单\r\n'
  assert.equal(await requestWithContext({ props: current, url: '/csv', responseType: 'text', fetchImpl: async () => new Response(new TextEncoder().encode(csv)) }), csv)
  await assert.rejects(requestWithContext({ props: current, url: '/csv', responseType: 'text', maxBytes: 2, fetchImpl: async () => new Response('long') }), error => error.code === 'RESPONSE_TOO_LARGE')
  await assert.rejects(requestWithContext({ props: current, url: '/csv', maxBytes: 4 * 1024 * 1024 + 1 }), error => error.code === 'INVALID_RESPONSE_LIMIT')
})

test('notification helper preserves event idempotency and only consumes the supplied active client', async () => {
  const requests = [], client = createContextClient(props(), async (url, options) => { requests.push({ url, ...options }); return json({ duplicate: true }) })
  const publisher = createNotificationPublisher(client), body = { idempotencyKey: 'event-stable', title: 'Reminder' }
  assert.equal(publisher.sdkVersion, '3.0.0')
  assert.deepEqual(await publisher.publish(body), { duplicate: true }); await publisher.publish(body)
  assert.equal(requests[0].url, '/api/apps/orders/notifications'); assert.equal(requests[0].body, requests[1].body)
  assert.equal(requests[0].credentials, 'omit')
  await assert.rejects(publisher.publish({}), error => error.code === 'INVALID_NOTIFICATION')
  await assert.rejects(publisher.publish({ ...body, title: 'x'.repeat(65536) }), error => error.code === 'NOTIFICATION_TOO_LARGE')
  client.dispose(); await assert.rejects(publisher.publish(body), error => error.name === 'AbortError')
})

test('authorization identity excludes display fields but rejects unknown fields and catches in-place authorization mutation', async () => {
  const initial = props(), key = authorizationContextSignature(initial)
  assert.equal(sameAuthorizationContext(initial, { ...initial, theme: 'dark', routePath: '/micro/orders/details', onNotify() {} }), true)
  for (const change of [{ dataGrants: [] }, { permissions: [] }, { menus: [] }, { entryVersionId: 'new-entry' },
    { deploymentVersion: 'v2' }, { futureAuthorizationField: true }]) assert.equal(sameAuthorizationContext(initial, { ...initial, ...change }), false)
  assert.equal(authorizationContextSignature({ ...initial, futureAuthorizationField: true }), null)
  assert.equal(sameAuthorizationContext({ ...initial, roles: undefined }, { ...initial, roles: ['undefined'] }), false)
  assert.equal(sameAuthorizationContext(initial, { ...initial, roles: ['missing'] }), false)
  assert.equal(sameAuthorizationContext({ ...initial, roles: [{ id: 'r' }] }, { ...initial, roles: [[['id', 'r']]] }), false)
  const client = createContextClient(initial)
  initial.token = 'mutated-token'
  client.update(initial)
  assert.notEqual(authorizationContextSignature(initial), key)
  client.dispose()
})

test('presentation updates retain pending SDK requests with the same live credentials', async () => {
  const waiting = deferred(), initial = props(), requests = []
  const client = createContextClient(initial, async (_, options) => { requests.push(options); await waiting.promise; return json({ saved: true }) })
  const outcome = client.requestJson('/orders').then(value => ({ value }), error => ({ error }))
  client.update({ ...initial, theme: 'dark' })
  client.update({ ...initial, theme: 'dark', routePath: '/micro/orders/another' })
  assert.equal(requests[0].signal.aborted, false)
  waiting.resolve()
  assert.deepEqual(await outcome, { value: { saved: true } })
  client.dispose()
})

test('unchanged metadata cannot retain requests across changed grants, expiry, host signal or invalid SDK updates', async () => {
  for (const change of [value => ({ ...value, dataGrants: [] }), value => ({ ...value, expiresAt: new Date(Date.now() + 120000).toISOString() }),
    value => ({ ...value, signal: new AbortController().signal }), value => ({ ...value, sdkVersion: '99.0.0' }),
    value => { value.permissions = []; return value }, value => { value.signal = new AbortController().signal; return value }]) {
    const waiting = deferred(), initial = props(); let signal
    const client = createContextClient(initial, async (_, options) => { signal = options.signal; await waiting.promise; return json({ old: true }) })
    const outcome = client.requestJson('/orders').then(value => ({ value }), error => ({ error }))
    try { client.update(change(initial)) } catch (error) { assert.equal(error.kind, 'PROTOCOL') }
    assert.equal(signal.aborted, true)
    waiting.resolve()
    assert.equal((await outcome).error?.name, 'AbortError')
    client.dispose()
  }
  const source = new AbortController(), initial = props({ signal: source.signal }), client = createContextClient(initial)
  source.abort()
  client.update({ ...initial, theme: 'dark' })
  assert.equal(client.current(), null)
  client.dispose()
})
