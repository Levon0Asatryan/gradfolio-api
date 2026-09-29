import { parseArgs } from 'node:util';

export type Command =
  { command: 'up'; to?: string } | { command: 'down'; all: boolean; to?: string };

/**
 *   up   [--to <name>]            apply pending migrations (up to and including <name>)
 *   down [--all | --to <name>]    roll back the latest one, all of them, or those after <name>
 */
export function parseCommand(argv: string[]): Command {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { to: { type: 'string' }, all: { type: 'boolean', default: false } },
  });
  const [command, ...rest] = positionals;

  if (rest.length > 0) throw new Error(`unexpected argument "${rest[0]}"`);
  if (command === 'up') {
    if (values.all) throw new Error('--all is for down');
    return { command, ...(values.to === undefined ? {} : { to: values.to }) };
  }
  if (command === 'down') {
    if (values.all && values.to !== undefined) throw new Error('use --all or --to, not both');
    return { command, all: values.all, ...(values.to === undefined ? {} : { to: values.to }) };
  }
  throw new Error(`unknown command "${command ?? ''}" (expected "up" or "down")`);
}
