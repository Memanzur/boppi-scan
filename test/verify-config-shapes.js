#!/usr/bin/env node
/** Malformed JSON structures are incomplete evidence, never verified removals. Runs against source or an installed package. */
'use strict';
const fs=require('fs'),path=require('path'),os=require('os'),{spawnSync}=require('child_process');
const ROOT=process.env.BOPPI_TEST_PACKAGE_ROOT || path.join(__dirname,'..');
const CLI=path.join(ROOT,'bin/boppi.js');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'boppi-shapes-'));
let checks=0;
function ok(label,value) { if(!value) throw new Error(label); checks++; console.log('PASS '+label); }
function write(file,value) { fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(value)); }
function run(home,args,cwd=home) { return spawnSync(process.execPath,[CLI,...args,'--home',home,'--cwd',cwd,'--platform','darwin','--no-color'],{encoding:'utf8'}); }
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
try {
 const home=path.join(tmp,'home'),file=path.join(home,'Library/Application Support/Claude/claude_desktop_config.json');
 const servers={filesystem:{command:'npx',args:['@modelcontextprotocol/server-filesystem',home]},fetch:{command:'uvx',args:['mcp-server-fetch']}};
 write(file,{mcpServers:servers});const baseline=path.join(tmp,'baseline.json');
 ok('positive baseline contains the affected fetch prediction',run(home,['scan','--only','claude-desktop','--json',baseline]).status===0 && read(baseline).predictions.some(p=>p.edit.server==='fetch'));
 const invalid=[null,[],true,'invalid',{mcpServers:null},{mcpServers:[]},{mcpServers:'bad'},{mcpServers:{...servers,fetch:null}},{mcpServers:{...servers,fetch:[]}},{mcpServers:{...servers,fetch:'BOPPI_SHAPE_SECRET_CANARY'}},{mcpServers:{...servers,fetch:{command:42}}},{mcpServers:{...servers,fetch:{command:'uvx',args:'mcp-server-fetch'}}},{mcpServers:{...servers,fetch:{command:'uvx',env:null}}}];
 for(let i=0;i<invalid.length;i++) {
  write(file,invalid[i]);const out=path.join(tmp,'verify.json');const p=run(home,['verify',baseline,'--only','claude-desktop','--json',out]);const d=read(out);
  ok('invalid shape '+i+' cannot confirm a removal',p.status===0 && d.summary.confirmed===0 && d.summary.unresolved>0);
  const scan=run(home,['scan','--only','claude-desktop']);const h=read(path.join(home,'.boppi/history.json')).filter(x=>x.kind!=='verification').at(-1);
  ok('invalid shape '+i+' is incomplete and history is withheld',scan.status===4 && h.complete===false && !!h.changes.withheld && !scan.stdout.includes('BOPPI_SHAPE_SECRET_CANARY'));
 }
 write(file,{mcpServers:{filesystem:servers.filesystem}});const verified=path.join(tmp,'positive.json');run(home,['verify',baseline,'--only','claude-desktop','--json',verified]);
 ok('a genuine removal from a valid object is still confirmed',read(verified).resolutions.some(r=>r.edit.server==='fetch'&&r.status==='CONFIRMED'));
 write(file,{mcpServers:{}});ok('a valid empty map is supported',run(home,['scan','--only','claude-desktop']).status===0);
 write(file,{mcpServers:{unknown:{command:'node',args:['./unrecognized-fixture.js'],futureExtension:{enabled:true}}}});ok('unknown servers and extension fields remain inspectable without execution',run(home,['scan','--only','claude-desktop']).status===0);
 const project=path.join(home,'project');fs.mkdirSync(project,{recursive:true});
 write(path.join(home,'.claude.json'),{mcpServers:{},projects:{[project]:{mcpServers:[]}}});
 ok('invalid selected Claude Code project map is incomplete',run(home,['scan','--only','claude-code'],project).status===4);
 write(path.join(home,'.claude.json'),{mcpServers:{},projects:{'/uninspected-project':null}});
 ok('unselected project data does not change supported coverage',run(home,['scan','--only','claude-code'],project).status===0);
 write(path.join(home,'.cursor/mcp.json'),{mcpServers:{}});write(path.join(project,'.cursor/mcp.json'),{mcpServers:{fetch:null}});
 ok('a malformed secondary file makes partial client evidence incomplete',run(home,['scan','--only','cursor'],project).status===4);
 const legacy=read(baseline);legacy.predictions.forEach(p=>p.coverageIdentity='prior-parser-coverage');const old=path.join(tmp,'old-parser.json');write(old,legacy);
 write(file,{mcpServers:{filesystem:servers.filesystem}});const oldOut=path.join(tmp,'old-verify.json');run(home,['verify',old,'--only','claude-desktop','--json',oldOut]);
 ok('older coverage contracts cannot confirm against the validated parser',read(oldOut).summary.confirmed===0);
 console.log(checks+' configuration-shape checks passed');
} finally {fs.rmSync(tmp,{recursive:true,force:true});}
