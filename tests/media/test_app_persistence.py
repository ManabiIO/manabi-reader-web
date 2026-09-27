"""The exact application assertion against scripted snapshots, not native IDB.

Native IndexedDB and reload acceptance remain in app-browser.py. This test keeps
its assertion from accepting wrong content just because a temporary ID remapped.
"""
import ast
import copy
import json
from pathlib import Path
import subprocess
import unittest

APP = Path(__file__).with_name('app-browser.py')
TREE = ast.parse(APP.read_text())
PREDICATE = next(ast.literal_eval(node.value) for node in TREE.body
                 if isinstance(node, ast.Assign) and any(
                     isinstance(target, ast.Name) and target.id == 'PERSISTED_SELECTION'
                     for target in node.targets))
KEY = 'content:' + 'a' * 64
ID = '11111111-1111-4111-8111-111111111111'
EXPECTED = {'label': 'ja · video.ja.srt', 'language': 'ja',
            'cues': [{'start': 0, 'end': 4, 'text': 'こんにちは。'}]}


def snapshot():
    return {
        'primary': ID, 'local': [{'open': True}],
        'records': [
            {'scope': 'guest', 'kind': 'video_track', 'id': ID, 'mediaKey': KEY,
             'payload': {'track': {'id': ID, 'mediaKey': KEY, 'complete': True,
                                  'origin': 'sidecar', 'language': 'ja', 'label': EXPECTED['label']},
                         'pages': [{'id': ID + '/p/0'}]}},
            {'scope': 'guest', 'kind': 'video_resume', 'id': KEY, 'mediaKey': KEY,
             'payload': {'primary': ID}},
            {'scope': 'guest', 'kind': 'video_chunk', 'id': ID + '/p/0', 'mediaKey': KEY,
             'payload': {'trackId': ID, 'index': 0, 'cues': copy.deepcopy(EXPECTED['cues'])}}
        ]
    }


def run(cases):
    program = '''import {readFileSync} from 'node:fs';
const predicate = (''' + PREDICATE + ''');
const {cases,expected} = JSON.parse(readFileSync(0,'utf8'));
const results=[];
for (const data of cases) {
    let closed=0;
    const request=(value,failed=false)=>{
        const r={result:value,error:Error('storage read failed')};
        queueMicrotask(()=>failed ? r.onerror() : r.onsuccess());
        return r;
    };
    globalThis.document={querySelector:()=>({value:data.primary})};
    globalThis.indexedDB={open:()=>request({
        transaction:()=>({objectStore:name=>({getAll:()=>request(data[name],data.fail===name)})}),
        close(){closed++;}
    })};
    try {results.push({value:await predicate(expected),closed});}
    catch(error){results.push({error:error.message,closed});}
}
console.log(JSON.stringify(results));
'''
    result = subprocess.run(['node', '--input-type=module', '-e', program],
                            input=json.dumps({'cases': cases, 'expected': EXPECTED}),
                            text=True, capture_output=True, check=True, timeout=10)
    return json.loads(result.stdout)


class PersistedSelectionTest(unittest.TestCase):
    def test_verified_id_passes_but_unpublished_temporary_id_does_not(self):
        canonical = snapshot()
        temporary = copy.deepcopy(canonical)
        temporary['primary'] = '22222222-2222-4222-8222-222222222222'
        self.assertEqual(run([canonical, temporary]),
                         [{'value': True, 'closed': 1}, {'value': False, 'closed': 1}])

    def test_wrong_content_or_wrong_persistence_cannot_satisfy_the_assertion(self):
        variants = []
        def changed():
            value = snapshot()
            variants.append(value)
            return value
        changed()['records'][1]['payload']['primary'] = 'temporary'
        changed()['records'][0]['payload']['track']['language'] = 'en'
        changed()['records'][0]['payload']['track']['label'] = 'ja · other.srt'
        changed()['records'][0]['payload']['track']['complete'] = False
        changed()['records'][0]['scope'] = 'account:another'
        changed()['records'][1]['mediaKey'] = 'content:' + 'b' * 64
        changed()['records'][2]['payload']['cues'][0]['text'] = '違う字幕'
        changed()['records'][2]['payload']['cues'][0]['start'] = 1
        changed()['records'][2]['payload']['trackId'] = 'other'
        changed()['records'].pop()
        changed()['local'][0]['open'] = False
        self.assertEqual(run(variants), [{'value': False, 'closed': 1}] * len(variants))

    def test_read_failure_propagates_and_closes_the_connection(self):
        value = snapshot()
        value['fail'] = 'records'
        self.assertEqual(run([value]), [{'error': 'storage read failed', 'closed': 1}])


if __name__ == '__main__':
    unittest.main()
