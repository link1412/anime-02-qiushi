import { startMock, bus, release, log, reasoningChunkCount } from './mock.mjs';
startMock();
bus.on('main-request', async k => {
  const n = reasoningChunkCount(k); release(`r${k}:start`);
  for (let i = 0; i < n; i++) { await new Promise(r => setTimeout(r, 20)); release(`r${k}:th${i}`); }
  release(`r${k}:text`); release(`r${k}:end`);
});
setTimeout(() => { console.log(JSON.stringify(log, null, 1)); process.exit(0); }, 25000);
