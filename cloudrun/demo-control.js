import { randomUUID } from 'node:crypto';
const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
export function settings(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail('Invalid run settings.');
  const scenario = input.scenario ?? 'valid';
  if (!['valid', 'mixed', 'rejected', 'sequence'].includes(scenario)) throw fail('Unknown scenario.');
  const result = { scenario };
  for (const [key, def, min, max] of [['file_count',30,1,100],['detail_count',20,1,1000],['interval_seconds',10,10,3600]]) {
    const value = input[key] ?? def;
    if (!Number.isSafeInteger(value) || value < min || value > max) throw fail(`${key} must be an integer between ${min} and ${max}.`);
    result[key] = value;
  }
  return result;
}
export function uuid(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw fail('Invalid run ID.');
  return value;
}
export function pagination(url) {
  const limit = Number(url.searchParams.get('limit') ?? 25), offset = Number(url.searchParams.get('offset') ?? 0);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || !Number.isSafeInteger(offset) || offset < 0 || offset > 100000) throw fail('Invalid pagination.');
  return [limit, offset];
}
export async function transaction(pool, fn) {
  if (!pool) throw fail('Demo database is not configured.', 503);
  const c = await pool.connect();
  try { await c.query('BEGIN'); const value = await fn(c); await c.query('COMMIT'); return value; }
  catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
}
export async function startRun(c, input, actor, key) {
  const config = settings(input);
  if (typeof key !== 'string' || key.length < 8 || key.length > 128) throw fail('An idempotency key of 8–128 characters is required.');
  await c.query("SELECT pg_advisory_xact_lock(892013)");
  const existing = await c.query('SELECT * FROM demo.runs WHERE idempotency_key=$1', [key]);
  if (existing.rows.length) {
    const r = existing.rows[0];
    // Omitted settings reuse the original run's defaults, including across a
    // deployment that changes those defaults. Explicit changes still conflict.
    if (Object.entries(config).some(([k,v]) => Object.hasOwn(input,k) && input[k] != null && r[k] !== v)) throw fail('Idempotency key already used for different settings.',409);
    return { run: r, replayed: true };
  }
  const active = await c.query("SELECT id FROM demo.runs WHERE generation_status IN ('QUEUED','RUNNING') LIMIT 1");
  if (active.rows.length) throw fail(`Run ${active.rows[0].id} is already generating.`,409);
  const r = await c.query('INSERT INTO demo.runs(id,idempotency_key,requested_by,scenario,file_count,detail_count,interval_seconds) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',[randomUUID(),key,actor,...Object.values(config)]);
  await c.query("INSERT INTO demo.events(run_id,stage) VALUES($1,'QUEUED')",[r.rows[0].id]);
  return { run:r.rows[0], replayed:false };
}
export async function stopRun(c,id) {
  uuid(id);
  const r = await c.query("UPDATE demo.runs SET stop_requested=true,updated_at=now() WHERE id=$1 RETURNING *",[id]);
  if (!r.rows.length) throw fail('Run not found.',404);
  await c.query("INSERT INTO demo.events(run_id,stage) VALUES($1,'STOP_REQUESTED')",[id]);
  return {run:r.rows[0]};
}
export async function overview(pool,id) {
  uuid(id);
  const r=await pool.query(`SELECT r.*, (SELECT jsonb_object_agg(s.delivery_status,s.n) FROM (SELECT delivery_status,count(*) n FROM demo.files WHERE run_id=r.id GROUP BY delivery_status) s) AS delivery_totals FROM demo.runs r WHERE id=$1`,[id]);
  if (!r.rows.length) throw fail('Run not found.',404);
  return {run:r.rows[0], checkedAt:new Date().toISOString()};
}
export async function routeDemo(pool,req,url,body,session) {
  if (!pool) throw fail('Demo database is not configured.',503);
  const base='/api/demo/runs', path=url.pathname;
  if(path===base && req.method==='POST') return transaction(pool,c=>startRun(c,body,session.email||session.sid,body.idempotency_key));
  if(path===base && req.method==='GET') {
    const page=pagination(url);
    const [r,h]=await Promise.all([pool.query('SELECT * FROM demo.runs ORDER BY created_at DESC LIMIT $1 OFFSET $2',page),pool.query('SELECT * FROM demo.worker_status')]);
    return {runs:r.rows,workers:h.rows,limit:page[0],offset:page[1],checkedAt:new Date().toISOString()};
  }
  const match=path.match(/^\/api\/demo\/runs\/([^/]+)(?:\/(stop|files|rows|exceptions|artifacts|events))?$/);
  if(!match) return null;
  const [,id,section]=match; uuid(id);
  if(section==='stop' && req.method==='POST') return transaction(pool,c=>stopRun(c,id));
  if(req.method!=='GET') throw fail('Method not allowed.',405);
  if(!section) return overview(pool,id);
  const [limit,offset]=pagination(url); let result;
  if(section==='files') result=await pool.query('SELECT file_id,run_id,ordinal,source_file,scenario,generated_at,processing_status,delivery_status,pg_match,sftp_match,duplicates,evidence,checked_at FROM demo.files WHERE run_id=$1 ORDER BY ordinal LIMIT $2 OFFSET $3',[id,limit,offset]);
  if(section==='events') result=await pool.query('SELECT * FROM demo.events WHERE run_id=$1 ORDER BY id DESC LIMIT $2 OFFSET $3',[id,limit,offset]);
  if(section==='rows'||section==='exceptions') {
    const table=section==='rows'?'bayno_processed_v2':'bayno_exceptions_v2';
    result=await pool.query(`SELECT * FROM public.${table} WHERE run_id=$1 ORDER BY ${section==='rows'?'carr,flt_nbr,first_leg_flt_dt,sched_dep_tm,dep_airpt,':'source_file,'}record_id LIMIT $2 OFFSET $3`,[id,limit,offset]);
  }
  if(section==='artifacts') result=await pool.query('SELECT * FROM demo.artifacts WHERE $1=ANY(run_ids) ORDER BY path LIMIT $2 OFFSET $3',[id,limit,offset]);
  return {rows:result.rows,source:section==='artifacts'?'SFTP files observed by VM verifier':section,checkedAt:new Date().toISOString(),limit,offset};
}
