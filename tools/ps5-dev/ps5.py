"""Small FTP helper for the owner's PS5 (Jobee'sLair testing): ls, cat, get, put, mkdir.

    python3 -I /tmp/jldeploy/ps5.py ls /data/homebrew
    python3 -I /tmp/jldeploy/ps5.py cat /path/file
    python3 -I /tmp/jldeploy/ps5.py get /path/file local
    python3 -I /tmp/jldeploy/ps5.py put local /path/file
    python3 -I /tmp/jldeploy/ps5.py mkdir /path/dir
"""
import os, ftplib, io, sys

HOST, PORT = os.environ["PS5_HOST"], 2121


def connect():
    f = ftplib.FTP()
    f.connect(HOST, PORT, timeout=60)
    f.login()
    f.sendcmd("TYPE I")
    if "disabled" not in f.sendcmd("SITE SELF"):
        f.sendcmd("SITE SELF")
    return f


cmd, args = sys.argv[1], sys.argv[2:]
f = connect()
if cmd == "ls":
    f.cwd(args[0])
    for name, facts in sorted(f.mlsd()):
        if name in (".", ".."):
            continue
        print(f"{facts.get('type', '?'):4} {facts.get('size', ''):>12} {name}")
elif cmd == "cat":
    buf = io.BytesIO()
    f.retrbinary(f"RETR {args[0]}", buf.write)
    sys.stdout.write(buf.getvalue().decode("utf-8", "replace"))
elif cmd == "get":
    with open(args[1], "wb") as out:
        f.retrbinary(f"RETR {args[0]}", out.write)
    print("saved", args[1])
elif cmd == "put":
    with open(args[0], "rb") as src:
        f.storbinary(f"STOR {args[1]}", src)
    print("stored", args[1])
elif cmd == "mkdir":
    try:
        f.mkd(args[0])
        print("created", args[0])
    except ftplib.error_perm as error:
        print("mkdir:", error)
else:
    sys.exit(f"unknown command {cmd}")
f.quit()
