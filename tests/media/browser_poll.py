"""Poll asynchronous browser state without treating a Promise as a truthy result."""
import time


def wait_for_async(page, expression, *, arg=None, timeout=30000, interval=25):
    """Page.evaluate awaits returned promises; wait_for_function predicates do not.

    Each query must resolve to the boolean True. A deadline limits repeated reads;
    query errors remain failures rather than being retried or converted into skips.
    """
    if timeout <= 0 or interval <= 0:
        raise ValueError('Polling timeout and interval must be positive')
    deadline = time.monotonic() + timeout / 1000
    while True:
        value = page.evaluate(expression, arg)
        if value is True:
            return
        if time.monotonic() >= deadline:
            raise AssertionError(f'Asynchronous browser condition did not become true: {expression}; last value: {value!r}')
        time.sleep(interval / 1000)
