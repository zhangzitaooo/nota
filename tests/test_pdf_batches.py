"""Local boundary tests; never calls OXR or Codex."""
import json,subprocess,tempfile,sys,os
from pathlib import Path
import pymupdf as fitz
root=Path(__file__).resolve().parent.parent/'server'
scratch=None
def invoke(mode,folder,*args,ok=True):
 r=subprocess.run([sys.executable,str(root/'pdf_worker.py'),mode,str(folder),*args],capture_output=True,text=True)
 if ok: assert r.returncode==0,r.stderr
 else: assert r.returncode!=0
 return r
with tempfile.TemporaryDirectory(dir=scratch,prefix='batch-test-') as tmp:
 d=Path(tmp);doc=fitz.open()
 for i in range(28): doc.new_page().insert_text((30,40),f'Original page {i+1}')
 doc.save(d/'original.pdf')
 invoke('prepare',d,'all');source=json.loads((d/'source.json').read_text());assert [len(b['pages']) for b in source['batches']]==[20,8]
 for batch in source['batches']:
  pages=[{'page_num':i,'page_size':{'w':595,'h':842},'blocks':[{'type':'Text','bbox':[20,20,300,80],'content':f'Original page {n}'}]} for i,n in enumerate(batch['pages'])]
  result={'data':{'task_id':str(batch['index']),'result':{'outputs':{'json':{'pages':pages}}}}}
  (d/f"batch-{batch['index']}-oxr.json").write_text(json.dumps(result))
 invoke('assemble',d);paper=json.loads((d/'paper.json').read_text());assert [(b['page'],b['text']) for b in paper['blocks']]==[(i,f'Original page {i}') for i in range(1,29)]
 last=d/'batch-1-oxr.json';bad=json.loads(last.read_text());bad['data']['result']['outputs']['json']['pages'].pop();last.write_text(json.dumps(bad));invoke('assemble',d,ok=False)
 invoke('prepare',d,'1,3,27');source=json.loads((d/'source.json').read_text());assert source['pages']==[1,3,27]
 invoke('prepare',d,'0-3',ok=False);invoke('prepare',d,'29',ok=False)
with tempfile.TemporaryDirectory(dir=scratch,prefix='size-test-') as tmp:
 d=Path(tmp);doc=fitz.open()
 for i in range(2):
  ppm=b'P6\n1400 1400\n255\n'+os.urandom(1400*1400*3)
  page=doc.new_page();page.insert_image(page.rect,stream=ppm)
 doc.save(d/'original.pdf');invoke('prepare',d,'all');source=json.loads((d/'source.json').read_text());assert len(source['batches'])==2;assert all(b['bytes']<=10*1024*1024 for b in source['batches'])
print(json.dumps({'pageLimitSplit':True,'batchLocalToOriginalPageMapping':True,'missingPageRejected':True,'nonContiguousPages':True,'invalidPageRangesRejected':True,'sizeLimitAdaptiveSplit':True}))
