/**
 * Canonical MCP tool definitions.
 * This is the single source of truth for all tool schemas.
 *
 * Consumed by:
 *   - src/mcp/tools.ts        → tool registration + handler dispatch
 *   - catalog-generators.ts   → --llm-help, MCP instructions
 *   - drift detection tests   → cross-reference validation
 */

export const TOOLS = [
  {
    name: 'create_connection',
    description: 'Create a data connection. MQTT: connects to a broker and subscribes to topics. WebSocket: connects to a remote WS URL. Webhook: creates an HTTP ingest endpoint.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        type: { type: 'string', enum: ['mqtt', 'webhook', 'websocket', 'file'], description: 'Source type', default: 'mqtt' },
        name: { type: 'string', description: 'Display name for the connection' },
        broker: { type: 'string', description: 'MQTT broker hostname (required for mqtt)' },
        port: { type: 'number', description: 'Broker port (default 1883 for mqtt)', default: 1883 },
        tls: { type: 'boolean', description: 'Use TLS (default false)', default: false },
        username: { type: 'string', description: 'MQTT username', default: '' },
        password: { type: 'string', description: 'MQTT password', default: '' },
        topics: { type: 'array', items: { type: 'string' }, description: 'MQTT topic filters (required for mqtt)' },
        url: { type: 'string', description: 'WebSocket URL (required for websocket)' },
        headers: { type: 'object', description: 'WebSocket auth headers' },
        handshake: { type: 'string', description: 'Message to send after WS connect (e.g. subscription JSON)' },
        path: { type: 'string', description: 'Absolute file path to tail (required for file type, e.g. "/var/log/app.log")' },
      },
    },
  },
  {
    name: 'list_connections',
    description: 'List all active connections with their status, message rate, and buffered count.',
    inputSchema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'get_connection',
    description: 'Get detailed status of a specific connection.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        connectionId: { type: 'string', description: 'The connection ID (e.g. "conn_a1b2c3d4")' },
      },
      required: ['connectionId'],
    },
  },
  {
    name: 'destroy_connection',
    description: 'Destroy a connection — stops the source subscriber, cleans up the stream buffer.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        connectionId: { type: 'string', description: 'The connection ID to destroy' },
      },
      required: ['connectionId'],
    },
  },
  {
    name: 'read_stream',
    description: "Read recent entries from a connection's live stream. Use this to inspect what data is flowing through a connection and understand the payload structure before creating watchers.",
    inputSchema: {
      type: 'object' as const,
      properties: {
        connectionId: { type: 'string', description: 'The connection ID to read from' },
        backfillSeconds: { type: 'number', description: 'Include entries from the last N seconds (default 60)', default: 60 },
        maxEntries: { type: 'number', description: 'Max entries to return (default 10)', default: 10 },
      },
      required: ['connectionId'],
    },
  },
  {
    name: 'create_watcher',
    description: 'Create an expression-based watcher on a connection. The watcher evaluates structured conditions against each stream entry and fires an alert when conditions match. ALWAYS use read_stream first to understand the data shape and field paths.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        connectionId: { type: 'string', description: 'The connection ID to watch' },
        conditions: {
          type: 'array',
          description: 'Array of conditions: [{field: "dot.path", op: ">", value: 50}]. Supported ops: >, <, >=, <=, ==, !=, contains, matches (regex)',
          items: {
            type: 'object',
            properties: {
              field: { type: 'string', description: 'Dot-path into the JSON payload (e.g. "sensors.temperature.value")' },
              op: { type: 'string', enum: ['>', '<', '>=', '<=', '==', '!=', 'contains', 'matches'], description: 'Comparison operator. "matches" takes a regex pattern string.' },
              value: { description: 'Value to compare against (number, string, or boolean)' },
            },
            required: ['field', 'op', 'value'],
          },
        },
        match: { type: 'string', enum: ['all', 'any'], description: 'How to combine conditions: "all" (AND) or "any" (OR). Default: "all"', default: 'all' },
        action: { description: '"channel_alert" (default), or {webhook: "url"}, or {shell: "command"}', default: 'channel_alert' },
        cooldown: { type: 'number', description: 'Seconds between repeated alerts. 0 for every match, 60 default. Use 0 for rare events (webhooks), 30-60 for sensors, 300+ for high-frequency streams.', default: 60 },
      },
      required: ['connectionId', 'conditions'],
    },
  },
  {
    name: 'list_watchers',
    description: 'List watchers. Optionally filter by connectionId. If omitted, lists all watchers.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        connectionId: { type: 'string', description: 'Optional: filter by connection ID' },
      },
    },
  },
  {
    name: 'get_watcher',
    description: 'Get details of a specific watcher including conditions, status, match count, and config.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        watcherId: { type: 'string', description: 'The watcher ID' },
      },
      required: ['watcherId'],
    },
  },
  {
    name: 'get_watcher_logs',
    description: 'Get evaluation logs from a watcher — shows MATCH, SUPPRESSED, FIELD_NOT_FOUND, and CHECKPOINT events.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        watcherId: { type: 'string', description: 'The watcher ID' },
        lines: { type: 'number', description: 'Number of log lines to return (default 50)', default: 50 },
      },
      required: ['watcherId'],
    },
  },
  {
    name: 'update_watcher',
    description: "Update a watcher's conditions, match mode, action, or cooldown. The watcher restarts with the new config.",
    inputSchema: {
      type: 'object' as const,
      properties: {
        watcherId: { type: 'string', description: 'The watcher ID' },
        conditions: { type: 'array', description: 'New conditions array', items: { type: 'object' } },
        match: { type: 'string', enum: ['all', 'any'] },
        action: { description: 'New action' },
        cooldown: { type: 'number', description: 'New cooldown in seconds' },
      },
      required: ['watcherId'],
    },
  },
  {
    name: 'delete_watcher',
    description: 'Stop and remove a watcher.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        watcherId: { type: 'string', description: 'The watcher ID to delete' },
      },
      required: ['watcherId'],
    },
  },
  {
    name: 'restart_watcher',
    description: 'Restart a stopped watcher.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        watcherId: { type: 'string', description: 'The watcher ID to restart' },
      },
      required: ['watcherId'],
    },
  },
  {
    name: 'status',
    description: 'Get daemon status: uptime, port, active connections and watchers count.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
]
