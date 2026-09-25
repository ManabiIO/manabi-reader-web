/** Reproducible Node CPU microbenchmark; NOT MOSS or browser inference evidence.
 * Run after tools/media/test.mjs. Optionally compare an earlier compiled hash.js:
 * node tools/media/benchmark-hash.mjs --baseline /path/to/old/hash.mjs
 */
import {createHash} from 'node:crypto';
import {cpus,platform,arch} from 'node:os';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {Sha256} from '../../.cache/media-test-build/hash.js';
const args=process.argv.slice(2);if(args.length && (args.length!==2 || args[0]!=='--baseline'))throw Error('Usage: benchmark-hash.mjs [--baseline path]');
const implementations={current:Sha256};if(args.length)implementations.baseline=(await import(pathToFileURL(resolve(args[1])))).Sha256;
const block=Buffer.alloc(1024*1024);for(let i=0;i<block.length;i++)block[i]=(i*31+(i>>>8))&255;
const blocks=64,iterations=5,bytes=blocks*block.length;
const reference=createHash('sha256');for(let i=0;i<blocks;i++)reference.update(block);const expected=reference.digest('hex');
const execute=Impl=>{const hash=new Impl(),start=performance.now();for(let i=0;i<blocks;i++)hash.update(block);const digest=hash.hex();const milliseconds=performance.now()-start;if(digest!==expected)throw Error('Incorrect SHA-256 output');return milliseconds;};
for(const Impl of Object.values(implementations))execute(Impl);
const timings=Object.fromEntries(Object.keys(implementations).map(k=>[k,[]]));
for(let n=0;n<iterations;n++)for(const [name,Impl] of (n%2?Object.entries(implementations).reverse():Object.entries(implementations)))timings[name].push(execute(Impl));
const report={scope:'Node incremental SHA-256 only, not MOSS or browser performance',node:process.version,platform:platform(),arch:arch(),cpu:cpus()[0]?.model,bytes,iterations,sha256:expected,
 results:Object.fromEntries(Object.entries(timings).map(([name,ms])=>{const median=[...ms].sort((a,b)=>a-b)[Math.floor(ms.length/2)];return[name,{milliseconds:ms,medianMilliseconds:median,mebibytesPerSecond:bytes/2**20/(median/1000)}]}))};
if(report.results.baseline)report.speedup=report.results.baseline.medianMilliseconds/report.results.current.medianMilliseconds;
console.log(JSON.stringify(report,null,2));
