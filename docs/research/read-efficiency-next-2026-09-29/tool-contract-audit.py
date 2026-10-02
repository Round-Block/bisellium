#!/usr/bin/env python3
import argparse,json
from pathlib import Path
SCHEMA={"type":"object","additionalProperties":True}
def main():
 ap=argparse.ArgumentParser();ap.add_argument("--output",type=Path);z=ap.parse_args();h=Path(__file__).resolve().parent;root=h.parent/"read-efficiency-evaluation-2026-09-28"/"run-v1-2026-09-29";runs=[]
 for rp in sorted((root/"runs").glob("*/run.json")):
  r=json.loads(rp.read_text())
  if r["arm"]!="candidate":continue
  calls={n:0 for n in ("locate","read","expand")};errors={};success=0;fallback=0;fallback_bytes=0
  for line in (rp.parent/"mcp-transcript.jsonl").read_text().splitlines():
   e=json.loads(line);tool=e.get("tool");text=e.get("text","")
   if tool in calls:
    calls[tool]+=1
    try: payload=json.loads(text)
    except json.JSONDecodeError: payload={}
    code=(payload.get("error") or {}).get("code")
    if code: errors[code]=errors.get(code,0)+1
    elif payload.get("ok") is True: success+=1
   elif tool in ("fallback_grep","fallback_read_file"):
    fallback+=1;fallback_bytes+=int(e.get("bytes",len(text.encode())))
  runs.append({"ordinal":r["ordinal"],"case":r["case"],"calls":calls,"productionCalls":sum(calls.values()),"productionSuccesses":success,"productionErrors":errors,"fallbackCalls":fallback,"fallbackResponseBytes":fallback_bytes})
 total={"runs":len(runs),"callsByTool":{n:sum(x["calls"][n] for x in runs) for n in ("locate","read","expand")},"productionCalls":sum(x["productionCalls"] for x in runs),"productionSuccesses":sum(x["productionSuccesses"] for x in runs),"fallbackCalls":sum(x["fallbackCalls"] for x in runs),"fallbackResponseBytes":sum(x["fallbackResponseBytes"] for x in runs),"productionErrors":{}}
 for x in runs:
  for k,v in x["productionErrors"].items():total["productionErrors"][k]=total["productionErrors"].get(k,0)+v
 out={"version":1,"measure":"trial interface behavior only; this does not prove a corrected interface would meet adoption","candidateInputSchema":{"locate":SCHEMA,"read":SCHEMA,"expand":SCHEMA,"source":"docs/research/read-efficiency/targeted-read-eval.mjs evalTools"},"runs":runs,"aggregate":total}
 text=json.dumps(out,indent=2,sort_keys=True)+"\n";z.output.write_text(text) if z.output else print(text,end="")
if __name__=="__main__":main()
