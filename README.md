# YouTube Smooth Pause

![Version](https://img.shields.io/badge/version-1.0-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)

A lightweight userscript that adds a smooth audio fade (in/out) when you pause or play YouTube videos. Say goodbye to abrupt, jarring audio cuts.

## 🎥 Demo

https://github.com/user-attachments/assets/570d9a39-049f-4140-8e0d-ce87d4bdc800

## ⚙️ Features
* **Smooth Fade:** A clean 300ms cubic-bezier volume fade on play/pause.
* **Native UI:** An integrated `SP` toggle button built right into the YouTube player controls.
* **Shorts Bypass:** Automatically disables itself on YouTube Shorts (where snappy audio makes more sense).
* **Failsafe Sync:** Prevents YouTube's native volume slider from glitching or desyncing if you manually adjust the volume mid-fade.

## 🚀 Installation
1. Install [Tampermonkey](https://www.tampermonkey.net/) for your browser.
2. **[Click here to install the script](https://raw.githubusercontent.com/nrksu1tan/youtube-smooth-pause/main/youtube-smooth-pause.user.js)** (one-click install).

## 🛠 Tech Notes
Built specifically to survive YouTube's aggressive SPA (Polymer) environment:
* **Zero Memory Leaks:** Uses `WeakMap` to isolate audio player instances. The garbage collector cleanly wipes old data when you switch videos.
* **Event-Driven UI:** No dirty `setInterval` polling. The UI updates hook directly into native YouTube router events (`yt-navigate-finish`, `yt-player-updated`).
* **Performance:** Volume getters/setters are spoofed by reference, node checks use O(1) class hash tables (no heavy `.matches()` parsing), and the fade animation runs efficiently on `requestAnimationFrame`.
