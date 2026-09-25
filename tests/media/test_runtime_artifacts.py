"""File-publication regressions using controlled placeholder outputs, NOT a MOSS build."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('runtime_artifacts', ROOT / 'tools/media/runtime_artifacts.py')
artifacts = importlib.util.module_from_spec(spec)
spec.loader.exec_module(artifacts)


class RuntimePublication(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.staged, self.dest = self.root / 'staged', self.root / 'output/moss'
        for mode in artifacts.MODES:
            target = self.staged / mode
            target.mkdir(parents=True)
            for name in artifacts.REQUIRED:
                (target / name).write_bytes(b'\0asm\x01\0\0\0' if name.endswith('.wasm') else b'controlled file fixture')
            self.manifest(mode)
            old = self.dest / mode
            old.mkdir(parents=True)
            (old / 'old.txt').write_text(mode)
        (self.dest / 'README.md').write_text('Keep tracked documentation')

    def tearDown(self):
        self.temp.cleanup()

    def manifest(self, mode):
        path = self.staged / mode
        value = {'version': 1, 'mode': mode, 'engineRevision': 'engine', 'ggmlCommit': 'ggml',
                 'files': {name: artifacts.digest(path / name) for name in artifacts.REQUIRED}}
        (path / 'build.json').write_text(json.dumps(value))

    def publish(self):
        artifacts.publish_pair(self.staged, self.dest, 'engine', 'ggml')

    def old_pair(self):
        for mode in artifacts.MODES:
            self.assertEqual((self.dest / mode / 'old.txt').read_text(), mode)
            self.assertFalse((self.dest / mode / 'moss.mjs').exists())

    def test_both_modes_publish_and_root_documentation_survives(self):
        self.publish()
        for mode in artifacts.MODES:
            artifacts.validate_mode(self.dest / mode, mode, 'engine', 'ggml')
        self.assertEqual((self.dest / 'README.md').read_text(), 'Keep tracked documentation')
        self.assertEqual(list(self.dest.parent.glob('.moss-runtime-*')), [])

    def test_missing_second_mode_does_not_replace_first(self):
        (self.staged / 'threaded/moss.wasm').unlink()
        with self.assertRaises(ValueError): self.publish()
        self.old_pair()

    def test_corruption_preserves_existing_pair(self):
        (self.staged / 'threaded/moss.wasm').write_bytes(b'corrupt')
        with self.assertRaises(ValueError): self.publish()
        self.old_pair()

    def test_wrong_mode_or_pin_is_rejected(self):
        for field, value in [('mode', 'single'), ('engineRevision', 'stale'), ('ggmlCommit', 'other')]:
            self.manifest('threaded')
            path = self.staged / 'threaded/build.json'
            record = json.loads(path.read_text()); record[field] = value; path.write_text(json.dumps(record))
            with self.assertRaises(ValueError): self.publish()
            self.old_pair()

    def test_matching_checksum_does_not_accept_non_wasm_bytes(self):
        (self.staged / 'threaded/moss.wasm').write_bytes(b'not wasm')
        self.manifest('threaded')
        with self.assertRaisesRegex(ValueError, 'WebAssembly'): self.publish()
        self.old_pair()

    def test_unknown_file_is_not_silently_published(self):
        (self.staged / 'single/unexpected.txt').write_text('not listed')
        with self.assertRaisesRegex(ValueError, 'Unexpected'): self.publish()
        self.old_pair()

    def test_manifest_symlink_rejected(self):
        path = self.staged / 'threaded/build.json'
        original = path.read_text(); path.unlink(); (self.root / 'metadata').write_text(original); path.symlink_to(self.root / 'metadata')
        with self.assertRaises(ValueError): self.publish()
        self.old_pair()

    def test_existing_output_ancestor_symlink_rejected(self):
        link = self.root / 'shortcut'; link.symlink_to(self.dest.parent, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, 'symlink'):
            artifacts.publish_pair(self.staged, link / 'moss', 'engine', 'ggml')
        self.old_pair()

    def test_failed_second_install_restores_both_prior_directories(self):
        original = artifacts.os.replace
        def replace(source, destination):
            if Path(source).name == 'threaded' and Path(source).parent.name.startswith('.moss-runtime-'):
                raise OSError('injected installation failure')
            return original(source, destination)
        with mock.patch.object(artifacts.os, 'replace', side_effect=replace):
            with self.assertRaises(OSError): self.publish()
        self.old_pair()

    def test_failed_recovery_preserves_the_recovery_files(self):
        original = artifacts.os.replace
        def replace(source, destination):
            if Path(source).name in ('threaded', 'previous-single') and Path(source).parent.name.startswith('.moss-runtime-'):
                raise OSError('injected installation/recovery failure')
            return original(source, destination)
        with mock.patch.object(artifacts.os, 'replace', side_effect=replace):
            with self.assertRaisesRegex(RuntimeError, 'previous files retained'): self.publish()
        backup = list(self.dest.parent.glob('.moss-runtime-*'))
        self.assertEqual(len(backup), 1)
        self.assertEqual((backup[0] / 'previous-single/old.txt').read_text(), 'single')
        self.assertEqual((backup[0] / 'previous-threaded/old.txt').read_text(), 'threaded')


if __name__ == '__main__':
    unittest.main()
