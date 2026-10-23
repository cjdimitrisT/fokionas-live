/* Small dependency-free WebSocket server (RFC 6455), so no npm install is needed. */
'use strict';
const crypto = require('crypto');
const { EventEmitter } = require('events');
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

class Socket extends EventEmitter {
  constructor(sock, maxPayload) {
    super();
    this.sock = sock; this.max = maxPayload; this.buf = Buffer.alloc(0); this.frag = null; this.readyState = 1;
    sock.setNoDelay(true);
    sock.on('data', d => { this.buf = Buffer.concat([this.buf, d]); this._parse(); });
    sock.on('close', () => this._closed());
    sock.on('error', () => this._closed());
  }
  _closed() { if (this.readyState === 3) return; this.readyState = 3; this.emit('close'); }
  _parse() {
    while (this.buf.length >= 2) {
      const b0 = this.buf[0], b1 = this.buf[1], fin = b0 & 0x80, op = b0 & 0x0f, masked = b1 & 0x80;
      let len = b1 & 0x7f, off = 2;
      if (len === 126) { if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (this.buf.length < 10) return; len = Number(this.buf.readBigUInt64BE(2)); off = 10; }
      if (!masked || len > this.max) return this.terminate();
      if (this.buf.length < off + 4 + len) return;
      const mask = this.buf.subarray(off, off + 4), data = Buffer.from(this.buf.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < data.length; i++) data[i] ^= mask[i & 3];
      this.buf = this.buf.subarray(off + 4 + len);
      if (op === 0x8) { this._frame(0x8, Buffer.alloc(0)); this.sock.end(); return this._closed(); }
      if (op === 0x9) { this._frame(0xA, data); continue; }
      if (op === 0xA) { this.emit('pong'); continue; }
      if (op === 0x1 || op === 0x2) this.frag = data;
      else if (op === 0x0 && this.frag) this.frag = Buffer.concat([this.frag, data]);
      else continue;
      if (this.frag.length > this.max) return this.terminate();
      if (fin) { const m = this.frag; this.frag = null; this.emit('message', m.toString('utf8')); }
    }
  }
  _frame(op, payload) {
    if (this.readyState !== 1 || this.sock.destroyed) return;
    const len = payload.length;
    let head;
    if (len < 126) head = Buffer.from([0x80 | op, len]);
    else if (len < 65536) { head = Buffer.alloc(4); head[0] = 0x80 | op; head[1] = 126; head.writeUInt16BE(len, 2); }
    else { head = Buffer.alloc(10); head[0] = 0x80 | op; head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
    this.sock.write(Buffer.concat([head, payload]));
  }
  send(text) { this._frame(0x1, Buffer.from(String(text), 'utf8')); }
  ping() { this._frame(0x9, Buffer.alloc(0)); }
  close() { if (this.readyState !== 1) return; this._frame(0x8, Buffer.alloc(0)); this.readyState = 2; setTimeout(() => this.terminate(), 1000); }
  terminate() { this.sock.destroy(); this._closed(); }
}

class WebSocketServer extends EventEmitter {
  constructor({ server, maxPayload = 65536 }) {
    super();
    server.on('upgrade', (req, sock) => {
      const key = req.headers['sec-websocket-key'];
      if (!key || String(req.headers.upgrade).toLowerCase() !== 'websocket') { sock.end('HTTP/1.1 400 Bad Request\r\n\r\n'); return; }
      const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
      sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
      this.emit('connection', new Socket(sock, maxPayload), req);
    });
  }
}
module.exports = { WebSocketServer };
