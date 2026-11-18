// ==UserScript==
// @name         YouTube Smooth Pause & Play
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  userscript that adds a native smooth volume fade out/in effect when pausing or playing YouTube videos. Protects your ears from abrupt audio stops.
// @author       @nrksu1tan
// @match        *://*.youtube.com/*
// @grant        none
// @run-at       document-start
// @updateURL    https://raw.githubusercontent.com/nrksu1tan/youtube-smooth-pause/main/youtube-smooth-pause.user.js
// @downloadURL  https://raw.githubusercontent.com/nrksu1tan/youtube-smooth-pause/main/youtube-smooth-pause.user.js
// ==/UserScript==

(function() {
    'use strict';

    const CONFIG = {
        FADE_MS: 300,
        RESTORE_DELAY_MS: 100,
        STORAGE: 'yt_smooth_pause_enabled',
        UI: {
            VIDEO_CLASS: 'html5-main-video',
            CONTROLS: '.ytp-right-controls',
            BTN_ID: 'yt-smooth-pause-btn'
        }
    };

    let isEnabled = localStorage.getItem(CONFIG.STORAGE) !== 'false';
    const rawVolume = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'volume');
    const rawPlay = HTMLMediaElement.prototype.play;
    const rawPause = HTMLMediaElement.prototype.pause;

    const audioEngines = new WeakMap();

    // Time of the last real user input. Used to tell a user's second press
    // during a fade-out apart from YouTube calling pause() twice internally.
    let lastUserInput = 0;
    const markInput = () => { lastUserInput = performance.now(); };
    window.addEventListener('keydown', markInput, true);
    window.addEventListener('pointerdown', markInput, true);

    class AudioEngine {
        constructor(video) {
            this.video = video;
            this.animId = 0;
            this.timerId = 0;
            this.restoreId = 0;
            this.baseVol = rawVolume.get.call(video);
            this.fading = false;
            this.pendingPause = false;
            this.pauseStartedAt = 0;
        }

        getRaw() {
            return rawVolume.get.call(this.video);
        }

        setVol(val) {
            rawVolume.set.call(this.video, Math.max(0, Math.min(1, val)));
        }

        stop() {
            cancelAnimationFrame(this.animId);
            clearTimeout(this.timerId);
            clearTimeout(this.restoreId);
            this.animId = this.timerId = this.restoreId = 0;
            this.fading = false;
        }

        // getTarget is a function so a volume change during a fade-in is respected.
        fade(getTarget, ms, cb) {
            this.stop();

            const finish = () => {
                this.stop();
                this.setVol(getTarget());
                if (cb) cb();
            };

            // rAF does not run in background tabs, so finish immediately there.
            if (document.hidden || ms <= 0) {
                finish();
                return;
            }

            this.fading = true;
            const start = this.getRaw();
            const t0 = performance.now();

            const step = (t) => {
                const p = Math.max(0, Math.min(1, (t - t0) / ms));
                const ease = 1 - Math.pow(1 - p, 3);
                const target = getTarget();
                this.setVol(start + (target - start) * ease);

                if (p < 1) {
                    this.animId = requestAnimationFrame(step);
                } else {
                    finish();
                }
            };
            this.animId = requestAnimationFrame(step);
            // Fallback in case rAF gets throttled mid-fade (tab switched).
            this.timerId = setTimeout(finish, ms + 150);
        }

        fadeIn() {
            this.fade(() => this.baseVol, CONFIG.FADE_MS);
        }

        fadeOutAndPause() {
            if (!this.fading && this.getRaw() > 0) this.baseVol = this.getRaw();
            this.pendingPause = true;
            this.pauseStartedAt = performance.now();
            this.fade(() => 0, CONFIG.FADE_MS, () => {
                this.pendingPause = false;
                rawPause.call(this.video);
                this.scheduleRestore();
            });
        }

        // Once paused, put the real volume back, so a play that bypasses
        // our play() (media keys, native controls) is never silent.
        scheduleRestore() {
            clearTimeout(this.restoreId);
            this.restoreId = setTimeout(() => {
                this.restoreId = 0;
                if (this.video.paused && !this.fading) this.setVol(this.baseVol);
            }, CONFIG.RESTORE_DELAY_MS);
        }

        // Cancel everything at once and return to the normal state.
        reset(pauseIfPending) {
            const wasPending = this.pendingPause;
            this.pendingPause = false;
            this.stop();
            if (wasPending && pauseIfPending) rawPause.call(this.video);
            this.setVol(this.baseVol);
        }
    }

    function getEngine(v) {
        let e = audioEngines.get(v);
        if (!e) {
            e = new AudioEngine(v);
            audioEngines.set(v, e);
        }
        return e;
    }

    function isShorts() {
        return window.location.pathname.startsWith('/shorts/');
    }

    function shouldHandle(v) {
        return isEnabled && !isShorts() && !!v.classList?.contains(CONFIG.UI.VIDEO_CLASS);
    }

    Object.defineProperty(HTMLMediaElement.prototype, 'volume', {
        configurable: true,
        enumerable: true,
        get() {
            const e = audioEngines.get(this);
            return e ? e.baseVol : rawVolume.get.call(this);
        },
        set(v) {
            const e = getEngine(this);
            e.baseVol = v;
            if (!e.fading) rawVolume.set.call(this, v);
        }
    });

    HTMLMediaElement.prototype.play = function() {
        const existing = audioEngines.get(this);

        if (!shouldHandle(this)) {
            if (existing && (existing.fading || existing.pendingPause || existing.getRaw() !== existing.baseVol)) {
                existing.reset(false);
            }
            return rawPlay.call(this);
        }

        const e = getEngine(this);

        // play() during a fade-out: the video is still playing, just fade back in.
        if (e.pendingPause) {
            e.pendingPause = false;
            e.fadeIn();
            return rawPlay.call(this);
        }

        // Already playing (YouTube does this after seeking/buffering): no volume dip.
        if (!this.paused) {
            return rawPlay.call(this);
        }

        if (!e.fading && e.getRaw() > 0) e.baseVol = e.getRaw();
        e.stop();
        e.setVol(0);

        const p = rawPlay.call(this);
        if (p && typeof p.then === 'function') {
            // On rejection (autoplay blocked / AbortError) put the volume back.
            p.then(() => e.fadeIn(), () => { if (!e.pendingPause) e.reset(false); });
        } else {
            e.fadeIn();
        }
        return p;
    };

    HTMLMediaElement.prototype.pause = function() {
        const existing = audioEngines.get(this);

        if (!shouldHandle(this) || this.paused) {
            if (existing && (existing.pendingPause || existing.fading)) existing.reset(false);
            return rawPause.call(this);
        }

        const e = getEngine(this);

        if (e.pendingPause) {
            // YouTube only learns about the pause from the 'pause' event, which
            // fires after the fade. So a second press of space/K during the fade
            // arrives as another pause() even though the user wants to resume.
            if (lastUserInput > e.pauseStartedAt) {
                e.pendingPause = false;
                e.fadeIn();
            }
            return;
        }

        e.fadeOutAndPause();
    };

    function updateButton(btn) {
        btn.style.opacity = isEnabled ? '1' : '0.4';
        btn.setAttribute('title', isEnabled ? 'Smooth Pause: ON' : 'Smooth Pause: OFF');
        btn.setAttribute('aria-label', btn.getAttribute('title'));
        btn.setAttribute('aria-pressed', String(isEnabled));
    }

    function ensureUI() {
        if (document.getElementById(CONFIG.UI.BTN_ID)) return;
        const controls = document.querySelector(CONFIG.UI.CONTROLS);
        if (!controls) return;

        const btn = document.createElement('button');
        btn.id = CONFIG.UI.BTN_ID;
        btn.className = 'ytp-button';
        btn.type = 'button';

        Object.assign(btn.style, {
            width: 'auto',
            minWidth: '36px',
            padding: '0 5px',
            transition: 'opacity 0.2s',
            fontSize: '14px',
            fontWeight: 'bold',
            color: '#fff',
            textAlign: 'center',
            verticalAlign: 'top'
        });
        btn.textContent = 'SP';
        updateButton(btn);

        // Never take focus on click: otherwise space "clicks" this button
        // instead of reaching YouTube's play/pause hotkey.
        btn.addEventListener('mousedown', (e) => e.preventDefault());

        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();

            isEnabled = !isEnabled;
            localStorage.setItem(CONFIG.STORAGE, String(isEnabled));
            updateButton(btn);

            if (!isEnabled) {
                document.querySelectorAll('video').forEach(v => {
                    const eng = audioEngines.get(v);
                    if (eng) eng.reset(true);
                });
            }

            btn.blur();
        });

        controls.insertBefore(btn, controls.firstChild);
    }

    let uiRafId;
    const triggerUIUpdate = () => {
        cancelAnimationFrame(uiRafId);
        uiRafId = requestAnimationFrame(ensureUI);
    };

    window.addEventListener('yt-navigate-finish', triggerUIUpdate);
    window.addEventListener('yt-page-data-updated', triggerUIUpdate);
    window.addEventListener('yt-player-updated', triggerUIUpdate);

    document.addEventListener('DOMContentLoaded', () => {
        triggerUIUpdate();
        const playerContainer = document.getElementById('movie_player') || document.body;
        new MutationObserver(triggerUIUpdate).observe(playerContainer, { childList: true, subtree: true });
    });

})();
