"""Exercise the actual generator cache using tiny files; speech-generation is a separate gate."""
import importlib.util
import json
import pathlib
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('media_fixtures', ROOT / 'tools/media/generate-fixtures.py')
generator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(generator)

class FixtureCacheTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name)
        self.key = 'a' * 64
        self.target = self.root / self.key
        self.target.mkdir()
        for name in generator.expected_files('en'):
            (self.target / name).write_bytes(('fixture ' + name).encode())
        self.data = {'schemaVersion': 2, 'language': 'en', 'fingerprint': self.key, 'duration': 10,
                     'cues': [{'start': 1, 'end': 3, 'text': 'First sentence.'}, {'start': 4, 'end': 7, 'text': 'Second sentence.'}],
                     'files': {n: generator.digest(self.target / n) for n in generator.expected_files('en')}}
        self.write()
    def write(self):
        (self.target / 'manifest.json').write_text(json.dumps(self.data))
    def valid(self):
        return generator.cached_fixture_valid(self.target, self.key, 'en')
    def test_valid_cache(self): self.assertTrue(self.valid())
    def test_missing_cache(self): self.assertFalse(generator.cached_fixture_valid(self.root/'absent',self.key,'en'))
    def test_corrupt_manifest(self):
        (self.target/'manifest.json').write_text('{broken')
        self.assertFalse(self.valid())
    def test_empty_file_map_is_not_success(self):
        self.data['files']={};self.write();self.assertFalse(self.valid())
    def test_wrong_fingerprint(self):
        self.data['fingerprint']='b'*64;self.write();self.assertFalse(self.valid())
    def test_missing_generated_file(self):
        (self.target/'embedded.mkv').unlink();self.assertFalse(self.valid())
    def test_changed_generated_file(self):
        (self.target/'video.mp4').write_bytes(b'changed');self.assertFalse(self.valid())
    def test_manifest_path_traversal_is_not_read(self):
        self.data['files']['../unrelated']='a'*64;self.write();self.assertFalse(self.valid())
    def test_output_symlink_is_not_trusted(self):
        outside=self.root/'external';outside.write_bytes(b'outside')
        path=self.target/'video.mp4';path.unlink();path.symlink_to(outside)
        self.data['files']['video.mp4']=generator.digest(outside);self.write();self.assertFalse(self.valid())
    def test_manifest_symlink_is_not_trusted(self):
        outside=self.root/'metadata';outside.write_text(json.dumps(self.data))
        manifest=self.target/'manifest.json';manifest.unlink();manifest.symlink_to(outside)
        self.assertFalse(self.valid())
    def test_wrong_language(self):
        self.assertFalse(generator.cached_fixture_valid(self.target,self.key,'ja'))
    def test_bad_duration(self):
        for duration in [0,True,float('nan'),float('inf'),301]:
            self.data['duration']=duration;self.write();self.assertFalse(self.valid())
    def test_multiple_cues_required(self):
        self.data['cues']=[{}];self.write();self.assertFalse(self.valid())

if __name__ == '__main__': unittest.main()
