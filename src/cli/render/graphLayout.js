(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BoppiGraphLayout = factory();
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  var COLUMN = { agent:0, server:1, capability:2, data:3, credential:3, destination:4 };
  function wrapLabel(label, limit, measure) {
    var lines = [], line = '';
    function fits(value) { return measure ? measure(value)<=limit : Array.from(value).length<=limit; }
    String(label).split(/\s+/).forEach(function (word) {
      if (line && !fits(line+' '+word)) { lines.push(line); line=''; }
      var chunk='';
      Array.from(word).forEach(function(char){
        if(chunk && !fits(chunk+char)){lines.push(chunk);chunk='';}
        chunk+=char;
      });
      if(chunk) line+=(line?' ':'')+chunk;
    });
    if (line) lines.push(line);
    return lines.length ? lines : [''];
  }
  function layout(nodes, requestedWidth, measure) {
    var width = Math.max(1280, requestedWidth || 0), pad = 20, colW = (width - pad * 2) / 5, boxW = colW - 44;
    var columns = [[],[],[],[],[]], heights = [0,0,0,0,0], positions = {};
    nodes.forEach(function (node) {
      var column = COLUMN[node.kind] === undefined ? 2 : COLUMN[node.kind];
      var lines = wrapLabel(node.label, measure ? boxW-28 : Math.max(12,Math.floor((boxW-28)/10)), measure);
      var height = Math.max(64, 36 + lines.length * 18);
      columns[column].push({ node:node, lines:lines, height:height });
      heights[column] += height + 18;
    });
    var contentHeight = Math.max.apply(null, heights.concat([100]));
    columns.forEach(function (column, ci) {
      var y = 44 + (contentHeight - heights[ci]) / 2;
      column.forEach(function (item) {
        positions[item.node.id] = { x:pad + ci * colW, y:y, w:boxW, h:item.height, lines:item.lines };
        y += item.height + 18;
      });
    });
    return { width:width, height:contentHeight + 92, colW:colW, positions:positions };
  }
  function route(a, b, bottom) {
    var x1 = a.x + a.w, y1 = a.y + a.h / 2, x2 = b.x, y2 = b.y + b.h / 2;
    if (a.x === b.x) {
      var gutter = x1 + 24;
      return 'M '+x1+' '+y1+' C '+gutter+' '+y1+', '+gutter+' '+y2+', '+(b.x+b.w)+' '+y2;
    }
    if (b.x < a.x || b.x-a.x > a.w+100) return 'M '+x1+' '+y1+' L '+(x1+18)+' '+y1+' L '+(x1+18)+' '+bottom+' L '+(x2-18)+' '+bottom+' L '+(x2-18)+' '+y2+' L '+x2+' '+y2;
    var middle = (x1 + x2) / 2;
    return 'M '+x1+' '+y1+' C '+middle+' '+y1+', '+middle+' '+y2+', '+x2+' '+y2;
  }
  return { wrapLabel:wrapLabel, layout:layout, route:route };
});
