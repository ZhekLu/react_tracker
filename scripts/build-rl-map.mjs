#!/usr/bin/env node
// Compile editable JSON + Markdown into a validated, offline frontend bundle.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'frontend/package.json'));
const katex = require('katex');
const source = path.join(root, 'content/rl-map');
const manifest = JSON.parse(fs.readFileSync(path.join(source, 'map.json'), 'utf8'));
const sections = ['Idea', 'Mechanics', 'Algorithm', 'Gradients', 'Paper trail', 'Recall'];
const ids = new Set();
const families = new Set(['foundation', 'value', 'score', 'path', 'bridge']);
if (manifest.version !== 1 || !Array.isArray(manifest.nodes) || !Array.isArray(manifest.edges)) throw Error('Expected rl-map version 1 with nodes and edges.');
let equations = 0;
const nodes = manifest.nodes.map(node => {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(node.id) || ids.has(node.id)) throw Error(`Invalid or duplicate id: ${node.id}`);
  ids.add(node.id);
  if (!families.has(node.family) || !node.title || !node.summary || !Number.isInteger(node.day)) throw Error(`Incomplete metadata: ${node.id}`);
  if (node.core && ['policy','actions','data','value','replay','gradient','control'].some(key => !node[key])) throw Error(`Incomplete decision row: ${node.id}`);
  if (!Array.isArray(node.sources) || !node.sources.length) throw Error(`Missing sources: ${node.id}`);
  for (const link of node.sources) {
    if (!link.label || (!link.resourceId && !link.url)) throw Error(`Incomplete source: ${node.id}`);
    if (link.url && !/^https?:\/\//.test(link.url)) throw Error(`Unsafe source URL: ${node.id}`);
  }
  const file = path.resolve(source, node.file);
  if (!file.startsWith(source + path.sep) || !file.endsWith('.md')) throw Error(`Invalid content path: ${node.id}`);
  const markdown = fs.readFileSync(file, 'utf8');
  const parts = markdown.split(/^## (.+)\r?\n/gm);
  if (parts[0].trim()) throw Error(`Content must start with ## Idea: ${node.id}`);
  const content = {};
  for (let i=1; i<parts.length; i+=2) {
    if (!sections.includes(parts[i]) || content[parts[i]]) throw Error(`Unknown/duplicate section ${parts[i]} in ${node.id}`);
    content[parts[i]] = parts[i+1].trim();
  }
  if (sections.some(key => !content[key])) throw Error(`Missing section in ${node.id}`);
  for (const match of markdown.matchAll(/\$\$([\s\S]*?)\$\$|(?<!\\)\$([^$\n]+)(?<!\\)\$/g)) {
    katex.renderToString(match[1] ?? match[2], { throwOnError: true, strict: 'error', displayMode: !!match[1] });
    equations++;
  }
  return { ...node, content };
});
const edgeIds = new Set();
for (const edge of manifest.edges) {
  const id = `${edge.source}/${edge.target}/${edge.label}`;
  if (!ids.has(edge.source) || !ids.has(edge.target) || edge.source===edge.target || !edge.label || !edge.kind || edgeIds.has(id)) throw Error(`Invalid edge: ${id}`);
  edgeIds.add(id);
}
const mechanismIds = new Set();
if (!Array.isArray(manifest.mechanisms)) throw Error('Missing mechanisms array.');
for (const mechanism of manifest.mechanisms) {
  if (!/^[a-z-]+$/.test(mechanism.id) || mechanismIds.has(mechanism.id)) throw Error(`Invalid mechanism: ${mechanism.id}`);
  mechanismIds.add(mechanism.id);
  if (['title','question','summary','distinction'].some(key => !mechanism[key]) || !mechanism.uses?.length) throw Error(`Incomplete mechanism: ${mechanism.id}`);
  for (const use of mechanism.uses) if (!ids.has(use.node) || !use.role) throw Error(`Invalid mechanism use: ${mechanism.id}/${use.node}`);
}
for (const node of nodes) {
  for (const match of node.content.Algorithm.matchAll(/\[@([a-z-]+)\]/g)) if (!mechanismIds.has(match[1])) throw Error(`Unknown mechanism ${match[1]} in ${node.id}`);
  for (const block of node.content.Algorithm.matchAll(/```algorithm\n([\s\S]*?)```/g)) {
    for (const line of block[1].split('\n').filter(Boolean)) {
      if (line.includes('\t') || (line.match(/^ */)[0].length % 2)) throw Error(`Pseudocode needs two-space indentation: ${node.id}`);
    }
  }
}
const result = JSON.stringify({...manifest,nodes}, null, 2)+'\n';
const output = path.join(root, 'frontend/src/features/algorithm-map/map.generated.json');
if (process.argv.includes('--check')) {
  if (!fs.existsSync(output) || fs.readFileSync(output,'utf8') !== result) throw Error('Map bundle is stale; run npm run map:build in frontend.');
} else {
  fs.mkdirSync(path.dirname(output), { recursive:true });
  fs.writeFileSync(output+'.tmp',result);
  fs.renameSync(output+'.tmp',output);
}
console.log(`RL map: ${nodes.length} nodes, ${manifest.edges.length} labeled relationships, ${equations} valid formulas.`);
