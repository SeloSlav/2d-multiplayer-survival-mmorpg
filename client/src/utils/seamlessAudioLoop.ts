/** Overlap buffered audio using the media clock, independently of React updates. */
export class SeamlessAudioLoop {
    isPrimaryActive = true;
    private targetVolume: number;
    private timer: ReturnType<typeof setInterval> | undefined;
    private running = false;
    private startingNext = false;
    private retryAfter = 0;
    private crossfade: {
        outgoing: HTMLAudioElement;
        incoming: HTMLAudioElement;
        duration: number;
    } | null = null;

    constructor(
        readonly primary: HTMLAudioElement,
        readonly secondary: HTMLAudioElement,
        volume: number,
        readonly playbackRate: number,
        private readonly onPlaybackError: (error: unknown) => void,
    ) {
        this.targetVolume = volume;
        for (const audio of [primary, secondary]) {
            audio.preload = 'auto';
            // Keep playing if the main thread is briefly stalled at a loop boundary.
            audio.loop = true;
            audio.playbackRate = playbackRate;
        }
        this.applyVolumes();
    }

    get volume(): number {
        return this.targetVolume;
    }

    set volume(volume: number) {
        this.targetVolume = volume;
        this.applyVolumes();
    }

    async start(): Promise<void> {
        this.running = true;
        await this.primary.play();
        if (this.running) {
            this.timer = setInterval(() => this.update(), 25);
        }
    }

    /** Stop scheduling before the caller fades and releases both audio elements. */
    cancel(): void {
        this.running = false;
        clearInterval(this.timer);
        this.timer = undefined;
    }

    private get progress(): number {
        if (!this.crossfade) return 0;
        // Playback speed and a stalled render thread must not change fade timing.
        const elapsed = this.crossfade.incoming.currentTime / this.crossfade.incoming.playbackRate;
        return Math.min(1, Math.max(0, elapsed / this.crossfade.duration));
    }

    private applyVolumes(): void {
        const volume = Math.min(1, Math.max(0, this.targetVolume));
        if (this.crossfade) {
            const angle = this.progress * Math.PI / 2;
            // Equal-power fades keep a steady buzz instead of dipping halfway through.
            this.crossfade.outgoing.volume = volume * Math.cos(angle);
            this.crossfade.incoming.volume = volume * Math.sin(angle);
        } else {
            this.primary.volume = this.isPrimaryActive ? volume : 0;
            this.secondary.volume = this.isPrimaryActive ? 0 : volume;
        }
    }

    private update(): void {
        if (!this.running) return;
        if (this.crossfade) {
            if (this.progress >= 1) {
                this.crossfade.outgoing.pause();
                this.crossfade.outgoing.currentTime = 0;
                this.crossfade = null;
            }
            this.applyVolumes();
            return;
        }
        if (this.startingNext || Date.now() < this.retryAfter) return;

        const current = this.isPrimaryActive ? this.primary : this.secondary;
        const next = this.isPrimaryActive ? this.secondary : this.primary;
        if (current.paused) {
            if (this.targetVolume > 0.01) {
                this.startingNext = true;
                current.play().catch(error => {
                    this.retryAfter = Date.now() + 250;
                    this.onPlaybackError(error);
                }).finally(() => {
                    this.startingNext = false;
                });
            }
            return;
        }
        if (!Number.isFinite(current.duration) || current.duration <= 0) return;

        const duration = current.duration / current.playbackRate;
        const remaining = (current.duration - current.currentTime) / current.playbackRate;
        const overlap = Math.min(2, duration * 0.35);
        // Leave a little time for play() to resolve before the actual fade begins.
        if (remaining > overlap + 0.15) return;

        this.startingNext = true;
        next.volume = 0;
        next.currentTime = 0;
        next.play().then(() => {
            if (!this.running) return;
            const remainingNow = (current.duration - current.currentTime) / current.playbackRate;
            this.crossfade = {
                outgoing: current,
                incoming: next,
                duration: Math.max(0.025, Math.min(overlap, remainingNow - 0.1)),
            };
            this.isPrimaryActive = !this.isPrimaryActive;
            this.applyVolumes();
        }).catch(error => {
            this.retryAfter = Date.now() + 250;
            this.onPlaybackError(error);
        }).finally(() => {
            this.startingNext = false;
        });
    }
}
