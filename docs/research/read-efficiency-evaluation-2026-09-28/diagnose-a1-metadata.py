from pathlib import Path
import json,hashlib,subprocess,os
root=Path(__file__).resolve().parent
work=Path('/home/edckt/projects/bisellium/.worktrees/maps-lookup-experiment')
runner=work/'docs/research/read-efficiency/targeted-read-eval.mjs'
def sha(b):return hashlib.sha256(b).hexdigest()
paths=['registry.json','cases.json','answer-key.json','snapshot-manifest.json']
before={f:sha((root/f).read_bytes()) for f in paths}
manifest=json.loads((root/'snapshot-manifest.json').read_text())
assert isinstance(manifest['preparedAt'],str) and manifest['preparedAt'].endswith('+00:00')
backup=root/'prevalidation-original';backup.mkdir(exist_ok=True)
original=root/'snapshot-manifest.json';target=backup/'snapshot-manifest.json'
if target.exists(): assert target.read_bytes()==original.read_bytes()
else:target.write_bytes(original.read_bytes())
(backup/'snapshot-manifest.sha256').write_text(before['snapshot-manifest.json']+'\n')
# Diagnostic copy only. Authoritative manifest and all hidden inputs are untouched.
manifest['preparedAt']=manifest['preparedAt'][:-6]+'Z'
diag=root/'diagnostic-z-manifest.json';assert not diag.exists();diag.write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
args=['node','--import','tsx',str(runner),'freeze-validate','--data-root',str(root),'--registry',str(root/'registry.json'),'--cases',str(root/'cases.json'),'--key',str(root/'answer-key.json'),'--manifest',str(diag),'--output',str(root/'validation-diagnostic-z.json')]
os.environ['PATH']='/home/linuxbrew/.linuxbrew/bin:'+os.environ['PATH']
r=subprocess.run(args,cwd=work,capture_output=True,text=True)
after={f:sha((root/f).read_bytes()) for f in paths}
assert before==after
result={'runnerSha256':sha(runner.read_bytes()),'originalPreparedAt':json.loads(original.read_text())['preparedAt'],'fieldType':'string','onlyDiagnosticChange':'preparedAt trailing +00:00 to Z (identical UTC instant)','authoritativeInputsUnchanged':True,'command':args,'exitCode':r.returncode,'stdout':r.stdout,'stderr':r.stderr}
(root/'diagnostic-z-execution.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({'runnerSha256':result['runnerSha256'],'originalPreparedAt':result['originalPreparedAt'],'fieldType':'string','authoritativeInputsUnchanged':True,'exitCode':r.returncode,'stdout':r.stdout,'stderr':r.stderr}))
