import test from 'node:test';import assert from 'node:assert/strict';
import {audioLanguage,chooseTranscriptionAudio} from '../../.cache/media-test-build/audio-selection.js';
import {language} from '../../.cache/media-test-build/contracts.js';
const a=(id,language,decodable=true,extra={})=>({id,language,decodable,name:null,...extra});
test('Japanese selection does not accidentally choose the first English dub',()=>assert.equal(chooseTranscriptionAudio([a(1,'eng'),a(2,'jpn')],'ja').id,2));
test('exact language variant precedes a different regional variant',()=>assert.equal(chooseTranscriptionAudio([a(1,'en-GB'),a(2,'en-US')],'en-US').id,2));
test('multiple same-language streams require a choice instead of arbitrary commentary audio',()=>assert.equal(chooseTranscriptionAudio([a(1,'ja'),a(2,'ja')],'ja'),undefined));
test('unsupported target codecs and known wrong languages are skipped',()=>assert.equal(chooseTranscriptionAudio([a(1,'ja',false),a(2,'en')],'ja'),undefined));
test('one untagged stream permits the explicitly requested user language',()=>assert.equal(chooseTranscriptionAudio([a(1,'und')],'ja').id,1));
test('multiple untagged streams remain ambiguous',()=>assert.equal(chooseTranscriptionAudio([a(1,'und'),a(2,'und')],'ja'),undefined));

test('unique ordinary Japanese audio wins over a Japanese commentary track',()=>assert.equal(
 chooseTranscriptionAudio([a(1,'ja',true,{commentary:true}),a(2,'ja')],'ja').id,2));
test('audio-description track is never auto-selected even when it is the only target-language stream',()=>assert.equal(
 chooseTranscriptionAudio([a(1,'ja',true,{visuallyImpaired:true})],'ja'),undefined));
test('one primary target-language stream disambiguates multiple ordinary dubs',()=>assert.equal(
 chooseTranscriptionAudio([a(1,'ja'),a(2,'ja',true,{primary:true})],'ja').id,2));
test('one original-language target disambiguates multiple ordinary streams when no primary exists',()=>assert.equal(
 chooseTranscriptionAudio([a(1,'ja'),a(2,'ja',true,{original:true})],'ja').id,2));
test('multiple preferred target streams stay ambiguous',()=>assert.equal(
 chooseTranscriptionAudio([a(1,'ja',true,{primary:true}),a(2,'ja',true,{primary:true})],'ja'),undefined));
test('one untagged commentary stream does not inherit the requested language automatically',()=>assert.equal(
 chooseTranscriptionAudio([a(1,'und',true,{commentary:true})],'ja'),undefined));
test('missing and malformed container language is explicitly unknown',()=>{assert.equal(audioLanguage(''), 'und');assert.equal(audioLanguage('not-a-language'), 'und');assert.equal(audioLanguage(null), 'und');});
for(const tag of ['ja','jpn','en-US','zh-Hant-TW','sl-rozaj-biske-1994','und'])test('portable language admits '+tag,()=>assert.ok(language(tag)));
for(const tag of ['en-US-US','en-Latn-Latn','en-foobar-FOOBAR','en-u-ca-japanese','ja-JP-','en-123-456','x-private'])test('portable language rejects '+tag,()=>assert.throws(()=>language(tag)));
