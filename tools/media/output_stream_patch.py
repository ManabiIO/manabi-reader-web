"""Guarded callback-only extension of the pinned greedy decoder (no numerical changes)."""
from pathlib import Path


def patch_output_stream(source: Path) -> None:
    def replace(name: str, old: str, new: str) -> None:
        path = source / 'src' / name
        text = path.read_text()
        if text.count(old) != 1:
            raise RuntimeError(f'Upstream output callback contract changed in {name}')
        path.write_text(text.replace(old, new))

    replace('generate.hpp', '#include <vector>', '#include <vector>\n#include <functional>')
    replace('generate.hpp', 'int max_new, int eos);',
            'int max_new, int eos,\n'
            '                                     const std::function<void(const std::vector<int32_t>&)>& output = {});')
    replace('generate.cpp', 'int max_new, int eos) {',
            'int max_new, int eos,\n'
            '                                     const std::function<void(const std::vector<int32_t>&)>& output) {')
    replace('generate.cpp', '        ids.push_back(t);',
            '        ids.push_back(t);\n'
            '        // Preview snapshots only. EOS/budget/error checks below still own success.\n'
            '        if (output && (ids.size() % 8 == 0 || t == eos)) output(ids);')
    replace('transcribe.cpp', '#include "transcribe.hpp"',
            '#include "transcribe.hpp"\n#include "manabi_web_hooks.hpp"')
    replace('transcribe.cpp', 'greedy_generate(dec, m, fused, seq, max_new, c.eos_token_id);',
            'greedy_generate(dec, m, fused, seq, max_new, c.eos_token_id,\n'
            '            [&](const std::vector<int32_t>& ids) {\n'
            '                const std::string preview = tok.decode(ids);\n'
            '                if (preview.size() > 1024u * 1024u)\n'
            '                    throw std::runtime_error("MOSS output exceeds preview budget");\n'
            '                manabi_web_output(preview.data(), static_cast<int>(preview.size()));\n'
            '            });')
    replace('transcribe.cpp', '#include <string>', '#include <string>\n#include <stdexcept>')
