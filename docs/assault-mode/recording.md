# Assault play recording

Assault records a play session as structured data, not as pictures of the page.

- **Page stream (rrweb).** `public/js/recording/` is the page-agnostic capture shared with the Workshop (`startPageCapture`:
  rrweb DOM, clicks, drags, keys, text selections; `recordCanvas` stays off, so no canvas pixels enter the event stream).
- **Board video (native).** `public/js/assault/recorder.js` composites the visible canvases of `.gm__field` into one 2D
  surface and a `MediaRecorder` encodes it as WebM (1280 px long edge, 24 fps, 900 kbps by default; `recordMax`,
  `recordFps`, `recordBitrate`, `recordChunkMs` override within bounds). Chunks are uploaded with acknowledged sequence
  numbers, so an outage never blocks a game action.
- **Entry.** `assault.html?record=1` starts when the page loads; `?record=ui` only shows the control; `?recording=<id>`
  resumes (a reload opens a new media segment). The control is a few characters in the page corner and is blocked from the
  DOM stream (class `rr-block`), so a replay never shows it.
- **Storage.** `runtime/assault/recordings/<id>/`: `meta.json`, `events.jsonl` (live) then `events.jsonl.gz` after stop,
  `canvas.webm` (`canvas-2.webm`, ... per segment), `captions.json`, `comments.json`. Routes under `/api/assault/recordings`
  (`server/modes/assault/recordings.js`, `recording-comments.js`): start, events, media/<seq>, stop, GET <id>,
  media/playback/<segment> (byte ranges), captions (GET / PUT), comments (CRUD). Nothing is transcoded on the server.
- **Replay.** `assault-review.html?recording=<id>` wraps `assault-replay.html` in an iframe: rrweb replays the DOM and the
  board video is painted into the recorded field element on the same clock. Pausing and picking a screen region attaches
  a timestamped comment. `captions.json` (`[{at, until?, text}]`, seconds from the recording start) is drawn as a small
  overlay and is never burned into the video. `&film=1&autoplay=1` shows only the replay at full window and plays it once;
  `window.__SP_REPLAY_DONE__` turns true at the end (used when the browser's own tab capture records the final cut).
- **Notes.** `window.__SP_RECORD_NOTE__(kind, payload)` adds a timestamped event (for example a mechanic marker) to the
  same stream. The browser may need `vendor/rrweb.umd.js` and `vendor/rrweb.css` from the installed vendor folder.
