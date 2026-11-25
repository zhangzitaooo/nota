import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

// Only the host process reads cloud credentials. Harness children get a random,
// process-local token for this loopback-only, fixed-destination relay.
const relays = new Map();
export function gatewayHeaders(connection) {
  return { 'x-api-key': connection.token, ...(connection.serviceToken ? { 'OAI-Sites-Authorization': `Bearer ${connection.serviceToken}` } : {}) };
}
export function localGatewayConnection(id, readConnection, {context = () => ({}), onUsage = async () => {}} = {}) {
  if (relays.has(id)) return relays.get(id);
  const tasks = new Set();
  const opening = new Promise((resolve, reject) => {
    const token = randomBytes(32).toString('base64url');
    const server = http.createServer(async (req, res) => {
      const fail = (code, message) => { if (!res.headersSent) { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify({ error: { message } })); } else res.destroy(); };
      const provided = String(req.headers['x-api-key'] || req.headers.authorization?.replace(/^Bearer /i, '') || '');
      const offered = Buffer.from(provided), expected = Buffer.from(token);
      const same = offered.length === expected.length && timingSafeEqual(offered, expected);
      if (req.headers.host !== `127.0.0.1:${server.address().port}` || req.headers.origin || !same) return fail(403, 'Unauthorized local relay');
      if (!((req.method === 'GET' && req.url === '/models') || (req.method === 'POST' && req.url === '/v1/messages'))) return fail(404, 'Unsupported relay route');
      if (req.method === 'POST' && req.headers['content-type']?.split(';')[0] !== 'application/json') return fail(415, 'JSON required');
      let taskDone;const task=new Promise(r=>{taskDone=r;});tasks.add(task);
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), 125000); timer.unref();
      res.on('close', () => { if (!res.writableEnded) abort.abort(); });
      req.on('aborted', () => abort.abort());
      let receipt=null,connection,meta;
      const observe=async()=>{
        if(!receipt||!connection)return;
        try{const r=await fetch(connection.baseURL+'/usage/requests/'+receipt,{headers:gatewayHeaders(connection),redirect:'error',signal:AbortSignal.timeout(8000)});if(r.ok){const d=await r.json();if(d.request?.id===receipt)await onUsage(d.request);}}catch{}
      };
      try {
        connection = await readConnection(); if (!connection) return fail(503, 'Nota Agent is not configured');
        let payload;
        if (req.method === 'POST') {
          const chunks = []; let size = 0;
          for await (const chunk of req) { size += chunk.length; if (size > 524288) return fail(413, 'Request too large'); chunks.push(chunk); }
          payload = Buffer.concat(chunks);
        }
        meta={...context()};
        const attribution=payload?{...(meta.questionMeter?{'x-nota-question-meter':'1'}:{}),'x-nota-purpose':meta.purpose||'other',...(meta.paperId?{'x-nota-paper-id':meta.paperId}:{}),...(meta.operationId?{'x-nota-operation-id':meta.operationId}:{})}:{};
        const upstream = await fetch(connection.baseURL + req.url, { method: req.method, redirect: 'error', headers: { ...gatewayHeaders(connection), ...attribution, ...(payload ? { 'Content-Type': 'application/json' } : {}) }, body: payload, signal: abort.signal });
        const requestId=upstream.headers.get('x-nota-request-id');
        if(requestId&&/^[a-f0-9-]{36}$/.test(requestId)){receipt=requestId;await Promise.resolve().then(()=>onUsage({id:receipt,paper_id:meta.paperId,purpose:meta.purpose,operation_id:meta.operationId,status:'reserved',created_at:Date.now()})).catch(()=>{});}
        const type = upstream.headers.get('content-type') || '';
        if (!type.startsWith('application/json') && !type.startsWith('text/event-stream')) { await upstream.body?.cancel(); return fail(502, 'Nota Agent gateway access failed'); }
        res.writeHead(upstream.status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
        if (upstream.body) await pipeline(Readable.fromWeb(upstream.body), res); else res.end();
      } catch { fail(502, 'Nota Agent gateway is unavailable'); }
      finally { clearTimeout(timer);await observe();tasks.delete(task);taskDone(); }
    });
    server.requestTimeout = 15000; server.headersTimeout = 10000;
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.unref(); resolve({ flush: async()=>{await Promise.race([Promise.allSettled([...tasks]),new Promise(r=>{const timer=setTimeout(r,9000);timer.unref();})]);}, baseURL: `http://127.0.0.1:${server.address().port}`, token, close: () => { relays.delete(id);server.closeAllConnections(); server.close(); } }); });
  });
  relays.set(id, opening); opening.catch(() => relays.delete(id)); return opening;
}
export async function closeGatewayRelays() { const current = [...relays.values()]; relays.clear(); for (const p of current) { try { (await p).close(); } catch {} } }
