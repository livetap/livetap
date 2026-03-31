/**
 * livetap tap <uri|file.json> — Connect to a data source.
 */

import { existsSync, readFileSync } from 'fs'
import { daemonFetch } from './daemon-client.js'

export async function run(args: string[]) {
  const source = args[0]
  if (!source) {
    console.error('Usage: livetap tap <uri|file.json|webhook>')
    console.error('  livetap tap mqtt://broker.emqx.io:1883/sensors/#')
    console.error('  livetap tap wss://stream.example.com/prices')
    console.error('  livetap tap webhook')
    console.error('  livetap tap connection.json')
    process.exit(1)
  }

  const nameIdx = args.indexOf('--name')
  const name = nameIdx !== -1 ? args[nameIdx + 1] : undefined

  let config: any

  if (source === 'webhook') {
    config = { type: 'webhook' }
  } else if (source.endsWith('.json') && existsSync(source)) {
    config = JSON.parse(readFileSync(source, 'utf-8'))
  } else if (source.startsWith('mqtt://') || source.startsWith('mqtts://')) {
    config = parseMqttUri(source)
  } else if (source.startsWith('ws://') || source.startsWith('wss://')) {
    config = { type: 'websocket', url: source }
  } else if (source.startsWith('file://')) {
    const path = source.slice(7) // strip file://
    if (!path.startsWith('/')) {
      console.error('file:// path must be absolute (e.g. file:///var/log/app.log)')
      process.exit(1)
    }
    config = { type: 'file', path }
  } else {
    console.error(`Unknown source format: ${source}`)
    console.error('Expected: mqtt://..., wss://..., file:///path, webhook, or a .json file')
    process.exit(1)
  }

  const body: any = { ...config }
  if (name) body.name = name

  const res = await daemonFetch('/connections', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  const data = await res.json()

  if (!res.ok) {
    console.error(`Error: ${data.error}`)
    process.exit(1)
  }

  console.log(`Tapped: ${data.connectionId} (${config.type} → ${summarize(config)})`)
  if (data.ingestUrl) {
    console.log(`Ingest URL: ${data.ingestUrl}`)
  }
}

function parseMqttUri(uri: string): any {
  // URL() mangles MQTT wildcards (# and +), so parse manually for the path
  const url = new URL(uri)
  const tls = url.protocol === 'mqtts:'

  // Extract topic from the raw URI (after host:port/)
  const hostEnd = uri.indexOf('/', uri.indexOf('//') + 2)
  const rawTopic = hostEnd !== -1 ? uri.slice(hostEnd + 1) : ''

  return {
    type: 'mqtt',
    broker: url.hostname,
    port: parseInt(url.port) || (tls ? 8883 : 1883),
    tls,
    credentials: {
      username: decodeURIComponent(url.username || ''),
      password: decodeURIComponent(url.password || ''),
    },
    topics: rawTopic ? [rawTopic] : [],
  }
}

function summarize(config: any): string {
  if (config.type === 'mqtt') return `${config.broker}/${config.topics?.[0] ?? ''}`
  if (config.type === 'websocket') return config.url
  if (config.type === 'file') return config.path
  return 'webhook ingest'
}
