"""Physical fixture identities from the actual export; native browser APIs stay untouched.

Only explicit test expressions pass through reader_fixture. It qualifies their
storage operands and navigation prefixes, never app code, archive data, native
API implementations, object-store names, API endpoints or upstream TTU contexts.
"""
from functools import lru_cache
import json
import os
from pathlib import Path
import re
from reader_edition_output import reader_edition_output

DATABASES = ('books', 'manabi-reader-integrations', 'manabi-reader-appearance',
             'manabi-library-previews', 'manabi-whispersync-v1', 'manabi-media-v1')
OPERAND = r"(?:'(?:\\.|[^'\\])*'|\"(?:\\.|[^\"\\])*\"|[A-Za-z_$][\w$]*)"


def reader_output_directory(*, require_export=False):
    # Diagnostic unit tests import the browser classes before exporting an app.
    # Only the implicit default may be computed early. An explicit selection
    # must never silently fall back to that default or bypass path validation.
    default = Path(__file__).resolve().parents[2] / 'apps/web/build'
    if require_export or 'READER_EDITION_TEST_OUTPUT' in os.environ:
        return reader_edition_output(default)
    return default


@lru_cache(maxsize=1)
def reader_product():
    value = json.loads((reader_output_directory(require_export=True) / 'reader-product.json').read_text())
    if (value.get('schema') != 1 or value.get('edition') not in ('manabi', 'manabitan')
            or not isinstance(value.get('storageNamespace'), str)
            or not re.fullmatch(r'[a-z][a-z0-9-]*', value['storageNamespace'])
            or not isinstance(value.get('basePath'), str)
            or not re.fullmatch(r'(?:/[A-Za-z0-9_-]+)*', value['basePath'])
            or not isinstance(value.get('name'), str) or not value['name']):
        raise ValueError('Build a valid Reader product before browser acceptance.')
    return value


def reader_fixture_path(source, product=None):
    product = reader_product() if product is None else product
    # Backend API routes retain their API identity across frontend editions.
    return re.sub(r'(?<!/api)/reader-web(?=/|$|[\'"?#])', lambda _: product['basePath'], source)


def reader_fixture(source, product=None):
    product = reader_product() if product is None else product
    prefix = json.dumps(product['storageNamespace'] + ':')
    source = reader_fixture_path(source, product)
    # Operands are literals or plain identifiers; no expression is evaluated or
    # browser API replaced here. Unknown complex operands fail visibly in tests.
    source = re.sub(r'(\blocalStorage\.(?:getItem|setItem|removeItem)\(\s*)(' + OPERAND + r')(?=\s*[,\)])',
                    lambda m: m[1] + prefix + ' + (' + m[2] + ')', source)

    def database(m):
        operand = m[2]
        if operand.startswith(('"', "'")):
            logical = operand[1:-1]
            return m[1] + (json.dumps(product['storageNamespace'] + ':' + logical)
                           if logical in DATABASES else operand)
        return m[1] + '(' + json.dumps(DATABASES) + '.includes(' + operand + ') ? ' + prefix + ' + ' + operand + ' : ' + operand + ')'

    source = re.sub(r'(\bindexedDB\.open\(\s*)(' + OPERAND + r')(?=\s*[,\)])', database, source)
    owners = r'(?:[A-Za-z_$][\w$]*\.transaction\.db|database|db)'
    source = re.sub(r'(\b' + owners + r'\.name\s*={2,3}\s*)([\'"])([^\'"]+)\2',
                    lambda m: m[1] + json.dumps(product['storageNamespace'] + ':' + m[3])
                    if m[3] in DATABASES else m[0], source)
    # Cache-open failure injection must target the same actual font cache.
    source = re.sub(r'([\'"])ttu-userfonts\1', lambda _: json.dumps(product['storageNamespace'] + ':ttu-userfonts'), source)
    if 'Storage.prototype.setItem' in source:
        source = re.sub(r'(\bkey\s*={2,3}\s*)([\'"])(writingMode)\2',
                        lambda m: m[1] + json.dumps(product['storageNamespace'] + ':' + m[3]), source)
    return source


def reader_product_name():
    return reader_product()['name']


def reader_storage_name(logical_name, product=None):
    """Pass a physical identity as a Playwright argument, without rewriting JS."""
    product = reader_product() if product is None else product
    if not isinstance(logical_name, str) or not logical_name:
        raise ValueError('A fixture storage identity needs a nonempty logical name.')
    return product['storageNamespace'] + ':' + logical_name


def reader_init_script(function, arguments):
    """Bind explicit JSON operands for add_init_script, which has no arg API."""
    return '(' + function + ')(' + json.dumps(arguments, ensure_ascii=True) + ');'
