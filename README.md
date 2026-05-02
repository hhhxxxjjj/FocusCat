# FocusCat 🐱

> **You code, she eats. You don't, she starves. You context-switch, she eats your apps.**

A pixel cat desktop companion for programmers. She lives on your screen and reacts to your real coding behavior — `git commit` feeds her, drifting off to non-work apps makes her pounce on those windows and minimize them. Built around symbiosis, not punishment: you don't want her to go hungry.

> **Status:** `v0.1` — feature-complete, packaging in progress. Pre-built installer coming soon. For now, run from source (see below).

---

## What she does

| Trigger                                  | Reaction                                                    |
| ---------------------------------------- | ----------------------------------------------------------- |
| You `git commit` in a watched repo       | **Hunger +30**, plays `eat` animation, green `+30` popup    |
| You switch to a non-whitelisted app      | She pounces (plays `eat`), **minimizes** the window, **−10** |
| Time passes (every minute)               | Hunger −1                                                   |
| Hunger reaches 100                       | She curls up and **sleeps** 💤                              |
| Hunger drops below 50                    | She starts **walking around your desktop**, looking for food |
| Hunger drops below 20                    | The hunger bar turns red and pulses                         |

The cat is a transparent always-on-top window. You can drag her anywhere, hover for control buttons (reset position / quit), and she remembers where you put her across restarts.

---

## Quick start

Requires Node.js 18+ on Windows.

```bash
git clone https://github.com/<you>/FocusCat.git
cd FocusCat
npm install
npm start
```

You should see an orange tabby pixel cat appear in the bottom-right corner of your screen, with a hunger bar above her head. Hover over her to see two control buttons: `⌂` (reset position) and `✕` (quit).

For a debug session with DevTools:

```bash
npm run dev
```

In the DevTools console you can manually drive her:

```js
window.focusCat.setState('walk');   // 'idle' | 'walk' | 'eat' | 'sleep'
window.focusCat.getHunger();         // current hunger value 0–100
```

---

## Configuration

Copy `config.example.json` to `config.json` and edit. `config.json` is gitignored and overrides the example.

### Whitelist

Apps in the whitelist are considered "work" — she ignores them. Match by either the display name (`"Claude"`, `"Windows Explorer"`) or the executable filename (`"Code.exe"`, `"chrome.exe"`).

To find what to whitelist, run `npm run dev`, switch to the offending app, and look at the terminal log:

```
[FocusCat] EAT name="WhateverApp" path="C:\...\app.exe" title="..." hwnd=...
```

Add `"WhateverApp"` (the `name` value) to your `whitelist` array, restart, done.

### Git monitor

Set `gitRepo` to the path of any git repo you want her to watch. She tails `.git/logs/HEAD` for new commits — every commit gives her +30 hunger.

```json
"gitRepo": "D:\\path\\to\\your\\repo"
```

She reacts to commits made anywhere — your IDE's commit button, a terminal in another directory, even commits from another tool. As long as the repo is the one configured.

### Real minimize vs. animation-only

By default, `monitor.actuallyMinimize` is `false` — she only plays the `eat` animation when you switch to a non-whitelist app, but doesn't actually minimize the window. This is a safety setting so you can verify your whitelist is correct before letting her loose.

When you're confident:

```json
"monitor": {
  "actuallyMinimize": true
}
```

Restart, and she'll start actually minimizing distraction windows.

---

## Architecture

```
FocusCat (Electron)
├── Main process
│   ├── WindowMonitor   — polls active-win, fires onIntruder if not whitelisted
│   ├── GitWatcher      — fs.watchFile on .git/logs/HEAD, parses commit lines
│   ├── HungerSystem    — 0–100 EventEmitter, persisted to userData/state.json
│   ├── minimize.js     — PowerShell + User32 ShowWindow (no native modules)
│   └── orchestration   — wires events to sprite state + hunger updates via IPC
└── Renderer process    — transparent, frameless, always-on-top window
    ├── Sprite state machine (idle / walk / eat / sleep)
    ├── Hunger bar UI (color-shift + pulse when low)
    └── Native drag region with hover-revealed controls
```

No native modules to compile — the only "native" part is calling `powershell.exe` to invoke `User32.ShowWindow` for actual window minimization. Works on stock Windows, no Visual Studio required.

---

## Roadmap

| Day   | Goal                                          | Status |
| ----- | --------------------------------------------- | ------ |
| 1     | Transparent always-on-top window + emoji cat  | ✅     |
| 2–3   | Native drag, position memory, multi-monitor, off-screen rescue, entrance animation | ✅ |
| 4–5   | Pixel sprite + state machine (idle/walk/eat) | ✅     |
| 6–7   | Active window monitor + actual minimize       | ✅     |
| 8–9   | Git watcher + commit feeding                  | ✅     |
| 10–11 | Hunger system + sleep state + desktop roaming | ✅     |
| 12    | Config polish + user docs                     | 🚧     |
| 13    | Build `.exe` installer                        | ⏳     |
| 14    | Release: GitHub + V2EX + Reddit               | ⏳     |

See [`IDEAS.md`](IDEAS.md) for v0.2+ ideas (and explicitly rejected ones — death/revival, in-cat git GUI, file-save detection — with the reasoning).

---

## Credits

Pixel cat sprites by the artist of "Cat 2D Pixel Art" (paid full version). See [`CREDITS.md`](CREDITS.md) and `src/assets/SPRITE_LICENSE.txt` for license terms.

The asset license permits use in projects (personal or commercial), but **not** redistribution as a standalone game asset, and **not** NFT use. The sprites are bundled here under that license.

---

## License

`MIT` for the source code. See [`LICENSE`](LICENSE).

The bundled sprite art has its own license — see `src/assets/SPRITE_LICENSE.txt`. Don't extract and republish the sprites separately.

---

## Why "FocusCat"?

Most focus tools work by punishment: they block sites, kill apps, lock you out. FocusCat works through symbiosis: she *needs* you to write code (commits feed her), and she's already there on your desktop watching. You don't quit her because you don't want her to starve — that's a stronger pull than any blocker.

It's a desktop pet that happens to also be a productivity tool. Or a productivity tool that happens to also be a pet. Pick your framing.
