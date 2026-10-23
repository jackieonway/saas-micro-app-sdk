import { cpSync, mkdtempSync, mkdirSync, realpathSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const sdkRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export function createWorkspace() {
  const temporary = realpathSync(os.tmpdir())
  const directory = mkdtempSync(path.join(temporary, 'saas-sdk-build-'))
  const target = path.join(directory, 'examples/micro-app-sdk')
  mkdirSync(target, {recursive:true})
  for (const name of ['src','scripts','contracts','generated','releases','release.json','index.mjs','index.d.mts','package.json']) {
    cpSync(path.join(sdkRoot,name),path.join(target,name),{recursive:true})
  }
  return { directory, dispose() {
    if (path.dirname(directory)!==temporary || !path.basename(directory).startsWith('saas-sdk-build-')) throw new Error('Unsafe SDK workspace')
    rmSync(directory,{recursive:true,force:true})
  } }
}
