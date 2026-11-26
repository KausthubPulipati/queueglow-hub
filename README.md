# Queueglow Hub

A compact, always-on-top Windows desktop companion that folds into a pair of eyes at the top of your screen. Hover over the eyes to open it, or switch to click-to-open in Settings.

Queueglow stays out of the taskbar and is controlled from the tray menu.

## Features

**At a glance**

- Home clock, current track, focus timer, and coding-agent activity
- Every tab fits without vertical scrolling. Longer lists and Robo answers use page buttons.

**System controls**

- Wi-Fi and Bluetooth on/off, network and device links, volume, brightness, battery status
- To toggle a radio, click the Wi-Fi or Bluetooth icon at the top left, then click a tile. The tile shows the confirmed state.

**Media**

- Windows media artwork and playback controls
- Local audio fallback and optional synced lyrics

**Mail**

- Opens Gmail in your default browser; Queueglow never accesses your inbox

**Productivity**

- Local notes, agenda, file tray, and optional clipboard history

**Coding agents**

- Codex and Claude Code hook events with one-time approval controls
- Robo: ask questions through the installed Codex or Claude Code CLI, or an optional OpenAI API key. Explicit screen attachments work with Codex and OpenAI.

**Customization**

- Separate Settings window for providers, global island hotkeys, website and local app shortcuts, notifications, island appearance, and startup
- Per-mode site, contact, and music preferences
- Optional floating-glass island skin

## Requirements

- Windows 10 or 11
- Wi-Fi, Bluetooth, brightness, battery, and media info depend on your hardware, active apps, and Windows permissions. Windows policy may refuse a radio toggle; the app reports the error.

## Quick start

1. Download and run `QueueglowHub-Setup` from [Releases](../../releases) for the first install. The per-user installer puts the app and its runtime files together and adds Start menu and optional desktop shortcuts.
2. Open Queueglow from the Start menu. It stays in the system tray when its window is closed.
3. Queueglow checks for updates in the background, downloads them while you work, and installs them the next time you quit. Use **Updates** → **Restart to update** to apply one immediately.

Existing portable-folder users need to run the installer once to switch to the install type that supports in-app updates; their Queueglow data stays in `%LOCALAPPDATA%\Queueglow`. After that one-time move, normal updates do not require downloading or running another setup. Windows may warn because the app is unsigned.

## Mail

The Mail tab opens `https://mail.google.com/` in your default browser. Queueglow does not sign in to Google, request mailbox permissions, or read and store inbox data.

## Privacy

Queueglow has no telemetry. Local data lives in `%LOCALAPPDATA%\Queueglow`.

| Feature           | Default        | What leaves your PC                                                                                             |
| ----------------- | -------------- | --------------------------------------------------------------------------------------------------------------- |
| Clipboard history | Off            | Nothing                                                                                                         |
| Online lyrics     | Off            | Track title and artist go to [LRCLIB](https://lrclib.net/docs) once enabled; results are cached for the session |
| Robo              | Only on submit | Your question goes to the selected provider. An explicitly attached screen or window image is sent with it      |
| OpenAI API key    | Optional       | Stored with Windows encryption                                                                                  |
| Mail              | On click       | Gmail opens in your browser; Queueglow does not access your inbox                                               |

## Build from source

Install Node.js 24 and npm on Windows, then run:

```powershell
npm ci
npm run build
npm test
npm run desktop
```

To create the portable development build, run `npm run package:win`. To create the distributable installer locally, run `npm run release:win`; output goes to `release/installer`. Tag a version as `v<package version>` to have GitHub Actions build and publish the installer plus update metadata. The source checkout does not need a Python environment or a prebuilt hook executable; the coding-agent hook is `electron/agent_hook.ps1`.

No Python environment or prebuilt hook executable is needed. The coding-agent hook is `electron/agent_hook.ps1`.

### GUI smoke tests

```powershell
node e2e/smoke.cjs
node e2e/music.cjs
node e2e/agent.cjs
node e2e/settings.cjs
node e2e/layout.cjs
```

Additional tests:

- `node e2e/robo.cjs` submits one short question through an installed, signed-in Codex CLI.
- `node e2e/radios.cjs` checks radio status. Set `QUEUEGLOW_TEST_RADIO_TOGGLE=1` to switch Bluetooth off and back on during the test.

> These tests move the Windows cursor and exercise live OS features. Run them on a disposable desktop session. The music test needs an active Windows media session with artwork.

## Known limitations

- **Memory use:** The Electron build is heavier than a native utility. A full island smoke test measured about 507 MB combined working set and 304 MB private bytes on the test PC. `QUEUEGLOW_SOFTWARE_RENDER=1` lowers GPU memory but may make animation less smooth.
- **Not implemented:** Google Calendar, microphone input, and enforced app or site blocking.
- **Untested:** Robo image attachments are implemented but have not completed a live provider test.

## Contributing

Open an issue for reproducible bugs. Include your Windows version, display scale, and the steps that caused the problem. Do not post API keys, private agent output, clipboard contents, or screenshots containing personal information.

## License

MIT. See [LICENSE](LICENSE).
