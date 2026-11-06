"""Output selection must never qualify a different shared build by accident."""
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from reader_edition_output import reader_edition_output


class ReaderEditionOutput(unittest.TestCase):
    def test_explicit_output_wins_over_the_shared_default(self):
        with TemporaryDirectory(prefix='reader-output-selection-') as temporary:
            root = Path(temporary).resolve()
            shared, private = root / 'shared-build', root / 'private-dist'
            shared.mkdir()
            private.mkdir()
            self.assertEqual(shared, reader_edition_output(shared, {}))
            self.assertEqual(private, reader_edition_output(shared, {
                'READER_EDITION_TEST_OUTPUT': str(private)}))

    def test_invalid_override_fails_without_falling_back_to_shared_build(self):
        with TemporaryDirectory(prefix='reader-output-selection-') as temporary:
            root = Path(temporary).resolve()
            shared = root / 'shared-build'
            shared.mkdir()
            file = root / 'file'
            file.write_text('not a directory')
            linked = root / 'linked-build'
            linked.symlink_to(shared, target_is_directory=True)
            parent = root / 'linked-parent'
            parent.symlink_to(root, target_is_directory=True)
            for value in ('', 'relative', str(root / 'missing'), str(file),
                          str(linked), str(parent / 'shared-build')):
                with self.subTest(value=value), self.assertRaises((ValueError, OSError)):
                    reader_edition_output(shared, {'READER_EDITION_TEST_OUTPUT': value})


if __name__ == '__main__':
    unittest.main(verbosity=2)
