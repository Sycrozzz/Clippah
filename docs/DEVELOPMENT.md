# Clippahh — development guide

## Architecture

```
src/
  app/                    Next.js App Router: pages (client components) + /api route handlers
    api/media|clips|jobs|exports|projects|settings|system|analyses
  components/             UI building blocks (ui.tsx, Shell, ClipCard, MediaCard, ExportForm, Recorder, editor/*)
  db/schema.ts            Drizzle schema (projects, media, transcripts, analyses, clips, jobs, exports, settings)
  lib/
    shared/               types, defaults, export presets, time/SRT helpers (used by client + server)
    client/               fetch helpers, upload (XHR progress + folder drop)
    server/
      ffmpeg.ts           binary resolution, spawn wrapper (progress, abort), ffprobe, hardware detection, disk checks
      queue.ts            DB-backed job queue: concurrency, progress/ETA, cancel, retry, crash recovery
      media.ts            import/validation/thumbnails/proxy jobs
      download.ts         direct URL + optional yt-dlp download job (SSRF-guarded)
      export.ts           ASS subtitle builder, FFmpeg command planner, export job, cached preview render
      clips.ts            clip helpers (cues, thumbnails, rebuilding scoring inputs)
      settings.ts/secrets.ts  settings store; AES-256-GCM encrypted API keys
      ai/providers.ts     replaceable provider layer: OpenAI-compatible + Anthropic LLM, OpenAI-compatible + whisper.cpp ASR,
                          retry/rate-limit/error mapping, privacy gate
      analysis/
        audio.ts          streamed PCM → FFT features → events (excited, laughter, applause, spikes, silences)
        visual.ts         FFmpeg scene-score stream → cuts + motion bursts
        transcript.ts     chunked audio extraction + ASR
        text.ts           keyword search + rule-based semantic/game cues
        semantic.ts       LLM highlight finding + optional vision review
        chat.ts           chat-log parsing + surge/emote-spam detection
        category.ts       heuristic content classification
        scoring.ts        multi-signal fusion, boundaries, confidence, engagement estimate, de-duplication (pure, unit-tested)
        pipeline.ts       orchestrates a full analysis job
tests/                    vitest unit + FFmpeg integration tests
```

### Analysis pipeline
1. Validate media (FFprobe) → 2. audio + visual analysis in parallel (streamed, constant memory) → 3. transcript (existing/SRT, or chunked ASR) → 4. chat → 5. keywords → 6. semantic (LLM or heuristic) → 7. category → 8. per-second family timelines fused with category-specific weights (× user multipliers) → 9. peak picking, boundary snapping to sentences/silences, adaptive length, overlap resolution → 10. persist analysis + clips + thumbnails.

Anti-loudness rule: a clip supported only by audio *volume* evidence is penalised ×0.6, flagged `loudnessOnly`, and loses confidence. Excited speech requires spectral brightening, not just level.

### Adding a provider
Implement `LLMProvider` / `Transcriber` in `ai/providers.ts`, add it to `getLLM` / `getTranscriber`, and add the option to `AppSettings` (`shared/types.ts`) and the Settings page. Always call `assertCloudAllowed()` before sending data to a non-local URL.

### Jobs
`enqueueJob({type, ...})` → handler map in `queue.ts` (`analysis`, `export`, `proxy`, `download`). Handlers receive a `JobContext` (`signal`, `update`, `log`, `setResult`). Throw `CancelledError` / `AppError` for clean statuses. On startup, `instrumentation.ts` calls `ensureQueue()` which re-queues jobs left in `running` state (max 3 attempts).

## Commands
```bash
npm run dev                        # dev server
npx drizzle-kit push               # apply schema
npx vitest run                     # tests
npx next typegen && npx tsc --noEmit && npm run build   # full validation
```

## Security notes
* File names are sanitised; FFmpeg/yt-dlp/whisper are spawned with argument arrays (no shell).
* Subtitle files are written to a temp directory and referenced by relative name (`cwd`), avoiding path-escaping problems in filter strings.
* Uploads stream to disk; exports render to `*.partial.ext` and are verified (duration) before being renamed.
* URL imports resolve DNS and block private/loopback addresses; platform links require an explicit rights confirmation.
* Local path import can be restricted with `CLIPPAHH_IMPORT_ROOTS`. **Run Clippahh bound to localhost only** — it has no user accounts.
* API keys are never returned to the browser, logged, or included in exports.

## Windows desktop packaging (not built in this delivery)
The recommended route is an Electron shell that:
1. starts the compiled Next server (`next start`, or `output: "standalone"`) on a free localhost port, with `CLIPPAHH_DATA_DIR` set to `%APPDATA%/Clippahh` and an embedded/portable PostgreSQL (or a switch to SQLite via a Drizzle dialect change),
2. loads it in a `BrowserWindow` (contextIsolation on, nodeIntegration off),
3. stores `CLIPPAHH_SECRET` via Electron `safeStorage` (backed by Windows DPAPI),
4. is packaged with `electron-builder` (`nsis` target for the installer, `portable` for the portable build), bundling `ffmpeg-static` binaries via `asarUnpack`.
This is architecture guidance, not shipped code; it needs to be built and tested on Windows 11.

## CI
`.github/workflows/ci.yml` runs type-checking, tests and the production build on Ubuntu and Windows with a PostgreSQL service (Ubuntu). It has not been executed in this environment.
