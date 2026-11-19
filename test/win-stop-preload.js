'use strict';
/**
 * Windows test helper. child.kill('SIGINT') terminates a Windows process
 * without running its SIGINT listener, so the parent writes BOPPI_TEST_STOP_FILE
 * and this preload delivers the same event inside the process.
 */
const fs = require('fs');
const stopFile = process.env.BOPPI_TEST_STOP_FILE;
if (stopFile) {
  const timer = setInterval(() => {
    try {
      if (fs.existsSync(stopFile)) {
        clearInterval(timer);
        process.emit('SIGINT');
      }
    } catch (_) { /* the scan should still finish if the stop file disappears */ }
  }, 30);
  if (typeof timer.unref === 'function') timer.unref();
}
