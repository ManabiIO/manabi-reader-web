"""Encoded-media qualification contracts only; these tests do not run ASR."""
import importlib.util
from pathlib import Path
import unittest

from encoded_asr_fixture import compose_pcm, OFFSETS, RATE

spec = importlib.util.spec_from_file_location('encoded_asr_gate', Path(__file__).with_name('encoded-asr.py'))
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)


class EncodedFixtureTest(unittest.TestCase):
    def test_composition_preserves_sample_bytes_absolute_times_and_gap(self):
        pcm = b'\x12\x34' * RATE
        cues = [{'start': 0.1, 'end': 0.9, 'text': '日本語'}]
        out, expected = compose_pcm(pcm, cues)
        self.assertEqual(out[:len(pcm)], pcm)
        self.assertEqual(out[OFFSETS[1] * RATE * 2:], pcm)
        self.assertEqual(out[len(pcm):OFFSETS[1] * RATE * 2], b'\0' * ((OFFSETS[1] - 1) * RATE * 2))
        self.assertEqual(expected, [cues[0], {'start': 30.1, 'end': 30.9, 'text': '日本語'}])
        self.assertEqual(cues, [{'start': 0.1, 'end': 0.9, 'text': '日本語'}])

    def test_oversized_empty_and_partial_sample_inputs_fail(self):
        for pcm in [b'', b'a', b'\0\0' * (RATE * 25 + 1), None]:
            with self.subTest(pcm_type=type(pcm)), self.assertRaises(ValueError):
                compose_pcm(pcm, [{'start': 0, 'end': 1, 'text': 'test'}])

    def test_reference_must_fit_audio(self):
        for cues in [[], [{'start': -1, 'end': 1}], [{'start': 0, 'end': 2}], [{'start': 1, 'end': 1}]]:
            with self.subTest(cues=cues), self.assertRaises(ValueError):
                compose_pcm(b'\0\0' * RATE, cues)


class EncodedRangeTest(unittest.TestCase):
    def test_exact_inclusive_http_range_becomes_exclusive_source_range(self):
        self.assertEqual(gate.byte_range('bytes=0-99', 100), (0, 100))
        self.assertEqual(gate.byte_range('bytes=99-99', 100), (99, 100))

    def test_ambiguous_invalid_and_oversized_ranges_fail(self):
        for header, size in [(None, 100), ('bytes=0-', 100), ('bytes=-10', 100),
                             ('bytes=0-0,1-1', 100), ('bytes=9-1', 100),
                             ('bytes=0-100', 100), ('bytes=0-4194304', 5000000)]:
            with self.subTest(header=header), self.assertRaises(ValueError):
                gate.byte_range(header, size)


class EncodedQualityTest(unittest.TestCase):
    def test_valid_complete_result_records_exact_edit_count(self):
        result = {'phase': 'complete', 'track': {'cues': [{'text': '今日は、本を読みます。'}]}}
        self.assertEqual(gate.assess(result, '今日は本を読みます。', .35),
                         {'edits': 0, 'referenceCharacters': 9, 'characterErrorRate': 0})

    def test_partial_failed_or_empty_result_cannot_qualify(self):
        for result in [None, {}, {'phase': 'paused'}, {'phase': 'complete', 'track': {'cues': []}}]:
            with self.subTest(result=result), self.assertRaises(ValueError):
                gate.assess(result, '日本語', .35)

    def test_bad_recognition_stays_a_failure(self):
        with self.assertRaises(AssertionError):
            gate.assess({'phase': 'complete', 'track': {'cues': [{'text': '違います'}]}}, '日本語', .35)

    def test_disabled_threshold_and_empty_reference_fail(self):
        good = {'phase': 'complete', 'track': {'cues': [{'text': '日本語'}]}}
        for limit in [float('nan'), float('inf'), True, -1, 2]:
            with self.subTest(limit=limit), self.assertRaises(ValueError):
                gate.assess(good, '日本語', limit)
        with self.assertRaises(ValueError):
            gate.assess(good, '！', .35)


if __name__ == '__main__':
    unittest.main()
