/**
 * livetap help
 */

export async function run(_args: string[]) {
  console.log(`livetap — Push live data streams into your AI coding agent

Usage:
  livetap start                              Start the livetap daemon
  livetap stop                               Stop the daemon
  livetap status                             Show daemon, taps, and watchers

  livetap tap <uri|file.json>                Tap into a data source
  livetap tap mqtt://host:port/topic/#       Quick MQTT tap
  livetap tap wss://host/path                Quick WebSocket tap
  livetap tap webhook                        Create webhook ingest endpoint
  livetap untap <connectionId>               Remove a tap
  livetap taps                               List active taps

  livetap sip <connectionId>                 Sip from a stream (sample recent entries)

  livetap watch <connId> "field > value"     Create a watcher
  livetap unwatch <watcherId>                Remove a watcher
  livetap watchers [connectionId]            List watchers

Options:
  --port <n>        Daemon port (default 8788, env: LIVETAP_PORT)
  --foreground      Run daemon in foreground (start only)
  --json            Output as JSON (taps, watchers, sip)
  --help, -h        Show this help
  --llm-help        Machine-readable JSON for AI agents
`)
}
