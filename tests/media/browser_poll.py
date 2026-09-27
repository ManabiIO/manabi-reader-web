"""Bounded async browser assertions with one outstanding read and strict booleans."""
import math

# Playwright's wait_for_function predicate is synchronous. Start each async read
# separately, and poll its settled value rather than the truthiness of a Promise.
# The host-side timeout still bounds a query that never resolves or a frozen page.
_POLL = """state => {
    if (state.failed) throw new Error(state.error);
    if (state.value === true) return true;
    if (!state.pending) {
        state.pending = true;
        Promise.resolve().then(() => state.predicate(state.arg)).then(
            value => { state.value = value; state.pending = false; },
            error => {
                state.failed = true;
                state.error = error instanceof Error ? error.message : String(error);
            }
        );
    }
    return false;
}"""


def wait_for_async(page, expression, *, arg=None, timeout=30000, interval=25):
    """Wait for a trusted test predicate to resolve to exactly True.

    An unresolved query cannot defeat Playwright's timeout. Rejections fail the
    assertion, and slow reads never overlap. No timer or state is installed on
    window; disposing the isolated handles does not schedule more reads.
    """
    for name, value in [('timeout', timeout), ('interval', interval)]:
        if (isinstance(value, bool) or not isinstance(value, (int, float)) or
                not math.isfinite(value) or value <= 0):
            raise ValueError(f'{name} must be positive and finite')
    if not isinstance(expression, str) or not expression.strip():
        raise ValueError('A nonempty JavaScript function expression is required')
    # Expressions come from checked-in tests, never application/user content.
    # Embed a function literal instead of eval(), including on CSP-hardened pages.
    state = page.evaluate_handle(f"""arg => {{
        const predicate = ({expression});
        if (typeof predicate !== 'function') throw new TypeError('A predicate function is required');
        return {{predicate, arg, pending:false, value:false, failed:false, error:''}};
    }}""", arg)
    try:
        result = page.wait_for_function(_POLL, arg=state, polling=interval, timeout=timeout)
        try:
            if result.json_value() is not True:
                raise AssertionError('Async browser predicate did not resolve to true')
        finally:
            result.dispose()
    finally:
        state.dispose()
