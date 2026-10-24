"""Produce the six synthetic accuracy cases against the built 0.4.0 candidate tarball (never the source checkout)."""
import hashlib
import json
import os
import shutil
import subprocess
from pathlib import Path

import sys
SCANNER = Path(__file__).resolve().parents[2]
CANDIDATE = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path.home() / 'Desktop' / ('Boppi-candidate-' + json.loads((SCANNER / 'package.json').read_text())['version'])
ROOT = CANDIDATE / 'kit'
ROOT.mkdir(parents=True, exist_ok=True)
import shutil as _shutil
for helper in ('serve.py', 'session.py'):
    if not (ROOT / helper).exists(): _shutil.copyfile(Path(__file__).resolve().parent / helper, ROOT / helper)
manifest = json.loads((CANDIDATE / 'CANDIDATE.json').read_text())
package = CANDIDATE / manifest['artifact']
assert hashlib.sha256(package.read_bytes()).hexdigest() == manifest['sha256'], 'tarball does not match CANDIDATE.json'
for name in ['runtime', 'public', 'public/cases', 'qa', 'cases']:
    (ROOT / name).mkdir(exist_ok=True)
assert not (ROOT / 'KIT.json').exists(), 'Kit is already prepared; build a new kit folder instead of overwriting this one.'
(ROOT / 'runtime/package.json').write_text(json.dumps({'name': 'boppi-candidate-kit', 'version': '1.0.0', 'private': True}))
subprocess.run(['npm', 'install', str(package), '--ignore-scripts', '--no-audit', '--no-fund'], cwd=ROOT / 'runtime', capture_output=True, text=True, check=True)
BIN = ROOT / 'runtime/node_modules/boppi/bin/boppi.js'
env = {key: value for key, value in os.environ.items() if not key.startswith('BOPPI_')}
version = subprocess.check_output(['node', str(BIN), '--version'], text=True).strip()
assert version == manifest['package_version'], version

def run(args, home, cwd, log):
    command = ['node', str(BIN), *args, '--home', str(home), '--cwd', str(cwd), '--platform', 'darwin', '--no-color']
    result = subprocess.run(command, cwd=cwd, env=env, capture_output=True, text=True)
    (ROOT / 'qa' / log).write_text(result.stdout + result.stderr)
    assert result.returncode == 0, f'Synthetic command failed: {args[0]}; see qa/{log}'

def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + '\n')

cases = {
    'tidy-control': {'source': 'claude-desktop', 'config': json.loads((SCANNER / 'src/demo/tidy-workstation.json').read_text()),
                     'context': 'Synthetic memory/time connectors. Negative control: no sensitive reach is established.'},
    'generic-critical': {'discovery': True, 'config': {'mcpServers': {'fetch': {'command': 'uvx', 'args': ['mcp-server-fetch']}}},
                         'context': 'Synthetic Claude Code plus fetch, run from a project folder. Generic file access exists, but no sensitive file or actual transfer was established. Ask what the badge means and what would make it critical.'},
    'explicit-read-deny': {'discovery': True, 'config': {'mcpServers': {'fetch': {'command': 'uvx', 'args': ['mcp-server-fetch']}}},
                           'deny': True, 'context': 'Synthetic settings explicitly deny Read/Edit/Write/Bash. Check whether the output acknowledges these limits. This is a permission-model challenge, not proof of real client enforcement.'},
    'read-only-dev': {'source': 'claude-desktop', 'config': {'mcpServers': {
        'github': {'command': 'npx', 'args': ['@modelcontextprotocol/server-github@1.0.0']},
        'dev-reader': {'command': 'node', 'args': ['./synthetic-dev-reader.js'], 'capabilities': ['network_access'], 'tools': ['kubectl_get']}}},
        'context': 'Synthetic scenario card: kubectl_get is a read-only tool against a disposable DEVELOPMENT cluster. Nothing is connected. A tool-name heuristic must not establish production write access.'},
    'misleading-email-name': {'source': 'claude-desktop', 'config': {'mcpServers': {
        'gmail-notes': {'command': 'node', 'args': ['./synthetic-notes.js'], 'tools': ['list_notes'], 'capabilities': ['filesystem_access']},
        'fetch': {'command': 'uvx', 'args': ['mcp-server-fetch']}}},
        'context': 'Synthetic scenario card: gmail-notes is a local notes fixture with no email backend. Its name is deliberately misleading. Review any email/impersonation inference rather than accepting it as fact.'},
    'unknown-reach': {'source': 'claude-desktop', 'config': {'mcpServers': {'weather': {'command': 'node', 'args': ['./synthetic-weather.js']}}},
                      'context': 'Synthetic local server with unspecified capabilities. Unknown reach is not evidence of safety, malware or an attack.'},
}
summary = []
for key, case in cases.items():
    home = ROOT / 'cases' / key / 'synthetic-home'
    project = home / 'project'
    (project / '.git').mkdir(parents=True, exist_ok=True)
    config = home / ('.claude.json' if case.get('discovery') else 'fixture.json')
    write(config, case['config'])
    if case.get('deny'):
        write(home / '.claude/settings.json', {'permissions': {'deny': ['Read', 'Edit', 'Write', 'Bash']}})
    (home.parent / 'CONTEXT.txt').write_text(case['context'] + '\n')
    target = ['--only', 'claude-code'] if case.get('discovery') else ['--config', str(config), '--source', case['source']]
    export = ROOT / 'qa' / (key + '.json')
    run(['scan', *target, '--json', str(export), '--html', str(ROOT / 'public/cases' / (key + '.html'))], home, project, key + '.txt')
    data = json.loads(export.read_text())
    text = (ROOT / 'qa' / (key + '.txt')).read_text()
    for leak in (str(home), 'synthetic-secret'):
        assert leak not in export.read_text() and leak not in (ROOT / 'public/cases' / (key + '.html')).read_text(), f'{key}: raw path in export'
    summary.append({'case': key, 'context': case['context'], 'path_count': len(data['exposurePaths']),
                    'unrecognized_servers': [r['server'] for r in data.get('recognition', []) if not r.get('recognized')],
                    'paths': [{'template': item['templateId'], 'priority': item['severity'], 'impact': item['assessment']['impact'],
                               'weakest': item['assessment']['weakestStrength'], 'assumptions': item['assessment']['assumptions'],
                               'unknowns': item['assessment']['unknowns']} for item in data['exposurePaths']]})
demo_home = ROOT / 'qa' / 'demo-synthetic-home'
demo_home.mkdir(exist_ok=True)
run(['demo', '--html', str(ROOT / 'public/demo.html')], demo_home, demo_home, 'demo-generation.txt')
run(['demo'], demo_home, demo_home, 'sandbox-initial.txt')
shutil.copyfile(demo_home / '.boppi/demo/report.html', ROOT / 'public/report.html')
(ROOT / 'qa/accuracy-case-results.json').write_text(json.dumps(summary, indent=2) + '\n')
(ROOT / 'KIT.json').write_text(json.dumps({**manifest, 'kit_prepared_at': subprocess.check_output(['date', '-u', '+%Y-%m-%dT%H:%M:%SZ'], text=True).strip(),
                                            'synthetic_case_count': len(cases), 'human_sessions_completed': 0}, indent=2) + '\n')
print(f'Prepared six synthetic cases, demo, and report from {package.name}. Human sessions: 0.')
for item in summary:
    print(item['case'], [(p['template'], p['priority'], p['weakest']) for p in item['paths']], 'unrecognized:', item['unrecognized_servers'])
