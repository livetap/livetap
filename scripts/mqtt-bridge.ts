#!/usr/bin/env bun
/**
 * MQTT → livetap channel bridge
 * Subscribes to broker.emqx.io justinx/demo/# and forwards
 * a sampled message to the livetap channel server every 30s.
 */
import mqtt from 'mqtt'

const CHANNEL_URL = 'http://127.0.0.1:8788'
const BROKER = 'mqtt://broker.emqx.io:1883'
const TOPIC = 'justinx/demo/#'
const INTERVAL_MS = 30_000

// Track latest message per sensor
const latest = new Map<string, { topic: string; payload: any }>()

const client = mqtt.connect(BROKER)

client.on('connect', () => {
  console.error(`[mqtt-bridge] connected to ${BROKER}`)
  client.subscribe(TOPIC, (err) => {
    if (err) console.error('[mqtt-bridge] subscribe error:', err)
    else console.error(`[mqtt-bridge] subscribed to ${TOPIC} — sampling every ${INTERVAL_MS / 1000}s`)
  })
})

client.on('message', (topic, message) => {
  try {
    const payload = JSON.parse(message.toString())
    const sensor = payload.metadata?.device_name || topic
    latest.set(sensor, { topic, payload })
  } catch {
    // skip malformed messages
  }
})

client.on('error', (err) => console.error('[mqtt-bridge] error:', err))

// Every INTERVAL_MS, forward latest readings to the channel server
setInterval(async () => {
  if (latest.size === 0) return

  const sensors = Array.from(latest.entries()).map(([name, { topic, payload }]) => ({
    sensor: name,
    topic,
    temp_c: payload.sensors?.environmental?.temperature?.value,
    humidity: payload.sensors?.environmental?.humidity?.value,
    smoke_ppm: payload.sensors?.air_quality?.smoke?.value,
    light: payload.sensors?.occupancy?.light,
    motion: payload.sensors?.occupancy?.motion,
  }))

  const body = JSON.stringify({
    protocol: 'mqtt',
    topic: TOPIC,
    payload: { summary: `${sensors.length} sensors`, sensors },
  })

  try {
    const res = await fetch(CHANNEL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    })
    console.error(`[mqtt-bridge] pushed ${sensors.length} sensors → ${res.status}`)
  } catch (err) {
    console.error('[mqtt-bridge] push failed:', err)
  }
}, INTERVAL_MS)
