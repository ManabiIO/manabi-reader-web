"""Voice discovery uses explicit doubles; these are NOT Japanese ASR/quality results."""
import importlib.util
import array
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import wave

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('fixture_voice_generator', ROOT / 'tools/media/generate-fixtures.py')
generator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(generator)
tts = generator._voice_module

class VoiceSelectionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.binary = self.root / 'open_jtalk'; self.binary.write_bytes(b'controlled executable identity')
        self.dictionary = self.root / 'dictionary'; self.dictionary.mkdir()
        for name in tts.DICT_FILES: (self.dictionary/name).write_bytes(('controlled '+name).encode())
        self.voice = self.root / 'installed_japanese.htsvoice'
        self.voice.write_bytes(b'[GLOBAL]\nFULLCONTEXT_FORMAT:HTS_TTS_JPN\n[DATA]\ncontrolled voice bytes')
        self.addCleanup(patch.stopall)
        patch.object(tts.platform, 'system', return_value='Linux').start()
        patch.dict(os.environ, {}, clear=True).start()
    def linux(self):
        patch.object(tts.shutil, 'which', side_effect=lambda n: str(self.binary) if n=='open_jtalk' else None).start()
        patch.object(tts, 'DICT_PATHS', (str(self.dictionary),)).start()
        patch.object(tts, 'VOICE_PATHS', (str(self.root),)).start()
    def test_kyoko_preference_falls_back_to_installed_japanese_on_linux(self):
        self.linux(); voice=tts.select_voice('ja', 'Kyoko')
        self.assertEqual((voice.name, voice.language, voice.voice), ('open-jtalk','ja',str(self.voice)))
        self.assertEqual(voice.identity['voice']['name'], 'installed_japanese')
    def test_unavailable_preferred_voice_can_use_another_mac_japanese_voice(self):
        patch.object(tts.platform,'system',return_value='Darwin').start()
        patch.object(tts.shutil,'which',return_value=str(self.binary)).start()
        patch.object(tts,'output',return_value='Samantha en_US # English\nOtoya ja_JP # Japanese\n').start()
        voice=tts.select_voice('ja','Kyoko'); self.assertEqual(voice.voice,'Otoya')
    def test_never_falls_back_to_english_for_japanese(self):
        patch.object(tts.shutil,'which',side_effect=lambda n:str(self.binary) if n=='espeak' else None).start()
        patch.object(tts.importlib,'import_module',side_effect=ImportError('not installed')).start()
        patch.object(tts,'output',return_value='Pty Language Age/Gender VoiceName File\n 5 en-us M english-us en-us\n').start()
        with self.assertRaisesRegex(ValueError,'No installed ja'): tts.select_voice('ja','Kyoko')
    def test_espeak_ng_requires_explicit_japanese_voice_entry(self):
        patch.object(tts.shutil,'which',side_effect=lambda n:str(self.binary) if n=='espeak-ng' else None).start()
        patch.object(tts,'output',side_effect=lambda args:' 5 ja --/M Japanese jpx/ja\n' if '--voices' in args else 'eSpeak NG controlled-test').start()
        voice=tts.select_voice('ja','Kyoko',engine='espeak')
        self.assertEqual((voice.name,voice.voice,voice.language),('espeak-ng','ja','ja'))
    def test_wrong_language_hts_voice_is_rejected(self):
        self.linux(); self.voice.write_bytes(b'FULLCONTEXT_FORMAT:HTS_TTS_ENG\n')
        with self.assertRaisesRegex(ValueError,'Japanese'): tts.select_voice('ja',engine='open-jtalk')
    def test_missing_dictionary_is_not_generic_mecab_success(self):
        self.linux(); (self.dictionary/'sys.dic').unlink()
        with self.assertRaisesRegex(ValueError,'dictionary'): tts.select_voice('ja',engine='open-jtalk')
    def test_empty_dictionary_is_rejected(self):
        self.linux(); (self.dictionary/'sys.dic').write_bytes(b'')
        with self.assertRaisesRegex(ValueError,'dictionary'): tts.select_voice('ja',engine='open-jtalk')
    def test_incomplete_default_dictionary_does_not_hide_another_installed_dictionary(self):
        self.linux(); broken=self.root/'broken';broken.mkdir()
        patch.object(tts, 'DICT_PATHS', (str(broken),str(self.dictionary))).start()
        self.assertEqual(tts.select_voice('ja').dictionary,str(self.dictionary))
    def test_voice_change_changes_cache_identity(self):
        self.linux(); first=tts.select_voice('ja').identity
        self.voice.write_bytes(self.voice.read_bytes()+b'v2')
        self.assertNotEqual(first,tts.select_voice('ja').identity)
    def test_dictionary_change_changes_cache_identity(self):
        self.linux(); first=tts.select_voice('ja').identity
        (self.dictionary/'sys.dic').write_bytes(b'new dictionary bytes')
        self.assertNotEqual(first,tts.select_voice('ja').identity)
    def test_executable_change_changes_cache_identity(self):
        self.linux(); first=tts.select_voice('ja').identity
        self.binary.write_bytes(b'new executable bytes')
        self.assertNotEqual(first,tts.select_voice('ja').identity)
    def test_open_jtalk_text_is_utf8_stdin_not_shell_arguments(self):
        self.linux(); voice=tts.select_voice('ja'); destination=self.root/'result.wav'
        with patch.object(tts.subprocess,'run') as execute:
            voice.synthesize('今日は晴れです。',destination)
            args,kwargs=execute.call_args
            self.assertEqual(kwargs['input'],'今日は晴れです。\n')
            self.assertEqual(kwargs['encoding'],'utf-8')
            self.assertIn(str(destination),args[0]);self.assertNotIn('shell',kwargs)
    def test_pyopenjtalk_discovery_does_not_download_missing_dictionary(self):
        class Missing:
            OPEN_JTALK_DICT_DIR=b'/nonexistent/open-jtalk-dictionary'
        with patch.object(tts.importlib,'import_module',return_value=Missing):
            with self.assertRaisesRegex(ValueError,'pyopenjtalk'): tts.select_voice('ja',engine='pyopenjtalk')
    def test_unknown_engine_reports_failure_instead_of_silence(self):
        with self.assertRaises(ValueError): tts.select_voice('ja',engine='invalid')
    def test_unsupported_language_rejected(self):
        with self.assertRaises(ValueError): tts.select_voice('xxx')

class FixtureValidationTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)
        self.definition={'sampleRate':16000,'leadingSilence':.5,'sentenceGap':.5,'sentences':{'ja':['今日は晴れです。','明日は公園に行きます。']}}
    def wav(self, samples, channels=1, rate=16000):
        path=self.root/'sample.wav'
        with wave.open(str(path),'wb') as target:
            target.setnchannels(channels);target.setsampwidth(2);target.setframerate(rate)
            target.writeframes(array.array('h',samples).tobytes())
        return path
    def test_two_japanese_sentences_are_valid(self): generator.validate_spec(self.definition,'ja')
    def test_wrong_sentence_container_is_a_validation_error(self):
        for value in [None,[],True,'invalid']:
            with self.subTest(value=value):
                with self.assertRaises(ValueError): generator.validate_spec({**self.definition,'sentences':value},'ja')
    def test_single_sentence_rejected(self):
        self.definition['sentences']['ja']=['一行。']
        with self.assertRaises(ValueError): generator.validate_spec(self.definition,'ja')
    def test_silent_pcm_not_accepted_as_generated_speech(self):
        with self.assertRaisesRegex(ValueError,'silence'): generator.fixture_pcm(self.wav([0]*1600),16000)
    def test_signal_validation_not_a_speech_recognition_claim(self):
        path=self.wav([400,-400]*100)
        self.assertEqual(len(generator.fixture_pcm(path,16000)),400)
    def test_wrong_rate_and_channels_rejected(self):
        for opts in [{'rate':8000},{'channels':2}]:
            with self.assertRaises(ValueError): generator.fixture_pcm(self.wav([400,-400]*100,**opts),16000)
    def test_lock_path_traversal_rejected(self):
        with self.assertRaises(ValueError):
            with generator.fixture_lock(self.root,'../escape'): pass
    def test_lock_file_symlink_rejected(self):
        directory=self.root/'.locks';directory.mkdir();other=self.root/'other';other.write_text('safe')
        (directory/('a'*64+'.lock')).symlink_to(other)
        with self.assertRaises(OSError):
            with generator.fixture_lock(self.root,'a'*64): pass
        self.assertEqual(other.read_text(),'safe')
    def test_intervals_are_bounded_and_finite(self):
        for value in [True,-1,6,float('nan')]:
            with self.assertRaises(ValueError): generator.validate_spec({**self.definition,'sentenceGap':value},'ja')

if __name__=='__main__': unittest.main()
