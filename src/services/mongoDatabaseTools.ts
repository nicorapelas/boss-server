import { spawn } from 'node:child_process'

export type MongoToolsRunner =
  | { mode: 'host' }
  | { mode: 'docker'; container: string }

const INSTALL_HINT =
  'Install MongoDB Database Tools (mongodump / mongorestore) on this server, or use the electropos-mongo Docker container for local dev.'

type SpawnResult = { code: number | null; stdout: string; stderr: string }

function spawnCapture(cmd: string, args: string[]): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (chunk: Buffer | string) => {
      stdout += String(chunk)
    })
    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderr += String(chunk)
    })
    child.on('error', reject)
    child.on('close', (code) => resolve({ code, stdout, stderr }))
  })
}

async function commandExists(cmd: string): Promise<boolean> {
  try {
    const { code } = await spawnCapture('sh', ['-c', `command -v ${cmd} >/dev/null 2>&1`])
    return code === 0
  } catch {
    return false
  }
}

async function dockerContainerRunning(name: string): Promise<boolean> {
  try {
    const { code, stdout } = await spawnCapture('docker', [
      'inspect',
      '-f',
      '{{.State.Running}}',
      name,
    ])
    return code === 0 && stdout.trim() === 'true'
  } catch {
    return false
  }
}

async function dockerMongoToolExists(container: string, tool: string): Promise<boolean> {
  try {
    const { code } = await spawnCapture('docker', ['exec', container, tool, '--version'])
    return code === 0
  } catch {
    return false
  }
}

export async function resolveMongoToolsRunner(dockerContainer?: string): Promise<MongoToolsRunner> {
  if ((await commandExists('mongodump')) && (await commandExists('mongorestore'))) {
    return { mode: 'host' }
  }

  const container = dockerContainer?.trim() || 'electropos-mongo'
  if (!(await commandExists('docker'))) {
    throw new Error(`mongodump not found — ${INSTALL_HINT}`)
  }
  if (!(await dockerContainerRunning(container))) {
    throw new Error(`mongodump not found — ${INSTALL_HINT}`)
  }
  if (
    !(await dockerMongoToolExists(container, 'mongodump')) ||
    !(await dockerMongoToolExists(container, 'mongorestore'))
  ) {
    throw new Error(
      `Mongo tools not found in Docker container "${container}" — ${INSTALL_HINT}`,
    )
  }

  return { mode: 'docker', container }
}

export async function runMongoTool(
  tool: 'mongodump' | 'mongorestore',
  args: string[],
  runner: MongoToolsRunner,
): Promise<void> {
  const cmd = runner.mode === 'host' ? tool : 'docker'
  const cmdArgs =
    runner.mode === 'host' ? args : ['exec', runner.container, tool, ...args]

  const { code, stderr } = await spawnCapture(cmd, cmdArgs)
  if (code === 0) return

  const tail = stderr.trim().slice(-2000)
  const label = runner.mode === 'docker' ? `docker exec ${runner.container} ${tool}` : tool
  throw new Error(`${label} failed (exit ${code})${tail ? `: ${tail}` : ''}`)
}

export async function readArchiveBytes(
  archivePath: string,
  runner: MongoToolsRunner,
): Promise<number> {
  if (runner.mode === 'host') {
    const { stat } = await import('node:fs/promises')
    const file = await stat(archivePath)
    return file.size
  }

  const { code, stdout, stderr } = await spawnCapture('docker', [
    'exec',
    runner.container,
    'stat',
    '-c',
    '%s',
    archivePath,
  ])
  if (code !== 0) {
    const tail = stderr.trim().slice(-500)
    throw new Error(`Could not read backup archive size${tail ? `: ${tail}` : ''}`)
  }
  const size = Number(stdout.trim())
  if (!Number.isFinite(size) || size < 0) {
    throw new Error('Could not read backup archive size')
  }
  return size
}

export async function removeArchive(archivePath: string, runner: MongoToolsRunner): Promise<void> {
  if (runner.mode === 'host') {
    const fsp = await import('node:fs/promises')
    await fsp.unlink(archivePath).catch(() => undefined)
    return
  }
  await spawnCapture('docker', ['exec', runner.container, 'rm', '-f', archivePath])
}

export function archivePathForRunner(runner: MongoToolsRunner, databaseName: string): string {
  const stamp = Date.now()
  if (runner.mode === 'host') {
    return `electropos-cloud-${databaseName}-${stamp}.archive.gz`
  }
  return `/tmp/electropos-cloud-${databaseName}-${stamp}.archive.gz`
}
