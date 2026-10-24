"""Rehearse a participant command's real confirmation in a disposable PTY."""
import errno
import os
import pty
import select
import subprocess
import sys
import time

master, slave = pty.openpty()
child = subprocess.Popen([sys.executable, *sys.argv[1:]], stdin=slave, stdout=slave, stderr=slave)
os.close(slave)
output = bytearray()
confirmed = False
deadline = time.monotonic() + 20
try:
    while time.monotonic() < deadline:
        if select.select([master], [], [], 0.1)[0]:
            try:
                chunk = os.read(master, 65536)
            except OSError as error:
                if error.errno == errno.EIO:
                    break
                raise
            if not chunk:
                break
            output.extend(chunk)
            if not confirmed and b'[y/N]' in output:
                os.write(master, b'y\n')
                confirmed = True
        elif child.poll() is not None:
            break
    if child.poll() is None:
        child.terminate()
    code = child.wait(timeout=3)
finally:
    if child.poll() is None:
        child.kill()
        child.wait()
    os.close(master)
sys.stdout.buffer.write(output)
if not confirmed:
    sys.stderr.write('No confirmation prompt was reached.\n')
sys.exit(code if confirmed and code else (0 if confirmed and code == 0 else 1))
