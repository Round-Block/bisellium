#!/usr/bin/env python3
import argparse,json,hashlib
from pathlib import Path
def load(p): return json.loads(p.read_text())
def walk(x):
 if isinstance(x,dict):
  yield x
  for v in x.values(): yield from walk(v)
 elif isinstance(x,list):
  for v in x: yield from walk(v)
def merge(xs):
 o=[]
 for a,b in sorted(xs):
  if o and a<=o[-1][1]+1:o[-1]=(o[-1][0],max(o[-1][1],b))
  else:o.append((a,b))
 return o
def gaps(a,b,c):
 o=[];n=a
 for x,y in c:
  if x>n:o.append([n,x-1])
  n=max(n,y+1)
 if n<=b:o.append([n,b])
 return o
def intervals(p):
 f={}
 for line in p.read_text().splitlines():
  e=json.loads(line);t=e.get("text")
  if not isinstance(t,str):continue
  try:x=json.loads(t)
  except json.JSONDecodeError:continue
  for i in walk(x):
   r,q,s,a,b=(i.get(k) for k in ("repository","path","sha256","startLine","endLine"))
   if isinstance(i.get("body"),str) and all(isinstance(v,str) for v in (r,q,s)) and all(isinstance(v,int) for v in (a,b)) and a<=b:f.setdefault((r,q,s),[]).append((a,b))
 return {k:merge(v) for k,v in f.items()}
def main():
 ap=argparse.ArgumentParser();ap.add_argument("--output",type=Path);z=ap.parse_args();h=Path(__file__).resolve().parent;src=h.parent/"read-efficiency-evaluation-2026-09-28";root=src/"run-v1-2026-09-29";ak=load(src/"answer-key.json");sc=load(root/"review/scoring-package.json");vd=load(root/"censor/answer-verdicts.json");cases={x["id"]:x for x in ak["cases"]};sha={x["runSha256"]:x for x in sc["answers"]};anon={x["anonymousId"]:x for x in vd["answers"]};runs=[]
 for rp in sorted((root/"runs").glob("*/run.json")):
  r=load(rp);ii=intervals(rp.parent/"mcp-transcript.jsonl");aa=[]
  for a in cases[r["case"]]["anchors"]:
   k=(a["repository"],a["path"],a["sha256"]);c=merge([(max(a["startLine"],x),min(a["endLine"],y)) for x,y in ii.get(k,[]) if y>=a["startLine"] and x<=a["endLine"]]);g=gaps(a["startLine"],a["endLine"],c);n=sum(y-x+1 for x,y in c);total=a["endLine"]-a["startLine"]+1;aa.append({"repository":a["repository"],"path":a["path"],"sha256":a["sha256"],"startLine":a["startLine"],"endLine":a["endLine"],"coveredLines":n,"totalLines":total,"coverage":f"{n}/{total}","delivered":not g,"missing":g})
  runsha=hashlib.sha256(rp.read_bytes()).hexdigest();s=sha.get(runsha);v=anon.get(s["anonymousId"]) if s else None;runs.append({"ordinal":r["ordinal"],"case":r["case"],"project":r["project"],"arm":r["arm"],"runSha256":runsha if s else None,"anchors":aa,"fullyDelivered":all(x["delivered"] for x in aa),"censorComplete":v["complete"] if v else None})
 ba={}
 for r in runs:
  c=ba.setdefault(r["arm"],{"runs":0,"fullyDelivered":0,"incomplete":0});c["runs"]+=1;c["fullyDelivered" if r["fullyDelivered"] else "incomplete"]+=1
 out=json.dumps({"version":1,"measure":"answer-key anchor delivery only; does not measure semantic use or answer completeness","source":{"answerKey":str(src/"answer-key.json"),"runCount":len(runs)},"runs":runs,"byArm":ba},indent=2,sort_keys=True)+"\n";z.output.write_text(out) if z.output else print(out,end="")
if __name__=="__main__":main()
