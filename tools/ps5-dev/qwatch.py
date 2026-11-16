"""Prints the Wolverine job's state every few seconds (written, speed), via the companion."""
import os, json, subprocess, sys, time
for _ in range(int(sys.argv[1]) if len(sys.argv) > 1 else 6):
    out = subprocess.run(["python3", "-I", os.path.join(os.path.dirname(os.path.abspath(__file__)), "comp.py"), "GET", "/api/queue"], capture_output=True, text=True, timeout=60).stdout
    try:
        jobs = json.loads(out.split(" ", 2)[2])["jobs"]
        j = next(x for x in jobs if x["gameId"] == "PPSA03671")
        print(time.strftime("%H:%M:%S"), j["state"], f"{(j.get('written') or 0)/1e9:.2f} GB", f"{(j.get('bytesPerSecond') or 0)/1e6:.1f} MB/s", (j.get("error") or "")[:80], flush=True)
    except Exception:
        print(time.strftime("%H:%M:%S"), "no answer:", out[:80].strip(), flush=True)
    time.sleep(8)
