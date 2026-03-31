/**
 * Simulated webhook sender — sends POST requests with sensor payloads.
 */

const SENSORS = ['sensor-zone-a', 'sensor-zone-b', 'sensor-zone-c']

export interface WebhookSender {
  start(): Promise<void>
  stop(): void
  sentCount: number
}

export function createWebhookSender(opts: { targetUrl: string; intervalMs?: number }): WebhookSender {
  const intervalMs = opts.intervalMs ?? 500
  let timer: ReturnType<typeof setInterval> | null = null
  let count = 0

  return {
    get sentCount() { return count },
    async start() {
      timer = setInterval(async () => {
        const sensor = SENSORS[count % SENSORS.length]
        const payload = {
          metadata: { device_name: sensor, timestamp_iso: new Date().toISOString() },
          sensors: {
            environmental: {
              temperature: { value: 20 + Math.random() * 15, unit: '°C' },
              humidity: { value: 40 + Math.random() * 50, unit: '%' },
            },
            air_quality: {
              smoke: { value: Math.random() * 0.05, unit: 'ppm' },
            },
          },
        }
        try {
          await fetch(opts.targetUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
          count++
        } catch { /* target not ready yet */ }
      }, intervalMs)
    },
    stop() {
      if (timer) { clearInterval(timer); timer = null }
    },
  }
}
