"""Compiles and executes the production C++ transfer helper with sanitizers.

This does not build ggml/MOSS/Emscripten or measure model runtime memory.
"""
import importlib.util
from pathlib import Path
import os
import shutil
import subprocess
import tempfile
import unittest
ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('model_loader_patch', ROOT/'tools/media/model_loader_patch.py')
patcher = importlib.util.module_from_spec(spec); spec.loader.exec_module(patcher)

class NativeModelReader(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.executable = Path(cls.temp.name)/'model-reader'
        compiler = shutil.which('clang++') or shutil.which('g++')
        if not compiler: raise RuntimeError('A native C++ compiler is required for the model reader tests')
        result = subprocess.run([compiler,'-std=c++17','-O1','-g','-Wall','-Wextra','-Werror',
            '-fsanitize=address,undefined','-fno-omit-frame-pointer','-I',str(ROOT/'tools/media'),
            str(ROOT/'tests/media/model-reader-native.cpp'),'-o',str(cls.executable)],capture_output=True,text=True)
        if result.returncode: raise RuntimeError(result.stdout+result.stderr)
    @classmethod
    def tearDownClass(cls): cls.temp.cleanup()
    def run_case(self, name):
        result = subprocess.run([str(self.executable),name],capture_output=True,text=True,timeout=20,
            env={**os.environ,'ASAN_OPTIONS':'detect_leaks=1:halt_on_error=1','UBSAN_OPTIONS':'halt_on_error=1'})
        self.assertEqual(result.returncode,0,result.stdout+result.stderr)
        self.assertIn('PASS '+name,result.stdout)
for case in ('bounded-copy','growing-tensor-sizes','short-read','cancel-before-read','cancel-before-upload',
             'cancel-between-chunks','exception-closes-file','offset-overflow','zero-tensor'):
    setattr(NativeModelReader,'test_'+case.replace('-','_'),lambda self,case=case:self.run_case(case))

class GuardedSourcePatch(unittest.TestCase):
    def test_exact_upstream_transfer_gets_bounded_helper(self):
        with tempfile.TemporaryDirectory() as folder:
            source=Path(folder)/'model_loader.cpp';source.write_text('before\n'+patcher.ORIGINAL+'\nafter\n')
            patcher.patch_model_loader(source);result=source.read_text()
            self.assertIn(patcher.REPLACEMENT,result)
            self.assertIn('ggml_backend_tensor_set(t, bytes, offset, count)',result)
            self.assertIn('sz != ggml_nbytes(t)',result)
            self.assertNotIn('stage.resize(sz)',result)
            self.assertTrue(result.endswith('after\n'))
            with self.assertRaisesRegex(RuntimeError,'transfer contract changed'):patcher.patch_model_loader(source)
    def test_missing_or_duplicate_anchor_does_not_partially_modify_file(self):
        for content in ['changed upstream',patcher.ORIGINAL+'\n'+patcher.ORIGINAL]:
            with self.subTest(content=content[:16]),tempfile.TemporaryDirectory() as folder:
                source=Path(folder)/'model_loader.cpp';source.write_text(content)
                with self.assertRaises(RuntimeError):patcher.patch_model_loader(source)
                self.assertEqual(source.read_text(),content)
    def test_recipe_applies_patch_and_binds_helper_identity(self):
        source=(ROOT/'tools/media/build-moss.py').read_text()
        self.assertIn("patch_model_loader(source/'src/model_loader.cpp')",source)
        self.assertGreaterEqual(source.count('manabi_model_reader.hpp'),2)
        self.assertIn('model_loader_patch.py',source)
if __name__=='__main__': unittest.main(verbosity=2)
