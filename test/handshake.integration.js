/* Socket-level integration smoke for protocol 1.0. Boots the server
 * in-process (via require of the compiled bin/server/server.js is
 * not possible without side-effects — it starts a listener on config
 * port). Instead we spawn a child process with a dedicated PORT and
 * drive it with a socket.io-client.
 *
 * Covers:
 *   - full-map spectator welcome
 *   - player welcome + first tick
 *   - reject on unknown protocol
 *   - reject on invalid capabilities
 *   - steer events from non-steer subscriber are silently dropped
 *   - chat without presence is dropped (no serverSendPlayerChat echo)
 */

const { expect } = require('chai');
const { spawn } = require('child_process');
const path = require('path');
const { io } = require('socket.io-client');

const PORT = 3101;
const HOST = '127.0.0.1';
const BASE = `http://${HOST}:${PORT}`;

let server;

function waitForServerUp(timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
        const start = Date.now();
        const tick = () => {
            fetch(`${BASE}/protocol`)
                .then((r) => (r.ok ? resolve() : retry()))
                .catch(() => retry());
        };
        const retry = () => {
            if (Date.now() - start > timeoutMs) {
                reject(new Error('server did not become ready in time'));
            } else {
                setTimeout(tick, 100);
            }
        };
        tick();
    });
}

function connectAndSubscribe(payload, { collect = [] } = {}) {
    return new Promise((resolve) => {
        const sock = io(BASE, { reconnection: false, forceNew: true });
        const r = { events: {} };
        for (const name of collect) r.events[name] = [];
        const done = () => { try { sock.disconnect(); } catch {} resolve(r); };
        sock.on('connect', () => sock.emit('subscribe', payload));
        sock.on('welcome', (p) => { r.welcome = p; });
        sock.on('reject', (p) => { r.reject = p; done(); });
        sock.on('tick', (p) => { if (r.events.tick) r.events.tick.push(p); });
        sock.on('serverSendPlayerChat', (p) => { if (r.events.serverSendPlayerChat) r.events.serverSendPlayerChat.push(p); });
        // Give enough wall time to collect a tick or two.
        setTimeout(() => { r.sock = sock; resolve(r); }, 400);
    });
}

describe('protocol 1.0 — handshake integration', function () {
    this.timeout(10000);

    before(async () => {
        server = spawn(
            'node',
            [path.join(__dirname, '..', 'bin', 'server', 'server.js')],
            {
                env: { ...process.env, PORT: String(PORT), HOST, ADMIN_PASS: '' },
                stdio: ['ignore', 'ignore', 'pipe']
            }
        );
        await waitForServerUp();
    });

    after(() => {
        if (server) server.kill('SIGTERM');
    });

    it('serves GET /protocol with { protocol, server, version }', async () => {
        const res = await fetch(`${BASE}/protocol`);
        const body = await res.json();
        expect(body.protocol).to.equal('1.0');
        expect(body.server).to.equal('cells-game');
        expect(typeof body.version).to.equal('string');
    });

    it('accepts a full-map spectator', async () => {
        const r = await connectAndSubscribe({ protocol: '1.0', capabilities: [] });
        expect(r.welcome).to.exist;
        expect(r.welcome.protocol).to.equal('1.0');
        expect(r.welcome.self).to.be.null;
        try { r.sock.disconnect(); } catch {}
    });

    it('accepts a player and emits a welcome with self', async () => {
        const r = await connectAndSubscribe({
            protocol: '1.0',
            capabilities: ['steer', 'presence', 'viewport'],
            name: 'alice',
            screen: { width: 800, height: 600 }
        }, { collect: ['tick'] });
        expect(r.welcome).to.exist;
        expect(r.welcome.self).to.be.an('object');
        expect(r.welcome.self.name).to.equal('alice');
        try { r.sock.disconnect(); } catch {}
    });

    it('rejects unknown protocol with UNSUPPORTED_PROTOCOL', async () => {
        const r = await connectAndSubscribe({ protocol: '9.9', capabilities: [] });
        expect(r.reject).to.exist;
        expect(r.reject.code).to.equal('UNSUPPORTED_PROTOCOL');
    });

    it('rejects invalid capability combination', async () => {
        const r = await connectAndSubscribe({ protocol: '1.0', capabilities: ['steer'] });
        expect(r.reject).to.exist;
        expect(r.reject.code).to.equal('INVALID_CAPABILITIES');
    });

    it('drops steer events from a non-steer subscriber silently', async () => {
        const r = await connectAndSubscribe({ protocol: '1.0', capabilities: [] });
        expect(r.welcome).to.exist;
        // Emit heartbeat on a spectator socket; server should not
        // crash and not treat us as a player. We just confirm the
        // socket stays connected and the server stays up.
        r.sock.emit('heartbeat', { x: 100, y: 100 });
        r.sock.emit('fireFood');
        r.sock.emit('split');
        // Give a moment for anything bad to happen.
        await new Promise((res) => setTimeout(res, 200));
        expect(r.sock.connected).to.be.true;
        try { r.sock.disconnect(); } catch {}
    });

    it('drops playerChat without presence', async () => {
        // One spectator (watching) + one spectator (sender).
        const watcher = await connectAndSubscribe(
            { protocol: '1.0', capabilities: [] },
            { collect: ['serverSendPlayerChat'] }
        );
        const sender = await connectAndSubscribe({ protocol: '1.0', capabilities: [] });
        sender.sock.emit('playerChat', { message: 'should not appear' });
        await new Promise((res) => setTimeout(res, 400));
        expect(watcher.events.serverSendPlayerChat).to.deep.equal([]);
        try { watcher.sock.disconnect(); sender.sock.disconnect(); } catch {}
    });
});
