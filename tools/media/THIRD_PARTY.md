# Runtime and fixture provenance

- MOSS C++ source: `localai-org/moss-transcribe.cpp`, commit
  `190a569c13b4b247450f2fb3b2a431244e84833e`, MIT. The build retains/copies its
  upstream notice instead of changing or rewriting it. The guarded original
  loader block in `model_loader_patch.py` is copied from that same MIT source;
  its replacement uses Manabi's bounded byte-transfer helper.
- ggml source: the MOSS submodule, commit
  `eced84c86f8b012c752c016f7fe789adea168e1e`, MIT. Preserve its notice in runtime
  distributions.
- Model: `mudler/moss-transcribe.cpp-gguf`, revision
  `54e4bbd17da3f84adf1c1bcf7791b9b9266f741e`, MOSS-Transcribe-Diarize weights under
  their upstream Apache-2.0 license. The app downloads the immutable q5_0 artifact,
  not a hosted transcription result. Preserve the model license/attribution in
  the shipped application's credits.
- Mediabunny: npm version `1.59.1`, MPL-2.0. It is used unmodified; retain its
  license and corresponding-source information when distributing the app. Its
  package includes source. This patch does not redistribute an installed package.
- Fixtures: short authored English/Japanese sentences in `fixture-spec.json`.
  ffmpeg plus platform-provided voices/eSpeak generate transient test artifacts.
  No voice models, proprietary voice assets, fonts, or media binaries are bundled.

Primary references reviewed:
https://github.com/localai-org/moss-transcribe.cpp
https://huggingface.co/mudler/moss-transcribe.cpp-gguf
https://mediabunny.dev/guide/reading-media-files
https://mediabunny.dev/guide/media-sinks
https://emscripten.org/docs/porting/pthreads.html
https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesisUtterance

Container text formats and browser security:
https://www.matroska.org/technical/subtitles.html
https://www.matroska.org/technical/elements.html
https://www.w3.org/TR/CSP3/#wasm-unsafe-eval
https://emscripten.org/docs/tools_reference/settings_reference.html#dynamic-execution

The build copies the exact upstream MOSS/ggml license texts and records compiler,
source, port and output digests in each runtime's build.json. No generated runtime
or upstream model/license bytes are being fabricated by this source bundle.
