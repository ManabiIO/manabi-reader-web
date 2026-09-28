"""Real-ASR gate input validation only; no inference or recognizer double runs here."""
import importlib.util
import json
import pathlib
import tempfile
import unittest
ROOT=pathlib.Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('asr_input_gate',ROOT/'tests/media/asr.py')
asr=importlib.util.module_from_spec(spec);spec.loader.exec_module(asr)

class ASRInputTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.path=pathlib.Path(self.temp.name)
        import hashlib
        names=['speech.wav','video.mp4','embedded.mp4','embedded.mkv','embedded-ass.mkv','video.ja.srt','video.es.srt']
        for name in names:(self.path/name).write_bytes(b'input-validation double, not speech')
        self.manifest={'schemaVersion':2,'language':'ja','fingerprint':'a'*64,'duration':5,'cues':[{'start':0,'end':2,'text':'123'},{'start':3,'end':4,'text':'二番目です。'}],'engine':{'name':'open-jtalk','language':'ja-JP'},'files':{name:hashlib.sha256((self.path/name).read_bytes()).hexdigest() for name in names}}
        self.write()
    def write(self): (self.path/'manifest.json').write_text(json.dumps(self.manifest))
    def test_threshold_cannot_be_disabled_with_nan_or_infinity(self):
        for value in [float('nan'),float('inf'),-1,2,True]:
            with self.assertRaises(ValueError):asr.valid_cer(value)
        self.assertEqual(asr.valid_cer(.35),.35)
    def test_manifest_expected_text_retains_numeric_utterances(self):
        self.assertEqual(asr.fixture_metadata(self.path,'ja')['cues'][0]['text'],'123')
    def test_wrong_voice_language_rejected(self):
        self.manifest['engine']['language']='en-US';self.write()
        with self.assertRaisesRegex(ValueError,'voice'):asr.fixture_metadata(self.path,'ja')
    def test_changed_audio_does_not_inherit_old_fixture_provenance(self):
        (self.path/'speech.wav').write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError,'checksums'):asr.fixture_metadata(self.path,'ja')
    def test_wrong_requested_language_rejected(self):
        with self.assertRaises(ValueError):asr.fixture_metadata(self.path,'en')
    def test_no_arbitrary_engine_attribution(self):
        self.manifest['engine']['name']='unverified';self.write()
        with self.assertRaisesRegex(ValueError,'voice'):asr.fixture_metadata(self.path,'ja')

    def test_pinned_kokoro_fixture_rejects_wrong_language_before_recognition(self):
        with self.assertRaisesRegex(ValueError,'Japanese'):
            asr.natural_kokoro_fixture(self.path,'en')

    def test_pinned_kokoro_fixture_rejects_substituted_audio(self):
        with self.assertRaisesRegex(ValueError,'hash'):
            asr.natural_kokoro_fixture(self.path,'ja')

class StreamingMetricsTest(unittest.TestCase):
    def test_real_callback_latencies_are_required(self):
        good=dict(inferenceSeconds=10,partialUpdates=4,firstOutputSeconds=2,firstPreviewCueSeconds=3,cues=[{'text':'one'},{'text':'two'}])
        asr.validate_streaming_metrics(good)
        for update in [dict(partialUpdates=0),dict(partialUpdates=True),dict(firstOutputSeconds=None),
                       dict(firstPreviewCueSeconds=float('nan')),dict(firstPreviewCueSeconds=11),
                       dict(firstPreviewCueSeconds=1),dict(inferenceSeconds=0)]:
            with self.subTest(update=update),self.assertRaises(ValueError):
                asr.validate_streaming_metrics({**good,**update})

    def test_single_cue_can_have_callbacks_without_a_structurally_complete_preview(self):
        # The end timestamp remains ambiguous until EOS; no invented preview latency.
        asr.validate_streaming_metrics(dict(inferenceSeconds=10,partialUpdates=4,
            firstOutputSeconds=2,firstPreviewCueSeconds=None,cues=[{'text':'Only one cue.'}]))

    def test_empty_or_missing_cues_cannot_excuse_missing_preview_evidence(self):
        for cues in (None, [], 'one'):
            with self.subTest(cues=cues),self.assertRaises(ValueError):
                asr.validate_streaming_metrics(dict(inferenceSeconds=10,partialUpdates=4,
                    firstOutputSeconds=2,firstPreviewCueSeconds=None,cues=cues))

    def test_multi_cue_result_requires_preview_and_missing_is_not_explicit_null(self):
        one=dict(inferenceSeconds=10,partialUpdates=4,firstOutputSeconds=2,cues=[{'text':'one'}])
        with self.assertRaises(ValueError):asr.validate_streaming_metrics(one)
        with self.assertRaises(ValueError):
            asr.validate_streaming_metrics({**one,'firstPreviewCueSeconds':None,'cues':[{},{}]})

if __name__=='__main__':unittest.main()
