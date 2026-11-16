"""Calls the running JL's phone companion with the owner's session cookie (owner-approved for testing, 2026-11-16).
The cookie is read from the app's settings.json over FTP and never printed."""
import os, ftplib, io, json, sys, urllib.error, urllib.request

f = ftplib.FTP(); f.connect(os.environ["PS5_HOST"], 2121, timeout=60); f.login()
buf = io.BytesIO(); f.retrbinary("RETR /mnt/sandbox/PPSA99471_000/download0/JobeesLair/settings.json", buf.write); f.quit()
session = json.loads(buf.getvalue())["companionSession"]
method, path = sys.argv[1], sys.argv[2]
body = sys.argv[3].encode() if len(sys.argv) > 3 else None
for port in (8080,):
    req = urllib.request.Request(f"http://{os.environ["PS5_HOST"]}:{port}{path}", data=body, method=method,
        headers={"X-JBH": "1", "Content-Type": "application/json", "Cookie": f"jbh={session}"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            print(port, r.status, r.read().decode()[:400000]); break
    except urllib.error.HTTPError as e:
        print(port, e.code, e.read().decode()[:500]); break
    except OSError as e:
        print(port, "unreachable", e)
