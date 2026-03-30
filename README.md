# livetap

Push live data streams into your AI coding agent. First tool to deliver real-time MQTT, WebSocket, Kafka, and webhook alerts directly into Claude Code sessions.

```
livetap <source-uri> <agent>
```

## What it does

livetap connects to a live data source (MQTT broker, WebSocket, webhook, Kafka topic) and pushes events into your AI coding agent's session using [Claude Code Channels](https://code.claude.com/docs/en/channels). Your agent sees the data in real-time and can analyze, alert, and act on it.

## Status

**v0 — research preview tested and working.**

We've confirmed end-to-end delivery of live IoT sensor data from an MQTT broker into a Claude Code session via the Channels API.

### What's built

- **Channel server** (`scripts/livetap-channel.ts`) — MCP server that accepts HTTP POSTs on `:8788` and forwards them as `<channel source="livetap">` events into Claude Code over stdio
- **MQTT bridge** (`scripts/mqtt-bridge.ts`) — Subscribes to an MQTT broker, samples sensor readings every 30s, and pushes summaries to the channel server

### What's been tested

- Claude Code Channels research preview (v2.1.80+, claude.ai auth required)
- Live IoT data from `broker.emqx.io` — 3 multi-zone environmental sensors (temperature, humidity, air quality, occupancy)
- Channel events arrive in-session as `<channel source="livetap" protocol="mqtt" topic="...">` tags
- Claude analyzes incoming data, detects anomalies, and responds automatically

## Quick start

**Requirements:** [Bun](https://bun.sh), Claude Code v2.1.80+, claude.ai login (not Bedrock/API key)

```bash
# Clone and install
git clone https://github.com/livetap/livetap.git
cd livetap && git checkout v0
bun install

# Start Claude Code with the livetap channel
claude --dangerously-load-development-channels server:livetap

# In another terminal, run the MQTT bridge
bun scripts/mqtt-bridge.ts

# Or push a manual test event
curl -X POST http://localhost:8788 \
  -H "Content-Type: application/json" \
  -d '{"protocol":"mqtt","topic":"sensor/temp","payload":{"device":"sensor-01","temp_c":42.7}}'
```

## Architecture

```
MQTT Broker ──→ mqtt-bridge.ts ──→ HTTP POST ──→ livetap-channel.ts ──→ Claude Code
                (samples every 30s)    :8788       (MCP over stdio)      <channel> tag
```

The channel server is an MCP server that declares the `claude/channel` capability. Claude Code spawns it as a subprocess and listens for `notifications/claude/channel` events. The MQTT bridge is a separate process that subscribes to the broker and periodically pushes summaries to the channel server's HTTP endpoint.

## Roadmap

- [ ] CLI: `livetap mqtt://broker.emqx.io/sensor/# claude`
- [ ] WebSocket, Webhook, and Kafka protocol support
- [ ] Expression-based watchers (alert on `temp > 30`, `smoke > 0.05`)
- [ ] Embedded Redis for message buffering
- [ ] OpenAI Codex agent delivery (dual-agent support)
- [ ] npm package: `npx @livetap/cli`

## Cloud upgrade

For managed connections, persistent streams, and a dashboard, see [JustinX](https://justinx.ai).

## License

MIT
