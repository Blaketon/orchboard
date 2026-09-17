export interface CliOptions {
  readonly port?: number;
  readonly host?: string;
  /** Sample data instead of real agents, so the dashboard can be tried safely. */
  readonly demo: boolean;
  /** Open the dashboard in the default browser once it is listening. */
  readonly open: boolean;
  readonly help: boolean;
  readonly version: boolean;
}

export const USAGE = `Orchboard — an agentic project board for Claude Code and Codex

Usage: orchboard [options]

Options:
  -p, --port <number>  Port to listen on (default 4317, or ORCHBOARD_PORT)
      --host <address> Address to bind (default 127.0.0.1, or ORCHBOARD_HOST)
      --demo           Run with sample data; no agents are started
      --open           Open the dashboard in your browser
  -h, --help           Show this help
  -v, --version        Show the version

Environment:
  ORCHBOARD_PORT, ORCHBOARD_HOST, ORCHBOARD_DATA_DIR (default ~/.orchboard),
  CLAUDE_CONFIG_DIR, CODEX_HOME`;

/** Reads command line options. Unknown or malformed arguments throw a message worth printing. */
export function parseCliArgs(argv: readonly string[]): CliOptions {
  let port: number | undefined;
  let host: string | undefined;
  let demo = false;
  let open = false;
  let help = false;
  let version = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? '';
    const [flag, inlineValue] = splitFlag(arg);
    const value = () => {
      const next = inlineValue ?? argv[++i];
      if (next === undefined || next.startsWith('-')) {
        throw new Error(`Missing value for ${flag}.`);
      }
      return next;
    };

    switch (flag) {
      case '-p':
      case '--port': {
        const raw = value();
        port = Number(raw);
        if (!Number.isInteger(port) || port < 0 || port > 65535) {
          throw new Error(`Invalid port "${raw}": expected an integer from 0 to 65535.`);
        }
        break;
      }
      case '--host':
        host = value();
        break;
      case '--demo':
        demo = true;
        break;
      case '--open':
        open = true;
        break;
      case '-h':
      case '--help':
        help = true;
        break;
      case '-v':
      case '--version':
        version = true;
        break;
      default:
        throw new Error(`Unknown option "${arg}". Run orchboard --help.`);
    }
  }

  return {
    ...(port === undefined ? {} : { port }),
    ...(host === undefined ? {} : { host }),
    demo,
    open,
    help,
    version,
  };
}

function splitFlag(arg: string): [string, string | undefined] {
  const equals = arg.indexOf('=');
  return equals === -1 ? [arg, undefined] : [arg.slice(0, equals), arg.slice(equals + 1)];
}
