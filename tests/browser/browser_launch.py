"""Project-owned Playwright launch options; never patch installed browser tools."""
import sys


def launch_options(engine='chromium', **options):
    if sys.platform != 'darwin' or engine != 'chromium':
        return options
    args = list(options.get('args', ()))
    prefix = '--disable-features='
    features = []
    remaining = []
    for arg in args:
        if arg.startswith(prefix):
            features.extend(arg[len(prefix):].split(','))
        else:
            remaining.append(arg)
    features.append('MacAppCodeSignClone')
    remaining.append(prefix + ','.join(dict.fromkeys(filter(None, features))))
    return {**options, 'args': remaining}
