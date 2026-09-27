#include "moss_transcribe_capi.h"
#include "backend.hpp"
#include "ggml-cpu.h"
#include <cstdint>
#include <cstdlib>
#include <stdexcept>
#include <string>
#include <emscripten.h>
#ifndef MANABI_MOSS_ENGINE_REVISION
#error "The build must bind transcript provenance to the compiled engine revision"
#endif
#ifndef MANABI_MOSS_GGML_REVISION
#error "The build must bind ggml revision"
#endif
// JS Atomics and the pthread build operate on the same WebAssembly memory. Keep
// the representation explicit instead of exposing an implementation-defined C++ atomic object layout.
alignas(4) static int32_t cancelled_operation = 0;
static_assert(sizeof(cancelled_operation) == 4, "Cancellation word must be 32-bit");
static int32_t active_operation = -1;
static int configured_threads = 1;
static void set_cpu_threads(int count) {
    ggml_backend_t cpu = mt::backend();
    if (ggml_backend_is_cpu(cpu)) ggml_backend_cpu_set_n_threads(cpu, count);
}
bool manabi_web_cancel_requested() {
    return __atomic_load_n(&cancelled_operation, __ATOMIC_RELAXED) == active_operation;
}
void manabi_web_check_cancel() {
    if (manabi_web_cancel_requested())
        throw std::runtime_error("Transcription cancelled");
}
void manabi_web_restore_threads() { set_cpu_threads(configured_threads); }
void manabi_web_decode_threads() {
    set_cpu_threads(configured_threads > 4 ? 4 : configured_threads);
}
extern "C" {
EMSCRIPTEN_KEEPALIVE int moss_web_abi_version() { return 1; }
EMSCRIPTEN_KEEPALIVE const char* moss_web_engine_revision() { return MANABI_MOSS_ENGINE_REVISION; }
EMSCRIPTEN_KEEPALIVE const char* moss_web_ggml_revision() { return MANABI_MOSS_GGML_REVISION; }
EMSCRIPTEN_KEEPALIVE int32_t* moss_web_cancel_ptr() { return &cancelled_operation; }
EMSCRIPTEN_KEEPALIVE void moss_web_begin(int operation) {
    if (operation < 1 || operation > 0x7ffffffe)
        throw std::runtime_error("Invalid MOSS operation identity");
    active_operation = static_cast<int32_t>(operation);
}
EMSCRIPTEN_KEEPALIVE moss_transcribe_ctx* moss_web_load(const char* path, int threads) {
    configured_threads = threads < 1 ? 1 : threads > 8 ? 8 : threads;
    const auto count = std::to_string(configured_threads);
    setenv("MTD_THREADS", count.c_str(), 1);
    setenv("MTD_DEVICE", "cpu", 1);
    return moss_transcribe_capi_load(path);
}
}
