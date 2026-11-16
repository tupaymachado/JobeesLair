"""Finishes an interrupted swap: moves only what is still in the .update folder."""
import ftplib, os, time
HOST, PORT = os.environ["PS5_HOST"], 2121
SRC = "/home/ubuntu/projects/JobeesLair/ps5-react/dist/PPSA99471"
DEST = "/data/homebrew/PPSA99471"; UP = "/data/jl-backups/PPSA99471.update"; PREV = "/data/jl-backups/PPSA99471.prev-" + time.strftime("%Y%m%d-%H%M")
files = sorted(os.path.relpath(os.path.join(r, n), SRC) for r, _, ns in os.walk(SRC) for n in ns)
files = [f for f in files if not f.startswith("data/pages/")]
f = ftplib.FTP(); f.connect(HOST, PORT, timeout=120); f.login(); f.sendcmd("TYPE I")
made = set()
def mkdirs(base, rel):
    parts = rel.split("/")[:-1]
    for i in range(len(parts) + 1):
        p = base + ("/" + "/".join(parts[:i]) if i else "")
        if p in made: continue
        try: f.mkd(p)
        except ftplib.error_perm: pass
        made.add(p)
moved = skipped = 0
for i, rel in enumerate(files, 1):
    try: f.size(f"{UP}/{rel}")
    except ftplib.error_perm: skipped += 1; continue
    mkdirs(PREV, rel); mkdirs(DEST, rel)
    try: f.rename(f"{DEST}/{rel}", f"{PREV}/{rel}")
    except ftplib.error_perm: pass
    f.rename(f"{UP}/{rel}", f"{DEST}/{rel}"); moved += 1
    if i % 100 == 0: print(i, flush=True)
print("MOVED", moved, "ALREADY", skipped, flush=True)
f.quit()
