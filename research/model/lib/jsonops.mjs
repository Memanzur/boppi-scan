// Minimal RFC 6902 style diff and apply (add, remove, replace) for MCP configs.
const esc = key => String(key).replace(/~/g, '~0').replace(/\//g, '~1');
const unesc = key => key.replace(/~1/g, '/').replace(/~0/g, '~');
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);

export function diff(before, after, path = '') {
  if (JSON.stringify(before) === JSON.stringify(after)) return [];
  if (isObj(before) && isObj(after)) {
    const ops = [];
    for (const key of Object.keys(before)) {
      if (!(key in after)) ops.push({ op: 'remove', path: `${path}/${esc(key)}` });
      else ops.push(...diff(before[key], after[key], `${path}/${esc(key)}`));
    }
    for (const key of Object.keys(after)) if (!(key in before)) ops.push({ op: 'add', path: `${path}/${esc(key)}`, value: after[key] });
    return ops;
  }
  return [{ op: 'replace', path: path || '', value: after }];
}

export function apply(doc, ops) {
  let root = JSON.parse(JSON.stringify(doc));
  for (const op of ops) {
    if (!op || typeof op.path !== 'string' || !['add', 'remove', 'replace'].includes(op.op)) throw new Error('bad op');
    const parts = op.path.split('/').slice(1).map(unesc);
    if (!parts.length) { if (op.op === 'remove') throw new Error('cannot remove root'); root = op.value; continue; }
    let parent = root;
    for (const part of parts.slice(0, -1)) {
      if (parent == null || typeof parent !== 'object' || !(part in parent)) throw new Error(`missing ${op.path}`);
      parent = parent[part];
    }
    const last = parts[parts.length - 1];
    if (parent == null || typeof parent !== 'object') throw new Error(`missing ${op.path}`);
    if (op.op === 'remove') {
      if (!(last in parent)) throw new Error(`missing ${op.path}`);
      if (Array.isArray(parent)) parent.splice(Number(last), 1); else delete parent[last];
    } else if (op.op === 'replace' && !(last in parent)) throw new Error(`missing ${op.path}`);
    else parent[last] = op.value;
  }
  return root;
}
