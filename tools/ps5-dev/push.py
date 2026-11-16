"""Uploads the listed files to the .update folder (checked by size, eboot by hash), then, with --swap, moves them in."""
import ftplib, hashlib, os, sys, time
HOST, PORT = os.environ["PS5_HOST"], 2121
SRC = "/home/ubuntu/projects/JobeesLair/ps5-react/dist/PPSA99471"
DEST = "/data/homebrew/PPSA99471"; UP = "/data/jl-backups/PPSA99471.update"; PREV = "/data/jl-backups/PPSA99471.prev-" + time.strftime("%Y%m%d-%H%M")
files = sys.argv[1].split(","); swap = "--swap" in sys.argv
f = ftplib.FTP(); f.connect(HOST, PORT, timeout=120); f.login(); f.sendcmd("TYPE I")
if "disabled" not in f.sendcmd("SITE SELF"): f.sendcmd("SITE SELF")
def mkdirs(base, rel):
    parts = rel.split("/")[:-1]
    for i in range(len(parts) + 1):
        try: f.mkd(base + ("/" + "/".join(parts[:i]) if i else ""))
        except ftplib.error_perm: pass
for rel in files:
    mkdirs(UP, rel)
    with open(f"{SRC}/{rel}", "rb") as fh: f.storbinary(f"STOR {UP}/{rel}", fh, blocksize=1 << 20)
    if f.size(f"{UP}/{rel}") != os.path.getsize(f"{SRC}/{rel}"): sys.exit(f"SIZE MISMATCH {rel}")
    print("up", rel, flush=True)
if "eboot.bin" in files:
    h = hashlib.sha256(); f.retrbinary(f"RETR {UP}/eboot.bin", h.update)
    if h.hexdigest() != hashlib.sha256(open(f"{SRC}/eboot.bin", "rb").read()).hexdigest(): sys.exit("HASH MISMATCH eboot")
    print("eboot sha256 ok", flush=True)
if swap:
    for rel in files:
        mkdirs(PREV, rel)
        try: f.rename(f"{DEST}/{rel}", f"{PREV}/{rel}")
        except ftplib.error_perm: pass
        f.rename(f"{UP}/{rel}", f"{DEST}/{rel}")
    print("SWAPPED", len(files), flush=True)
print("DONE", flush=True)
f.quit()
