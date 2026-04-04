import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { MongoMemoryServer } from 'mongodb-memory-server'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

async function run() {
  const mongod = await MongoMemoryServer.create({ instance: { dbName: 'electropos' } })
  const uri = mongod.getUri('electropos')

  const vectorBase = process.env.VECTOR_BACKUP_PATH || 'default'
  console.log(`[dev:local:vector] Embedded MongoDB: ${uri}`)
  console.log(`[dev:local:vector] Seeding products from: ${vectorBase}`)

  const runSeed = (script: string) =>
    new Promise<void>((resolve, reject) => {
      const child = spawn(
        'npx',
        ['tsx', script, '--mongo-uri', uri],
        {
          cwd: root,
          env: { ...process.env, NODE_ENV: 'development' },
          stdio: 'inherit',
          shell: true,
        },
      )
      child.on('exit', (code) => {
        if (code === 0) resolve()
        else reject(new Error(`${script} exited with code ${code}`))
      })
    })

  // 1) Seed into the same embedded database
  await runSeed('scripts/migrate-vector-items.ts')
  await runSeed('scripts/migrate-vector-users.ts')
  await runSeed('scripts/migrate-vector-sales.ts')

  // 2) Start API
  const server = spawn('npx', ['tsx', 'watch', 'src/index.ts'], {
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
    server.kill('SIGTERM')
    await mongod.stop()
  }

  process.on('SIGINT', () => {
    void stop().then(() => process.exit(0))
  })
  process.on('SIGTERM', () => {
    void stop().then(() => process.exit(0))
  })
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})

