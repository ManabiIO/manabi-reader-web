"""Enter the installed shell through a normal document before going offline.

The production worker deliberately does not claim existing clients. Activation
can finish after a test's reader navigation, so waiting for controllerchange on
that uncontrolled document would never finish without a subsequent navigation.
"""

READY = '''async ({scope, timeout}) => {
  let timer;
  try {
    const registration = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(
          'Offline shell did not activate within ' + timeout + 'ms for ' + scope)), timeout);
      })
    ]);
    if (registration.scope !== scope)
      throw new Error('Unexpected offline shell scope: ' + registration.scope);
    return Boolean(navigator.serviceWorker.controller);
  } finally { clearTimeout(timer); }
}'''

CONTROLLED = '''scope => {
  const controller = navigator.serviceWorker.controller;
  return controller?.state === 'activated' &&
    controller.scriptURL === new URL('service-worker.js', scope).href;
}'''


def enter_offline_shell(page, scope, timeout=20000):
    """Wait for activation, hand off once if needed, and require real control.

    This is one normal online navigation, not a retry of a failed assertion.
    Readiness and control failures propagate without retrying or going offline.
    """
    controlled = page.evaluate(READY, {'scope': scope, 'timeout': timeout})
    if not controlled:
        page.reload(timeout=timeout)
    page.wait_for_function(CONTROLLED, arg=scope, timeout=timeout)
