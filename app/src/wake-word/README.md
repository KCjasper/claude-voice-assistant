# Wake-word backend

The main process uses Picovoice Porcupine with PvRecorder. Microphone frames are
processed in memory by the local Porcupine runtime. Frames are not written to
disk, included in session persistence, or sent to the network.

`Hey Claude` requires a platform-compatible custom `.ppn` keyword generated in
Picovoice Console and a Picovoice AccessKey. The AccessKey is stored through the
existing encrypted secret store; only the keyword file path and sensitivity are
stored in `prefs.json`.

When configuration, permission, device capture, or engine initialization fails,
the service reports `status: "fallback"` over IPC and leaves the global
push-to-talk shortcut active.
