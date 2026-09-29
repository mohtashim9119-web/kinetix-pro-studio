"""U8 parity gate — cloud arm. Aligns a corpus's PRODUCTION chunk plan on the sync gateway (cache lookup
first, then a job) and writes the words next to the local arm's, for cloud/compare_fa.py.

    python cloud/u8_cloud_align.py <corpus> <lang> <path-to-original-voiceover>

Procedure (per corpus; v6 / 173 / spanish):
  1. plan   -> .work-phase4/replay/<corpus>/u8_plan.json  ({audioDuration, chunks}) from scripts/chunkPlanCorpora.ts
               buildCorpusPlan(<corpus>, 'prod') — the same computeFaChunkPlan call production makes.
  2. local  -> cargo test --release --features fa-inference --lib -- --ignored --nocapture --exact
               fa_onnx::session_p_regen::regenerate_fa_against_live_plan
               with FA_REGEN_CORPUS / FA_REGEN_LANG / FA_REGEN_PLAN=u8_plan.json / FA_REGEN_OUT=u8_local_words.json
               (HOME pointed at a scratch dir whose Library/Application Support/com.kinetix.pro-studio/fa-models
               links the model folder, so the app's own data directory is never touched).
  3. cloud  -> this script -> u8_cloud_words.json
  4. compare-> python cloud/compare_fa.py --local u8_local_words.json --cloud u8_cloud_words.json --out cloud/results/u8_parity_<corpus>.json
Gate: withinHundredMsPct >= 95 (start and end), identicalText == nCompared.
"""
import json, sys, time, subprocess, urllib.request, urllib.error, hashlib, os
GATEWAY="https://thekingsmanco99--kinetix-sync.modal.run"
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KEY=open(ROOT+"/cloud/.keys/operator.key").read().strip()
def call(method, path, body=None, raw=None):
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    ct = "application/octet-stream" if raw is not None else "application/json"
    req=urllib.request.Request(GATEWAY+path, data=data, method=method, headers={"Authorization":f"Bearer {KEY}","Content-Type":ct})
    try:
        with urllib.request.urlopen(req, timeout=900) as r: return r.status, json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        b=e.read(); 
        try: return e.code, json.loads(b or b"null")
        except Exception: return e.code, None
corp=sys.argv[1]; lang=sys.argv[2]; src=sys.argv[3]
h=hashlib.sha256(open(src,"rb").read()).hexdigest()
opus=os.environ.get("U8_TMP","/tmp")+f"/u8_{corp}.opus"
cache=os.path.expanduser(f"~/Library/Application Support/com.kinetix.pro-studio/cloud-opus-cache/{h}.opus")
if os.path.exists(cache): opus=cache
else:
    subprocess.run(["ffmpeg","-y","-loglevel","error","-i",src,"-vn","-map","0:a:0","-map_metadata","-1","-ar","16000","-ac","1","-c:a","libopus","-b:a","16k","-vbr","off","-compression_level","4",opus],check=True)
req=urllib.request.Request(GATEWAY+f"/v1/audio/{h}", method="HEAD", headers={"Authorization":f"Bearer {KEY}"})
try:
    urllib.request.urlopen(req, timeout=60); have=True
except urllib.error.HTTPError as e: have=(e.code==200)
print(corp,"hash",h[:12],"audio present" if have else "uploading", os.path.getsize(opus))
if not have:
    st,r=call("PUT",f"/v1/audio/{h}",raw=open(opus,"rb").read()); print("upload",st,r)
plan=json.load(open(f"{ROOT}/.work-phase4/replay/{corp}/u8_plan.json"))
req={"stage":"align","audioHash":h,"language":lang,"chunks":plan["chunks"]}
st,look=call("POST","/v1/cache/lookup",req); print("lookup",st,look.get("cached") if look else look)
if look and look.get("cached"): res=look["result"]; meta={"cached":True}
else:
    st,job=call("POST","/v1/jobs",req); print("submit",st,job and {k:job.get(k) for k in ("jobId","status","cached","error")})
    jid=job["jobId"]; t0=time.time()
    while True:
        st,j=call("GET",f"/v1/jobs/{jid}")
        if j["status"] in ("done","failed","cancelled"): break
        time.sleep(3)
    print("final",j["status"],"cached",j.get("cached"),"workerSec",j.get("workerSec"),"clientSec",round(time.time()-t0,1),"error",j.get("error"))
    res=j["result"]; meta={"cached":j.get("cached"),"workerSec":j.get("workerSec"),"jobId":jid}
json.dump({"meta":meta,"audioHash":h,**res},open(f"{ROOT}/.work-phase4/replay/{corp}/u8_cloud_words.json","w"))
print("words",len(res["words"]),"nFallback",res.get("nFallbackChunks"))
