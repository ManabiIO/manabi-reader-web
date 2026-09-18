"""Create real nested exported-book ZIPs without using any Reader storage fake."""
import io
import json
import pathlib
import sys
import zipfile

root=pathlib.Path(sys.argv[1]);root.mkdir(parents=True,exist_ok=True)
def archive(entries):
    result=io.BytesIO()
    with zipfile.ZipFile(result,'w',zipfile.ZIP_DEFLATED) as z:
        for name,data in entries.items():z.writestr(name,data)
    return result.getvalue()
def stored(title,html=None):
    return archive({'staticdata.json':json.dumps({'title':title,
        'elementHtml':html or '<div id="backup1"><h1>復元された本</h1><p><ruby>猫<rt>ねこ</rt></ruby>と日本語。</p></div>',
        'styleSheet':'ruby{ruby-position:over}','language':'ja',
        'sections':[{'reference':'backup1','charactersWeight':1,'startCharacter':0,'characters':20}]},ensure_ascii=False)})
name='bookdata_1_6_20_100_0.zip'
(root/'backup-valid.zip').write_bytes(archive({'E2E Backup %2F 日本語/'+name:stored('E2E Backup / 日本語')}))
(root/'backup-invalid.zip').write_bytes(archive({'E2E Invalid Backup/'+name:archive({'staticdata.json':'{"title":42,"elementHtml":"x"}'})}))
(root/'backup-traversal.zip').write_bytes(archive({'../escape':'not allowed'}))
(root/'backup-nested-limit.zip').write_bytes(archive({'E2E Large Backup/'+name:stored('E2E Large Backup','x'*(17*1024*1024))}))
(root/'backup-cancel.zip').write_bytes(archive({f'E2E Cancel {i}/'+name:stored(f'E2E Cancel {i}','<div><p>'+('復元テスト。'*30000)+'</p></div>') for i in range(40)}))
(root/'backup-retry.zip').write_bytes(archive({'E2E Backup Retry/'+name:stored('E2E Backup Retry')}))
