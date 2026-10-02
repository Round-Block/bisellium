import hashlib, json
from pathlib import Path
ROOT = Path('/home/edckt/projects/bisellium/docs/research/read-efficiency-evaluation-2026-09-28/run-v1-2026-09-29')
WT = Path('/home/edckt/projects/bisellium/.worktrees/maps-lookup-experiment')
EXPECTED = {
 'freeze.json':'96f22c5b2c9e5c235e22bf25f81e2eb81098d6284f057aeb29586059084041ac',
 'runs.json':'7001c8167434e633765cf69e2b56cb252d6ce5522a8999316da2712e00f000a2',
 'review/review-packet.json':'67fce8eef6c104fca859a8ff2af12f6adda2112c95020a061b54f784a3ce2d1d',
 'review/scoring-package.json':'a1148cea5edc193a1fc0d53bfd3f12a8f0d0fd98654c0fbfbe83a8d60f9d83bf',
}
def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def fail(msg): raise AssertionError(msg)
actual = {p: sha(ROOT/p) for p in EXPECTED}
if actual != EXPECTED: fail('top-level hash mismatch')
freeze = json.loads((ROOT/'freeze.json').read_text())
if freeze.get('status') != 'FROZEN' or len(freeze.get('order', [])) != 12: fail('freeze status/order')
for name, path in [('sourceReader', WT/'packages/commands/src/source.ts'), ('runner', WT/'docs/research/read-efficiency/targeted-read-eval.mjs')]:
 if freeze['hashes'].get(name) != sha(path): fail(name+' commitment')
for name in ['registry','cases','snapshotManifest']:
 path = Path('/home/edckt/projects/bisellium/docs/research/read-efficiency-evaluation-2026-09-28') / {'registry':'registry.json','cases':'cases.json','snapshotManifest':'snapshot-manifest.json'}[name]
 if freeze['hashes'].get(name) != sha(path): fail(name+' commitment')
runs_index = json.loads((ROOT/'runs.json').read_text())['runs']
if len(runs_index) != 12 or len(set(runs_index)) != 12: fail('run index cardinality')
run_hashes=[]; audit_hashes=[]; totals={}; ordinals=[]
for raw in runs_index:
 p=Path(raw)
 if not p.is_absolute() or ROOT/'runs' not in p.parents: fail('run path confinement')
 run=json.loads(p.read_text()); audit=json.loads((p.parent/'audit.json').read_text())
 ordinal=run.get('ordinal'); ordinals.append(ordinal)
 if run.get('status') != 'COMPLETE' or run.get('exit') != 0: fail('run status')
 if audit.get('status') != 'VALID': fail('audit status')
 if run['hashes'].get('freeze') != EXPECTED['freeze.json']: fail('run freeze link')
 if run['hashes'].get('jsonl') != sha(p.parent/'codex.jsonl') or run['hashes'].get('transcript') != sha(p.parent/'mcp-transcript.jsonl'): fail('raw transcript link')
 run_hashes.append(sha(p)); audit_hashes.append(sha(p.parent/'audit.json'))
 totals[run['arm']] = totals.get(run['arm'], {'runs':0,'readBytes':0,'calls':0})
 totals[run['arm']]['runs'] += 1; totals[run['arm']]['readBytes'] += run['readBytes']; totals[run['arm']]['calls'] += run['calls']
if sorted(ordinals) != list(range(1,13)): fail('ordinals')
packet=json.loads((ROOT/'review/review-packet.json').read_text())
score=json.loads((ROOT/'review/scoring-package.json').read_text())
pa=packet.get('answers',[]); sa=score.get('answers',[])
if len(pa)!=12 or len(sa)!=12: fail('review package cardinality')
ids=[x.get('anonymousId') for x in pa]
sids=[x.get('anonymousId') for x in sa]
if len(set(ids))!=12 or set(ids)!=set(sids): fail('anonymous identity link')
if score.get('freezeSha256') != EXPECTED['freeze.json']: fail('score freeze link')
if set(x.get('runSha256') for x in sa) != set(run_hashes): fail('score run link')
cert=json.loads((ROOT/'certification/exit.json').read_text())
if cert.get('exitCode') != 0: fail('certificate exit')
result={'status':'PASS','topLevelSha256':actual,'freezeStatus':freeze['status'],'freezeOrder':len(freeze['order']),'runs':12,'ordinals':sorted(ordinals),'auditsValid':12,'auditSetSha256':hashlib.sha256(''.join(sorted(audit_hashes)).encode()).hexdigest(),'reviewAnswers':len(pa),'anonymousIdsUnique':len(set(ids)),'scoreAnswers':len(sa),'rawTotals':totals,'certificateExitCode':cert['exitCode']}
(ROOT/'pre-censor-prereview-checkreceipt.json').write_text(json.dumps(result,sort_keys=True,separators=(',',':'))+'\n')
print(json.dumps(result,sort_keys=True))
