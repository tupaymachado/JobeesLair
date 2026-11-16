"""Bytes of the Wolverine set's parts on disk, every 8 s, by SIZE over FTP's control connection (no data channel)."""
import os, ftplib, sys, time
D = "/data/downloads/sets/set-89897458953c4f84"
last = None
for _ in range(int(sys.argv[1])):
    total, have = 0, []
    try:
      f = ftplib.FTP(); f.connect(os.environ["PS5_HOST"], 2121, timeout=30); f.login(); f.sendcmd("TYPE I")
      for n in range(1, 12):
        for name in (f"part-{n}.bin", f"part-{n}.bin.part"):
            try: total += f.size(f"{D}/{name}"); have.append(name)
            except ftplib.error_perm: pass
      f.close()
    except Exception as e:
      print(time.strftime("%H:%M:%S"), "ftp:", e, flush=True); time.sleep(8); continue
    rate = "" if last is None else f"{(total - last) / 8 / 1e6:.1f} MB/s"
    print(time.strftime("%H:%M:%S"), f"{total/1e9:.2f} GB", rate, have[-2:], flush=True)
    last = total
    time.sleep(8)
