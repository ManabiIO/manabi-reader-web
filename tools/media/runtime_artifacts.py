"""Local runtime build publication; this checks files, not inference correctness.

Both modes are staged and hashed before either installed mode is replaced. Local
publication is serialized; caught rename failures restore the previous pair.
The two directory renames are NOT an atomic live-deployment primitive. A process
kill may leave the named recovery directory beside the output root.
"""
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import tempfile

MODES = ('single', 'threaded')
REQUIRED = {'moss.mjs', 'moss.wasm', 'LICENSE-MOSS.txt', 'LICENSE-GGML.txt'}


def check_path(path):
    path = Path(path).absolute()
    for part in [*reversed(path.parents), path]:
        if part.is_symlink():
            raise ValueError(f'Runtime path must not contain a symlink: {part}')
    return path


def digest(path):
    result = hashlib.sha256()
    with Path(path).open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            result.update(chunk)
    return result.hexdigest()


def validate_mode(path, mode, engine_revision, ggml_revision):
    path = check_path(path)
    manifest = path / 'build.json'
    if not manifest.is_file() or manifest.is_symlink() or manifest.stat().st_size > 65536:
        raise ValueError('Missing or invalid runtime build manifest')
    value = json.loads(manifest.read_text())
    if (type(value) is not dict or type(value.get('version')) is not int or value.get('version') != 1 or value.get('mode') != mode or
            value.get('engineRevision') != engine_revision or value.get('ggmlCommit') != ggml_revision):
        raise ValueError('Runtime mode or source revisions do not match this build')
    hashes = value.get('files')
    if type(hashes) is not dict or not REQUIRED <= hashes.keys() or len(hashes) > 32:
        raise ValueError('Incomplete runtime outputs')
    if {item.name for item in path.iterdir()} != set(hashes) | {'build.json'}:
        raise ValueError('Unexpected runtime output')
    for name, expected in hashes.items():
        if name not in REQUIRED and not re.fullmatch(r'moss[\w.-]*\.worker\.(?:m?js)', name):
            raise ValueError('Unsafe or unsupported runtime filename')
        item = path / name
        if (item.is_symlink() or not item.is_file() or not item.stat().st_size or
                type(expected) is not str or not re.fullmatch(r'[a-f0-9]{64}', expected) or digest(item) != expected):
            raise ValueError('Runtime output checksum or type mismatch')
    with (path / 'moss.wasm').open('rb') as binary:
        if binary.read(8) != b'\0asm\x01\0\0\0':
            raise ValueError('Runtime output is not a WebAssembly binary')
    return value


@contextmanager
def publish_lock(root):
    """Linux/macOS build tooling; the kernel releases the lock on process exit."""
    import fcntl
    check_path(root)
    root.mkdir(parents=True, exist_ok=True)
    name = root / '.publish.lock'
    descriptor = os.open(name, os.O_CREAT | os.O_RDWR | getattr(os, 'O_NOFOLLOW', 0), 0o600)
    try:
        fcntl.flock(descriptor, fcntl.LOCK_EX)
        yield
    finally:
        os.close(descriptor)


def publish_pair(staged, destination, engine_revision, ggml_revision):
    staged, destination = check_path(staged), check_path(destination)
    for mode in MODES:
        validate_mode(staged / mode, mode, engine_revision, ggml_revision)
    destination.parent.mkdir(parents=True, exist_ok=True)
    # Same-filesystem temporary directories keep the rename stage independent of
    # where the compiler cache lives. Preserve README/other root-level files.
    prepared = Path(tempfile.mkdtemp(prefix='.moss-runtime-', dir=destination.parent))
    preserve = False
    try:
        for mode in MODES:
            shutil.copytree(staged / mode, prepared / mode)
            validate_mode(prepared / mode, mode, engine_revision, ggml_revision)
        with publish_lock(destination.parent / '.moss-publication-lock'):
            check_path(destination)
            destination.mkdir(exist_ok=True)
            for mode in MODES:
                target = check_path(destination / mode)
                if target.exists() and not target.is_dir():
                    raise ValueError('Installed runtime output is not a directory')
                if target.exists() and any(item.is_symlink() for item in target.rglob('*')):
                    raise ValueError('Installed runtime contains symlinked files')
            moved, installed = [], []
            try:
                for mode in MODES:
                    target = destination / mode
                    if target.exists():
                        os.replace(target, prepared / ('previous-' + mode))
                        moved.append(mode)
                for mode in MODES:
                    os.replace(prepared / mode, destination / mode)
                    installed.append(mode)
            except BaseException:
                try:
                    for mode in installed:
                        shutil.rmtree(destination / mode)
                    for mode in moved:
                        os.replace(prepared / ('previous-' + mode), destination / mode)
                except BaseException as recovery:
                    preserve = True
                    raise RuntimeError(f'Runtime recovery needs inspection; previous files retained at {prepared}') from recovery
                raise
    finally:
        if not preserve:
            shutil.rmtree(prepared)
