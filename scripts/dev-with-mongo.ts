import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { MongoMemoryServer } from 'mongodb-memory-server'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

async function main() {
  const mongod = await MongoMemoryServer.create({
    instance: { dbName: 'electropos' },
  })
  const uri = mongod.getUri('electropos')
  console.log(`[dev] Local MongoDB (embedded): ${uri}`)
  console.log('[dev] Data is in-memory only — install Docker + mongo image for a persistent DB.')

  const child = spawn('npx', ['tsx', 'watch', 'src/index.ts'], {
    cwd: root,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      MONGODB_URI: uri,
    },
    stdio: 'inherit',
    shell: true,
  })

  const stop = async () => {
    child.kill('SIGTERM')
    await mongod.stop()
  }

  process.on('SIGINT', () => {
    void stop().then(() => process.exit(0))
  })
  process.on('SIGTERM', () => {
    void stop().then(() => process.exit(0))
  })

  child.on('exit', (code) => {
    void mongod.stop().then(() => process.exit(code ?? 0))
  })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
