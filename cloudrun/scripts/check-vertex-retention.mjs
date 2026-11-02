import { execFileSync } from 'node:child_process';

const project = process.env.GOOGLE_CLOUD_PROJECT || 'my-rd-coe-demo-gen-ai';
const location = process.env.GOOGLE_CLOUD_LOCATION || 'asia-southeast1';
const model = process.env.GEMINI_MODEL || 'gemini-3.5-flash';
const token = execFileSync('gcloud', ['auth', 'print-access-token'], { encoding: 'utf8' }).trim();

async function getJson(url) {
  const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Google Cloud returned HTTP ${response.status}.`);
  return response.json();
}

const cache = await getJson(`https://us-central1-aiplatform.googleapis.com/v1/projects/${encodeURIComponent(project)}/cacheConfig`);
const logging = await getJson(`https://${location}-aiplatform.googleapis.com/v1beta1/projects/${encodeURIComponent(project)}/locations/${encodeURIComponent(location)}/publishers/google/models/${encodeURIComponent(model)}:fetchPublisherModelConfig`);

let cacheStatus;
if (cache?.disableCache === true) cacheStatus = 'disabled';
else if (cache?.retentionConfig?.retentionType) cacheStatus = `enabled (${cache.retentionConfig.retentionType.toLowerCase()} retention)`;
else cacheStatus = 'not explicitly disabled; verify the project default';

const loggingStatus = logging === null
  ? 'disabled (no model logging configuration exists)'
  : logging.loggingConfig?.enabled === true
    ? 'ENABLED'
    : 'disabled';

process.stdout.write(`Project: ${project}\nModel: ${model} (${location})\nVertex implicit cache: ${cacheStatus}\nRequest-response logging: ${loggingStatus}\n`);
