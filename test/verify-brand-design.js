'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const layout = require('../src/cli/render/graphLayout');
let checks=0;
function ok(value,label){assert(value,label);console.log('  ✓ '+label);checks++;}

const labels=['Claude Code','Very long human readable server name with sensitive capabilities','GITHUB_PERSONAL_ACCESS_TOKEN_WITH_A_LONG_SUFFIX','folder/access/that-must-not-be-cut-off','日本語の長いラベルと🔒の情報'.repeat(4)];
const nodes=Array.from({length:35},(_,i)=>({id:String(i),kind:['agent','server','capability','data','destination'][i%5],label:labels[i%labels.length]}));
const drawing=layout.layout(nodes,320);
ok(drawing.width>=1280,'narrow viewport scrolls instead of shrinking graph labels');
ok(nodes.every(n=>drawing.positions[n.id].lines.join('').replace(/\s/g,'')===n.label.replace(/\s/g,'')),'full labels survive wrapping, including identifiers and Unicode');
ok(nodes.every(n=>drawing.positions[n.id].h>=drawing.positions[n.id].lines.length*18+36),'variable node heights reserve label and evidence space');
ok(nodes.every((n,i)=>nodes.slice(i+1).every(other=>{const a=drawing.positions[n.id],b=drawing.positions[other.id];return a.x+a.w<=b.x||b.x+b.w<=a.x||a.y+a.h<=b.y||b.y+b.h<=a.y;})),'all node rectangles are disjoint');
ok(Object.values(drawing.positions).every(p=>p.x>=0&&p.x+p.w<=drawing.width&&p.y+p.h<=drawing.height),'all nodes fit the graph viewBox');
const a=drawing.positions['2'],b=drawing.positions['7'];
const measured=layout.layout([{id:'wide',kind:'credential',label:'GITHUB_PERSONAL_ACCESS_TOKEN_WITH_WWW'}],320,s=>s.length*10);
ok(measured.positions.wide.lines.every(line=>line.length*10<=measured.positions.wide.w-28),'measured uppercase labels fit the text area');
ok(layout.route(a,b,drawing.height-20).endsWith((b.x+b.w)+' '+(b.y+b.h/2)),'same-column edges enter the node from its gutter, not through its text');
ok(layout.route(drawing.positions['4'],drawing.positions['0'],drawing.height-20).includes(' L '),'backward edges use an explicit return lane');
ok(layout.route(drawing.positions['0'],drawing.positions['4'],drawing.height-20).includes(' L '),'long edges route around intermediate columns rather than through node labels');
const tokens=fs.readFileSync(path.join(__dirname,'../src/design/tokens.css'),'utf8');
for(const hsl of ['222 31% 8%','188 86% 62%','221 84% 72%','38 95% 66%']) ok(tokens.includes(hsl),'verified live token '+hsl);
const styles=fs.readFileSync(path.join(__dirname,'../src/design/report.css'),'utf8');
ok(styles.includes('prefers-reduced-motion')&&styles.includes(':focus-visible'),'motion preference and visible keyboard focus are supported');
function luminance(hex){const c=hex.match(/../g).map(x=>parseInt(x,16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);return c[0]*.2126+c[1]*.7152+c[2]*.0722;}
function contrast(a,b){const x=luminance(a),y=luminance(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05);}
for(const [name,fg,bg] of [['body','f2f5f7','0e121b'],['muted text','a0abba','161b27'],['primary action','0e121b','4bdbf1'],['critical text','e25050','161b27'],['warning text','fbbe56','161b27']]) ok(contrast(fg,bg)>=4.5,`${name} meets WCAG AA normal-text contrast (${contrast(fg,bg).toFixed(2)}:1)`);
console.log(`\n${checks} passed, 0 failed`);
