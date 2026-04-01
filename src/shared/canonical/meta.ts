/**
 * Canonical metadata — everything that isn't tool schemas or CLI commands.
 * This is the single source of truth for descriptions, operators, source types,
 * examples, do-not rules, tips, data shapes, and generation specs.
 *
 * Consumed by:
 *   - catalog-generators.ts   → --help, --llm-help, MCP instructions
 *   - /lt-push skill          → README + CONTRIBUTING generation
 *   - drift detection tests   → cross-reference validation
 *   - package.json            → description field (synced by /lt-push)
 */

export const META = {
  name: 'LiveTap',
  npmName: 'livetap',
  description: 'Push live data streams into your AI coding agent',
  npmDescription: 'Push live data streams into your AI coding agent. LLM/AI agent? Run: npx livetap --llm-help',
  repo: 'https://github.com/livetap/livetap',
  license: 'MIT',

  channelsExplainer: 'Claude Code Channels let MCP servers push real-time events (like watcher alerts) into your conversation. The --dangerously-load-development-channels flag enables this for locally-installed servers. It only loads servers listed in your project\'s .mcp.json — nothing is sent externally.',

  demoImages: [
    {
      path: 'docs/images/demo-setup.png',
      alt: 'Claude Code connects to a live MQTT stream of solar inverter data, samples payloads with OBIS codes, and creates a watcher for high power consumption (16.7.0 > 3000W). When the alert fires, it autonomously formats the data and analyzes the reading.',
      caption: 'Real solar inverter data — from natural language request to live alert in under 30 seconds',
    },
    {
      path: 'docs/images/demo-alert.png',
      alt: 'A second alert fires and Claude Code autonomously compares previous and current values, noting consumption increased by 174W and is still climbing. It formats a comparison table and recommends investigation.',
      caption: 'Escalating alerts — the agent compares values across alerts and analyzes trends autonomously',
    },
  ],

  sourceTypes: [
    {
      type: 'mqtt',
      params: '{ type: "mqtt", broker, port, tls, topics, username?, password? }',
      cli: 'mqtt://host:port/topic/#',
      useCase: 'IoT sensors, home automation',
    },
    {
      type: 'websocket',
      params: '{ type: "websocket", url, headers?, handshake? }',
      cli: 'wss://...',
      useCase: 'Finance, real-time APIs',
    },
    {
      type: 'file',
      params: '{ type: "file", path }',
      cli: 'file:///path/to/log',
      useCase: 'Log monitoring, DevOps',
    },
    {
      type: 'webhook',
      params: '{ type: "webhook" }',
      cli: 'webhook',
      useCase: 'CI/CD, external services',
      status: 'built-deferred' as const,
    },
  ],

  operators: ['>', '<', '>=', '<=', '==', '!=', 'contains', 'matches'] as const,

  doNotRules: [
    'Do NOT add livetap to ~/.claude/mcp.json — it goes in .mcp.json in the project root',
    'Do NOT configure livetap as type:http — it is a stdio MCP server (command + args)',
    'Do NOT worry about the daemon — setup starts it, and the MCP proxy auto-starts it if needed',
    'Do NOT guess field names — always read_stream first to see actual payload structure',
    'Do NOT use npm init — use the existing project directory',
  ],

  dataShapes: [
    {
      source: 'MQTT/WebSocket',
      format: 'JSON',
      description: 'entries have { payload: "{...json...}", topic: "..." }. The payload is parsed as JSON.',
      usage: 'Use dot-paths into the parsed JSON: "sensors.temperature.value", "metadata.device_name"',
    },
    {
      source: 'File',
      format: 'plain text',
      description: 'entries have { payload: "the raw line", format: "text" }.',
      usage: 'Use field "payload" with contains/matches: { field: "payload", op: "contains", value: "ERROR" }',
    },
    {
      source: 'File',
      format: 'JSON lines',
      description: 'entries have { payload: "{...json...}", format: "json" }. Parsed as JSON.',
      usage: 'Use dot-paths like MQTT: "level", "msg", "status"',
    },
  ],

  tips: [
    'The daemon auto-starts when needed. If a tool returns "daemon was restarted", just retry your request.',
    'Watcher IDs (w_xxx) are globally unique. You don\'t need the connectionId to get, update, or delete a watcher.',
    'Public MQTT streams to try: test.mosquitto.org SHRDZM/# (real smart meter data, ~35 msg/s), test.mosquitto.org Testing/Traffic/Paddy/House/# (simulated, ~50 msg/s), broker.emqx.io justinx/demo/# (low-freq IoT demo).',
    'For regex watchers, use the "matches" operator: { field: "payload", op: "matches", value: "ERROR|FATAL" }',
    'If a field path doesn\'t exist in the payload, the condition evaluates to false (no crash, no error).',
    'Fields with dots in the key name (like OBIS codes "2.8.0") are looked up as literal keys first, then as dot-paths.',
  ],

  setupSteps: [
    'Step 1: npm install livetap (skip if already installed)',
    'Step 2: npx livetap setup (creates .mcp.json and starts the daemon — do NOT create .mcp.json manually)',
    'Step 3: Tell user to restart Claude Code: claude --dangerously-load-development-channels server:livetap --continue',
    'Step 4: After restart, use create_connection to connect, read_stream to sample, create_watcher to alert',
  ],

  demoBrokers: [
    {
      name: 'SHRDZM Smart Meters',
      broker: 'test.mosquitto.org',
      port: 1883,
      topic: 'SHRDZM/#',
      rate: '~35 msg/s',
      description: 'Real smart meter network data with OBIS codes (power consumption, voltage, energy). JSON payloads with dotted keys like "16.7.0" (active power).',
      dataType: 'real' as const,
    },
    {
      name: 'Paddy House Traffic',
      broker: 'test.mosquitto.org',
      port: 1883,
      topic: 'Testing/Traffic/Paddy/House/#',
      rate: '~50 msg/s',
      description: 'High-frequency simulated home automation data.',
      dataType: 'simulated' as const,
    },
    {
      name: 'LiveTap IoT Demo',
      broker: 'broker.emqx.io',
      port: 1883,
      topic: 'justinx/demo/#',
      rate: '~1 msg/s',
      description: 'Low-frequency IoT sensor demo with temperature, humidity, and environmental readings.',
      dataType: 'simulated' as const,
    },
  ],

  examples: [
    {
      title: 'Smart meter energy monitoring',
      sourceType: 'mqtt' as const,
      url: 'mqtt://test.mosquitto.org:1883/SHRDZM/#',
      publicBroker: true,
      fieldPaths: ['16.7.0', '1.7.0', '2.7.0'],
      condition: '16.7.0 > 3000',
      narrative: 'Agent connects to a live smart meter network (~35 msg/s of real data). Samples the stream, discovers OBIS codes like 16.7.0 (active power in watts). Sets watcher for high consumption > 3kW. When it fires, formats a table with device ID, power readings, and timestamps — then compares across alerts to spot escalating trends.',
    },
    {
      title: 'WebSocket trade stream',
      sourceType: 'websocket' as const,
      url: 'wss://stream.binance.com:9443/ws/btcusdt@trade',
      fieldPaths: ['p', 'q', 'T'],
      condition: 'payload contains "btcusdt"',
      narrative: 'Agent connects, samples to discover trade fields (p=price, q=quantity, T=timestamp), sets up a watcher to log each trade. Can filter by quantity or use regex on the symbol field.',
    },
    {
      title: 'Log file monitoring',
      sourceType: 'file' as const,
      url: 'file:///var/log/nginx/error.log',
      fieldPaths: ['payload'],
      condition: 'payload matches "5[0-9]{2}"',
      narrative: 'Agent tails error log, creates regex watcher for 5xx errors, summarizes each match: "503 Service Unavailable on /api/data — upstream auth-service not responding"',
    },
    {
      title: 'WiFi disconnect detection',
      sourceType: 'file' as const,
      url: 'file:///var/log/wifi.log',
      fieldPaths: ['payload'],
      condition: 'payload matches "power state changed"',
      narrative: 'Agent monitors WiFi log for power state changes, reports outage duration: "Wi-Fi powered OFF at 17:51:45, back ON at 17:51:47 (2s outage)"',
    },
  ],

  alertGuidance: [
    'When a watcher alert fires, you receive the FULL stream entry — all fields, not just the matched condition.',
    'Analyze the data: format it clearly (tables work well), explain what the values mean, identify what triggered the alert.',
    'Compare across alerts: if you have seen previous alerts from the same watcher, compare values and note trends (e.g. "consumption increased by 174W since last alert").',
    'Be proactive: if values are escalating, say so. If something looks anomalous compared to earlier samples, flag it.',
    'Include context: device IDs, timestamps, related fields — not just the field that matched the condition.',
  ],

  troubleshooting: [
    {
      problem: 'Daemon won\'t start / "Unable to connect"',
      solution: 'Run `livetap start --foreground` to see error output. Check if port 8788 is in use: `lsof -i :8788`. Use `--port` or `LIVETAP_PORT` to change.',
    },
    {
      problem: 'MQTT connection refused',
      solution: 'Verify the broker is reachable: `nc -zv broker.emqx.io 1883`. Check that `tls: false` and `port: 1883` are set for unencrypted brokers. Brokers on port 8883 typically require `tls: true`.',
    },
    {
      problem: 'Watcher not firing',
      solution: 'Run `read_stream` (or `livetap sip`) to verify data is flowing. Check field paths match the actual payload structure. View watcher logs: `livetap watchers --logs <watcherId>` — look for FIELD_NOT_FOUND or SUPPRESSED events.',
    },
    {
      problem: 'MCP tools not showing after restart',
      solution: 'Verify `.mcp.json` exists in the project root (not `~/.claude/mcp.json`). Restart Claude Code with the `--dangerously-load-development-channels server:livetap` flag.',
    },
  ],

  limitations: [
    'In-memory stream buffer — data does not persist across daemon restarts.',
    'No authentication on the daemon HTTP API (localhost only, port 8788).',
    'Tested with streams up to ~50 msg/s. High-throughput streams (1000+ msg/s) may need higher cooldowns on watchers.',
    'MQTT credentials are passed as tool parameters, not stored on disk.',
    'Single daemon instance per port. Multiple projects can share a daemon or use different ports.',
  ],

  architectureDiagram: `Source (MQTT/WS/File) ──> Subscriber ──> StreamStore ──> Watcher Engine
                                              |                 |
                                              v                 v (on match)
                                         read_stream        Channel Alert
                                         (agent samples)    ──> Claude Code
                                                            ──> agent acts`,

  readmeSpec: {
    audience: 'Developers and AI coding agents (Claude Code, Codex, etc.)',
    tone: 'Direct, practical, no fluff. Show don\'t tell.',
    sections: [
      { id: 'tagline', notes: 'One-liner + 1 sentence expansion. No badges yet.' },
      { id: 'hero-demo', notes: 'Both demo screenshots immediately after tagline. Use demoImages from canonical. Each with alt text and caption. This is the wow moment — show before explaining.' },
      { id: 'quick-start', notes: 'Use npm (not bun) for quickstart — universal. npx livetap setup, then restart Claude. Explain what --dangerously-load-development-channels does using channelsExplainer. Show one example prompt AND expected outcome.' },
      { id: 'agent-setup', notes: 'For AI agents reading this. npx livetap --llm-help pointer. Quick steps. do-not rules. After-restart workflow. Mention MCP tools auto-register on restart — no discovery step needed.' },
      { id: 'what-it-does', notes: 'Architecture paragraph + ASCII flow diagram. Mention daemon, in-memory StreamStore, Channels API.' },
      { id: 'source-types-and-data', notes: 'MERGED section: source types table with data shape info inline. Each row shows type, params, CLI, and how the payload looks. End with IMPORTANT: always read_stream first.' },
      { id: 'examples', notes: 'One subsection per example from canonical data. Show user prompt + agent behavior. Include one CLI-only example (livetap tap, sip, watch sequence) for people who want to verify manually before handing to the agent.' },
      { id: 'expression-watchers', notes: 'JSON example, ALL operators listed here (single location, not repeated), cooldown guidance, how alerts arrive as channel tags.' },
      { id: 'cli', notes: 'Full CLI reference from canonical CLI commands. Group by function. Include all flags.' },
      { id: 'mcp-tools', notes: 'Table of all MCP tools from canonical data.' },
      { id: 'troubleshooting', notes: 'Top problems and solutions from canonical troubleshooting array.' },
      { id: 'limitations', notes: 'Upfront about what this tool does NOT do. From canonical limitations array.' },
      { id: 'config', notes: 'Daemon port, state directory, MCP config (.mcp.json), --llm-help.' },
      { id: 'development', notes: 'Clone, install, test.' },
      { id: 'contributing', notes: 'Brief or link to CONTRIBUTING.md.' },
      { id: 'license', notes: 'MIT.' },
    ],
  },

  contributingSpec: {
    audience: 'Contributors',
    tone: 'Concise, welcoming.',
    sections: [
      { id: 'setup', notes: 'Clone, bun install, bun test.' },
      { id: 'architecture', notes: 'Brief overview, link to docs/PLAN.md for details.' },
      { id: 'testing', notes: 'How to run tests, port ranges (28xxx), SKIP_LIVE_MQTT.' },
      { id: 'pr-process', notes: 'Fork, branch, test, PR to v0.' },
    ],
  },
}
