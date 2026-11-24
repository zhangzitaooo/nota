"""Local PDF preparation and OXR coordinate-to-asset adaptation."""
import sys,json,hashlib,re
from pathlib import Path
import pymupdf as fitz
mode,folder=sys.argv[1:3]; folder=Path(folder)
doc=fitz.open(folder/'original.pdf')
if len(doc)==0: raise ValueError('PDF 不完整或没有可读页面，请换一份文件')
if doc.needs_pass: raise ValueError('暂不支持加密 PDF')
if mode=='prepare':
    spec=sys.argv[3].strip(); pages=[]
    if spec.lower() in ['all','全部','全文','']: pages=list(range(1,len(doc)+1))
    else:
        for item in spec.split(','):
            m=re.fullmatch(r'\s*(\d+)(?:\s*-\s*(\d+))?\s*',item)
            if not m: raise ValueError('页码格式：all、1-48 或 1,3,5')
            a,b=int(m[1]),int(m[2] or m[1])
            if a<1 or b<a or b>len(doc): raise ValueError(f'页码超出范围，PDF 共 {len(doc)} 页')
            pages.extend(range(a,b+1))
    pages=sorted(set(pages))
    if len(pages)>500: raise ValueError('原型最多支持 500 页')
    batches=[]
    def split(selected):
        subset=fitz.open()
        for page in selected: subset.insert_pdf(doc,from_page=page-1,to_page=page-1)
        data=subset.tobytes(garbage=4,deflate=True);subset.close()
        if len(data)>10*1024*1024:
            if len(selected)==1: raise ValueError(f'第 {selected[0]} 页单页超过 OXR 10MB 限制')
            mid=len(selected)//2;split(selected[:mid]);split(selected[mid:]);return
        i=len(batches);name=f'batch-{i}.pdf';(folder/name).write_bytes(data)
        batches.append({'index':i,'file':name,'pages':selected,'bytes':len(data),'status':'pending'})
    for i in range(0,len(pages),20): split(pages[i:i+20])
    for p in pages: doc[p-1].get_pixmap(matrix=fitz.Matrix(1.6,1.6)).save(folder/f'page-{p}.png')
    meta={'sourcePages':len(doc),'pages':pages,'pdfTitle':doc.metadata.get('title',''),'batches':batches}
    (folder/'source.json').write_text(json.dumps(meta,ensure_ascii=False));print(json.dumps(meta));sys.exit()
meta=json.loads((folder/'source.json').read_text())
if 'batches' in meta:
    pages=[];warnings=[];tasks=[]
    for batch in meta['batches']:
        response=json.loads((folder/f"batch-{batch['index']}-oxr.json").read_text())
        result=response['data'].get('result',response['data']); batchpages=result['outputs']['json']['pages']
        if sorted(p['page_num'] for p in batchpages)!=list(range(len(batch['pages']))): raise ValueError('OXR 返回页码缺失或重复')
        for p in batchpages:
            p=dict(p);p['page_num']=meta['pages'].index(batch['pages'][p['page_num']]);pages.append(p)
        warnings.extend(response.get('warnings',[]));tasks.append(response['data'].get('task_id'))
    pages.sort(key=lambda p:p['page_num'])
    response={'receivedAt':response.get('receivedAt'),'warnings':warnings,'data':{'task_id':tasks}}
else:
    response=json.loads((folder/'oxr.json').read_text());result=response['data'].get('result',response['data']);pages=result['outputs']['json']['pages']
if len(pages)!=len(meta['pages']): raise ValueError('OXR 返回页数与提交页数不一致')
blocks=[];seen=set()
for page in pages:
    pi=page['page_num']
    if pi in seen or not isinstance(pi,int) or pi<0 or pi>=len(meta['pages']): raise ValueError('OXR 页码无效或重复')
    seen.add(pi); source=meta['pages'][pi]; pdfpage=doc[source-1]
    for j,b in enumerate(page['blocks']):
        kind=b.get('type','Text'); text=b.get('content','')
        block={'id':f'p{source}-b{j}','page':source,'type':kind,'bbox':b.get('bbox'),'pageSize':page.get('page_size'),'text':text,'title':f'第 {source} 页 · {kind}'}
        if kind in ['Picture','Table','Chemical Structure']:
            x1,y1,x2,y2=b['bbox']; size=page['page_size']; r=pdfpage.rect
            rect=fitz.Rect(x1/size['w']*r.width,y1/size['h']*r.height,x2/size['w']*r.width,y2/size['h']*r.height)&r
            if rect.is_empty: raise ValueError('图表坐标无效')
            name=block['id']+'.png'; pdfpage.get_pixmap(matrix=fitz.Matrix(2,2),clip=rect).save(folder/name)
            block['asset']=name
            if kind=='Picture' or kind=='Chemical Structure': block['text']=''
            elif kind=='Table': block['text']=re.sub(r'<[^>]+>',' ',text);block['text']=re.sub(r'\s+',' ',block['text']).strip()
        blocks.append(block)
for i,b in enumerate(blocks):
    if b.get('asset'):
        captions=[c for c in blocks[i+1:i+3] if c['page']==b['page'] and (c['type']=='Caption' or re.match(r'^(Figure|Table)\s+\d',c['text']))]
        for c in captions: c['relatedAsset']=b['asset']
        if captions: b['captionId']=captions[0]['id']
if not any(b['text'] for b in blocks): raise ValueError('OXR 没有返回可阅读文本')
paper={'id':folder.name,'version':1,'title':next((b['text'] for b in blocks if b['type']=='Title'),meta['pdfTitle'] or '导入论文'),'subtitle':'OXR 图文解析 · 原页码保留','blocks':blocks,**meta,'parser':'OXR','parsedAt':response.get('receivedAt'),'warnings':response.get('warnings',[]),'taskId':response['data'].get('task_id'),'coverage':{'expectedPages':meta['pages'],'receivedPages':sorted(meta['pages'][i] for i in seen),'complete':len(seen)==len(meta['pages'])}}
(folder/'paper.json').write_text(json.dumps(paper,ensure_ascii=False,indent=2)); print(json.dumps({'blocks':len(blocks),'images':sum(bool(b.get('asset')) for b in blocks)}))
