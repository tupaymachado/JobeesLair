"""Uploads the changed part of the JL build to the PS5, checks it, then swaps it in (old files kept in .prev)."""
import ftplib, os, sys, hashlib, io
HOST, PORT = os.environ["PS5_HOST"], 2121
SRC = "/home/ubuntu/projects/JobeesLair/ps5-react/dist/PPSA99471"
DEST = "/data/homebrew/PPSA99471"; import time
UP = "/data/jl-backups/PPSA99471.update"; PREV = "/data/jl-backups/PPSA99471.prev-" + time.strftime("%Y%m%d-%H%M")
SKIP = ("data/pages/",)  # releases changed with DLPSGame gone (871 files)
def connect():
    f = ftplib.FTP(); f.connect(HOST, PORT, timeout=120); f.login(); f.sendcmd("TYPE I")
    r = f.sendcmd("SITE SELF")  # toggles; make sure it ends up disabled
    if "disabled" not in r: f.sendcmd("SITE SELF")
    return f
files = []
for root, _, names in os.walk(SRC):
    for n in names:
        rel = os.path.relpath(os.path.join(root, n), SRC)
        if not rel.startswith(SKIP): files.append(rel)
files.sort()
f = connect()
def mkdirs(base, rel):
    parts = rel.split("/")[:-1]
    for i in range(len(parts) + 1):
        p = base + ("/" + "/".join(parts[:i]) if i else "")
        try: f.mkd(p)
        except ftplib.error_perm: pass
mode = sys.argv[1]
if mode == "upload":
    total = sum(os.path.getsize(os.path.join(SRC, r)) for r in files)
    print(f"{len(files)} files, {total/1e6:.1f} MB", flush=True)
    for i, rel in enumerate(files, 1):
        mkdirs(UP, rel)
        with open(os.path.join(SRC, rel), "rb") as fh: f.storbinary(f"STOR {UP}/{rel}", fh)
        if f.size(f"{UP}/{rel}") != os.path.getsize(os.path.join(SRC, rel)): sys.exit(f"SIZE MISMATCH {rel}")
        if i % 20 == 0: print(f"{i}/{len(files)}", flush=True)
    for rel in ("eboot.bin",):
        h = hashlib.sha256(); f.retrbinary(f"RETR {UP}/{rel}", h.update)
        local = hashlib.sha256(open(os.path.join(SRC, rel), "rb").read()).hexdigest()
        if h.hexdigest() != local: sys.exit(f"HASH MISMATCH {rel}")
        print(f"{rel} sha256 ok", flush=True)
    print("UPLOADED", flush=True)
elif mode == "swap":
    for rel in files:
        mkdirs(PREV, rel); mkdirs(DEST, rel)
        try: f.rename(f"{DEST}/{rel}", f"{PREV}/{rel}")
        except ftplib.error_perm: pass  # new file
        f.rename(f"{UP}/{rel}", f"{DEST}/{rel}")
    print("SWAPPED", len(files), flush=True)
f.quit()
