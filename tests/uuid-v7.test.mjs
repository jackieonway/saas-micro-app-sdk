import assert from 'node:assert/strict'
import test from 'node:test'
import { newUuid, isUuidV7 } from '../src/uuid.mjs'
import { requestWithContext, createContextClient, detectBrowserCapabilities, MicroSdkError } from '../src/index.mjs'

const legacyV4 = '019c0000-0000-4000-8000-000000000001'
const nil = '00000000-0000-0000-0000-000000000000'
const badVariant = '019c0000-0000-7000-c000-000000000001'
const props = () => ({
  contractVersion: '2.0', appCode: 'orders', basePath: '/micro/orders',
  contextVersion: 'fixture', contextEpoch: 1, token: 'fixture-token',
  signal: new AbortController().signal,
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  tokenExpiresAt: new Date(Date.now() + 60_000).toISOString(),
  user: { id: newUuid() }, tenant: { id: newUuid() }, organization: { id: newUuid() },
})

test('maintained SDK generator creates unique v7 identifiers with RFC variant', () => {
  const values = Array.from({ length: 10_000 }, newUuid)
  assert.equal(new Set(values).size, values.length)
  assert.ok(values.every(isUuidV7))
})

test('same-millisecond and backwards-clock calls stay unique within the runtime', t => {
  let now = Date.now()
  t.mock.method(Date, 'now', () => now)
  const first = newUuid(), second = newUuid()
  now -= 60_000
  const afterRollback = newUuid()
  assert.ok([first, second, afterRollback].every(isUuidV7))
  assert.ok(first < second && second < afterRollback)
})

test('old or malformed request identifiers are replaced and never echoed as system request IDs', async () => {
  for (const supplied of [legacyV4, nil, badVariant, 'external-correlation']) {
    let sent
    const value = await requestWithContext({
      props: props(), url: '/fixture', options: { headers: { 'X-Request-Id': supplied } },
      fetchImpl: async (_, options) => {
        sent = options.headers.get('X-Request-Id')
        return new Response('{}', { headers: { 'X-Request-Id': supplied } })
      },
    })
    assert.deepEqual(value, {})
    assert.ok(isUuidV7(sent)); assert.notEqual(sent, supplied)
    assert.equal(new MicroSdkError('HTTP', { requestId: supplied }).requestId, undefined)
  }
})

test('context identities reject legacy UUIDs, nil and non-RFC variants before transport', async () => {
  for (const id of [legacyV4, nil, badVariant]) {
    for (const change of [
      value => { value.user.id = id },
      value => { value.organizationScopeIds = [id] },
      value => { value.roles = [{ id }] },
      value => { value.menus = [{ id: newUuid(), children: [{ id }] }] },
      value => { value.entryVersionId = id },
      value => { value.dataGrants = [{ subjectUserId: id, tenantId: newUuid(), organizationIds: [] }] },
    ]) {
      const context = props(); change(context)
      assert.throws(() => createContextClient(context), error => error.code === 'UNSUPPORTED_MICRO_PROPS')
      await assert.rejects(requestWithContext({ props: context, url: '/fixture' }), error => error.code === 'UNSUPPORTED_MICRO_PROPS')
    }
  }
})

test('v7 browser capability requires cryptographic random values, not native v4 generation', () => {
  const result = detectBrowserCapabilities('client', { ...globalThis,
    fetch, Headers, URL, AbortController, DOMException, TextEncoder, TextDecoder, ReadableStream, Response,
    crypto: { randomUUID() { throw new Error('v4 must not be used') } },
  })
  assert.deepEqual(result.missing, ['crypto.getRandomValues'])
})
