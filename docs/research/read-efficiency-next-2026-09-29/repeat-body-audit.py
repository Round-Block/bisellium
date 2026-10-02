#!/usr/bin/env python3
import argparse,json
from pathlib import Path
def load(p): return json.loads(p.read_text())
def walk(x):
 if isinstance(x,dict):
  yield x
  for v in x.values(): yield from walk(v)
 elif isinstance(x,list):
  for v in x: yield from walk(v)
def main():
 ap=argparse.ArgumentParser();ap.add_argument("--output",type=Path);z=ap.parse_args();h=Path(__file__).resolve().parent;root=h.parent/"read-efficiency-evaluation-2026-09-28"/"run-v1-2026-09-29";runs=[]
 for rp in sorted((root/"runs").glob("*/run.json")):
  r=load(rp);seen=set();first=repeat=0;invalid=[]
  for line_no,line in enumerate((rp.parent/"mcp-transcript.jsonl").read_text().splitlines(),1):
   try:e=json.loads(line); payload=json.loads(e.get("text",""))
   except (json.JSONDecodeError,TypeError): continue
   for i in walk(payload):
    body=i.get("body");repo=i.get("repository");path=i.get("path");sha=i.get("sha256");a=i.get("startLine");b=i.get("endLine")
    if not (isinstance(body,str) and all(isinstance(v,str) for v in (repo,path,sha)) and all(isinstance(v,int) for v in (a,b))): continue
    parts=body.split("\n");lines=[(part+"\n") for part in parts[:-1]]+([parts[-1]] if parts[-1] else [])
    if len(lines)!=b-a+1:
     invalid.append({"sequence":e.get("sequence"),"line":line_no,"repository":repo,"path":path,"startLine":a,"endLine":b,"bodyLineCount":len(lines)});continue
    for offset,line_bytes in enumerate(lines):
     text=line_bytes[:-1] if line_bytes.endswith("\n") else line_bytes
     key=(repo,path,sha,a+offset,text); size=len(line_bytes.encode("utf-8"))
     if key in seen: repeat+=size
     else: seen.add(key);first+=size
  runs.append({"ordinal":r["ordinal"],"case":r["case"],"project":r["project"],"arm":r["arm"],"readBytes":r["readBytes"],"firstTimeBodyBytes":first,"repeatedBodyBytes":repeat,"mappedBodyBytes":first+repeat,"mappingFailures":invalid})
 byarm={};bycase={}
 for r in runs:
  for dest,key in ((byarm,r["arm"]),(bycase,r["case"])):
   c=dest.setdefault(key,{"runs":0,"readBytes":0,"firstTimeBodyBytes":0,"repeatedBodyBytes":0,"mappingFailures":0});c["runs"]+=1;c["readBytes"]+=r["readBytes"];c["firstTimeBodyBytes"]+=r["firstTimeBodyBytes"];c["repeatedBodyBytes"]+=r["repeatedBodyBytes"];c["mappingFailures"]+=len(r["mappingFailures"])
 out={"version":1,"measure":"optimistic ceiling for exact repeated source-line bodies only; ignores receipt and metadata cost and is not total potential or subscription savings","runs":runs,"byArm":byarm,"byCase":bycase}
 text=json.dumps(out,indent=2,sort_keys=True)+"\n";z.output.write_text(text) if z.output else print(text,end="")
if __name__=="__main__":main()
