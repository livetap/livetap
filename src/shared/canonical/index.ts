/**
 * Canonical data barrel — THE single import point for all canonical data.
 *
 * Usage:
 *   import { TOOLS, CLI_COMMANDS, META } from '../canonical/index.js'
 */

export { TOOLS } from './tools.js'
export { CLI_COMMANDS, type CatalogCommand } from './cli.js'
export { META } from './meta.js'
