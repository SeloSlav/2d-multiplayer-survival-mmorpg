import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

const bundle = await build({
    entryPoints: ['client/src/utils/seamlessAudioLoop.ts'],
    bundle: true, platform: 'node', format: 'esm', write: false,
});
const { SeamlessAudioLoop } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`);

class FakeAudio {
    duration = 6;
    volume = 1;
    playbackRate = 1;
    loop = false;
    paused = true;
    playCalls = 0;
    mediaTime = 0;
    startedAt = 0;
    playResult;

    get currentTime() {
        const time = this.mediaTime + (this.paused ? 0 : (Date.now() - this.startedAt) / 1000 * this.playbackRate);
        return this.loop ? time % this.duration : Math.min(this.duration, time);
    }

    set currentTime(time) {
        this.mediaTime = time;
        this.startedAt = Date.now();
    }

    play() {
        this.playCalls++;
        const result = this.playResult ?? Promise.resolve();
        return result.then(() => {
            if (this.paused) {
                this.startedAt = Date.now();
                this.paused = false;
            }
        });
    }

    pause() {
        this.mediaTime = this.currentTime;
        this.paused = true;
    }
}

const flush = async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
};

function setup(t, rate = 1) {
    t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: 0 });
    const primary = new FakeAudio();
    const secondary = new FakeAudio();
    const errors = [];
    const loop = new SeamlessAudioLoop(primary, secondary, 0.25, rate, error => errors.push(error));
    t.after(() => loop.cancel());
    return { loop, primary, secondary, errors };
}

async function advance(t, milliseconds, inspect = () => {}) {
    for (let elapsed = 0; elapsed < milliseconds; elapsed += 25) {
        t.mock.timers.tick(25);
        await flush();
        inspect();
    }
}

const power = (...audios) => audios.reduce((sum, audio) => sum + (audio.paused ? 0 : audio.volume ** 2), 0);

test('stationary playback stays continuous across repeated loops at different pitches', async t => {
    for (const rate of [0.95, 1, 1.05]) {
        await t.test(`playback rate ${rate}`, async t => {
            const { loop, primary, secondary, errors } = setup(t, rate);
            await loop.start();
            assert.equal(secondary.volume, 0);
            await advance(t, 30000, () => {
                assert.ok(Math.abs(power(primary, secondary) - 0.25 ** 2) < 1e-9, 'no silence or loudness spikes at a handoff');
            });
            assert.ok(primary.playCalls + secondary.playCalls >= 7, 'multiple swaps without any game-state updates');
            assert.deepEqual(errors, []);
        });
    }
});

test('frequent distance and settings volume changes preserve the crossfade envelope', async t => {
    const { loop, primary, secondary } = setup(t);
    await loop.start();
    await advance(t, 5000);
    assert.ok(primary.volume > 0 && secondary.volume > 0, 'both clips overlap');
    loop.volume = 0.1;
    assert.ok(Math.abs(power(primary, secondary) - 0.1 ** 2) < 1e-9);
    await advance(t, 10000, () => {
        loop.volume = Date.now() % 100 < 50 ? 0.08 : 0.15;
        assert.ok(Math.abs(power(primary, secondary) - loop.volume ** 2) < 1e-9);
    });
});

test('a slow play request starts only one handoff and leaves the outgoing clip audible', async t => {
    const { loop, primary, secondary } = setup(t);
    let allowPlayback;
    secondary.playResult = new Promise(resolve => { allowPlayback = resolve; });
    await loop.start();
    await advance(t, 4800);
    assert.equal(secondary.playCalls, 1);
    assert.equal(primary.volume, 0.25);
    allowPlayback();
    await flush();
    await advance(t, 2000);
    assert.equal(secondary.playCalls, 1);
    assert.equal(secondary.volume, 0.25);
    assert.equal(primary.paused, true);
});

test('failed handoffs retain playback and retry without duplicate starts', async t => {
    const { loop, primary, secondary, errors } = setup(t);
    secondary.playResult = Promise.resolve().then(() => { throw new Error('temporary playback failure'); });
    await loop.start();
    await advance(t, 4000);
    assert.equal(errors.length, 1);
    assert.equal(primary.volume, 0.25);
    assert.equal(primary.paused, false);
    secondary.playResult = undefined;
    await advance(t, 2500);
    assert.equal(secondary.playCalls, 2);
    assert.equal(secondary.volume, 0.25);
});

test('cleanup cancels scheduling and pending handoffs cannot overwrite the fade-out', async t => {
    const { loop, primary, secondary } = setup(t);
    let allowPlayback;
    secondary.playResult = new Promise(resolve => { allowPlayback = resolve; });
    await loop.start();
    await advance(t, 4000);
    loop.cancel();
    primary.volume = 0.07;
    allowPlayback();
    await flush();
    await advance(t, 12000);
    assert.equal(primary.volume, 0.07);
    assert.equal(secondary.volume, 0);
    assert.equal(secondary.playCalls, 1);
});
