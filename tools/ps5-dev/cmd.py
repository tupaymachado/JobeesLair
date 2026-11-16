"""Writes one live command to the running JL (dev/commands.txt) and, with a shot name, fetches the BMP as PNG."""
import os, ftplib, io, sys, time
seq, steps = sys.argv[1], sys.argv[2]
shot = sys.argv[3] if len(sys.argv) > 3 else None
D = "/data/homebrew/PPSA99471/dev"
f = ftplib.FTP(); f.connect(os.environ["PS5_HOST"], 2121, timeout=60); f.login(); f.sendcmd("TYPE I")
f.storbinary(f"STOR {D}/commands.txt", io.BytesIO(f"{seq} {steps}\n".encode()))
if shot:
    for _ in range(40):
        time.sleep(1.5)
        try:
            buf = io.BytesIO(); f.retrbinary(f"RETR {D}/{shot}.bmp", buf.write); break
        except ftplib.error_perm: continue
    else: sys.exit("no shot")
    from PIL import Image
    Image.open(io.BytesIO(buf.getvalue())).convert("RGB").resize((960, 540)).save(f"/tmp/{shot}.png")
    try: f.delete(f"{D}/{shot}.bmp")
    except ftplib.all_errors: pass
    print("saved", shot)
f.quit()
