// ==UserScript==
// @name         YouTube Smooth Pause & Play
// @namespace    http://tampermonkey.net/
// @version      1.0
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

    class AudioEngine {
        constructor(video) {
            this.video = video;
            this.animId = null;
            this.baseVol = rawVolume.get.call(video) || 1;
            this.fading = false;
        }

        setVol(val) {
            rawVolume.set.call(this.video, Math.max(0, Math.min(1, val)));
        }

        fade(target, ms, cb) {
            cancelAnimationFrame(this.animId);
            this.fading = true;
            const start = rawVolume.get.call(this.video);
            const t0 = performance.now();

            const step = (t) => {
                let p = (t - t0) / ms;
                if (p >= 1) p = 1;
                const ease = 1 - Math.pow(1 - p, 3);
                this.setVol(start + (target - start) * ease);

                if (p < 1) {
                    this.animId = requestAnimationFrame(step);
                } else {
                    this.fading = false;
                    if (cb) cb();
                }
            };
            this.animId = requestAnimationFrame(step);
        }
    }

    function getEngine(v) {
        if (!audioEngines.has(v)) audioEngines.set(v, new AudioEngine(v));
        return audioEngines.get(v);
    }

    function isShorts() {
        return window.location.pathname.startsWith('/shorts/');
    }

    Object.defineProperty(HTMLMediaElement.prototype, 'volume', {
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
        if (!isEnabled || isShorts() || !this.classList?.contains(CONFIG.UI.VIDEO_CLASS)) {
            const e = audioEngines.get(this);
            if (e && rawVolume.get.call(this) === 0 && e.baseVol > 0) {
                rawVolume.set.call(this, e.baseVol);
            }
            return rawPlay.call(this);
        }

        const e = getEngine(this);
        if (rawVolume.get.call(this) > 0 && !e.fading) e.baseVol = rawVolume.get.call(this);
        e.setVol(0);

        const p = rawPlay.call(this);
        const up = () => e.fade(e.baseVol, CONFIG.FADE_MS);
        p ? p.then(up).catch(() => {}) : up();
        return p;
    };

    HTMLMediaElement.prototype.pause = function() {
        if (!isEnabled || isShorts() || !this.classList?.contains(CONFIG.UI.VIDEO_CLASS) || this.paused) {
            return rawPause.call(this);
        }
        getEngine(this).fade(0, CONFIG.FADE_MS, () => rawPause.call(this));
    };

    function ensureUI() {
        if (document.getElementById(CONFIG.UI.BTN_ID)) return;
        const controls = document.querySelector(CONFIG.UI.CONTROLS);
        if (!controls) return;

        const btn = document.createElement('button');
        btn.id = CONFIG.UI.BTN_ID;
        btn.className = 'ytp-button';
        btn.setAttribute('title', isEnabled ? 'Smooth Pause: ON' : 'Smooth Pause: OFF');

        btn.style.width = 'auto';
        btn.style.minWidth = '36px';
        btn.style.padding = '0 5px';
        btn.style.opacity = isEnabled ? '1' : '0.4';
        btn.style.transition = 'opacity 0.2s';
        btn.style.fontSize = '14px';
        btn.style.fontWeight = 'bold';
        btn.style.color = '#fff';
        btn.style.textAlign = 'center';
        btn.style.verticalAlign = 'top';
        btn.innerText = 'SP';

        btn.onclick = (e) => {
            isEnabled = !isEnabled;
            localStorage.setItem(CONFIG.STORAGE, String(isEnabled));
            btn.style.opacity = isEnabled ? '1' : '0.4';
            btn.setAttribute('title', isEnabled ? 'Smooth Pause: ON' : 'Smooth Pause: OFF');

            if (!isEnabled) {
                document.querySelectorAll('video').forEach(v => {
                    const eng = audioEngines.get(v);
                    if (eng && rawVolume.get.call(v) === 0 && eng.baseVol > 0) {
                        cancelAnimationFrame(eng.animId);
                        eng.fading = false;
                        rawVolume.set.call(v, eng.baseVol);
                    }
                });
            }

            e.preventDefault();
            e.stopPropagation();
        };

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
