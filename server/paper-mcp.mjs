import { createInterface } from 'node:readline';
import { paperTools, callPaperTool } from './paper-environment.mjs';
const manifest = process.argv[2];
const out = m => process.stdout.write(JSON.stringify(m) + '\n');
createInterface({ input: process.stdin }).on('line', line => {
  let m; try { m = JSON.parse(line); } catch { return; }
  if (m.id === undefined) return;
  try {
    let result;
    if (m.method === 'initialize') result = { protocolVersion: m.params.protocolVersion || '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'nota-paper', version: '1.0.0' } };
    else if (m.method === 'tools/list') result = { tools: paperTools.map(tool => ({ ...tool, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } })) };
    else if (m.method === 'tools/call') {
      try { result = callPaperTool(manifest, m.params.name, m.params.arguments); }
      catch (e) { result = { isError: true, content: [{ type: 'text', text: e.message }] }; }
    } else if (m.method === 'ping') result = {};
    else throw Error('Unknown MCP method');
    out({ jsonrpc: '2.0', id: m.id, result });
  } catch (e) { out({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: e.message } }); }
});
