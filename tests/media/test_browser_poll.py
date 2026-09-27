"""Static and parameter regressions; native polling semantics run in browser-poll.py."""
import ast
from pathlib import Path
import re
import unittest
from unittest.mock import Mock

from browser_poll import wait_for_async


class BrowserPollingTest(unittest.TestCase):
    def test_invalid_budgets_do_not_touch_the_browser(self):
        for name in ('timeout', 'interval'):
            for value in (0, -1, float('nan'), float('inf'), True, '25', None):
                with self.subTest(name=name, value=value):
                    page = Mock()
                    with self.assertRaises(ValueError):
                        wait_for_async(page, 'async () => true', **{name: value})
                    self.assertEqual(page.mock_calls, [])

    def test_invalid_expression_does_not_touch_the_browser(self):
        for value in ('', ' ', None, 1):
            with self.subTest(value=value):
                page = Mock()
                with self.assertRaises(ValueError):
                    wait_for_async(page, value)
                self.assertEqual(page.mock_calls, [])

    def test_media_runners_do_not_pass_async_predicates_to_sync_polling(self):
        bad = []
        for path in Path(__file__).parent.glob('*.py'):
            for node in ast.walk(ast.parse(path.read_text(), filename=str(path))):
                if (not isinstance(node, ast.Call) or not isinstance(node.func, ast.Attribute)
                        or node.func.attr != 'wait_for_function' or not node.args):
                    continue
                expression = node.args[0]
                if (isinstance(expression, ast.Constant) and isinstance(expression.value, str)
                        and re.match(r'^\s*async\b', expression.value)):
                    bad.append(f'{path.name}:{node.lineno}')
        self.assertEqual(bad, [], 'Use wait_for_async for resolved asynchronous predicates')


if __name__ == '__main__':
    unittest.main()
