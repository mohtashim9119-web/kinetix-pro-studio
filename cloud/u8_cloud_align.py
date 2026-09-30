"""U8 parity gate — cloud arm. Aligns a corpus's PRODUCTION chunk plan on the sync gateway (cache lookup
first, then a job) and writes the words next to the local arm's, for cloud/compare_fa.py.

    python cloud/u8_cloud_align.py <corpus> <lang> <path-to-original-voiceover>

Procedure (per corpus; v6 / 173 / spanish):
  1. plan   -> cloud/build_chunk_plan.ts   -> $U8_WORK/<corpus>/u8_plan.json
  2. local  -> cloud/run_local_fa.sh         -> $U8_WORK/<corpus>/u8_local_words.json (isolated HOME)
  3. cloud  -> this script                   -> $U8_WORK/<corpus>/u8_cloud_words.json
  4. compare-> cloud/compare_fa.py           -> $U8_WORK/<corpus>/u8_parity.json
Run all four for all three corpora, and check against the recorded numbers, with ONE command:
    cloud/u8_gate.sh
Gate: withinHundredMsPct >= 95 (start and end), identicalText == nCompared.

BILLING GUARD: by default this script REFUSES to submit a job on a cache miss (a miss is a T4 run and a
meter line). Set U8_ALLOW_CLOUD_SPEND=1 to allow it. A hit costs nothing.
"""
import json, sys, time, subprocess, urllib.request, urllib.error, hashlib, os
GATEWAY="https://thekingsmanco99--kinetix-sync.modal.run"
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORK=os.environ.get("U8_WORK", ROOT+"/.work-phase4/u8-gate")
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
plan=json.load(open(f"{WORK}/{corp}/u8_plan.json"))
def ensure_audio():
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
req={"stage":"align","audioHash":h,"language":lang,"chunks":plan["chunks"]}
st,look=call("POST","/v1/cache/lookup",req); print("lookup",st,look.get("cached") if look else look)
if look and look.get("cached"): res=look["result"]; meta={"cached":True}
elif os.environ.get("U8_ALLOW_CLOUD_SPEND")!="1":
    sys.exit(f"{corp}: cache MISS — a job would run on a T4 and bill. Refusing (set U8_ALLOW_CLOUD_SPEND=1 to allow).")
else:
    ensure_audio()
    st,job=call("POST","/v1/jobs",req); print("submit",st,job and {k:job.get(k) for k in ("jobId","status","cached","error")})
    jid=job["jobId"]; t0=time.time()
    while True:
        st,j=call("GET",f"/v1/jobs/{jid}")
        if j["status"] in ("done","failed","cancelled"): break
        time.sleep(3)
    print("final",j["status"],"cached",j.get("cached"),"workerSec",j.get("workerSec"),"clientSec",round(time.time()-t0,1),"error",j.get("error"))
    res=j["result"]; meta={"cached":j.get("cached"),"workerSec":j.get("workerSec"),"jobId":jid}
json.dump({"meta":meta,"audioHash":h,**res},open(f"{WORK}/{corp}/u8_cloud_words.json","w"))
print("words",len(res["words"]),"nFallback",res.get("nFallbackChunks"))
