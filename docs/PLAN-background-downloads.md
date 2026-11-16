# Plan: downloads that keep going in the background (payload)

Written 2026-11-16 at the end of a long session, for a fresh session to pick up. Branch:
`feature/free-volumes-and-links` on the fork `tupaymachado/JobeesLair` (remote `fork`). Everything below was seen on
the owner's PS5 unless it says otherwise.

## 1. Why

Measured on the console (2026-11-16, Marvel's Wolverine, zstd set from PFS, 11 RAR parts via TorBox, 60-83 MB/s):

- **Opening any game closes Jobee'sLair at once.** The PS5 runs one game at a time, and JL is a game title (PPSA99471,
  a folder mounted by ShadowMount+). Its log ends mid-download (`conns=64/64 ... 63 MB/s`), no error. The download
  stops there.
- **Reopening JL resumes it from disk** (`part-N.bin.part` + `.resume`): it went on from ~13 GB, nothing lost.
- So "close JL / play something while it downloads" is impossible today. Pegasus DL 1.x did it by being a payload
  (`pegasus_dl.elf`, web UI on port 6970): loader payloads are not apps, so the system does not close them. Pegasus
  DL+ 2.x became an app like JL. Its source is not public (`~/projects/pegasus-dl` holds only releases); nothing to reuse.

## 2. The idea

A loader payload, `download-daemon.elf`, built by the app's build like `companion-daemon.elf` (app.json
`payloads`), that takes over the running download while JL is not running, and hands it back when JL returns.

1. While a download runs, JL keeps a small hand-off file next to the queue: the **resolved** file URL(s) (TorBox gives
   direct links; a link that needs the console's browser cannot be handed off), destination, the set's remaining
   parts in order, range size, and the checkpoint identity.
2. JL sends the daemon at launch (and when a download starts) to the payload loader on 127.0.0.1:9021, like
   `companion-daemon.elf` / `relauncher.elf` are sent (`native/ps5/payload_loader.cpp send_file`: the ELF, then the
   request lines on the same connection).
3. The daemon polls (twice a second, as companion_daemon.c does) whether PPSA99471 runs (`sceLncUtilGetAppId`). When
   it does not, it downloads: libcurl multi, 8-16 connections, `pwrite` into the same `.part`, updating the same
   `.resume` (format below). Part done -> rename `.part` to the final name, next part of the hand-off.
4. When JL runs again the daemon finishes the ranges in flight, writes the checkpoint, and stops; JL's own resume
   (network.cpp, `job.request.resume`) takes over. Nothing to do -> the daemon exits (not resident for nothing).
5. Extraction stays with JL (streaming RAR extraction during download, `freeVolumes`): parts the daemon finishes are
   extracted when JL is back. Disk space: with "free parts" on, parts pile up while JL is away; the daemon must stop
   before the drive fills (statfs, keep a margin like MARGIN2).
6. Phone: `companion-daemon.elf` already answers on the companion's port while JL is closed (queue as last saved,
   "Open Jobee'sLair"). It could show the daemon's progress file.

### Checkpoint format (native/shared/network.cpp `checkpoint()` / resume at ~1247)

`<dest>.resume` = `Checkpoint` header {magic, total, range_bytes, count, identity[64]} + one byte per range
(1 = done). Fixed ranges of `range_bytes` when there is one source (`job.sources.empty()`). JL accepts a resume
whose size and ranges match even under another identity if the tail of the last kept range matches the server's
bytes (0.5.6 rule) - so a renewed TorBox link still resumes. The daemon must write the same struct (copy it, or
share a small C header with network.cpp), `fsync` the `.part` before writing the checkpoint, write it via
`.resume.tmp` + rename.

### Building blocks that exist

- Payload SDK at `ps5-react/.deps/sdk/ps5-payload-sdk`; `prospero-clang` (see tools/build_ps5.py, how
  `relauncher.elf` / `pkg-installer.elf` are built). LncUtil symbols in `target/lib/libSceSystemService.so`
  (`sceLncUtilGetAppId`, `sceLncUtilLaunchApp`, `sceLncUtilKillApp`).
- HTTPS for PS5: `ps5-react/.deps/network-ports` (libcurl, OpenSSL, zlib, zstd, psl static libs) - linked into the
  eboot (build_ps5.py `network_libs`, plus `examples/pacbrew-curl/compat.c` and `netdb.c`). A payload can link the same.
- The app side: download-queue.js (parts loop ~1560-1700, `checkHeaders`, `streamSet`), state/downloads.js,
  companion/service.js (how companion-daemon is armed and given its settings).

### Open questions to settle first

- Does a loader payload keep running in rest mode? (Probably not; then the daemon just resumes after rest like JL.)
- Can the daemon's network get the speed JL gets (JL raises the socket receive window on PROSPERO, network.cpp ~556)?
- The owner's rule for the PS5 (savewind AGENTS.md): nothing resident beyond approved payloads. The owner asked for
  this feature; keep it non-resident when idle and say so.
- Handing off a set mid-extraction (streamed RAR) - simplest: the daemon only downloads; JL extracts on return.

## 3. Other findings of this session (all committed unless noted)

- **Memory**: the JS heap is 64 MiB (`ps5-react/native/shared/js_heap.hpp`), of a 256 MiB title heap (peak seen
  ~190). A feed's games stay in the heap (~7x its file size). DLPSGame is gone from the bundled data
  (`tools/catalog/drop-catalog.mjs`) and the feeds; Pippo, PFS, ZER0GAME feeds share 2 MiB (1.83 used), zstd/LZ4
  links first. Cached feeds over 3 MiB together are not loaded at launch (`state/feeds.js LOADED_BYTES`).
- **UI freeze 132 s at the start of a download**: `archives.inspect` read the growing `.part` on the render thread
  while 64 connections wrote to it. Now `archives.inspectStart/inspectPoll` (native thread) + `Archives.inspectAsync`;
  checked on the PS5: no stall.
- **Speed at 0 KB/s at the end of each part**: a TorBox server trickled 2 KB / 25 s and `CURLOPT_LOW_SPEED_LIMIT`
  was 1 B/s; now 1024 B/s over 30 s (network.cpp).
- **Phone companion sends links**: `POST /api/links {"text", "looseAs"}` (Downloads tab, "Enviar links"); checked on
  the PS5 (a link queued through it).
- **The PS5 ran the wrong copy of JL** for part of the day: ShadowMount links a title to any folder with its ID under
  /data/homebrew, and the deploy script's backups (`PPSA99471.prev-*`) were there. Backups now go to
  `/data/jl-backups/`. Check with `cat /user/app/PPSA99471/mount.lnk` or ShadowMount's API
  `POST http://<ps5>:10101/api/v1/games`; fix: move extra folders out, close JL, `POST /api/v1/scan`.

## 4. Working with the owner's PS5 remotely

Tools in `tools/ps5-dev/` (set `PS5_HOST` to the console's Tailscale address; FTP is `ftpsrv-ps5.elf` on 2121, sent to
the loader on 9021 when needed - it stops at reboot):

- `ps5.py ls|cat|get|put|mkdir` - FTP helper (turns SITE SELF decryption off).
- `push.py <files,comma,separated> [--swap]` - upload only changed dist files to `/data/jl-backups/PPSA99471.update`,
  check sizes and the eboot hash, then move them in (JL must be closed). Full upload: `deploy.py upload|swap`.
  FTP over Tailscale is slow (~100 KB/s-1 MB/s, 138 ms RTT): send only what changed (usually eboot.bin, 42 MB).
- `cmd.py <seq> "<steps>" [shot]` - live commands to the running JL through `dev/commands.txt` (InputScript:
  `confirm`, `down`, `wait:MS`, `shot:NAME`); a shot comes back as /tmp/NAME.png. Every launch shows the terms
  dialog first: `confirm`.
- `comp.py GET|POST /api/... [json]` - the phone companion API (port **8080**; 34177 is Orbit Store) with the owner's
  session cookie read from the app's settings.json. **Owner-approved for testing (2026-11-16); never print the cookie.**
- `qwatch.py N` - the Wolverine job's progress via the companion; `partwatch.py N` - set parts' sizes by FTP SIZE.
- `payloads/kill.c` (close JL), `front.c`, `status.c` (which titles run) - build with the payload SDK:
  `PS5_PAYLOAD_SDK=<sdk> PS5_CLANG=<llvm>/clang LLVM_CONFIG=<llvm>/llvm-config <sdk>/bin/prospero-clang -std=gnu11 -O2
  -o x.elf x.c -lSceUserService -lSceSystemService`, send with `nc -q 5 $PS5_HOST 9021 < x.elf`.
- Open JL: `relauncher.elf` from dist + `RLA1\nPPSA99471\n` to 9021 (it launches once the title is closed).

**Do not touch YouTube (PPSA01650)** - the owner runs the jailbreak from it. For "another game in front" tests use a
game without save sync (Mighty Morphin Power Rangers PPSA18528 was used); never Pragmata, Ghost of Tsushima or
Breath of the Wild (savewind sync). Power the console off only when asked (a poweroff payload exists in an old
scratchpad).

Builds: `cd ps5-react && PATH=<clang-18 shims>:$PATH python3 tools/build_ps5.py --app-dir ../app` (~4 min);
desktop preview `tools/ps5_drive.py start --app-dir ../app` under `Xvfb :99` with curl 8 / libarchive 3.7 from
`~/.local`. Tests: `npm test` (488) and `npm run test:render`.

## 5. State at hand-off

- The PS5 runs the build of commit 9a04312 (+ this doc), mounted from /data/homebrew/PPSA99471.
- Wolverine (PPSA03671) is downloading in JL (part 2 of 11, part 1 extracted).
- Feeds: built every 4 h by crontab (`tools/catalog/catalog-feeds.mjs --out /srv/jl-feeds`, served at
  https://files.tupay.dev.br/jl/); `dlps.jlx` there is a one-game stub for older builds.
- Not done: publishing builds as GitHub releases so JL's own updater fetches them fast (needs the owner's ok).

## 6. Suggested order for the new session

1. Read this file; run `npm test`.
2. Spike: a payload that downloads one URL with libcurl + OpenSSL from network-ports to /data, 8 connections, and
   prints speed - built with the SDK, sent by `nc`. Answers the speed and linking questions.
3. Share the checkpoint struct; daemon resumes a JL `.part`/`.resume`; JL resumes the daemon's. Test on the preview
   first (a desktop build of the daemon, like companion-daemon's `-DCOMPANION_HOST_TEST`).
4. Hand-off file + arming from the queue; companion-daemon shows progress.
5. On the PS5: start a set in JL, open Power Rangers, watch `partwatch.py`, reopen JL.
