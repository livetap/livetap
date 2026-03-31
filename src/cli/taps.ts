/**
 * livetap taps — List active taps.
 */

import { isDaemonRunning, daemonJson } from './daemon-client.js'

export async function run(args: string[]) {
  if (!(await isDaemonRunning())) {
    console.log('livetap is not running. Use "livetap start" first.')
    return
  }

  const jsonMode = args.includes('--json')
  const data = await daemonJson('/connections')

  if (jsonMode) {
    console.log(JSON.stringify(data, null, 2))
    return
  }

  if (data.length === 0) {
    console.log('No active taps. Use "livetap tap <uri>" to connect.')
    return
  }

  console.log(`Active taps (${data.length}):\n`)
  for (const c of data) {
    const rate = `${c.msgPerSec} msg/s`
    const buf = `${c.bufferedCount} buffered`
    console.log(`  ${c.connectionId}  ${c.type.padEnd(9)} ${(c.summary || '').slice(0, 40).padEnd(42)} ${rate.padStart(10)}  ${buf}`)
  }
}
