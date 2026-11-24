import http from 'node:http';
import https from 'node:https';
import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

const MAX_BYTES = 30 * 1024 * 1024;
const denied = new BlockList();
for (const [ip, prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.168.0.0',16],['198.18.0.0',15],['224.0.0.0',3]]) denied.addSubnet(ip,prefix,'ipv4');
const publicV6 = new BlockList(); publicV6.addSubnet('2000::',3,'ipv6');
export function isPublicAddress(address) {
  const family = isIP(address);
  return family === 4 ? !denied.check(address,'ipv4') : family === 6 && publicV6.check(address,'ipv6') && !address.toLowerCase().startsWith('2001:db8:');
}
export function normalizePaperUrl(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 8192) throw Error('请粘贴论文链接');
  let url; try { url = new URL(value.trim()); } catch { throw Error('请输入完整的 http 或 https 链接'); }
  if (!['http:','https:'].includes(url.protocol) || url.username || url.password || (url.port && !['80','443'].includes(url.port))) throw Error('请使用公开的 http 或 https 论文链接');
  const host = url.hostname.replace(/^\[|\]$/g,'').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || (isIP(host) && !isPublicAddress(host))) throw Error('请使用公开的论文链接');
  url.hash = '';
  if (['arxiv.org','www.arxiv.org','export.arxiv.org'].includes(host)) {
    const match = /^\/(?:abs|pdf|html)\/((?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[a-z]{2})?\/\d{7})(?:v\d+)?)(?:\.pdf)?\/?$/i.exec(url.pathname);
    if (!match) throw Error('请粘贴有效的 arXiv 论文链接');
    url.protocol='https:';url.hostname='arxiv.org';url.port='';url.pathname='/pdf/'+match[1];url.search='';
  }
  return url;
}
function fileName(response, url) {
  const header = response.headers['content-disposition'] || '';
  let name = /filename\*=UTF-8''([^;]+)/i.exec(header)?.[1] || /filename="([^"]+)"/i.exec(header)?.[1] || /filename=([^;]+)/i.exec(header)?.[1] || url.pathname.split('/').at(-1) || 'paper';
  try { name=decodeURIComponent(name); } catch {}
  name=name.split(/[\\/]/).at(-1).replace(/[\x00-\x1f\x7f]/g,'').trim().slice(0,180) || 'paper';
  return /\.pdf$/i.test(name) ? name : name+'.pdf';
}
async function resolveWithSignal(hostname, resolveHost, signal) {
  let cancel;
  try {
    return await Promise.race([
      resolveHost(hostname, { all: true, verbatim: true }),
      new Promise((_, reject) => {
        cancel = () => reject(signal.reason);
        if (signal.aborted) cancel();
        else signal.addEventListener('abort', cancel, { once: true });
      }),
    ]);
  } finally { signal.removeEventListener('abort', cancel); }
}
// Resolve every hop and pin the chosen public address in the actual connection,
// including HTTPS SNI/certificate validation. No cookies or app credentials travel.
export async function downloadPaper(value, { signal, timeoutMs = 45000, maxBytes = MAX_BYTES, resolveHost = lookup, makeRequest } = {}) {
  let url = normalizePaperUrl(value);
  const abort = AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : [])]);
  try {
    for (let hop=0;hop<=5;hop++) {
      abort.throwIfAborted();
      const hostname=url.hostname.replace(/^\[|\]$/g,'');
      const addresses = isIP(hostname) ? [{address:hostname,family:isIP(hostname)}] : await resolveWithSignal(hostname, resolveHost, abort);
      abort.throwIfAborted();
      if (!addresses.length || addresses.some(a=>!isPublicAddress(a.address))) throw Error('请使用公开的论文链接');
      const pinned=addresses[0];
      const response=await new Promise((resolve,reject)=>{
        const send=makeRequest || (url.protocol==='https:' ? https.request : http.request);
        const req=send(url,{method:'GET',signal:abort,agent:false,headers:{Accept:'application/pdf','User-Agent':'Nota/0.2 Paper Reader'},lookup:(_host,options,cb)=>cb(null,...(options?.all ? [[pinned]] : [pinned.address,pinned.family]))},resolve);
        req.setTimeout(15000,()=>req.destroy(Error('下载超时，请重试')));req.on('error',reject);req.end();
      });
      if ([301,302,303,307,308].includes(response.statusCode)) {
        const location=response.headers.location;response.destroy();
        if (!location || hop===5) throw Error('链接跳转过多，请使用 PDF 直链');
        const next=normalizePaperUrl(new URL(location,url).href);
        if (url.protocol==='https:' && next.protocol!=='https:') throw Error('链接跳转到不安全的地址，请使用 HTTPS PDF 直链');
        url=next;continue;
      }
      if (response.statusCode!==200) {
        response.destroy();
        throw Error([401,403].includes(response.statusCode) ? '此链接需要登录或不允许下载，请改用 PDF 文件' : `论文下载失败（HTTP ${response.statusCode}），请检查链接`);
      }
      if (Number(response.headers['content-length'])>maxBytes) { response.destroy();throw Error('PDF 超过 30 MB，请改用较小的文件'); }
      const chunks=[];let size=0;
      for await(const chunk of response){size+=chunk.length;if(size>maxBytes){response.destroy();throw Error('PDF 超过 30 MB，请改用较小的文件');}chunks.push(chunk);}
      const pdf=Buffer.concat(chunks);
      if (!pdf.subarray(0,1024).includes(Buffer.from('%PDF-'))) throw Error('链接未返回 PDF，请使用 PDF 直链或 arXiv 论文链接');
      return {pdf,name:fileName(response,url),sourceUrl:url.href};
    }
  } catch(e) {
    if (abort.aborted) throw Error(signal?.aborted ? '已取消导入' : '下载超时，请重试');
    if (['ENOTFOUND','EAI_AGAIN'].includes(e.code)) throw Error('无法找到该网址，请检查链接');
    if (['ECONNREFUSED','ECONNRESET','ETIMEDOUT','ENETUNREACH','EHOSTUNREACH'].includes(e.code)) throw Error('无法下载论文，请检查网络或稍后重试');
    throw e;
  }
}
