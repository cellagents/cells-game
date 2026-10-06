/* Protocol-shape unit tests. Exercises parseSubscribe() across the
 * documented valid and invalid combinations so the capability
 * grammar can't silently drift. These tests travel with the
 * protocol module when it moves to the standalone game-protocol
 * repo in Day 4a. */

const { expect } = require('chai');

// Import the published protocol package. The identical suite lives
// in @cellagents/game-protocol itself; this copy exists so cells-game's
// CI exercises the package shape as the server consumes it.
const protocol = require('@cellagents/game-protocol');

describe('protocol 1.0 — parseSubscribe', () => {
    const base = (over) => Object.assign(
        { protocol: '1.0', capabilities: [] },
        over
    );

    it('accepts a full-map spectator (no capabilities)', () => {
        const r = protocol.parseSubscribe(base({}));
        expect(r.ok).to.be.true;
        expect(r.value.capabilities).to.deep.equal([]);
    });

    it('accepts a follow viewer (viewport + follow)', () => {
        const r = protocol.parseSubscribe(base({
            capabilities: ['viewport'],
            follow: 'target-socket-id'
        }));
        expect(r.ok).to.be.true;
    });

    it('accepts a player (steer + presence + viewport)', () => {
        const r = protocol.parseSubscribe(base({
            capabilities: ['steer', 'presence', 'viewport'],
            name: 'alice',
            screen: { width: 800, height: 600 }
        }));
        expect(r.ok).to.be.true;
    });

    it('rejects an unknown protocol version with UNSUPPORTED_PROTOCOL', () => {
        const r = protocol.parseSubscribe({ protocol: '9.9', capabilities: [] });
        expect(r.ok).to.be.false;
        expect(r.code).to.equal('UNSUPPORTED_PROTOCOL');
    });

    it('rejects steer without presence with INVALID_CAPABILITIES', () => {
        const r = protocol.parseSubscribe(base({ capabilities: ['steer'] }));
        expect(r.ok).to.be.false;
        expect(r.code).to.equal('INVALID_CAPABILITIES');
    });

    it('rejects presence without viewport with INVALID_CAPABILITIES', () => {
        const r = protocol.parseSubscribe(base({
            capabilities: ['steer', 'presence'],
            name: 'bob'
        }));
        expect(r.ok).to.be.false;
        expect(r.code).to.equal('INVALID_CAPABILITIES');
    });

    it('rejects presence without name with INVALID_NAME', () => {
        const r = protocol.parseSubscribe(base({
            capabilities: ['steer', 'presence', 'viewport'],
            screen: { width: 800, height: 600 }
        }));
        expect(r.ok).to.be.false;
        expect(r.code).to.equal('INVALID_NAME');
    });

    it('rejects viewport without screen or follow', () => {
        const r = protocol.parseSubscribe(base({ capabilities: ['viewport'] }));
        expect(r.ok).to.be.false;
        expect(r.code).to.equal('INVALID_CAPABILITIES');
    });

    it('rejects viewport+presence without screen', () => {
        const r = protocol.parseSubscribe(base({
            capabilities: ['steer', 'presence', 'viewport'],
            name: 'carol'
        }));
        expect(r.ok).to.be.false;
        expect(r.code).to.equal('INVALID_CAPABILITIES');
    });

    it('rejects viewport+follow with a screen (follow does not take screen)', () => {
        const r = protocol.parseSubscribe(base({
            capabilities: ['viewport'],
            follow: 'target',
            screen: { width: 800, height: 600 }
        }));
        expect(r.ok).to.be.false;
        expect(r.code).to.equal('INVALID_CAPABILITIES');
    });

    it('rejects screen without viewport', () => {
        const r = protocol.parseSubscribe(base({
            capabilities: [],
            screen: { width: 800, height: 600 }
        }));
        expect(r.ok).to.be.false;
        expect(r.code).to.equal('INVALID_CAPABILITIES');
    });

    it('rejects a bad nickname with INVALID_NAME', () => {
        const r = protocol.parseSubscribe(base({
            capabilities: ['steer', 'presence', 'viewport'],
            name: 'has space',
            screen: { width: 800, height: 600 }
        }));
        expect(r.ok).to.be.false;
        expect(r.code).to.equal('INVALID_NAME');
    });

    it('rejects duplicate capabilities', () => {
        const r = protocol.parseSubscribe({
            protocol: '1.0',
            capabilities: ['steer', 'steer', 'presence', 'viewport'],
            name: 'dup',
            screen: { width: 800, height: 600 }
        });
        expect(r.ok).to.be.false;
        expect(r.code).to.equal('INVALID_PAYLOAD');
    });
});
