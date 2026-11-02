import {test} from 'node:test';
import assert from 'node:assert/strict';
import {settings,startRun} from '../demo-control.js';

test('default demo is 30 files at 10-second intervals with 20 details',()=>{
  assert.deepEqual(settings(),{scenario:'valid',file_count:30,detail_count:20,interval_seconds:10});
  assert.equal(settings().file_count*settings().interval_seconds,5*60);
});
test('start retries retain original defaults across the cadence deployment',async()=>{
  const original={id:'legacy-run',scenario:'valid',file_count:10,detail_count:20,interval_seconds:60};
  const c={query:async sql=>({rows:sql.includes('idempotency_key')?[original]:[]})};
  assert.deepEqual(await startRun(c,{file_count:10,detail_count:20},'test-session','legacy-key'),{run:original,replayed:true});
  await assert.rejects(startRun(c,{file_count:30,interval_seconds:10},'test-session','legacy-key'),e=>e.statusCode===409);
});
test('cadence accepts the new minimum and historical runs while rejecting invalid settings',()=>{
  assert.equal(settings({interval_seconds:10}).interval_seconds,10);
  assert.equal(settings({interval_seconds:60,file_count:10}).interval_seconds,60);
  for(const value of [0,1,9,10.5,3601,'10'])assert.throws(()=>settings({interval_seconds:value}),/interval_seconds/);
  assert.throws(()=>settings({file_count:101}));
});
