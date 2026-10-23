import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import os from 'node:os'
import path from 'node:path'
import { syncSdk, generateArtifacts, validateRelease } from '../tools/generate.mjs'
import { SDK_VERSION, isSupportedSdkVersion, assertSupportedSdkVersion } from '../generated/protocol.mjs'
import { createWorkspace } from '../tools/workspace.mjs'

const workspace = createWorkspace()
const root = workspace.directory
test.after(() => workspace.dispose())
await syncSdk({ root })
const sdk = 'examples/micro-app-sdk'
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const release = JSON.parse(readFileSync(path.join(root, sdk, 'release.json')))
function isolated(t) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'saas-sdk-'))
  t.after(() => {
    const absolute = path.resolve(directory), parent = path.resolve(os.tmpdir())
    assert(absolute.startsWith(parent + path.sep) && path.basename(absolute).startsWith('saas-sdk-'))
    rmSync(absolute, { recursive: true, force: true })
  })
  mkdirSync(path.join(directory, 'examples'), { recursive: true })
  cpSync(path.join(root, sdk), path.join(directory, sdk), { recursive: true })
  return directory
}

test('fixed generation is deterministic and only produces current SDK artifacts', async () => {
  const first = await generateArtifacts({ root }), second = await generateArtifacts({ root })
  assert.deepEqual([...first.artifacts], [...second.artifacts])
  assert([...first.artifacts.keys()].every(file => file.startsWith(sdk + '/')))
  assert(![...first.artifacts.keys()].some(file => /releases\/1\.0\.0|bridge|compat/.test(file)))
  assert.equal((await syncSdk({ root, check: true })).sdkVersion, '2.0.0')
  const manifest = JSON.parse(readFileSync(path.join(root, sdk, 'releases', SDK_VERSION, 'artifact-manifest.json')))
  for (const file of manifest.files) {
    const bytes = readFileSync(path.join(root, sdk, 'releases', SDK_VERSION, file.path))
    assert.equal(bytes.length, file.bytes, file.path)
    assert.equal(sha(bytes), file.sha256, file.path)
  }
  assert.deepEqual(manifest.contracts, { context: '1.0', microProps: '2.0', notification: '1.0' })
  const schema = JSON.parse(readFileSync(path.join(root, sdk, 'generated/schema.json')))
  assert.deepEqual(schema.$defs.MicroEntryType.enum, ['HTML'])
  assert.deepEqual(schema.$defs.MicroRuntimeMode.enum, ['TRUSTED'])
})

test('generated file drift fails check without rewriting the changed input', async t => {
  const directory = isolated(t)
  const { artifacts } = await generateArtifacts({ root: directory })
  for (const file of artifacts.keys()) {
    const target = path.join(directory, file), original = readFileSync(target)
    const altered = Buffer.concat([original, Buffer.from('\n')])
    writeFileSync(target, altered)
    await assert.rejects(syncSdk({ root: directory, check: true }), /SDK artifact drift/)
    assert.deepEqual(readFileSync(target), altered, 'CHECK must not repair drift')
    writeFileSync(target, original)
  }
  assert.equal((await syncSdk({ root: directory, check: true })).status, 'PASS')
})

test('unregistered active release files are rejected without deletion', async t => {
  const directory = isolated(t)
  const target = path.join(directory, sdk, 'releases', SDK_VERSION, 'unexpected.js')
  writeFileSync(target, '/* unregistered artifact */')
  await assert.rejects(syncSdk({ root: directory, check: true }), /Unregistered files/)
  await assert.rejects(syncSdk({ root: directory }), /Unregistered files/)
  assert.equal(readFileSync(target, 'utf8'), '/* unregistered artifact */')
})

test('only current registered SDK versions are accepted without echoing unsupported input', () => {
  assert.equal(isSupportedSdkVersion(SDK_VERSION), true)
  for (const version of ['1.0.0', '1.99.0', '2.0.1', 'sentinel-private-token', null, {}]) {
    assert.equal(isSupportedSdkVersion(version), false)
    assert.throws(() => assertSupportedSdkVersion(version), error => error.code === 'UNSUPPORTED_SDK_VERSION' && !String(error).includes('sentinel'))
  }
  assert.throws(() => validateRelease({ ...release, sdkVersion: '../private' }))
  assert.throws(() => validateRelease({ ...release, supportedSdkVersions: [SDK_VERSION, '1.0.0'] }))
  assert.throws(() => validateRelease({ ...release, legacy: [] }))
  assert.throws(() => validateRelease({ ...release, contracts: { ...release.contracts, iframe: '2.0' } }))
})

test('release 1.0.0 remains the exact immutable archive and is never regenerated', async () => {
  const base = path.join(root, sdk, 'releases/1.0.0')
  const originalManifest = readFileSync(path.join(base, 'artifact-manifest.json'))
  assert.equal(sha(originalManifest), 'd3137ecd7588e59df7151b5c533adfdc0a72eedf36138f038928538cf914b1dc')
  const manifest = JSON.parse(originalManifest)
  assert.equal(manifest.sdkVersion, '1.0.0')
  for (const file of manifest.files) {
    const bytes = readFileSync(path.join(base, file.path))
    assert.equal(bytes.length, file.bytes, file.path)
    assert.equal(sha(bytes), file.sha256, file.path)
  }
  await syncSdk({ root })
  assert.deepEqual(readFileSync(path.join(base, 'artifact-manifest.json')), originalManifest)
})

test('classic package installs only MicroSdk and no bridge, lifecycle or channel APIs', () => {
  const classic = readFileSync(path.join(root, sdk, 'releases/2.0.0/sdk.js'), 'utf8')
  assert.doesNotMatch(classic, /installIframeBridge|MicroIframe|__MICRO_APP__|MessageChannel|MessagePort|IFRAME_PROTOCOL_VERSION/)
  const window = {}
  vm.runInNewContext(classic, { window })
  assert.deepEqual(Object.keys(window), ['MicroSdk'])
  assert.equal(window.MicroSdk.sdkVersion, '2.0.0')
  assert.equal(Object.isFrozen(window.MicroSdk), true)
  for (const key of ['createContextClient', 'createNotificationPublisher', 'requestWithContext']) assert.equal(typeof window.MicroSdk[key], 'function')
})

test('standalone release declarations expose standard qiankun props and reject removed APIs and modes', t => {
  const directory = isolated(t)
  const require = createRequire(new URL('../package.json', import.meta.url)), ts = require('typescript')
  const module = path.join(directory, sdk, 'releases/2.0.0/index.mjs').replaceAll('\\', '/')
  const file = path.join(directory, 'consumer.mts')
  writeFileSync(file, `import {SDK_VERSION,createContextClient,MicroSdkError,detectBrowserCapabilities} from ${JSON.stringify(module)}\n`
    + `import type {MicroProps,AppAuthorizationContext,NotificationPublishBody,QiankunProps,QiankunLifecycle,MicroEntryType,MicroRuntimeMode} from ${JSON.stringify(module)}\n`
    + `declare const business:MicroProps;declare const container:HTMLElement\n`
    + `const props:QiankunProps={container,platform:business,services:{downloadCsv:async file=>{const name:string=file.filename;void name}}}\n`
    + `const lifecycle:QiankunLifecycle={bootstrap:async p=>{p.platform.onNavigate(p.platform.basePath)},mount:async p=>{p.container.replaceChildren()},unmount:async()=>{},update:async p=>{p.platform.onNotify('updated')}}\n`
    + `const client=createContextClient(business);const version:typeof SDK_VERSION=client.sdkVersion\n`
    + `const contextVersion:AppAuthorizationContext['contractVersion']='1.0';const target:NotificationPublishBody['target']={kind:'TENANT'}\n`
    + `detectBrowserCapabilities('client');const entry:MicroEntryType='HTML';const runtime:MicroRuntimeMode='TRUSTED'\n`
    + `// @ts-expect-error removed custom lifecycle\nimport type {MicroLifecycle} from ${JSON.stringify(module)}\n`
    + `// @ts-expect-error removed bridge\nimport {installIframeBridge} from ${JSON.stringify(module)}\n`
    + `// @ts-expect-error removed capability mode\ndetectBrowserCapabilities('iframe')\n`
    + `// @ts-expect-error removed entry mode\nconst removed:MicroEntryType='ESM'\n`
    + `// @ts-expect-error removed runtime mode\nconst removedRuntime:MicroRuntimeMode='IFRAME'\n`
    + `// @ts-expect-error unknown wire version\nconst unknown:MicroProps['contractVersion']='3.0'\n`
    + `// @ts-expect-error archived SDK version\nconst oldSdk:MicroProps['sdkVersion']='1.0.0'\n`
    + `void [props,lifecycle,version,contextVersion,target,entry,runtime,removed,removedRuntime,unknown,oldSdk,MicroSdkError]\n`)
  const program = ts.createProgram([file], { strict: true, noEmit: true, module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext, target: ts.ScriptTarget.ES2022,
    lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'], types: [], skipLibCheck: false })
  assert.deepEqual(ts.getPreEmitDiagnostics(program).map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')), [])
})
