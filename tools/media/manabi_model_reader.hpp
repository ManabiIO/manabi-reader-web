#pragma once
// Manabi browser port: bounded, exception-safe transfer of unchanged tensor bytes.
// This is transport only, not a quantizer, numerical transform or model parser.
#include <algorithm>
#include <climits>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <memory>
#include <stdexcept>
#include <vector>

namespace manabi_web {
constexpr std::size_t model_staging_limit = 4u * 1024u * 1024u;
using ModelFile = std::unique_ptr<std::FILE, decltype(&std::fclose)>;

inline ModelFile open_model_file(const char* path) {
    ModelFile file(std::fopen(path, "rb"), &std::fclose);
    if (!file) throw std::runtime_error("MOSS model file could not be opened");
    return file;
}

// GGUF offsets are unsigned; wasm32 fseek uses signed long. Check before casting
// or addition rather than wrapping into a different part of the model.
inline std::size_t model_offset(std::size_t data, std::size_t tensor) {
    const auto maximum = static_cast<std::size_t>(LONG_MAX);
    if (data > maximum || tensor > maximum - data)
        throw std::runtime_error("MOSS model offset exceeds this runtime's file range");
    return data + tensor;
}

template<class Upload, class CheckCancel>
void transfer_tensor(std::FILE* file, std::size_t offset, std::size_t bytes,
                     std::vector<std::uint8_t>& staging, Upload upload,
                     CheckCancel check_cancel) {
    check_cancel();
    const auto maximum = static_cast<std::size_t>(LONG_MAX);
    if (!file || offset > maximum || bytes > maximum - offset)
        throw std::runtime_error("MOSS model tensor exceeds this runtime's file range");
    if (!bytes) return;
    if (std::fseek(file, static_cast<long>(offset), SEEK_SET) != 0)
        throw std::runtime_error("MOSS model tensor seek failed");
    // Reuse this buffer across tensors, never grow it to a whole embedding matrix.
    const auto capacity = std::min(bytes, model_staging_limit);
    // Reserve the final bound once: resize alone may geometrically over-allocate
    // (e.g. 3 MiB -> 4 MiB requests can reserve 6 MiB) on an increasing tensor list.
    if (staging.capacity() < capacity) staging.reserve(model_staging_limit);
    if (staging.size() < capacity) staging.resize(capacity);
    for (std::size_t position = 0; position < bytes;) {
        check_cancel();
        const auto count = std::min(bytes - position, model_staging_limit);
        if (std::fread(staging.data(), 1, count, file) != count)
            throw std::runtime_error("MOSS model tensor is truncated or unreadable");
        check_cancel();
        // Upload offsets and sizes are bytes, including packed quantized tensors.
        upload(staging.data(), position, count);
        position += count;
    }
}
} // namespace manabi_web
