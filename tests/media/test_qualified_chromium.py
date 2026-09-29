"""Exercise installer verification with local fixture bytes; no browser or download."""
import hashlib
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[2]
INSTALLER = ROOT / 'tools/media/install-qualified-chromium.sh'
ARCHIVE_SHA = 'ceee2972074d441ea7c4ba8bcc0eaab77e7e87680f6653d73d3065851fe10302'
BINARY_SHA = 'e528b77a8b250c48a5bbd7aeeabbc2813940c0a2fe39b1b11fbaf1f01fb04f18'


class QualifiedChromiumTests(unittest.TestCase):
    def exercise(self, fault=None):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            version = '154.0.8037.56' if fault == 'version' else '154.0.8037.57'
            binary = f'#!/bin/sh\nprintf "Google Chrome for Testing {version}\\n"\n'.encode()
            archive = root / 'fixture.zip'
            with zipfile.ZipFile(archive, 'w') as z:
                item = zipfile.ZipInfo('chrome-linux64/chrome')
                item.create_system = 3
                item.external_attr = 0o100755 << 16
                z.writestr(item, binary)
            archive_digest = hashlib.sha256(archive.read_bytes()).hexdigest()
            binary_digest = hashlib.sha256(binary).hexdigest()
            # Only substitute fixture digests in a temporary test copy. The real
            # installer remains pinned to bytes independently observed in CI.
            script = INSTALLER.read_text().replace(ARCHIVE_SHA, archive_digest).replace(
                BINARY_SHA, '0' * 64 if fault == 'binary' else binary_digest)
            installer = root / 'install.sh'
            installer.write_text(script)
            commands = root / 'commands'
            commands.mkdir()
            curl = commands / 'curl'
            curl.write_text('''#!/bin/sh
printf '%s\\n' "$@" > "$TEST_ROOT/curl-arguments.txt"
if [ "$TEST_FAULT" = download ]; then exit 22; fi
while [ "$#" -gt 0 ]; do
  if [ "$1" = --output ]; then shift; destination="$1"; fi
  shift
done
if [ "$TEST_FAULT" = archive ]; then
  printf 'altered download' > "$destination"
else
  cp "$TEST_ROOT/fixture.zip" "$destination"
fi
''')
            curl.chmod(0o755)
            env = {**os.environ, 'PATH': f'{commands}:{os.environ["PATH"]}',
                   'TEST_ROOT': str(root), 'TEST_FAULT': fault or '',
                   'GITHUB_ENV': str(root / 'environment')}
            result = subprocess.run(['bash', str(installer), 'evidence'], cwd=root,
                                    env=env, text=True, capture_output=True, timeout=10)
            exports = (root / 'environment').read_text() if (root / 'environment').exists() else ''
            arguments = (root / 'curl-arguments.txt').read_text()
            self.assertIn('https://storage.googleapis.com/chrome-for-testing-public/'
                          '154.0.8037.57/linux64/chrome-linux64.zip', arguments)
            if fault:
                self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertEqual(exports, '', 'unverified browser escaped into job environment')
            else:
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertEqual(exports, 'CHROMIUM=' + str(root / '.cache/qualified-chromium/'
                                  '154.0.8037.57/chrome-linux64/chrome') + '\n')
                self.assertTrue((root / 'evidence/browser-version.txt').exists())
                self.assertIn(archive_digest, (root / 'evidence/browser-archive-sha256.txt').read_text())
                self.assertIn(binary_digest, (root / 'evidence/browser-binary-sha256.txt').read_text())

    def test_verified_archive_binary_and_version_export_executable(self):
        self.exercise()

    def test_corrupt_archive_is_rejected(self):
        self.exercise('archive')

    def test_wrong_binary_is_rejected(self):
        self.exercise('binary')

    def test_wrong_version_is_rejected(self):
        self.exercise('version')

    def test_failed_download_cannot_export_a_browser(self):
        self.exercise('download')


if __name__ == '__main__':
    unittest.main()
