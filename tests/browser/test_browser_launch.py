"""Launch safety without starting a browser or changing installed tooling."""
import unittest
from unittest.mock import patch
from browser_launch import launch_options


class BrowserLaunchOptions(unittest.TestCase):
    def test_macos_chromium_merges_features_without_mutating_caller(self):
        args = ['--headless', '--disable-features=First,MacAppCodeSignClone',
                '--disable-features=Second']
        original = list(args)
        with patch('browser_launch.sys.platform', 'darwin'):
            result = launch_options(args=args, executable_path='/example/chrome')
        self.assertEqual(result['args'], [
            '--headless', '--disable-features=First,MacAppCodeSignClone,Second'])
        self.assertEqual(result['executable_path'], '/example/chrome')
        self.assertEqual(args, original)

    def test_macos_chromium_adds_clone_protection_without_other_arguments(self):
        with patch('browser_launch.sys.platform', 'darwin'):
            self.assertEqual(launch_options(), {
                'args': ['--disable-features=MacAppCodeSignClone']})

    def test_other_engines_and_hosts_preserve_options(self):
        for host, engine in [('darwin', 'webkit'), ('darwin', 'firefox'),
                             ('win32', 'chromium'), ('linux', 'chromium')]:
            with self.subTest(host=host, engine=engine), patch('browser_launch.sys.platform', host):
                self.assertEqual(launch_options(engine, headless=True), {'headless': True})


if __name__ == '__main__':
    unittest.main(verbosity=2)
