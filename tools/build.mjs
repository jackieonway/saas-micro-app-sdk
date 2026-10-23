import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createWorkspace } from './workspace.mjs'
import { generateArtifacts } from './generate.mjs'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
assert(args.length===1 && ['--check','--write'].includes(args[0]), 'Use --check or --write')
const workspace = createWorkspace()
try {
  const { artifacts, release } = await generateArtifacts({root:workspace.directory})
  const prefix='examples/micro-app-sdk/'
  const selected=[...artifacts].filter(([file])=>file.startsWith(prefix) && file!==prefix+'package.json')
  const expected=new Set(selected.map(([file])=>file.slice(prefix.length)))
  for (const name of existsSync(path.join(root,'releases',release.sdkVersion)) ? readdirSync(path.join(root,'releases',release.sdkVersion)) : []) {
    assert(expected.has(`releases/${release.sdkVersion}/${name}`), 'Unregistered SDK release file')
  }
  for (const [file,content] of selected) {
    const target=path.join(root,file.slice(prefix.length))
    if (args[0]==='--check') assert(existsSync(target)&&readFileSync(target).equals(Buffer.from(content)), `SDK artifact drift: ${file}`)
    else {mkdirSync(path.dirname(target),{recursive:true});writeFileSync(target,content)}
  }
  console.log(`SDK ${release.sdkVersion}: verified ${selected.length} generated artifacts`)
} finally { workspace.dispose() }
