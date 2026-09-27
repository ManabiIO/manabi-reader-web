"""Strict asynchronous polling contracts; no browser or recognition claim."""
import unittest
from unittest.mock import Mock, patch
from browser_poll import wait_for_async


class AsyncPollingTest(unittest.TestCase):
    def test_waits_for_resolved_true_and_preserves_argument(self):
        page = Mock()
        page.evaluate.side_effect = [False, None, {'truthy': True}, 1, True]
        with patch('browser_poll.time.sleep') as sleep:
            wait_for_async(page, 'async id => read(id)', arg='job')
        self.assertEqual(page.evaluate.call_count, 5)
        self.assertEqual(sleep.call_count, 4)
        page.evaluate.assert_called_with('async id => read(id)', 'job')

    def test_false_predicate_cannot_pass(self):
        page = Mock()
        page.evaluate.return_value = False
        with patch('browser_poll.time.monotonic', side_effect=[0, 0.001, 0.011]), patch('browser_poll.time.sleep'):
            with self.assertRaisesRegex(AssertionError, 'did not become true'):
                wait_for_async(page, 'async () => false', timeout=10)
        self.assertEqual(page.evaluate.call_count, 2)

    def test_errors_propagate_without_retry(self):
        page = Mock()
        error = RuntimeError('IndexedDB read failed')
        page.evaluate.side_effect = error
        with self.assertRaises(RuntimeError) as result:
            wait_for_async(page, 'async () => read()')
        self.assertIs(result.exception, error)
        self.assertEqual(page.evaluate.call_count, 1)

    def test_rejects_invalid_polling_budget(self):
        for args in [{'timeout': 0}, {'interval': 0}, {'timeout': -1}]:
            with self.subTest(args=args), self.assertRaises(ValueError):
                wait_for_async(Mock(), 'async () => true', **args)


if __name__ == '__main__':
    unittest.main()
