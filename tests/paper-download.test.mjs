import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { normalizePaperUrl, isPublicAddress, downloadPaper } from '../server/paper-download.mjs';

const pdf = Buffer.from('%PDF-1.7\nfixture');
const publicDNS = async () => [{ address: '93.184.216.34', family: 4 }];
async function fixture(t, handler) {
  const server = http.createServer(handler);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  return {
    resolveHost: publicDNS,
    makeRequest(url, options, callback) {
      // Check the production connection pins the validated DNS result. The test
      // alone substitutes loopback transport for a controlled upstream fixture.
      options.lookup(url.hostname, { all: true }, (error, addresses) => {
        assert.equal(error, null); assert.deepEqual(addresses, [{ address: '93.184.216.34', family: 4 }]);
      });
      assert.equal(options.headers.Authorization, undefined);
      assert.equal(options.headers.Cookie, undefined);
      return http.request({ ...options, hostname: '127.0.0.1', port: server.address().port,
        path: url.pathname + url.search, lookup: undefined }, callback);
    },
  };
}

test('arXiv abstract, HTML, PDF and legacy IDs resolve to downloadable PDFs', () => {
  for (const path of ['abs/2210.03629', 'pdf/2210.03629.pdf', 'html/2210.03629?x=1#abstract'])
    assert.equal(normalizePaperUrl('https://arxiv.org/' + path).href, 'https://arxiv.org/pdf/2210.03629');
  assert.equal(normalizePaperUrl('http://export.arxiv.org/abs/hep-th/9901001v2').href, 'https://arxiv.org/pdf/hep-th/9901001v2');
  assert.equal(normalizePaperUrl(' https://papers.test/file?id=1#page=2 ').href, 'https://papers.test/file?id=1');
});

test('URL validation excludes private destinations, credentials and non-web protocols', () => {
  for (const value of ['', 'paper', 'file:///etc/passwd', 'ftp://papers.test/a.pdf', 'https://user:pass@papers.test',
    'http://localhost', 'http://a.local', 'http://127.1', 'http://2130706433', 'http://10.0.0.1',
    'http://169.254.169.254', 'http://100.64.1.1', 'http://[::1]', 'http://[::ffff:127.0.0.1]',
    'https://papers.test:8080/a.pdf', 'https://arxiv.org/list/cs/recent'])
    assert.throws(() => normalizePaperUrl(value), undefined, value);
  for (const address of ['127.0.0.1', '0.0.0.0', '172.31.1.2', '192.168.1.2', '240.1.1.1', 'fe80::1', 'fc00::1', '2001:db8::1'])
    assert.equal(isPublicAddress(address), false, address);
  assert.equal(isPublicAddress('2606:4700:4700::1111'), true);
});

test('DNS validation blocks private and mixed results before opening a connection', async () => {
  let requests = 0;
  for (const addresses of [[{address:'127.0.0.1',family:4}], [...await publicDNS(),{address:'192.168.1.1',family:4}]])
    await assert.rejects(downloadPaper('https://papers.test/a.pdf', {
      resolveHost: async () => addresses, makeRequest() { requests++; throw Error('must not connect'); },
    }), /公开/);
  assert.equal(requests, 0);
});

test('download follows public redirects, sniffs PDF bytes and sanitizes upstream filename', async t => {
  const options = await fixture(t, (req, res) => {
    if (req.url === '/start') { res.writeHead(302,{Location:'/download'});res.end();return; }
    res.writeHead(200, {'Content-Type':'application/octet-stream', 'Content-Disposition':"attachment; filename*=UTF-8''..%2F%E8%AE%BA%E6%96%87.pdf"});res.end(pdf);
  });
  const result = await downloadPaper('https://papers.test/start', options);
  assert.deepEqual(result.pdf, pdf); assert.equal(result.name,'论文.pdf');
  assert.equal(result.sourceUrl,'https://papers.test/download');
});

test('redirects are revalidated and capped, and HTTPS cannot downgrade', async t => {
  let destination='http://127.0.0.1/private', requests=0;
  const options=await fixture(t, (_req,res)=>{requests++;res.writeHead(302,{Location:destination});res.end();});
  await assert.rejects(downloadPaper('https://papers.test/start',options), /公开/);assert.equal(requests,1);
  destination='http://public.test/paper';
  await assert.rejects(downloadPaper('https://papers.test/start',options), /不安全/);
  destination='/loop';
  await assert.rejects(downloadPaper('https://papers.test/start',options), /跳转过多/);
  assert.equal(requests,8);
});

test('HTML, authentication errors, oversized headers and oversized streams fail cleanly', async t => {
  const options=await fixture(t,(req,res)=>{
    if(req.url==='/login'){res.writeHead(403);res.end();}
    else if(req.url==='/large-header'){res.writeHead(200,{'Content-Length':'9999'});res.end();}
    else if(req.url==='/large-stream'){res.writeHead(200,{'Transfer-Encoding':'chunked'});res.write(pdf);res.end(Buffer.alloc(200));}
    else res.end('<html>A publisher landing page</html>');
  });
  await assert.rejects(downloadPaper('https://papers.test/html',options),/未返回 PDF/);
  await assert.rejects(downloadPaper('https://papers.test/login',options),/需要登录/);
  for(const path of ['/large-header','/large-stream'])
    await assert.rejects(downloadPaper('https://papers.test'+path,{...options,maxBytes:100}),/超过 30 MB/);
});

test('whole-download deadline and cancellation terminate stalled connections', async t => {
  const options=await fixture(t,()=>{});
  await assert.rejects(downloadPaper('https://papers.test/stall',{...options,timeoutMs:60}),/下载超时/);
  const controller=new AbortController();
  const downloading=downloadPaper('https://papers.test/stall',{...options,signal:controller.signal});
  setTimeout(()=>controller.abort(),20);
  await assert.rejects(downloading,/已取消/);
});

test('HTTP import endpoint validates JSON and rejects bad URLs without creating papers or blocking retries', async t => {
  const dir=mkdtempSync(join(tmpdir(),'nota-url-import-'));
  const child=spawn(process.execPath,['server/server.mjs'],{cwd:resolve(import.meta.dirname,'..'),
    env:{...process.env,PAPER_DATA_DIR:dir,PORT:'0'},stdio:['ignore','ignore','pipe','ipc']});
  t.after(async()=>{const exit=once(child,'exit');child.kill();await exit;rmSync(dir,{recursive:true,force:true});});
  const ready=await Promise.race([once(child,'message'),new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('server timeout')),10000);timer.unref();})]);
  const base='http://127.0.0.1:'+ready[0].port;
  let r=await fetch(base+'/api/import/url',{method:'POST',body:'https://papers.test/a.pdf'});assert.equal(r.status,415);
  for(const url of ['http://127.0.0.1/private','https://user:pass@papers.test','bad']){
    r=await fetch(base+'/api/import/url',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url})});
    assert.equal(r.status,400);assert((await r.json()).error);
  }
  assert.equal(readdirSync(join(dir,'papers')).length,0);
  assert.equal((await (await fetch(base+'/api/state')).json()).importJob,null);
});
