/**
 * livetap unwatch <watcherId> — Remove a watcher.
 */

import { daemonFetch } from './daemon-client.js'

export async function run(args: string[]) {
  const id = args[0]
  if (!id) {
    console.error('Usage: livetap unwatch <watcherId>')
    process.exit(1)
  }

  const res = await daemonFetch(`/watchers/${id}`, { method: 'DELETE' })
  const data = await res.json()

  if (!res.ok) {
    console.error(`Error: ${data.error}`)
    process.exit(1)
  }

  console.log(`Unwatched: ${id}`)
}
