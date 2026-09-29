"""Pinned MOSS loader adaptation; fails closed if upstream's transfer contract moves.

The old block below is from localai-org/moss-transcribe.cpp at
190a569c13b4b247450f2fb3b2a431244e84833e, MIT licensed (see THIRD_PARTY.md).
The new helper transports identical bytes using bounded scratch memory.
"""
from pathlib import Path

ORIGINAL = '''    // Stream the on-disk tensor bytes into the backend buffer. We open
    // the file ourselves (gguf has the byte offsets but doesn't expose a
    // streaming reader) and read each tensor in turn into a small CPU
    // staging buffer, then upload via ggml_backend_tensor_set. The
    // staging buffer is sized to the largest tensor we encounter.
    FILE* fp = std::fopen(path.c_str(), "rb");
    if (!fp) {
        MT_LOGE("ModelLoader: fopen %s failed", path.c_str());
        return false;
    }
    const size_t data_off = gguf_get_data_offset(gguf_);
    std::vector<uint8_t> stage;
    for (int64_t i = 0; i < n; ++i) {
        const char* name = gguf_get_tensor_name(gguf_, i);
        if (!name) continue;
        struct ggml_tensor* t = ggml_get_tensor(ctx_, name);
        if (!t) continue;
        const size_t off = data_off + gguf_get_tensor_offset(gguf_, i);
        const size_t sz  = gguf_get_tensor_size(gguf_, i);
        if (sz == 0) continue;
        if (stage.size() < sz) stage.resize(sz);
        if (std::fseek(fp, static_cast<long>(off), SEEK_SET) != 0
         || std::fread(stage.data(), 1, sz, fp) != sz) {
            MT_LOGE("ModelLoader: read failed for tensor %s", name);
            std::fclose(fp);
            return false;
        }
        ggml_backend_tensor_set(t, stage.data(), 0, sz);
    }
    std::fclose(fp);'''

REPLACEMENT = '''    // Bounded browser transfer. File ownership survives cancellation/throw,
    // and no additional whole-tensor staging allocation duplicates large weights.
    auto fp = manabi_web::open_model_file(path.c_str());
    const size_t data_off = gguf_get_data_offset(gguf_);
    std::vector<uint8_t> stage;
    for (int64_t i = 0; i < n; ++i) {
        manabi_web_check_cancel();
        const char* name = gguf_get_tensor_name(gguf_, i);
        if (!name) continue;
        struct ggml_tensor* t = ggml_get_tensor(ctx_, name);
        if (!t) continue;
        const size_t off = manabi_web::model_offset(data_off, gguf_get_tensor_offset(gguf_, i));
        const size_t sz = gguf_get_tensor_size(gguf_, i);
        if (sz != ggml_nbytes(t)) throw std::runtime_error("MOSS tensor byte size mismatch");
        manabi_web::transfer_tensor(fp.get(), off, sz, stage,
            [t](const uint8_t* bytes, size_t offset, size_t count) {
                ggml_backend_tensor_set(t, bytes, offset, count);
            }, [] { manabi_web_check_cancel(); });
    }'''


def patch_model_loader(path):
    path = Path(path)
    source = path.read_text()
    if source.count(ORIGINAL) != 1:
        raise RuntimeError('Pinned MOSS model-loader transfer contract changed; refusing a partial port')
    includes = '#include "manabi_model_reader.hpp"\n#include "manabi_web_hooks.hpp"\n'
    path.write_text(includes + source.replace(ORIGINAL, REPLACEMENT))
