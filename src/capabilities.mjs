const clientChecks = Object.freeze([
  ['fetch', (env) => typeof env.fetch === 'function'],
  ['Headers', (env) => typeof env.Headers === 'function'],
  ['URL', (env) => typeof env.URL === 'function'],
  ['AbortController', (env) => typeof env.AbortController === 'function'],
  ['DOMException', (env) => typeof env.DOMException === 'function'],
  ['TextEncoder', (env) => typeof env.TextEncoder === 'function'],
  ['TextDecoder', (env) => typeof env.TextDecoder === 'function'],
  ['ReadableStream', (env) => typeof env.ReadableStream === 'function'],
  ['Response.body', (env) => typeof env.Response === 'function' && 'body' in env.Response.prototype],
  ['crypto.randomUUID', (env) => typeof env.crypto?.randomUUID === 'function'],
])

const modeChecks = Object.freeze({
  client: clientChecks,
})

/** Check only browser APIs used by the authorization HTTP client. */
export function detectBrowserCapabilities(mode = 'client', environment = globalThis) {
  if (!Object.hasOwn(modeChecks, mode)) throw new TypeError('Unsupported SDK capability mode')
  const missing = modeChecks[mode].filter(([, check]) => {
    try { return !check(environment) } catch { return true }
  }).map(([name]) => name)
  return Object.freeze({ mode, supported: missing.length === 0, missing: Object.freeze(missing) })
}

/** Throws a bounded diagnostic containing API names only, never browser or application input. */
export function assertBrowserCapabilities(mode = 'client', environment = globalThis) {
  const result = detectBrowserCapabilities(mode, environment)
  if (!result.supported) {
    const error = new Error('Required browser capabilities are unavailable: ' + result.missing.join(', '))
    error.code = 'BROWSER_CAPABILITIES_UNSUPPORTED'
    error.missing = result.missing
    throw error
  }
  return result
}
