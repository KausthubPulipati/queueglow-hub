import React, { useEffect, useRef, useState } from 'react';
import Connectivity from './Connectivity.jsx';
import {
  Home,
  TerminalSquare,
  Sparkles,
  Music2,
  Timer,
  Moon,
  Inbox,
  Copy,
  FileText,
  CalendarDays,
  Mail,
  Volume2,
  Plus,
  MoreHorizontal,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  X,
  FolderOpen,
  Send,
  Maximize2,
  Settings2,
  LayoutGrid,
  Check,
  Trash2,
  Link,
  Clipboard,
  Bell,
  ExternalLink,
  Wifi,
  Bluetooth,
  Battery,
  BatteryCharging,
  Sun,
  RefreshCw,
  Pencil,
  Power,
} from 'lucide-react';

const ICONS = {
  home: Home,
  codex: TerminalSquare,
  robo: Sparkles,
  music: Music2,
  focus: Timer,
  modes: Moon,
  tray: Inbox,
  clips: Copy,
  note: FileText,
  agenda: CalendarDays,
  mail: Mail,
};
const NAMES = {
  home: 'Home',
  codex: 'Codex',
  robo: 'Robo',
  music: 'Music',
  focus: 'Focus',
  modes: 'Modes',
  tray: 'Tray',
  clips: 'Clips',
  note: 'Note',
  agenda: 'Agenda',
  mail: 'Mail',
};
const fmt = (seconds) =>
  `${Math.floor(Math.max(0, seconds) / 60)
    .toString()
    .padStart(2, '0')}:${Math.floor(Math.max(0, seconds) % 60)
    .toString()
    .padStart(2, '0')}`;
const clock = (date, settings = {}) =>
  date.toLocaleTimeString([], {
    hour: settings.clockLeadingZero ? '2-digit' : 'numeric',
    minute: '2-digit',
    second: settings.clockShowSeconds ? '2-digit' : undefined,
    hour12: settings.clockFormat !== '24h',
  });
const day = (date) =>
  `${date.toLocaleDateString([], { weekday: 'short' })} ${date.getDate()} ${date.toLocaleDateString([], { month: 'short' })}`.toUpperCase();
const initial = {
  settings: {},
  apps: [],
  jobs: [],
  events: [],
  clips: [],
  tray: [],
  agenda: [],
  modes: [],
  pending: [],
  note: '',
  audio: [],
  systemMedia: null,
  roboCapabilities: null,
  volume: null,
  system: null,
  focus: null,
  folded: true,
  motion: 'idle',
  mail: null,
};

export default function App() {
  const [state, setState] = useState(initial),
    [page, setPage] = useState('home'),
    [menu, setMenu] = useState(false),
    [now, setNow] = useState(new Date());
  const [volumeOpen, setVolumeOpen] = useState(false),
    [volumeDraft, setVolumeDraft] = useState(0),
    [brightnessDraft, setBrightnessDraft] = useState(50);
  const [connectivityOpen, setConnectivityOpen] = useState(false);
  const [error, setError] = useState(''),
    [success, setSuccess] = useState('');
  const [updateState, setUpdateState] = useState({ supported: false, status: 'idle', message: '' });
  const [duration, setDuration] = useState(25),
    [selectedMode, setSelectedMode] = useState('work');
  const [note, setNote] = useState(''),
    [agendaTitle, setAgendaTitle] = useState(''),
    [agendaStart, setAgendaStart] = useState(''),
    [agendaEnd, setAgendaEnd] = useState('');
  const [prompt, setPrompt] = useState(''),
    [answer, setAnswer] = useState(''),
    [busy, setBusy] = useState(false),
    [captureTarget, setCaptureTarget] = useState('none'),
    [roboTargets, setRoboTargets] = useState([]);
  const [track, setTrack] = useState(0),
    [playing, setPlaying] = useState(false),
    [progress, setProgress] = useState(0);
  const audio = useRef(null);
  const foldTimer = useRef(null);
  const noteReady = useRef(false);
  const noteDirty = useRef(false);
  const noteDraft = useRef('');
  const noteSaveChain = useRef(Promise.resolve());
  const noteSaveTimer = useRef(null);
  const saveNote = (value) => {
    noteSaveChain.current = noteSaveChain.current
      .catch(() => {})
      .then(() => window.hub.noteSave(value));
    return noteSaveChain.current.then(() => {
      if (noteDraft.current === value) noteDirty.current = false;
    });
  };
  const flushNote = () => {
    if (noteSaveTimer.current) clearTimeout(noteSaveTimer.current);
    noteSaveTimer.current = null;
    if (noteDirty.current) return saveNote(noteDraft.current);
    return Promise.resolve();
  };
  const scheduleNoteSave = () => {
    if (noteSaveTimer.current) clearTimeout(noteSaveTimer.current);
    noteSaveTimer.current = setTimeout(() => {
      noteSaveTimer.current = null;
      flushNote().catch((error) => setError(error.message));
    }, 300);
  };
  useEffect(() => {
    window.hub.state().then((s) => {
      setState(s);
      setNote(s.note || '');
      noteDraft.current = s.note || '';
      noteReady.current = true;
    });
    return window.hub.onUpdate((s) => {
      setState(s);
      if (!noteDirty.current && document.activeElement?.tagName !== 'TEXTAREA') {
        setNote(s.note || '');
        noteDraft.current = s.note || '';
      }
    });
  }, []);
  useEffect(() => {
    window.hub
      .updateState()
      .then(setUpdateState)
      .catch(() => {});
    return window.hub.onUpdateStatus(setUpdateState);
  }, []);
  useEffect(() => {
    const flush = () => {
      if (noteSaveTimer.current) clearTimeout(noteSaveTimer.current);
      if (noteDirty.current) window.hub.noteFlush(noteDraft.current);
    };
    window.addEventListener('beforeunload', flush);
    return () => window.removeEventListener('beforeunload', flush);
  }, []);
  useEffect(
    () => window.hub.onMotion((value) => setState((previous) => ({ ...previous, ...value }))),
    [],
  );
  useEffect(() => {
    if (state.folded || state.motion === 'folding') {
      setMenu(false);
      setVolumeOpen(false);
      setConnectivityOpen(false);
    }
  }, [state.folded, state.motion]);
  useEffect(
    () =>
      window.hub.onPresence(({ x, y, sleeping }) => {
        document.documentElement.style.setProperty('--gaze-x', `${x}px`);
        document.documentElement.style.setProperty('--gaze-y', `${y}px`);
        document.documentElement.dataset.eyesSleep = String(sleeping);
      }),
    [],
  );
  useEffect(() => {
    document.documentElement.dataset.reduceMotion = String(
      !!state.settings?.reduceMotion || state.settings?.appAnimations === false,
    );
  }, [state.settings?.reduceMotion, state.settings?.appAnimations]);
  useEffect(() => {
    let timer;
    const tick = () => {
      const current = new Date();
      setNow(current);
      const needsSeconds = state.settings?.clockShowSeconds || Boolean(state.focus);
      const delay = needsSeconds ? 1000 : 60_000 - (current.getTime() % 60_000) + 20;
      timer = setTimeout(tick, delay);
    };
    const current = new Date();
    const needsSeconds = state.settings?.clockShowSeconds || Boolean(state.focus);
    timer = setTimeout(tick, needsSeconds ? 1000 : 60_000 - (current.getTime() % 60_000) + 20);
    return () => clearTimeout(timer);
  }, [state.settings?.clockShowSeconds, Boolean(state.focus)]);
  useEffect(() => {
    if (state.volume !== null) setVolumeDraft(state.volume);
  }, [state.volume]);
  useEffect(() => {
    if (state.system?.brightnessPercent !== null && state.system?.brightnessPercent !== undefined)
      setBrightnessDraft(state.system.brightnessPercent);
  }, [state.system?.brightnessPercent]);
  useEffect(() => {
    if (
      page === 'robo' &&
      state.roboCapabilities?.screenAttachments &&
      state.settings?.roboScreenCapture !== false
    )
      window.hub
        .roboTargets()
        .then(setRoboTargets)
        .catch(() => setRoboTargets([]));
    else setRoboTargets([]);
  }, [page, state.roboCapabilities?.screenAttachments, state.settings?.roboScreenCapture]);
  useEffect(() => {
    if (page !== 'music' || !audio.current) return;
    if (playing) audio.current.play().catch(() => setPlaying(false));
    else audio.current.pause();
  }, [playing, track, page]);
  const activeTrack = state.audio[track];
  const remaining = state.focus
    ? Math.max(0, Math.ceil((new Date(state.focus.deadline_at) - now) / 1000))
    : duration * 60;
  const jobsToday = state.jobs.filter(
    (job) => new Date(job.started_at).toDateString() === now.toDateString(),
  ).length;
  const call = async (fn, message) => {
    setError('');
    setSuccess('');
    try {
      await fn();
      if (message) setSuccess(message);
    } catch (e) {
      setError(e.message || String(e));
    }
  };
  const updateAction = async () => {
    setError('');
    setSuccess('');
    try {
      if (!updateState.supported) {
        setSuccess(updateState.message || 'In-app updates are available in the Windows install.');
      } else if (updateState.status === 'downloaded') {
        await window.hub.installUpdate();
      } else if (updateState.status === 'available') {
        setSuccess(
          'The update is downloading in the background. It installs when you quit Queueglow.',
        );
      } else {
        const next = await window.hub.checkForUpdates();
        setUpdateState(next);
        if (next.status === 'current') setSuccess(next.message);
        else if (next.status === 'error') setError(next.message);
      }
    } catch (e) {
      setError(e.message || String(e));
    }
  };
  const navigate = (id) => {
    if (page === 'note' && id !== 'note' && noteDirty.current)
      flushNote().catch((error) => setError(error.message));
    setPage(id);
    setMenu(false);
    setError('');
    setSuccess('');
  };
  const openSettings = (section = 'home') => {
    setMenu(false);
    call(() => window.hub.openSettings(section));
  };
  const visible = state.apps.filter((app) => app.visible).map((app) => app.id);
  const cancelFold = () => {
    if (foldTimer.current) clearTimeout(foldTimer.current);
    foldTimer.current = null;
  };
  const scheduleFold = () => {
    cancelFold();
    foldTimer.current = setTimeout(() => call(() => window.hub.fold()), 650);
  };

  const currentArtwork = state.systemMedia?.artwork;
  const islandAlpha = 1 - (state.settings?.islandTransparency || 0) / 100;
  return (
    <div
      className={`shell theme-${page} skin-${state.settings?.wallpaperSync ? 'wallpaper' : state.settings?.islandSkin || 'obsidian'} indicator-${state.settings?.restingIndicator || 'eyes'} robo-${state.settings?.roboAppearance || 'cyan'} motion-${state.folded ? 'folded' : state.motion || 'idle'} material-${state.settings?.islandMaterial || 'black'} performance-${state.settings?.performanceMode || 'automatic'} ${state.settings?.animationSpeed === 'fast' ? 'speed-fast' : ''} ${state.settings?.appAnimations === false ? 'animations-off' : ''} ${state.settings?.islandMaterial === 'glass' && state.settings?.musicColor && currentArtwork ? 'music-color-on' : ''} ${state.settings?.roboBlinking === false ? 'eyes-still' : ''} ${state.settings?.roboDance && state.systemMedia?.playing ? 'robo-dancing' : ''}`}
      style={{
        '--shell-alpha': islandAlpha,
        '--cover-art': currentArtwork ? `url("${currentArtwork}")` : 'none',
        '--custom-accent': state.settings?.customAccent || '#84e1be',
        '--clock-color': state.settings?.clockColor || '#ffffff',
        ...(state.wallpaperColor ? { '--wallpaper-accent': state.wallpaperColor } : {}),
      }}
      onMouseEnter={cancelFold}
      onMouseLeave={scheduleFold}
    >
      <button
        className="island-notch"
        aria-label="Open Queueglow"
        onClick={() => state.folded && call(() => window.hub.expand())}
      >
        <div className="eyes">
          <span />
          <span />
        </div>
      </button>
      <header className="topbar">
        <div className="header-left">
          {state.settings?.systemIndicators !== false && (
            <Connectivity
              system={state.system}
              open={connectivityOpen}
              setOpen={setConnectivityOpen}
              dismissOtherPanels={() => {
                setMenu(false);
                setVolumeOpen(false);
              }}
              call={call}
            />
          )}
          {state.settings?.showDate !== false && <span className="date mono">{day(now)}</span>}
        </div>
        <span className="topcenter">QUEUEGLOW</span>
        <div className="header-right">
          <button
            className="battery-button mono"
            aria-label="Battery and quick controls"
            onClick={() => {
              setMenu(false);
              setConnectivityOpen(false);
              setVolumeOpen(!volumeOpen);
            }}
          >
            {state.system?.charging ? <BatteryCharging size={17} /> : <Battery size={17} />}
            <span>
              {state.system?.batteryPercent === null || state.system?.batteryPercent === undefined
                ? '—'
                : `${state.system.batteryPercent}%`}
            </span>
          </button>
          <span
            className={`time ${state.settings?.clockStyle === 'rounded' ? '' : 'mono'}`}
            style={{
              fontSize: `${state.settings?.clockHeaderSize || 17}px`,
              color: 'var(--clock-color)',
            }}
          >
            {clock(now, state.settings)}
          </span>
          <button
            className="icon-button"
            aria-label="More options"
            onClick={() => {
              setVolumeOpen(false);
              setConnectivityOpen(false);
              setMenu(!menu);
            }}
          >
            <MoreHorizontal />
          </button>
        </div>
      </header>
      {menu && (
        <div className="menu" role="group" aria-label="App menu">
          <label className="menu-volume">
            <Volume2 size={17} />
            <input
              aria-label="Menu volume"
              type="range"
              min="0"
              max="100"
              disabled={state.volume === null}
              value={volumeDraft}
              onChange={(e) => setVolumeDraft(Number(e.target.value))}
              onPointerUp={() => call(() => window.hub.volumeSet(volumeDraft))}
              onKeyUp={() => call(() => window.hub.volumeSet(volumeDraft))}
            />
          </label>
          <div className="menu-grid">
            <button onClick={() => navigate('all')}>
              <LayoutGrid size={19} />
              All apps
            </button>
            <button onClick={() => navigate('customize')}>
              <Pencil size={19} />
              Customize
            </button>
            <button onClick={() => openSettings()}>
              <Settings2 size={19} />
              Settings
            </button>
            <button
              onClick={updateAction}
              disabled={updateState.status === 'checking' || updateState.status === 'downloading'}
            >
              <RefreshCw size={19} />
              {updateState.status === 'downloaded'
                ? 'Restart to update'
                : updateState.status === 'available'
                  ? 'Updating in background…'
                  : updateState.status === 'downloading'
                    ? `Updating ${updateState.percent || 0}%`
                    : updateState.status === 'checking'
                      ? 'Checking…'
                      : updateState.status === 'error'
                        ? 'Retry update check'
                        : updateState.status === 'current'
                          ? 'Check for updates'
                          : 'Updates'}
            </button>
            <button
              onClick={() => {
                setMenu(false);
                call(() => window.hub.fold());
              }}
            >
              <ChevronUp size={19} />
              Fold in
            </button>
            <button className="quit-tile" onClick={() => window.hub.quit()}>
              <Power size={19} />
              Quit
            </button>
          </div>
        </div>
      )}
      <main className="content">
        {page === 'home' && (
          <HomePage
            now={now}
            jobsToday={jobsToday}
            state={state}
            remaining={remaining}
            navigate={navigate}
            openUnread={() => window.hub.mailOpenUnread()}
            play={() => {
              navigate('music');
              if (activeTrack) setPlaying(true);
            }}
          />
        )}
        {page === 'codex' && <AgentPage state={state} call={call} openSettings={openSettings} />}
        {page === 'robo' && (
          <section className="robo-page">
            <div className="page-title">
              {state.settings?.roboName || 'Robo'}{' '}
              <span className="subtle">
                {state.roboCapabilities?.provider
                  ? `Using ${state.roboCapabilities.provider}`
                  : 'Connect an AI provider in Settings'}
              </span>
            </div>
            <div className="robo-answer">
              <PagedText
                text={
                  busy
                    ? 'Thinking…'
                    : answer || 'Ask a question, explain a concept, or refine a piece of writing.'
                }
              />
            </div>
            <div className="chips">
              {['Explain this', 'Check spelling', 'Translate', 'Summarize'].map((v) => (
                <button key={v} onClick={() => setPrompt(v + ': ')}>
                  {v}
                </button>
              ))}
              {state.roboCapabilities?.screenAttachments &&
                state.settings?.roboScreenCapture !== false && (
                  <select
                    aria-label="Image to include"
                    value={captureTarget}
                    onChange={(e) => setCaptureTarget(e.target.value)}
                  >
                    <option value="none">No image</option>
                    <option value="screen">Entire screen</option>
                    {roboTargets.map((target) => (
                      <option key={target.id} value={target.id}>
                        {target.name}
                      </option>
                    ))}
                  </select>
                )}
            </div>
            <form
              className="composer"
              onSubmit={(e) => {
                e.preventDefault();
                setBusy(true);
                call(async () => {
                  setAnswer(
                    await window.hub.roboAsk(
                      prompt,
                      state.roboCapabilities?.screenAttachments &&
                        state.settings?.roboScreenCapture !== false
                        ? captureTarget
                        : 'none',
                    ),
                  );
                  setPrompt('');
                  setCaptureTarget('none');
                }, null).finally(() => setBusy(false));
              }}
            >
              <input
                aria-label="Ask Robo"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Ask Robo anything"
              />
              <button aria-label="Send question" type="submit">
                <Send size={22} />
              </button>
            </form>
          </section>
        )}
        {page === 'music' && (
          <MusicPage
            state={state}
            activeTrack={activeTrack}
            audio={audio}
            progress={progress}
            setProgress={setProgress}
            playing={playing}
            setPlaying={setPlaying}
            track={track}
            setTrack={setTrack}
            call={call}
          />
        )}
        {page === 'focus' && (
          <section className="focus-page">
            <div className="focus-main">
              <div>
                <div className="focus-time mono">{fmt(remaining)}</div>
                <p>
                  {state.focus
                    ? `Done at ${clock(new Date(state.focus.deadline_at))}`
                    : `Done at ${clock(new Date(now.getTime() + duration * 60000))}`}
                </p>
              </div>
              <button
                className="primary-button"
                disabled={!state.focus && duration === 0}
                onClick={() =>
                  call(() =>
                    state.focus
                      ? window.hub.focusStop()
                      : window.hub.focusStart(selectedMode, duration * 60),
                  )
                }
              >
                {state.focus ? 'End focus' : 'Start focus'}
              </button>
            </div>
            <label className="sr-only" htmlFor="focus-duration">
              Focus duration in minutes
            </label>
            <input
              id="focus-duration"
              className="focus-ruler"
              type="range"
              min="0"
              max="60"
              step="5"
              value={duration}
              disabled={!!state.focus}
              onChange={(event) => setDuration(Number(event.target.value))}
            />
            <div className="focus-ruler-labels mono" aria-hidden="true">
              {[0, 10, 20, 30, 40, 50, 60].map((minute) => (
                <span key={minute}>{minute}</span>
              ))}
            </div>
          </section>
        )}
        {page === 'modes' && (
          <section className="modes-page">
            <div className="page-title">
              Modes <span className="subtle">Set the tone</span>
            </div>
            <div className="mode-grid">
              {(state.modes || []).map((mode) => (
                <button
                  key={mode.id}
                  className={`mode-card ${selectedMode === mode.id ? 'active' : ''}`}
                  onClick={() => {
                    setSelectedMode(mode.id);
                    setDuration(mode.duration_seconds / 60);
                  }}
                >
                  <span className="mode-dot" />
                  <strong>{mode.name}</strong>
                  <small>{Math.round(mode.duration_seconds / 60)} minute session</small>
                </button>
              ))}
            </div>
            {(() => {
              const mode = (state.modes || []).find((item) => item.id === selectedMode);
              return (
                <div className="mode-preferences" aria-label={`${selectedMode} preferences`}>
                  {[
                    ['blockSites', 'block_sites', 'Site blocking'],
                    ['quietContacts', 'quiet_contacts', 'Quiet contacts'],
                    ['keepMusic', 'keep_music', 'Keep music playing'],
                  ].map(([option, key, label]) => (
                    <label key={key}>
                      <span>{label}</span>
                      <input
                        type="checkbox"
                        aria-label={label}
                        checked={!!mode?.[key]}
                        onChange={(event) =>
                          call(() =>
                            window.hub.modeOption(selectedMode, option, event.target.checked),
                          )
                        }
                      />
                    </label>
                  ))}
                </div>
              );
            })()}
            <div className="mode-options">
              <span className="muted">
                Preferences are saved per mode; app and contact blocking are not enabled in this
                preview.
              </span>
            </div>
            <button
              className="primary-button"
              onClick={() => {
                navigate('focus');
                call(() => window.hub.focusStart(selectedMode, duration * 60));
              }}
            >
              Start {selectedMode}
            </button>
          </section>
        )}
        {page === 'tray' && (
          <section
            className="list-page"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const files = [...e.dataTransfer.files];
              call(async () => {
                for (const file of files)
                  await window.hub.trayDrop(file.name, new Uint8Array(await file.arrayBuffer()));
              }, 'Files added');
            }}
          >
            <div className="page-title">
              Tray <span className="subtle">Keep files close</span>
            </div>
            <div className="action-row">
              <button className="primary-button" onClick={() => call(() => window.hub.trayAdd())}>
                <Plus size={18} /> Add files
              </button>
              <span className="muted">Drop files here · 25 MB each · stored on this PC</span>
            </div>
            {!state.tray.length ? (
              <Empty
                icon={Inbox}
                title="Your tray is empty"
                body="Drop files here or choose Add files."
              />
            ) : (
              <PagedItems items={state.tray} pageSize={2} className="item-list">
                {(file) => (
                  <div className="list-item" key={file.id}>
                    <FolderOpen size={20} />
                    <span className="item-name">{file.name}</span>
                    <small>{Math.ceil(file.byte_size / 1024)} KB</small>
                    <button
                      aria-label={`Show ${file.name}`}
                      onClick={() => call(() => window.hub.trayOpen(file.id))}
                    >
                      <ExternalLink size={18} />
                    </button>
                    <button
                      aria-label={`Remove ${file.name}`}
                      onClick={() => call(() => window.hub.trayRemove(file.id))}
                    >
                      <X size={18} />
                    </button>
                  </div>
                )}
              </PagedItems>
            )}
          </section>
        )}
        {page === 'clips' && (
          <section className="list-page">
            <div className="page-title">
              Clips <span className="subtle">Your recent copies</span>
            </div>
            <div className="action-row">
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={!!state.settings.clipboardEnabled}
                  onChange={(e) =>
                    call(() => window.hub.setting('clipboardEnabled', e.target.checked))
                  }
                />{' '}
                Capture text
              </label>
              <button className="soft-button" onClick={() => call(() => window.hub.clipClear())}>
                <Trash2 size={16} /> Clear history
              </button>
            </div>
            {!state.clips.length ? (
              <Empty
                icon={Copy}
                title="No clips yet"
                body="Turn on capture, then copy text or a link."
              />
            ) : (
              <PagedItems items={state.clips} pageSize={2} className="item-list">
                {(clip) => (
                  <button
                    className="list-item clip"
                    key={clip.id}
                    onClick={() => call(() => window.hub.clipCopy(clip.id), 'Copied to clipboard')}
                  >
                    <span>
                      {clip.kind === 'link' ? <Link size={19} /> : <Clipboard size={19} />}
                    </span>
                    <span className="item-name">{clip.preview}</span>
                    <small>
                      {new Date(clip.captured_at).toLocaleTimeString([], {
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </small>
                    <Copy size={16} />
                  </button>
                )}
              </PagedItems>
            )}
          </section>
        )}
        {page === 'note' && (
          <section className="note-page">
            <div className="note-editor">
              <label htmlFor="quick-note" className="eyebrow">
                NOTE
              </label>
              <textarea
                id="quick-note"
                aria-label="Your note"
                value={note}
                disabled={!noteReady.current}
                onChange={(event) => {
                  if (event.target.value.length > 30000) {
                    setError('The note can hold up to 30,000 characters.');
                    return;
                  }
                  noteDirty.current = true;
                  noteDraft.current = event.target.value;
                  setNote(event.target.value);
                  scheduleNoteSave();
                }}
                onBlur={() => {
                  if (noteDirty.current) flushNote().catch((error) => setError(error.message));
                }}
                placeholder="Click to type"
              />
            </div>
            <div className="note-preview">
              {note.split('\n').some((line) => /^\[[ xX]\]/.test(line)) ? (
                note.split('\n').map((line, index) => {
                  const match = /^\[([ xX])\]\s?(.*)$/.exec(line);
                  return match ? (
                    <button
                      key={index}
                      className="note-check"
                      aria-label={`${match[1].toLowerCase() === 'x' ? 'Uncheck' : 'Check'} ${match[2]}`}
                      onClick={() => {
                        const lines = note.split('\n');
                        lines[index] =
                          `[${match[1].toLowerCase() === 'x' ? ' ' : 'x'}] ${match[2]}`;
                        const next = lines.join('\n');
                        noteDirty.current = true;
                        noteDraft.current = next;
                        setNote(next);
                        saveNote(next).catch((error) => setError(error.message));
                      }}
                    >
                      <span>{match[1].toLowerCase() === 'x' ? '✓' : ''}</span>
                      {match[2]}
                    </button>
                  ) : (
                    <p key={index}>{line}</p>
                  );
                })
              ) : (
                <p>Start a line with [ ] to add a check item. Your note saves as you type.</p>
              )}
            </div>
          </section>
        )}
        {page === 'agenda' && (
          <AgendaPage
            state={state}
            call={call}
            now={now}
            agendaTitle={agendaTitle}
            setAgendaTitle={setAgendaTitle}
            agendaStart={agendaStart}
            setAgendaStart={setAgendaStart}
            agendaEnd={agendaEnd}
            setAgendaEnd={setAgendaEnd}
          />
        )}
        {page === 'mail' && (
          <section className="mail-page">
            {(() => {
              const mail = state.mail || { configured: false, connected: false };
              return (
                <>
                  <div className="mail-heading">
                    <div>
                      <div className="eyebrow">GOOGLE MAIL</div>
                      <h1>{mail.connected ? `${mail.unread ?? 0} unread` : 'Unread mail'}</h1>
                    </div>
                    <div className="mail-actions">
                      {mail.connected ? (
                        <>
                          <button
                            className="soft-button"
                            onClick={() => window.hub.mailOpenUnread()}
                          >
                            Open unread <ExternalLink size={12} />
                          </button>
                          <button
                            className="soft-button"
                            onClick={() => window.hub.mailDisconnect()}
                          >
                            Disconnect
                          </button>
                        </>
                      ) : mail.configured ? (
                        <button
                          className="soft-button"
                          disabled={!mail.configured || mail.loading}
                          onClick={() => window.hub.mailConnect().catch(() => {})}
                        >
                          {mail.loading ? 'Opening Google…' : 'Sign in with Google'}
                        </button>
                      ) : (
                        <button className="soft-button" onClick={() => window.hub.mailOpenUnread()}>
                          Open Gmail <ExternalLink size={12} />
                        </button>
                      )}
                    </div>
                  </div>
                  <p className="mail-hint">
                    {mail.error ||
                      (mail.connected
                        ? 'Queueglow reads only the unread label count. Click the count on Home to open unread Gmail.'
                        : mail.configured
                          ? 'Sign in to show your unread Gmail count on Home. Queueglow does not read message content or change labels.'
                          : 'Gmail opens in your browser. Queueglow does not sign in to or read your mail.')}
                  </p>
                </>
              );
            })()}
          </section>
        )}
        {page === 'all' && (
          <section className="all-page">
            <div className="page-title">All apps</div>
            <PagedItems
              className="all-grid"
              pageSize={12}
              items={[
                ...Object.keys(NAMES).map((id) => ({ kind: 'built-in', id })),
                { kind: 'settings' },
                ...(state.settings?.customShortcuts || [])
                  .map((shortcut, index) => ({ kind: 'shortcut', shortcut, index }))
                  .filter((item) => item.shortcut),
              ]}
            >
              {(item) => {
                const Icon =
                  item.kind === 'built-in'
                    ? ICONS[item.id]
                    : item.kind === 'settings'
                      ? Settings2
                      : ExternalLink;
                const name =
                  item.kind === 'built-in'
                    ? NAMES[item.id]
                    : item.kind === 'settings'
                      ? 'Settings'
                      : item.shortcut.label;
                return (
                  <button
                    key={`${item.kind}-${item.id || item.index || ''}`}
                    onClick={() =>
                      item.kind === 'built-in'
                        ? navigate(item.id)
                        : item.kind === 'settings'
                          ? openSettings()
                          : call(() => window.hub.openShortcut(item.index))
                    }
                    title={name}
                  >
                    <Icon size={26} />
                    {name}
                  </button>
                );
              }}
            </PagedItems>
          </section>
        )}
        {page === 'customize' && (
          <section className="list-page">
            <div className="page-title">
              Customize <span className="subtle">Choose apps for your dock</span>
            </div>
            <div className="custom-grid">
              {state.apps.map((app) => {
                const Icon = ICONS[app.id];
                return (
                  <label key={app.id}>
                    <Icon size={21} />
                    {NAMES[app.id]}
                    <input
                      type="checkbox"
                      checked={app.visible}
                      disabled={app.id === 'home'}
                      onChange={(e) => call(() => window.hub.appVisible(app.id, e.target.checked))}
                    />
                  </label>
                );
              })}
            </div>
          </section>
        )}
      </main>
      {(error || success) && (
        <div className={`toast ${error ? 'error' : ''}`} role="status">
          {error || success}
          <button
            onClick={() => {
              setError('');
              setSuccess('');
            }}
            aria-label="Dismiss"
          >
            <X size={14} />
          </button>
        </div>
      )}
      {volumeOpen && (
        <div className="volume-panel" role="group" aria-label="Quick controls">
          <div className="quick-title">
            Quick controls{' '}
            <button aria-label="Close quick controls" onClick={() => setVolumeOpen(false)}>
              <X size={16} />
            </button>
          </div>
          <label htmlFor="system-volume">
            <Volume2 size={17} /> Volume{' '}
            <span>{state.volume === null ? 'Unavailable' : `${volumeDraft}%`}</span>
          </label>
          <input
            id="system-volume"
            type="range"
            min="0"
            max="100"
            disabled={state.volume === null}
            value={volumeDraft}
            onChange={(e) => setVolumeDraft(Number(e.target.value))}
            onPointerUp={() => call(() => window.hub.volumeSet(volumeDraft))}
            onKeyUp={() => call(() => window.hub.volumeSet(volumeDraft))}
          />
          <label htmlFor="system-brightness">
            <Sun size={17} /> Brightness{' '}
            <span>
              {state.system?.brightnessPercent == null ? 'Unavailable' : `${brightnessDraft}%`}
            </span>
          </label>
          <input
            id="system-brightness"
            type="range"
            min="0"
            max="100"
            disabled={state.system?.brightnessPercent == null}
            value={brightnessDraft}
            onChange={(e) => setBrightnessDraft(Number(e.target.value))}
            onPointerUp={() => call(() => window.hub.brightnessSet(brightnessDraft))}
            onKeyUp={() => call(() => window.hub.brightnessSet(brightnessDraft))}
          />
          <div className="quick-battery">
            {state.system?.charging ? <BatteryCharging size={17} /> : <Battery size={17} />} Battery{' '}
            <strong>
              {state.system?.batteryPercent == null
                ? 'Unavailable'
                : `${state.system.batteryPercent}%${state.system.charging ? ' · Charging' : ''}`}
            </strong>
          </div>
        </div>
      )}
      <footer className="dock">
        <button className="dock-plus" aria-label="All apps" onClick={() => navigate('all')}>
          <Plus />
        </button>
        <nav aria-label="Apps">
          {visible.map((id) => {
            const Icon = ICONS[id];
            return (
              <button
                key={id}
                className={page === id ? 'current' : ''}
                aria-label={NAMES[id]}
                aria-current={page === id ? 'page' : undefined}
                onClick={() => navigate(id)}
              >
                <Icon size={23} />
                {page === id && <span>{NAMES[id]}</span>}
              </button>
            );
          })}
        </nav>
        <button
          className="dock-volume"
          aria-label="Quick controls"
          onClick={() => {
            setMenu(false);
            setConnectivityOpen(false);
            setVolumeOpen(!volumeOpen);
          }}
        >
          <Volume2 size={21} />
        </button>
      </footer>
    </div>
  );
}

function Empty({ icon: Icon, title, body }) {
  return (
    <div className="empty">
      <Icon size={42} />
      <strong>{title}</strong>
      <span>{body}</span>
    </div>
  );
}
function PagedItems({ items, pageSize, className = '', children }) {
  const [page, setPage] = useState(0);
  const last = Math.max(0, Math.ceil(items.length / pageSize) - 1);
  const current = Math.min(page, last);
  return (
    <div className="paged-items">
      <div className={className}>
        {items.slice(current * pageSize, (current + 1) * pageSize).map(children)}
      </div>
      {last > 0 && (
        <div className="page-controls">
          <button
            disabled={current === 0}
            onClick={() => setPage(current - 1)}
            aria-label="Previous items"
          >
            ‹
          </button>
          <span>
            {current + 1} / {last + 1}
          </span>
          <button
            disabled={current === last}
            onClick={() => setPage(current + 1)}
            aria-label="Next items"
          >
            ›
          </button>
        </div>
      )}
    </div>
  );
}
function PagedText({ text }) {
  const [page, setPage] = useState(0);
  const chunks = text.match(/[\s\S]{1,220}/g) || [''];
  const current = Math.min(page, chunks.length - 1);
  return (
    <div className="paged-text">
      <div>{chunks[current]}</div>
      {chunks.length > 1 && (
        <div className="page-controls">
          <button
            disabled={current === 0}
            onClick={() => setPage(current - 1)}
            aria-label="Previous answer"
          >
            ‹
          </button>
          <span>
            {current + 1} / {chunks.length}
          </span>
          <button
            disabled={current === chunks.length - 1}
            onClick={() => setPage(current + 1)}
            aria-label="Next answer"
          >
            ›
          </button>
        </div>
      )}
    </div>
  );
}
function MusicPage({
  state,
  activeTrack,
  audio,
  progress,
  setProgress,
  playing,
  setPlaying,
  track,
  setTrack,
  call,
}) {
  const system = state.systemMedia;
  const [syncNow, setSyncNow] = useState(() => Date.now());
  useEffect(() => {
    if (!system?.playing) return undefined;
    const timer = setInterval(() => setSyncNow(Date.now()), 100);
    return () => clearInterval(timer);
  }, [system?.playing]);
  const title = system?.title || activeTrack?.name || 'Your soundtrack starts here';
  const isPlaying = system ? system.playing : playing;
  const position = system
    ? Math.min(
        system.duration || Infinity,
        Math.max(
          0,
          (system.position || 0) +
            (isPlaying && system.sampledAt ? Math.max(0, (syncNow - system.sampledAt) / 1000) : 0),
        ),
      )
    : 0;
  const lyricLines = system?.lyrics?.lines || [];
  const lyric = lyricLines.reduce(
    (current, line) => (line.at <= position + 0.08 ? line.text : current),
    '',
  );
  const percent = system?.duration ? Math.min(100, (position / system.duration) * 100) : progress;
  const control = (action, seconds) =>
    system ? call(() => window.hub.mediaControl(action, seconds)) : null;
  return (
    <section className="music-page">
      <div className="album-placeholder">
        {system?.artwork ? (
          <img
            className="music-art-image album-art"
            src={system.artwork}
            alt={`${title} cover art`}
          />
        ) : (
          <Music2 size={96} />
        )}
      </div>
      <div className="music-info">
        <div className="eyebrow">{system ? 'WINDOWS MEDIA' : 'LOCAL MUSIC'}</div>
        <h1>{title}</h1>
        <p>
          {system
            ? system.artist || 'Current Windows media session'
            : activeTrack
              ? 'Playing from your files'
              : 'Add audio files or play music in another Windows app.'}
        </p>
        {lyric && (
          <p className="music-lyric" aria-label="Current lyric" aria-live="off">
            {lyric}
          </p>
        )}
        {system?.duration > 0 && (
          <div className="music-times mono">
            <span>{fmt(position)}</span>
            <span>{fmt(Math.max(0, system.duration - position))}</span>
          </div>
        )}
        <input
          className="seek"
          aria-label="Track position"
          type="range"
          min="0"
          max="100"
          value={percent}
          onChange={(e) => {
            const value = Number(e.target.value);
            if (system?.duration) control('seek', (system.duration * value) / 100);
            else if (audio.current?.duration)
              audio.current.currentTime = (audio.current.duration * value) / 100;
            setProgress(value);
          }}
        />
        <div className="transport">
          <button
            aria-label="Previous track"
            onClick={() =>
              system ? control('previous') : (setTrack(Math.max(0, track - 1)), setPlaying(true))
            }
          >
            <SkipBack />
          </button>
          <button
            className="play-button"
            aria-label={isPlaying ? 'Pause' : 'Play'}
            onClick={() => (system ? control('playPause') : setPlaying(!playing))}
          >
            {isPlaying ? <Pause /> : <Play />}
          </button>
          <button
            aria-label="Next track"
            onClick={() =>
              system
                ? control('next')
                : (setTrack(Math.min(state.audio.length - 1, track + 1)), setPlaying(true))
            }
          >
            <SkipForward />
          </button>
        </div>
        <button className="soft-button" onClick={() => call(() => window.hub.musicOpen())}>
          <Plus size={16} /> Add local music
        </button>
        {activeTrack && !system && (
          <audio
            ref={audio}
            src={activeTrack.url}
            onTimeUpdate={(e) =>
              setProgress(e.target.duration ? (e.target.currentTime / e.target.duration) * 100 : 0)
            }
            onEnded={() => setPlaying(false)}
          />
        )}
      </div>
    </section>
  );
}
function AgendaPage({
  state,
  call,
  now,
  agendaTitle,
  setAgendaTitle,
  agendaStart,
  setAgendaStart,
  agendaEnd,
  setAgendaEnd,
}) {
  const [view, setView] = useState('day');
  const [selected, setSelected] = useState(() => new Date());
  const daysInMonth = new Date(selected.getFullYear(), selected.getMonth() + 1, 0).getDate();
  const offset = (new Date(selected.getFullYear(), selected.getMonth(), 1).getDay() + 6) % 7;
  const eventsOnDay = (date) =>
    state.agenda.filter(
      (event) => new Date(event.starts_at).toDateString() === date.toDateString(),
    );
  const chosenEvents = eventsOnDay(selected);
  return (
    <section className="agenda-page">
      <div className="page-title">
        Agenda <span className="subtle">{day(selected)}</span>
        <div className="view-tabs">
          <button className={view === 'day' ? 'active' : ''} onClick={() => setView('day')}>
            Day
          </button>
          <button className={view === 'month' ? 'active' : ''} onClick={() => setView('month')}>
            Month
          </button>
        </div>
      </div>
      <div className="agenda-layout">
        <div className="agenda-list">
          {view === 'day' ? (
            <>
              <div className="day-head">
                <button
                  aria-label="Previous day"
                  onClick={() =>
                    setSelected(
                      new Date(selected.getFullYear(), selected.getMonth(), selected.getDate() - 1),
                    )
                  }
                >
                  ‹
                </button>
                <h2>{selected.toDateString() === now.toDateString() ? 'Today' : day(selected)}</h2>
                <button
                  aria-label="Next day"
                  onClick={() =>
                    setSelected(
                      new Date(selected.getFullYear(), selected.getMonth(), selected.getDate() + 1),
                    )
                  }
                >
                  ›
                </button>
              </div>
              {chosenEvents.length ? (
                <PagedItems items={chosenEvents} pageSize={2} className="agenda-events">
                  {(event) => (
                    <div className="timeline-event" key={event.id}>
                      <span className="mono">
                        {new Date(event.starts_at).toLocaleTimeString([], {
                          hour: 'numeric',
                          minute: '2-digit',
                        })}
                      </span>
                      <strong title={event.title}>{event.title}</strong>
                      <button
                        aria-label={`Remove ${event.title}`}
                        onClick={() => call(() => window.hub.agendaRemove(event.id))}
                      >
                        <X size={14} />
                      </button>
                    </div>
                  )}
                </PagedItems>
              ) : (
                <p className="agenda-empty">No events today</p>
              )}
            </>
          ) : (
            <>
              <div className="month-head">
                <button
                  onClick={() =>
                    setSelected(new Date(selected.getFullYear(), selected.getMonth() - 1, 1))
                  }
                >
                  ‹
                </button>
                <h2>{selected.toLocaleDateString([], { month: 'long', year: 'numeric' })}</h2>
                <button
                  onClick={() =>
                    setSelected(new Date(selected.getFullYear(), selected.getMonth() + 1, 1))
                  }
                >
                  ›
                </button>
              </div>
              <div className="month-grid">
                {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((label, i) => (
                  <span key={i} className="weekday">
                    {label}
                  </span>
                ))}
                {Array.from({ length: offset }, (_, i) => (
                  <span key={`blank${i}`} />
                ))}
                {Array.from({ length: daysInMonth }, (_, i) => {
                  const date = new Date(selected.getFullYear(), selected.getMonth(), i + 1);
                  return (
                    <button
                      key={i}
                      className={date.toDateString() === selected.toDateString() ? 'active' : ''}
                      onClick={() => {
                        setSelected(date);
                        setView('day');
                      }}
                    >
                      {i + 1}
                      {eventsOnDay(date).length > 0 && <i />}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
        <form
          className="agenda-form"
          onSubmit={(e) => {
            e.preventDefault();
            call(() => window.hub.agendaAdd(agendaTitle, agendaStart, agendaEnd), 'Event added');
            setAgendaTitle('');
          }}
        >
          <h2>Add local event</h2>
          <input
            aria-label="Event title"
            placeholder="Event title"
            value={agendaTitle}
            onChange={(e) => setAgendaTitle(e.target.value)}
          />
          <label>
            Starts
            <input
              type="datetime-local"
              value={agendaStart}
              onChange={(e) => setAgendaStart(e.target.value)}
            />
          </label>
          <label>
            Ends
            <input
              type="datetime-local"
              value={agendaEnd}
              onChange={(e) => setAgendaEnd(e.target.value)}
            />
          </label>
          <button className="primary-button" type="submit">
            <Plus size={17} /> Add event
          </button>
          <span className="muted">Stored only on this PC</span>
        </form>
      </div>
    </section>
  );
}
function HomePage({ now, jobsToday, state, remaining, navigate, openUnread, play }) {
  return (
    <section className="home-page">
      <div
        className={`hero-clock ${state.settings?.clockStyle === 'rounded' ? '' : 'mono'} clock-${state.settings?.clockSize || 'standard'}`}
        style={{
          '--home-clock-size': `${state.settings?.clockHomeSize || 92}px`,
          color: 'var(--clock-color)',
        }}
      >
        {clock(now, state.settings).replace(/\s?(AM|PM)$/i, '')}
      </div>
      <div className="home-cards">
        <button onClick={() => navigate('codex')}>
          <span className="card-number mono">{jobsToday}</span>
          <span>jobs today</span>
        </button>
        <button onClick={play}>
          {state.systemMedia?.artwork ? (
            <img
              className="music-art-image home-cover"
              src={state.systemMedia.artwork}
              alt="Current track cover"
            />
          ) : (
            <Music2 size={29} />
          )}
          <span className="home-track-copy">
            <strong>{state.systemMedia?.title || state.audio[0]?.name || 'Music'}</strong>
            <small>
              {state.systemMedia
                ? state.systemMedia.playing
                  ? `${state.systemMedia.artist || 'Windows media'} · Playing`
                  : `${state.systemMedia.artist || 'Windows media'} · Paused`
                : state.audio.length
                  ? 'Ready to play'
                  : 'Add your songs'}
            </small>
          </span>
          <Play className="round-icon" size={18} />
        </button>
        <button onClick={() => navigate('focus')}>
          <span className="card-number mono">{fmt(remaining)}</span>
          <span>{state.focus ? 'Focus in progress' : 'Focus, ready'}</span>
          <Play className="round-icon" size={18} />
        </button>
        <button
          onClick={() =>
            state.mail?.connected
              ? openUnread()
              : state.mail?.configured
                ? navigate('mail')
                : openUnread()
          }
        >
          <span className="card-number mono">
            {state.mail?.connected ? (state.mail.unread ?? 0) : '↗'}
          </span>
          <span>{state.mail?.connected ? 'unread emails' : 'Open Gmail'}</span>
          {state.mail?.connected ? (
            <ExternalLink className="round-icon" size={18} />
          ) : (
            <Mail className="round-icon" size={18} />
          )}
        </button>
      </div>
    </section>
  );
}
function AgentPage({ state, call, openSettings }) {
  const [selectedEventId, setSelectedEventId] = useState(null);
  const selectedEvent = state.events.find((event) => event.id === selectedEventId);
  useEffect(() => {
    if (state.pending.length) setSelectedEventId(null);
  }, [state.pending.length]);
  return (
    <section className="agent-page">
      <div className="agent-side">
        <div className="big-eyes">
          <span />
          <span />
        </div>
        <div className="agent-count mono">
          {
            state.jobs.filter(
              (j) => new Date(j.started_at).toDateString() === new Date().toDateString(),
            ).length
          }
        </div>
        <div className="eyebrow">JOBS TODAY</div>
      </div>
      <div className="agent-feed">
        {selectedEvent?.detail ? (
          <div className="agent-detail">
            <button
              className="agent-back"
              onClick={() => setSelectedEventId(null)}
              aria-label="Back to agent activity"
            >
              ‹ Activity
            </button>
            <strong>
              {selectedEvent.provider === 'claude' ? 'Claude Code' : 'Codex'} ·{' '}
              {selectedEvent.kind === 'done' ? 'final response' : 'activity details'}
            </strong>
            <PagedText text={selectedEvent.detail} />
          </div>
        ) : (
          <>
            <h1>
              Codex <span className="subtle">and Claude Code</span>
            </h1>
            {state.pending?.length > 0 && (
              <div className="permission">
                <strong>Decision needed</strong>
                <PagedItems items={state.pending} pageSize={1}>
                  {(p) => (
                    <div key={p.id}>
                      <p>{p.summary}</p>
                      {p.detail && <pre title={p.detail}>{p.detail}</pre>}
                      <div className="decision-row">
                        <button onClick={() => call(() => window.hub.decide(p.id, 'deny'))}>
                          Deny
                        </button>
                        <button onClick={() => call(() => window.hub.decide(p.id, 'allow'))}>
                          Allow once
                        </button>
                      </div>
                    </div>
                  )}
                </PagedItems>
              </div>
            )}
            {state.jobs.some((job) => ['working', 'attention'].includes(job.state)) && (
              <div className="agent-active" aria-label="Active coding agent jobs">
                {state.jobs
                  .filter((job) => ['working', 'attention'].includes(job.state))
                  .slice(0, 2)
                  .map((job) => (
                    <div key={job.id}>
                      <span className={`event-mark ${job.state}`} />
                      <strong>{job.provider === 'claude' ? 'Claude Code' : 'Codex'}</strong>
                      <small>{job.state === 'attention' ? 'Needs attention' : 'Working now'}</small>
                    </div>
                  ))}
              </div>
            )}
            {state.events.length ? (
              <PagedItems items={state.events} pageSize={2} className="event-feed">
                {(event) => (
                  <div className="event" key={event.id}>
                    <span className={`event-mark ${event.kind}`} />
                    <span>
                      <strong>{event.provider === 'claude' ? 'Claude Code' : 'Codex'}</strong>
                      <small>{event.summary}</small>
                    </span>
                    <time>
                      {new Date(event.occurred_at).toLocaleTimeString([], {
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </time>
                    {event.detail && state.pending.length === 0 && (
                      <button
                        className="event-open"
                        onClick={() => setSelectedEventId(event.id)}
                        aria-label={`Read ${event.provider} ${event.kind === 'done' ? 'final response' : 'activity details'}`}
                      >
                        Read
                      </button>
                    )}
                  </div>
                )}
              </PagedItems>
            ) : (
              <div className="agent-empty">
                Connect your coding agent to see recent activity and decisions in this space.
                <div>
                  <button onClick={() => openSettings('connections')}>
                    Connect agents <ExternalLink size={15} />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

