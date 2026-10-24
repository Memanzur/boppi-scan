"""Participant commands for the usability sessions, confined to separate synthetic homes under kit/participants/.

Runs the installed candidate tarball (kit/runtime), never the source checkout. No cloud, discover, watch, or hook
command is reachable from here. Usage: python3 session.py T1|T2|T3|T4|T5|QA start|scan|plan|fix|verify|backups|rollback
"""
import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BIN = ROOT / 'runtime/node_modules/boppi/bin/boppi.js'
IDS = {'T1', 'T2', 'T3', 'T4', 'T5', 'QA'}
ACTIONS = {'start', 'scan', 'plan', 'fix', 'verify', 'rollback', 'backups'}


def main():
    if len(sys.argv) != 3 or sys.argv[1] not in IDS or sys.argv[2] not in ACTIONS:
        raise SystemExit('Usage: python3 session.py T1|T2|T3|T4|T5|QA start|scan|plan|fix|verify|backups|rollback')
    if not BIN.exists():
        raise SystemExit('The kit runtime is missing; this file belongs next to kit/runtime (see KIT.json).')
    participant, action = sys.argv[1:]
    home = (ROOT / 'participants' / participant / 'synthetic-home')
    home.mkdir(parents=True, exist_ok=True)
    home = home.resolve()
    assert home.is_relative_to((ROOT / 'participants').resolve())
    project = home / 'project'
    project.mkdir(exist_ok=True)
    config = home / '.boppi/demo/mcp.json'
    if action == 'start' and config.exists():
        print('This sandbox already exists; use scan. Earlier work is preserved.')
        return
    if action != 'start' and not config.exists():
        raise SystemExit('Run start first. No existing sandbox was edited.')
    common = ['--home', str(home), '--cwd', str(project), '--platform', 'darwin', '--no-color']
    target = ['--config', str(config), '--source', 'claude-desktop']
    commands = {
        'start': ['demo'],
        'scan': ['scan', *target],
        'plan': ['plan', '--diff', *target],
        'fix': ['fix', '--server', 'github', '--client', 'claude-desktop', *target],
        'verify': ['verify', str(home / '.boppi/demo/scan.json'), *target],
        'backups': ['rollback'],
    }
    if action == 'rollback':
        manifest = home / '.boppi/backups/index.json'
        if not manifest.exists():
            raise SystemExit('No sandbox backup exists yet.')
        entries = [entry for entry in json.loads(manifest.read_text())['entries']
                   if entry.get('action') == 'remove_server' and Path(entry['original']).resolve() == config.resolve()]
        if not entries:
            raise SystemExit('No matching synthetic removal backup exists.')
        commands[action] = ['rollback', '--id', entries[-1]['id'], *target]
    env = {key: value for key, value in os.environ.items()
           if not key.startswith('BOPPI_') and key not in {'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'}}
    env.update(BOPPI_SCAN_HOME=str(home), BOPPI_SCAN_PLATFORM='darwin')
    print(f'SYNTHETIC ONLY: {participant}; no MCP program is started; no upload command is available.', flush=True)
    result = subprocess.run(['node', str(BIN), *commands[action], *common], cwd=project, env=env)
    raise SystemExit(result.returncode)


if __name__ == '__main__':
    main()
