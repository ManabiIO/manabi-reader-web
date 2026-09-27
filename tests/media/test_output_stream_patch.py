"""Guarded source patch and compiled callback ABI with a scripted C++ decoder.

This does not compile ggml/Emscripten or run MOSS weights. The fixtures below keep
pinned patch anchors explicit; the actual pinned-source runtime build is a separate CI gate.
"""
import importlib.util
import pathlib
import shutil
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('output_stream_patch', ROOT / 'tools/media/output_stream_patch.py')
patcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(patcher)

HEADER = '''#pragma once
#include <cstdint>
#include <vector>
#include <stdexcept>
struct ModelLoader {};
struct Qwen3Decoder {
  int step = 0;
  int hidden() const { return 1; }
  bool prefill(const std::vector<float>&, int seq, std::vector<float>* out) {
    out->assign(seq, 0); return true;
  }
  std::vector<float> logits_from_hidden(const std::vector<float>&) {
    std::vector<float> values(19, 0); values[++step] = 1; return values;
  }
  std::vector<float> decode_one(const std::vector<float>&) { return {0}; }
};
std::vector<int32_t> greedy_generate(Qwen3Decoder& dec, ModelLoader& m,
                                     const std::vector<float>& fused, int seq,
                                     int max_new, int eos);
'''
# The generation loop's dataflow follows the inspected pinned function; its compute
# calls are the scripted decoder above. Callback/default-argument linkage is real C++.
SOURCE = '''#include "generate.hpp"
#define MT_LOGE(...) ((void)0)
static int argmax_first(const std::vector<float>& v) {
    int best = 0;
    for (int i = 1; i < (int)v.size(); ++i) if (v[i] > v[best]) best = i;
    return best;
}
static std::vector<float> embed_token(ModelLoader&, int32_t, int) { return {0}; }
std::vector<int32_t> greedy_generate(Qwen3Decoder& dec, ModelLoader& m,
                                     const std::vector<float>& fused, int seq,
                                     int max_new, int eos) {
    std::vector<int32_t> ids;
    const int H = dec.hidden();
    if (H <= 0 || seq <= 0 || max_new <= 0) return ids;
    std::vector<float> hid;
    if (!dec.prefill(fused, seq, &hid)) return ids;
    if ((int)hid.size() < H * seq) return ids;
    std::vector<float> last(hid.end() - H, hid.end());
    std::vector<float> logits = dec.logits_from_hidden(last);
    if (logits.empty()) return ids;
    ids.reserve((size_t)max_new);
    for (;;) {
        int t = argmax_first(logits);
        ids.push_back(t);
        if (t == eos) break;
        if ((int)ids.size() >= max_new) break;
        std::vector<float> emb = embed_token(m, t, H);
        if (emb.empty()) break;
        std::vector<float> h1 = dec.decode_one(emb);
        if ((int)h1.size() < H) break;
        logits = dec.logits_from_hidden(h1);
        if (logits.empty()) break;
    }
    return ids;
}
'''
TRANSCRIBE = '''#include "transcribe.hpp"
#include <string>
void placeholder() {
  greedy_generate(dec, m, fused, seq, max_new, c.eos_token_id);
}
'''
MAIN = '''#include "generate.hpp"
#include <cassert>
int main() {
  Qwen3Decoder a, b, cancelled; ModelLoader m;
  const auto baseline = greedy_generate(a,m,{0},1,30,18);
  std::vector<std::vector<int32_t>> previews;
  const auto streamed = greedy_generate(b,m,{0},1,30,18,[&](const auto& ids) {
    previews.push_back(ids);
  });
  assert(baseline == streamed);
  assert(previews.size()==3);
  assert(previews[0].size()==8 && previews[1].size()==16 && previews[2].back()==18);
  for (const auto& ids : previews)
    assert(std::vector<int32_t>(baseline.begin(),baseline.begin()+ids.size())==ids);
  bool threw=false;
  try { greedy_generate(cancelled,m,{0},1,30,18,[](const auto&){throw std::runtime_error("cancel");}); }
  catch(const std::runtime_error&){threw=true;}
  assert(threw && cancelled.step==8);
}
'''

class OutputStreamPatch(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.temp.name)
        (self.root / 'src').mkdir()
        for name, text in [('generate.hpp', HEADER), ('generate.cpp', SOURCE), ('transcribe.cpp', TRANSCRIBE)]:
            (self.root / 'src' / name).write_text(text)

    def tearDown(self):
        self.temp.cleanup()

    def test_callback_abi_compiles_and_preserves_greedy_token_sequence(self):
        patcher.patch_output_stream(self.root)
        (self.root / 'src/main.cpp').write_text(MAIN)
        compiler = shutil.which('clang++') or shutil.which('g++')
        self.assertIsNotNone(compiler, 'A native C++ compiler is required')
        subprocess.run([compiler, '-std=c++17', '-Wall', '-Wextra', '-Werror',
                        str(self.root / 'src/generate.cpp'), str(self.root / 'src/main.cpp'),
                        '-o', str(self.root / 'test')], check=True, capture_output=True, text=True)
        subprocess.run([str(self.root / 'test')], check=True, timeout=10)

    def test_patch_requires_exact_unique_anchors(self):
        path = self.root / 'src/generate.hpp'
        path.write_text(path.read_text().replace('int max_new, int eos);', 'different contract'))
        with self.assertRaisesRegex(RuntimeError, 'contract changed'):
            patcher.patch_output_stream(self.root)

    def test_double_application_fails_closed(self):
        patcher.patch_output_stream(self.root)
        with self.assertRaisesRegex(RuntimeError, 'contract changed'):
            patcher.patch_output_stream(self.root)

    def test_existing_tokenizer_is_reused_and_output_size_is_bounded(self):
        patcher.patch_output_stream(self.root)
        source = (self.root / 'src/transcribe.cpp').read_text()
        self.assertNotIn('tok.decode(ids)', source)
        self.assertIn('preview += tok.decode(delta)', source)
        self.assertIn('ids.begin() + preview_ids', source)
        self.assertIn('preview_ids = ids.size()', source)
        self.assertIn('preview.size() > 1024u * 1024u', source)
        self.assertIn('manabi_web_output(preview.data()', source)
        self.assertNotIn('Tokenizer tok', source)

    def test_build_identity_and_manifest_cover_the_callback_patch(self):
        source = (ROOT / 'tools/media/build-moss.py').read_text()
        self.assertIn("PORT_REVISION='manabi-web-v6'", source)
        self.assertIn('patch_output_stream(source)', source)
        self.assertIn("'output_stream_patch.py'", source)
        self.assertIn('MOSS token budget exhausted; incomplete window', source)
        self.assertIn('MOSS stopped before EOS', source)
        # The callback is stacked on #46's v5 Wasm/encoder/thread performance work.
        self.assertIn('CMAKE_SYSTEM_NAME STREQUAL \"Emscripten\"', source)
        self.assertIn('requested_frames', source)
        self.assertIn('ggml_view_2d', source)
        self.assertIn('cwd=work', source)
        bridge = (ROOT / 'tools/media/bridge.cpp').read_text()
        self.assertIn('HEAPU8.slice(data, data + length)', bridge)
        self.assertIn("Module['onMossOutput']", bridge)

if __name__ == '__main__':
    unittest.main()
