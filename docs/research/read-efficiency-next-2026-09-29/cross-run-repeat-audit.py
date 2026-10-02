#!/usr/bin/env python3
import argparse,json
from collections import defaultdict
from pathlib import Path
def load(p): return json.loads(p.read_text(encoding="utf-8"))
def walk(x):
    if isinstance(x,dict):
        yield x
        for v in x.values(): yield from walk(v)
    elif isinstance(x,list):
        for v in x: yield from walk(v)
def lines(body):
    parts=body.split("\n")
    return [p+"\n" for p in parts[:-1]]+([parts[-1]] if parts[-1] else [])
def main():
    ap=argparse.ArgumentParser(); ap.add_argument("--output",type=Path); args=ap.parse_args()
    here=Path(__file__).resolve().parent
    root=here.parent/"read-efficiency-evaluation-2026-09-28"/"run-v1-2026-09-29"
    manifest=load(root/"runs.json"); seen=defaultdict(set); records=[]
    totals=defaultdict(lambda:{"runs":0,"readBytes":0,"withinRunRepeatedBodyBytes":0,"acrossRunRepeatedBodyBytes":0,"uniqueMappedBodyBytes":0,"mappingFailures":0})
    for text in manifest["runs"]:
        rp=Path(text); run=load(rp); arm,project=run["arm"],run["project"]; prior=seen[(project,arm)]; current=set()
        within=across=unique=0; failures=[]
        for n,raw in enumerate((rp.parent/"mcp-transcript.jsonl").read_text(encoding="utf-8").splitlines(),1):
            try:
                event=json.loads(raw); payload=json.loads(event.get("text",""))
            except (json.JSONDecodeError,TypeError): continue
            for item in walk(payload):
                body,repo,path,sha=(item.get(k) for k in ("body","repository","path","sha256"))
                start,end=item.get("startLine"),item.get("endLine")
                if not (isinstance(body,str) and all(isinstance(v,str) for v in (repo,path,sha)) and all(isinstance(v,int) and not isinstance(v,bool) for v in (start,end))): continue
                bodylines=lines(body)
                if len(bodylines)!=end-start+1:
                    failures.append({"sequence":event.get("sequence"),"transcriptLine":n,"repository":repo,"path":path,"startLine":start,"endLine":end,"bodyLineCount":len(bodylines)}); continue
                for off,line in enumerate(bodylines):
                    key=(repo,path,sha,start+off,line.removesuffix("\n")); size=len(line.encode("utf-8"))
                    if key in current: within+=size
                    elif key in prior: across+=size; current.add(key)
                    else: unique+=size; current.add(key)
        prior.update(current)
        rec={"ordinal":run["ordinal"],"case":run["case"],"project":project,"arm":arm,"readBytes":run["readBytes"],"withinRunRepeatedBodyBytes":within,"acrossRunRepeatedBodyBytes":across,"uniqueMappedBodyBytes":unique,"mappingFailures":failures}; records.append(rec)
        total=totals[(project,arm)]
        for k,v in (("runs",1),("readBytes",run["readBytes"]),("withinRunRepeatedBodyBytes",within),("acrossRunRepeatedBodyBytes",across),("uniqueMappedBodyBytes",unique),("mappingFailures",len(failures))): total[k]+=v
    projects={}
    for (project,arm),value in sorted(totals.items()): projects.setdefault(project,{})[arm]=value
    out={"version":1,"measure":"optimistic upper bound for exact source-line body bytes recurring in later distinct runs, by arm and project; within-run repeats are reported separately; excludes metadata/receipt cost and is neither billed-token saving nor correctness evidence; cold sessions still need content","runOrderSource":"frozen runs.json array","identity":["project stream","arm stream","repository","path","sha256","absolute source line number","exact line text"],"projects":projects,"runs":records}
    rendered=json.dumps(out,indent=2,sort_keys=True)+"\n"
    args.output.write_text(rendered,encoding="utf-8") if args.output else print(rendered,end="")
if __name__=="__main__": main()
