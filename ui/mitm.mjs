// Local "internet" for the film's OpenCode instance: an HTTP(S) proxy that never forwards.
// Every request (CONNECT-tunnelled HTTPS or plain HTTP) is answered here with a small stub page,
// so the webfetch tool calls on screen hit nothing outside this machine.
import http from 'http';
import https from 'https';
import fs from 'fs';

const PORT = +(process.env.MITM_PORT || 4321);
const DIR = process.env.MITM_DIR || '/tmp/film2';
const LOG = `${DIR}/mitm.log`;
const key = fs.readFileSync(`${DIR}/mitm.key`), cert = fs.readFileSync(`${DIR}/mitm.crt`);

function stub(url) {
  let title = decodeURIComponent(url.replace(/^https?:\/\//, '').replace(/[?#].*$/, ''));
  const last = title.split('/').filter(Boolean).pop() || title;
  const body = `<!doctype html><html><head><meta charset="utf-8"><title>${last}</title></head><body>
<h1>${last}</h1>
<p>(film stub page — served locally, no network access)</p>
${Array.from({ length: 12 }, (_, i) => `<p>§${i + 1}. ${last} …</p>`).join('\n')}
</body></html>`;
  return body;
}

// hosts OpenCode itself polls (model catalogue, updates): fail them so cached data is kept
const BLOCK = /(^|\.)(opencode\.ai|models\.dev|github\.com|githubusercontent\.com|npmjs\.org|registry\.npmjs\.org)(:\d+)?$/;

function handle(req, res, scheme) {
  const url = req.url.startsWith('http') ? req.url : `${scheme}://${req.headers.host}${req.url}`;
  fs.appendFileSync(LOG, `${new Date().toISOString()} ${req.method} ${url}\n`);
  if (BLOCK.test(new URL(url).host)) { req.socket.destroy(); return; }
  const b = Buffer.from(stub(url));
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': b.length });
  res.end(b);
}

const tls = https.createServer({ key, cert }, (req, res) => handle(req, res, 'https'));
const proxy = http.createServer((req, res) => handle(req, res, 'http'));
proxy.on('connect', (req, sock, head) => {
  fs.appendFileSync(LOG, `${new Date().toISOString()} CONNECT ${req.url}\n`);
  if (BLOCK.test(req.url)) { sock.destroy(); return; }
  sock.write('HTTP/1.1 200 Connection Established\r\n\r\n');
  if (head && head.length) sock.unshift(head);
  tls.emit('connection', sock);
});
proxy.listen(PORT, '127.0.0.1', () => console.log('mitm proxy on', PORT));
