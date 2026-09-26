#!/usr/bin/env python3
"""Build both CPU-only browser runtimes from pinned source; never bundles model weights."""
import argparse, hashlib, json, pathlib, shutil, subprocess, tempfile
from runtime_artifacts import check_path, publish_pair
from model_loader_patch import patch_model_loader
PIN='190a569c13b4b247450f2fb3b2a431244e84833e'
PORT_REVISION='manabi-web-v3'
GGML_PIN='eced84c86f8b012c752c016f7fe789adea168e1e'
ROOT=pathlib.Path(__file__).resolve().parents[2]
def run(*args): subprocess.run(args, check=True)
def replace(path, old, new):
    source=path.read_text()
    if source.count(old)!=1: raise RuntimeError(f'Upstream contract changed in {path.name}: {old!r}')
    path.write_text(source.replace(old,new))
def main():
    parser=argparse.ArgumentParser();parser.add_argument('--source',type=pathlib.Path);args=parser.parse_args()
    for binary in ('git','emcmake','em++','cmake'):
        if not shutil.which(binary): raise SystemExit(f'Missing {binary}; activate the Emscripten SDK first.')
    cache=ROOT/'.cache/moss-web';cache.mkdir(parents=True,exist_ok=True)
    check_path(cache)
    work=pathlib.Path(tempfile.mkdtemp(prefix='build-', dir=cache))
    source=work/'source'
    # Unique work directories preserve failed builds for diagnosis and do not
    # erase another process's compilation. No installed output changes yet.
    run('git','clone','--no-checkout',str(args.source) if args.source else 'https://github.com/localai-org/moss-transcribe.cpp.git',str(source))
    run('git','-C',str(source),'checkout','--detach',PIN)
    run('git','-C',str(source),'submodule','update','--init','--recursive')
    ggml_head=subprocess.check_output(['git','-C',str(source/'third_party/ggml'),'rev-parse','HEAD'],text=True).strip()
    if ggml_head != GGML_PIN: raise RuntimeError('Unexpected ggml submodule revision')
    compiler=subprocess.check_output(['em++','--version'],text=True).strip()
    cmake=source/'CMakeLists.txt'
    replace(cmake,'set(GGML_NATIVE ON CACHE BOOL "" FORCE)','set(GGML_NATIVE OFF CACHE BOOL "" FORCE)')
    replace(cmake,'set(GGML_LLAMAFILE ON CACHE BOOL "" FORCE)','set(GGML_LLAMAFILE OFF CACHE BOOL "" FORCE)')
    for name in ('generate.cpp','audio_encoder.cpp','mel.cpp'):
        path=source/'src'/name;path.write_text('#include "manabi_web_hooks.hpp"\n#include <stdexcept>\n'+path.read_text())
    backend=source/'src/backend.cpp'
    backend.write_text('#include "manabi_web_hooks.hpp"\n'+backend.read_text())
    shutil.copy(ROOT/'tools/media/manabi_web_hooks.hpp',source/'src')
    shutil.copy(ROOT/'tools/media/manabi_model_reader.hpp',source/'src')
    patch_model_loader(source/'src/model_loader.cpp')
    replace(source/'src/generate.cpp','    for (;;) {','    for (;;) {\n        manabi_web_check_cancel();')
    replace(source/'src/generate.cpp','        if ((int)ids.size() >= max_new) break;','        if ((int)ids.size() >= max_new) throw std::runtime_error("MOSS token budget exhausted; incomplete window");')
    replace(source/'src/generate.cpp','    return ids;\n}\n\n}  // namespace mt','    if (ids.empty() || ids.back() != eos) throw std::runtime_error("MOSS stopped before EOS");\n    return ids;\n}\n\n}  // namespace mt')
    replace(source/'src/audio_encoder.cpp','    for (size_t off = 0; off < total; off += (size_t)chunk_samples) {','    for (size_t off = 0; off < total; off += (size_t)chunk_samples) {\n        manabi_web_check_cancel();')
    replace(source/'src/mel.cpp','    for (int t = 0; t < n_frames; ++t) {','    for (int t = 0; t < n_frames; ++t) {\n        manabi_web_check_cancel();')
    replace(backend,'            ggml_backend_cpu_set_n_threads(g_backend, nt);',
        '            ggml_backend_cpu_set_n_threads(g_backend, nt);\n'
        '            ggml_backend_cpu_set_abort_callback(g_backend, [](void *) { return manabi_web_cancel_requested(); }, nullptr);')
    shutil.copy(ROOT/'tools/media/bridge.cpp',source/'manabi_bridge.cpp')
    with cmake.open('a') as f:
        f.write('''
add_executable(moss-web manabi_bridge.cpp)
target_link_libraries(moss-web PRIVATE moss-transcribe)
set_target_properties(moss-web PROPERTIES OUTPUT_NAME moss SUFFIX .mjs)
target_link_options(moss-web PRIVATE
 "--no-entry" "-O3" "-msimd128" "-sMODULARIZE=1" "-sEXPORT_ES6=1"
 "-sENVIRONMENT=worker" "-sALLOW_MEMORY_GROWTH=1" "-sMAXIMUM_MEMORY=2147483648"
 "-sFILESYSTEM=1" "-lworkerfs.js" "-sDISABLE_EXCEPTION_CATCHING=0" "-sDYNAMIC_EXECUTION=0"
 "-sEXPORTED_RUNTIME_METHODS=['ccall','UTF8ToString','FS','WORKERFS','HEAP32','HEAPF32']"
 "-sEXPORTED_FUNCTIONS=['_malloc','_free','_moss_web_abi_version','_moss_web_engine_revision','_moss_web_ggml_revision','_moss_web_load','_moss_web_cancel_ptr','_moss_web_begin','_moss_transcribe_capi_transcribe_pcm','_moss_transcribe_capi_free','_moss_transcribe_capi_free_string','_moss_transcribe_capi_last_error']")
if(MANABI_THREADS)
 target_link_options(moss-web PRIVATE "-pthread" "-sPTHREAD_POOL_SIZE=4" "-sEXPORTED_RUNTIME_METHODS=['ccall','UTF8ToString','FS','WORKERFS','HEAP32','HEAPF32','PThread']")
endif()
''')
        f.write(f'\ntarget_compile_definitions(moss-web PRIVATE MANABI_MOSS_ENGINE_REVISION="{PIN}+{PORT_REVISION}" MANABI_MOSS_GGML_REVISION="{GGML_PIN}")\n')
    staged=work/'staged'
    for mode in ('single','threaded'):
        build=work/mode
        flags='-O3 -msimd128 -fexceptions'+(' -pthread' if mode=='threaded' else '')
        run('emcmake','cmake','-S',str(source),'-B',str(build),'-DCMAKE_BUILD_TYPE=Release','-DMT_BUILD_CLI=OFF','-DMT_BUILD_TESTS=OFF','-DBUILD_SHARED_LIBS=OFF','-DGGML_OPENMP=OFF','-DGGML_BACKEND_DL=OFF','-DGGML_CPU_ALL_VARIANTS=OFF','-DGGML_WEBGPU=OFF','-DGGML_WASM_SINGLE_FILE=OFF',f'-DMANABI_THREADS={"ON" if mode=="threaded" else "OFF"}',f'-DCMAKE_C_FLAGS={flags}',f'-DCMAKE_CXX_FLAGS={flags}')
        run('cmake','--build',str(build),'--target','moss-web','-j','2')
        for required in ('moss.mjs','moss.wasm'):
            if not (build/required).is_file(): raise RuntimeError(f'Missing build output: {required}')
        dest=staged/mode
        dest.mkdir(parents=True,exist_ok=True)
        for pattern in ('moss.mjs','moss.wasm','moss*.worker.*'):
            for file in build.glob(pattern):shutil.copy(file,dest/file.name)
        shutil.copy(source/'LICENSE',dest/'LICENSE-MOSS.txt')
        shutil.copy(source/'third_party/ggml/LICENSE',dest/'LICENSE-GGML.txt')
        metadata={'version':1,'engineRevision':PIN+'+'+PORT_REVISION,'mossCommit':PIN,'ggmlCommit':GGML_PIN,'compiler':compiler,'mode':mode,
                  'portSha256':{name:hashlib.sha256((ROOT/'tools/media'/name).read_bytes()).hexdigest()
                    for name in ('build-moss.py','bridge.cpp','manabi_web_hooks.hpp','runtime_artifacts.py','manabi_model_reader.hpp','model_loader_patch.py')},
                  'files':{file.name:hashlib.sha256(file.read_bytes()).hexdigest()
                    for file in sorted(dest.iterdir()) if file.is_file()}}
        (dest/'build.json').write_text(json.dumps(metadata,indent=2)+'\n')
    publish_pair(staged,ROOT/'apps/web/static/moss',PIN+'+'+PORT_REVISION,GGML_PIN)
    shutil.rmtree(work)
    print('Both CPU-only SIMD runtimes built; validated pair installed. No model weights were downloaded.')
if __name__=='__main__':main()
