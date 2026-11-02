import {consumeChatEvents} from './chat-events.js';
import {formatChatText} from './chat-format.js';
const chapters = [
  { label: "Feed file", short: "01 · FILE", title: "The feed file" },
  { label: "SAS package", short: "02 · PACKAGE", title: "Inside the package" },
  { label: "Original process", short: "03 · SAS FLOW", title: "How SAS runs it" },
  { label: "Cloud solution", short: "04 · CLOUD FLOW", title: "The Cloud path" },
  { label: "Confluent setup", short: "05 · CONFLUENT", title: "What exists in Cloud" },
  { label: "Flink SQL", short: "06 · FLINK SQL", title: "The consolidated Flink job" },
  { label: "Transformed table", short: "07 · OUTPUT", title: "The resulting table" },
];

const feedText = `00,FMCS0000,BAYNO000,20261101,090000,00001
01,MH,01001,2026-11-01,0830,KUL,A01
01,SQ,01002,2026-11-01,0930,SIN,B02
99,FMCS0000,2`;

const packageFiles = [
  {
    name: "TransportMetadata.xml", kind: "SAS metadata", evidence: "6 job definitions",
    body: "The main structured export: job names, transformation steps, source and target references, column metadata, and embedded SAS code. This is where the BAYNO process can be reconstructed.",
  },
  {
    name: "DeployMap.xml", kind: "deployment map", evidence: "object paths + IDs",
    body: "Links exported jobs, tables, and file objects to their SAS metadata locations. Useful when importing or promoting the package between SAS environments.",
  },
  {
    name: "ConnectionMapping.xml", kind: "connection map", evidence: "5 tables + 1 file",
    body: "Lists the table and external-file objects referenced by the jobs, their object IDs, metadata paths, and the jobs that use them.",
  },
  {
    name: "SubstitutionProperties.subprop", kind: "promotion inputs", evidence: "source → target paths",
    body: "Generated import-time remapping properties. TargetPath values can point the imported connections to matching tables and files in another SAS metadata environment.",
  },
  {
    name: "PromotionSettings.properties", kind: "package identity", evidence: "UUID + export time",
    body: "Records the package UUID and export timestamp. It is package bookkeeping, not runtime job configuration or a business-data file.",
  },
  {
    name: "Export_261022175228.log", kind: "export log", evidence: "6 jobs · 6 mappings",
    body: "Human-readable export record. It lists six BAYNO jobs, five table mappings, and one external-file mapping, and says the metadata export completed. It does not prove the jobs ran successfully.",
  },
  {
    name: "PackageMetaData", kind: "package envelope", evidence: "binary descriptor",
    body: "A small binary metadata envelope. Its text identifies the package as an export file plus associated nested content; it contains no flat-file business rows.",
  },
];

const sasJobs = [
  {
    code: "A_01", title: "Validate the incoming file", layer: "Source · file validation",
    body: "Find BAYNO files, parse filename components, check header/trailer and detail structure, then split valid from invalid files.",
    output: "Control metadata · valid / invalid file path",
  },
  {
    code: "A_02", title: "Read detail records", layer: "Source · file reader",
    body: "The File Reader parses the external BAYNO detail file; the Table Loader writes the extracted records.",
    output: "FCMS0000_BAYNO0000_DETAILS",
  },
  {
    code: "B_02", title: "Join details with header", layer: "Staging · SQL Join",
    body: "A left join connects the parsed details to FMCS0000_BAYNO000_HEADER and writes the staging table.",
    output: "TREF01_BAYNO_HIST_STG",
  },
  {
    code: "C_02", title: "Load the SAS history table", layer: "Integration · table loader",
    body: "The Table Loader transfers the staging result into the load table held in the SAS Tables library.",
    output: "TREF01_BAYNO_HIST_LD · SAS table",
  },
  {
    code: "C_03", title: "Sort and load the DB2 target", layer: "Integration · SAS Sort",
    body: "Sort ascending by carrier, flight, first-leg date, scheduled time, and departure airport, then load the DB2 table.",
    output: "TREF01_BAYNO_HIST · DB2 table",
  },
  {
    code: "D_01", title: "Move the processed source file", layer: "Post-processing",
    body: "After a successful load, the job moves the validated file from the valid folder into the processed folder.",
    output: "Processed-file archive",
  },
];

const sqlFiles = [
 {key:"raw",label:"Parse and validate",file:"10-stage.sql",status:"V2 IMPLEMENTATION"},
 {key:"history",label:"File reconciliation",file:"14-file-state-complete.sql",status:"V2 IMPLEMENTATION"},
 {key:"insert",label:"Route to sinks",file:"34-route-final.sql",status:"V2 IMPLEMENTATION"},
];

let activeChapter = 0;
let activeSql = "raw";
let loadedSql = "";

const esc = (value) => String(value).replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[char]));

function heading(kicker, title, description, badge = "") {
  return `<div class="chapter-heading"><div><div class="chapter-kicker">${kicker}</div><h2>${title}</h2><p>${description}</p></div><span class="chapter-index">${String(activeChapter + 1).padStart(2, "0")}</span>${badge}</div>`;
}

function renderFeed() {
 return `${heading("01 / SOURCE FILE · SYNTHETIC EXAMPLE", "The incremental CSV feed", "The default demo generates 30 immutable files, one every 10 seconds, across a five-minute window. Each file carries separate updates; every file is validated and processed.")}
 <div class="card sql-wrap"><pre class="sql-code">${esc(feedText)}</pre></div>
 <div class="mapping-grid"><div class="card mapping-card"><span>00 header</span><strong>Six CSV fields</strong><small>Record type, source, feed, effective date, effective time, sequence</small></div><div class="card mapping-card"><span>01 detail</span><strong>Seven CSV fields</strong><small>Record type, carrier, flight, ISO date, HHMM time, airport, bay</small></div><div class="card mapping-card"><span>99 trailer</span><strong>Three CSV fields</strong><small>Record type, source, declared detail count</small></div></div>
 <div class="note"><span class="note-mark">i</span><div><strong>Example only.</strong> This CSV layout is a documented demo contract, not a recovered production layout. Filenames carry source/feed, the header timestamp and sequence, a run UUID and an ordinal. Live file identities, counts and hashes appear in the Live demo.</div></div>`;
}

function renderPackage() {
  return `${heading("02 / SOURCE PACKAGE · SAS EXPORT", "Inside the package", "The folder contains extracted SAS export metadata. These files describe jobs and connection mappings; they are not transport business data.")}
    <div class="stat-grid"><div class="card stat"><strong>7</strong><span>files in the supplied folder</span></div><div class="card stat"><strong>6</strong><span>BAYNO SAS jobs in the export log</span></div><div class="card stat"><strong>5 + 1</strong><span>table mappings + external file</span></div></div>
    <div class="package-grid">${packageFiles.map((item) => `<article class="card package-card"><div class="filetype">${item.kind}</div><h3>${item.name}</h3><p>${item.body}</p><span class="evidence">${item.evidence}</span></article>`).join("")}</div>
    <div class="note"><span class="note-mark">i</span><div><strong>The .spk archive itself is not in this folder.</strong> The export log names a SAS package archive on the source workstation, while the supplied folder contains the extracted metadata artifacts listed above.</div></div>`;
}

function renderOriginal() {
  return `${heading("03 / ORIGINAL PROCESS · PACKAGE EVIDENCE", "How SAS runs it", "The export describes six jobs: validate the source file, load and join its records, sort into the DB2 target, then archive the processed file.")}
    ${renderOriginalGraph()}
    <div class="section-label">The six exported jobs · details</div>
    <div class="job-list">${sasJobs.map((job) => `<article class="card job-row" id="sas-job-${job.code}" tabindex="-1"><div class="job-code">${job.code}_BAYNO</div><div><h3>${job.title}</h3><p>${job.layer}</p></div><div class="job-output">${job.body}<br><strong>→ ${job.output}</strong></div></article>`).join("")}</div>
    <div class="section-label">Table lineage · names as exported</div>
    <div class="lineage">
      <article class="card lineage-item"><span class="lineage-num">01</span><div><h3>External detail file → extract table</h3><p><span class="code-inline">FMCS0000_BAYNO000_DETAILS</span> is read into <span class="code-inline">FCMS0000_BAYNO0000_DETAILS</span>. The package uses these names verbatim.</p></div></article>
      <article class="card lineage-item"><span class="lineage-num">02</span><div><h3>Details + header → staging</h3><p><span class="code-inline">B_02_BAYNO</span> left-joins the detail table and <span class="code-inline">FMCS0000_BAYNO000_HEADER</span>, producing <span class="code-inline">TREF01_BAYNO_HIST_STG</span>.</p></div></article>
      <article class="card lineage-item"><span class="lineage-num">03</span><div><h3>Staging → SAS load table → DB2 history table</h3><p><span class="code-inline">C_02_BAYNO</span> loads <span class="code-inline">TREF01_BAYNO_HIST_LD</span> in the SAS Tables library. <span class="code-inline">C_03_BAYNO</span> sorts and loads <span class="code-inline">TREF01_BAYNO_HIST</span> in the DB2 library.</p></div></article>
      <article class="card lineage-item"><span class="lineage-num">04</span><div><h3>Successful load → processed folder</h3><p><span class="code-inline">D_01_BAYNO</span> checks the validation flags and moves the valid source file to the processed folder.</p></div></article>
    </div>
    <div class="join-panel"><article class="card join-box"><h3>Join type from metadata</h3><code>LEFT JOIN</code><p>The package marks the SQL Join type as Left.</p></article><article class="card join-box"><h3>Exported join predicate</h3><code>REC_TYPE = detail_rec_type</code><p>This is a record-type match, not a declared unique key. SEQUENCE_NUMBER exists in the metadata, but the exported SQL Join filter shown here does not include it.</p></article></div>
    <div class="note"><span class="note-mark">!</span><div><strong>Cardinality needs a production layout check.</strong> The export shows one predicate and does not declare uniqueness for the header. The consolidated pipeline scopes header/detail correlation by source filename and retains the content hash for reconciliation.</div></div>`;
}

function renderOriginalGraph() {
  const job=(code,title,body,output)=>`<button type="button" class="sas-flow-node sas-flow-job sas-flow-${code}" data-sas-job="${code}" aria-label="View ${code}_BAYNO: ${title}"><span class="sas-flow-code">${code}_BAYNO <span aria-hidden="true">↗</span></span><strong>${title}</strong><span>${body}</span><code>${output}</code></button>`;
  return `<figure class="card sas-flow" aria-labelledby="sas-flow-title" aria-describedby="sas-flow-description sas-flow-evidence">
    <figcaption class="sas-flow-heading"><div><h3 id="sas-flow-title">Original SAS flow</h3><p>Follow the arrows. Select a job to see its exported steps and outputs.</p></div><span class="tag green">RECONSTRUCTED FROM EXPORT</span></figcaption>
    <p id="sas-flow-description" class="sas-flow-accessible">Incoming BAYNO files go to A_01 validation. Failed validation or an insufficient valid-file count routes files to the invalid folder. Accepted input is split into header and detail data. A_02 reads details. B_02 left-joins the detail table with the header to create staging. C_02 loads the SAS history load table. C_03 sorts and loads the DB2 history table. D_01 is the intended post-processing step and moves the valid source file to the processed folder.</p>
    <div class="sas-flow-legend"><span><i class="sas-flow-line"></i>Data flow</span><span><i class="sas-flow-line invalid"></i>Invalid-file route</span><span><i class="sas-flow-line control"></i>Post-processing / file move</span></div>
    <div class="sas-flow-scroll" role="region" aria-label="Original SAS flow graph; scroll horizontally on small screens" tabindex="0"><div class="sas-flow-canvas">
      <svg class="sas-flow-edges" viewBox="0 0 1100 550" preserveAspectRatio="none" aria-hidden="true" focusable="false">
        <defs><marker id="sas-flow-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8 Z" fill="#6b927c"/></marker><marker id="sas-flow-reject-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8 Z" fill="#bc8455"/></marker><marker id="sas-flow-control-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8 Z" fill="#8d9992"/></marker></defs>
        ${["M175 165 H220","M410 165 H460","M570 165 H650","M840 165 H900","M990 250 V390","M900 455 H840"].map(d=>`<path class="sas-flow-data-edge" d="${d}"/>`).join('')}
        ${["M610 165 V40 H650","M840 40 H990 V100"].map(d=>`<path class="sas-flow-data-edge" d="${d}"/>`).join('')}
        <path class="sas-flow-reject-edge" d="M515 210 V260"/>
        ${["M650 455 H580","M390 455 H240"].map(d=>`<path class="sas-flow-control-edge" d="${d}"/>`).join('')}
        <polygon class="sas-flow-gate-shape" points="460,165 515,120 570,165 515,210"/>
      </svg>
      <div class="sas-flow-node sas-flow-raw"><span class="sas-flow-kind">SOURCE FILES</span><strong>Incoming BAYNO files</strong><span>Raw source folder</span></div>
      ${job('A_01','Validate and split','Filename, header / trailer, counts and detail rules','Validation flags')}
      <div class="sas-flow-gate"><strong>Checks<br>pass?</strong></div><span class="sas-flow-pass">Pass</span><span class="sas-flow-fail">Fail</span>
      <div class="sas-flow-node sas-flow-invalid"><span class="sas-flow-kind">INVALID FILES</span><strong>Invalid folder</strong><span>Failed flags or too few valid files</span></div>
      <div class="sas-flow-node sas-flow-header"><span class="sas-flow-kind">VALIDATED HEADER</span><code>FMCS0000_BAYNO000_HEADER</code></div>
      ${job('A_02','Read detail records','File Reader → extract table','FCMS0000_BAYNO0000_DETAILS')}
      ${job('B_02','Join details + header','LEFT JOIN · record-type match','TREF01_BAYNO_HIST_STG')}
      ${job('C_02','Load SAS history','Table Loader · SAS Tables library','TREF01_BAYNO_HIST_LD')}
      ${job('C_03','Sort and load DB2','Carrier → flight → date → time → airport','TREF01_BAYNO_HIST')}
      ${job('D_01','Archive source file','Checks validation flags; moves the valid file','Valid folder → processed folder')}
      <div class="sas-flow-node sas-flow-archive"><span class="sas-flow-kind">SOURCE-FILE ARCHIVE</span><strong>Processed source folder</strong><span>Original input file</span></div>
      <span class="sas-flow-staging-label">Staging → SAS</span><span class="sas-flow-archive-label">File move</span>
    </div></div>
    <p class="sas-flow-mobile-hint">Scroll sideways to follow the complete graph.</p>
    <p id="sas-flow-evidence" class="sas-flow-evidence"><strong>Package evidence:</strong> <code>TransportMetadata.xml</code>. Arrows reconstruct the logical flow from the exported jobs; scheduler dependencies were not supplied. The external detail-validation include is missing. D_01’s code checks validation flags; its load-success ordering is described in comments, not a recovered scheduler link.</p>
    <p class="sas-flow-adaptation"><strong>Streaming adaptation:</strong> SAS selects the latest filename per feed; the demo processes every incremental file.</p>
  </figure>`;
}

function renderProposal() {
  const nodes = [
    ["01", "Feed generator", "Immutable CSV · runs on demo VM", "local"],
    ["02", "SFTP source VM", "GCP asia-southeast1 · MAG VPC", "local"],
    ["03", "Managed SFTP Source", "SFTP /incoming → bayno_raw_lines", "cloud"],
    ["04", "Confluent Flink", "Parse · join · map into history", "cloud"],
    ["05", "History topic", "bayno_processed_v2 · Avro", "output"],
    ["06", "Managed sinks", "JSON to SFTP + upserts to PostgreSQL", "local"],
  ];
  return `${heading("04 / PROPOSED SOLUTION · DEMO DESIGN", "The Cloud path", "The SAS export is metadata, not business rows. The Cloud path processes every incremental CSV file through managed connectors and SAS-derived validation.")}
    <div class="architecture">${nodes.map(([num, title, body, cls]) => `<article class="arch-node ${cls}"><span class="node-num">${num}</span><h3>${title}</h3><p>${body}</p></article>`).join("")}</div>
    <div class="join-panel"><article class="card join-box"><h3>Managed SFTP source</h3><code>VM generator → SFTP Source → bayno_raw_lines</code><p>The synthetic generator sends unique files to the chrooted SFTP service on the MAG VM. The managed connector ingests completed immutable CSV files. Flink validates and transforms them; managed sinks deliver JSON files and PostgreSQL records.</p></article><article class="card join-box"><h3>Cloud processing and delivery</h3><code>Kafka → Flink → managed SFTP + PostgreSQL sinks</code><p>Flink correlates rows by source file, proves file completeness, validates counts and enriches accepted details with header metadata. The JDBC sink upserts rows to PostgreSQL. The website sorts rows when it queries the final table; Kafka does not guarantee globally sorted arrival order.</p></article></div>
    <div class="section-label">Processing engine choice</div>
    <div class="join-panel"><article class="card join-box"><h3>ksqlDB · enough for a small example</h3><code>simple continuous SQL</code><p>The original small parse-and-join fixture could use ksqlDB. This consolidated demo adds stateful file completeness, error thresholds and multi-destination reconciliation. <a class="doc-link" href="https://docs.confluent.io/cloud/current/ksqldb/overview.html" target="_blank" rel="noreferrer">ksqlDB on Confluent Cloud ↗</a></p></article><article class="card join-box"><h3>Flink · selected for the MAG demo</h3><code>proposal direction + room to grow</code><p>Confluent recommends Flink for new stream-processing workloads; ksqlDB remains supported for existing applications. Flink aligns with the proposed MAG direction and can carry more stateful file validation and transformation logic. <a class="doc-link" href="https://docs.confluent.io/cloud/current/flink/overview.html" target="_blank" rel="noreferrer">Flink on Confluent Cloud ↗</a></p></article></div>
    <div class="note"><span class="note-mark">→</span><div><strong>Make the demo exercise more than a happy-path join.</strong> The consolidated flow includes trailer-count reconciliation, invalid-record rejects and replay checks; the package-backed SAS process remains separately identified as source evidence.</div></div>
    <div class="note"><span class="note-mark">↗</span><div><strong>MCP is the control plane for the assistant.</strong> The site reads Confluent state and can submit an approved Flink statement through MCP. Kafka cluster and connector provisioning use Confluent Cloud REST APIs because the connected MCP tools do not expose create operations for those resources.</div></div>`;
}

function renderConfluent() {
 return `${heading("05 / CONFLUENT CLOUD", "Live infrastructure", "The consolidated pipeline uses lumo-demo, the VM generator and managed SFTP / PostgreSQL connectors. Refresh to observe current state.")}
 <div class="card live-refresh-panel"><div class="live-refresh-head"><strong>Confluent MCP snapshot</strong><button id="refresh-cloud" class="copy-button" type="button">Refresh from MCP ↻</button></div><div id="live-cloud-status" role="status">Not refreshed.</div><div id="live-cloud-summary"></div></div>
 <div class="note"><span class="note-mark">i</span><div>Processing health is distinct from verified delivery. Open the Live demo for file-level reconciliation. Confluent console links open in a separate tab because its UI blocks embedding.</div></div>`;
}

function renderSql() {
  const tabs = sqlFiles.map((sql) => `<button class="sql-tab" type="button" role="tab" data-sql="${sql.key}" aria-selected="${activeSql === sql.key}">${sql.label}</button>`).join("");
  const file = sqlFiles.find((sql) => sql.key === activeSql);
  const statusClass = activeSql === "insert" ? "orange" : "green";
  return `${heading("06 / MAG FLINK SQL · V2", "The Flink job", "Versioned SQL reads bayno_raw_lines and produces the three topics consumed by both managed sinks.")}
    <div class="card sql-wrap"><div class="sql-head"><div class="sql-tabs" role="tablist" aria-label="Flink SQL files">${tabs}</div><button class="copy-button" id="copy-sql" type="button">Copy SQL</button></div>
      <div class="sql-meta"><span>${file.file}</span><span class="tag ${statusClass}">${file.status}</span></div>
      <pre class="sql-code"><code id="sql-code">${esc(loadedSql || "Loading SQL from the checked-in implementation…")}</code></pre>
    </div>
    <div class="mapping-grid">
      <div class="card mapping-card"><span>Header record</span><strong>kind 00 · source metadata</strong><small>Source system comes from the header row</small></div>
      <div class="card mapping-card"><span>Detail record</span><strong>kind 01 · business fields</strong><small>Validated details are enriched with their own file header</small></div>
      <div class="card mapping-card"><span>File correlation</span><strong>Source filename + content hash</strong><small>Independent files never share a header</small></div>
    </div>
    <div class="note"><span class="note-mark">i</span><div><strong>Difference from SAS metadata:</strong> the export marks a left join with REC_TYPE = detail_rec_type. The consolidated demo processes every incremental file and enriches valid details with their matching file header. A database table has no guaranteed row order; query it with ORDER BY CARR, FLT_NBR, FIRST_LEG_FLT_DT, SCHED_DEP_TM, DEP_AIRPT to view the SAS sort order.</div></div>`;
}

function renderOutput() {
  const rows = [];
  const columns = ["CARR", "FLT_NBR", "FIRST_LEG_FLT_DT", "SCHED_DEP_TM", "DEP_AIRPT", "BAY_NO", "REC_LD_TS", "FILE_SEQ", "REC_SRC_SYS"];
  return `${heading("07 / TRANSFORMED TABLE · POSTGRESQL", "The resulting table", "The page reads the destination table on demand. Rows are ordered by the original SAS sort fields in the query; Kafka and PostgreSQL do not promise physical row order.")}
    <div class="file-top card output-file-head"><div class="file-name"><span class="file-icon">▦</span><span>magbayno.public.bayno_processed_v2</span></div><div><span id="live-db-badge" class="tag orange">LOADING · POSTGRESQL</span> <button id="refresh-db" class="copy-button" type="button">Refresh rows ↻</button></div></div>
    <div id="live-db-status" class="live-cloud-status" role="status">Loading the current PostgreSQL rows…</div>
    <div class="card output-table-wrap output-table-card"><table class="output-table"><thead><tr>${columns.map((col) => `<th>${col}</th>`).join("")}</tr></thead><tbody id="live-output-table">${rows.map((row) => `<tr>${row.map((cell, i) => `<td class="${i === 0 ? "primary-cell" : ""}">${cell}</td>`).join("")}</tr>`).join("")}</tbody></table><div class="table-caption"><span id="live-output-count">Awaiting live query</span><span>REC_LD_TS is populated at Flink runtime</span></div></div>
    <div class="section-label">Where each output field comes from</div>
    <div class="mapping-grid">
      <div class="card mapping-card"><span>Detail row</span><strong>CARR · FLT_NBR</strong><small>Detail CSV fields 2–3</small></div>
      <div class="card mapping-card"><span>Detail row</span><strong>DATE · TIME · AIRPORT</strong><small>Detail CSV fields 4–6; ISO date and HHMM time</small></div>
      <div class="card mapping-card"><span>Detail row</span><strong>BAY_NO</strong><small>Detail CSV field 7; output name matches SAS</small></div>
      <div class="card mapping-card"><span>Flink runtime</span><strong>REC_LD_TS</strong><small>CURRENT_TIMESTAMP at processing time</small></div>
      <div class="card mapping-card"><span>Demo file id</span><strong>FILE_SEQ from header</strong><small>Header sequence is retained as text; content SHA-256 is the file ID</small></div>
      <div class="card mapping-card"><span>Header row</span><strong>REC_SRC_SYS</strong><small>FMCS0000 copied from record kind 00</small></div>
    </div>
    <div class="note"><span class="note-mark">↗</span><div><strong>Original destination:</strong> <span class="code-inline">TREF01_BAYNO_HIST</span> is in the SAS package's DB2 Tables library. <strong>Demo destination:</strong> Flink writes the history Kafka topic, then the managed JDBC Sink connector writes to PostgreSQL on the MAG VM.</div></div>`;
}

const renderers = [renderFeed, renderPackage, renderOriginal, renderProposal, renderConfluent, renderSql, renderOutput];

function drawNav() {
  const nav = document.querySelector("#chapter-nav");
  nav.innerHTML = chapters.map((chapter, index) => `<button type="button" data-chapter="${index}" aria-current="${activeChapter === index ? "step" : "false"}"><span class="nav-number">${String(index + 1).padStart(2, "0")}</span><span class="nav-label">${chapter.label}</span><span class="nav-check">${index < activeChapter ? "✓" : ""}</span></button>`).join("");
  nav.querySelectorAll("button").forEach((button) => button.addEventListener("click", () => { document.querySelector("#demo-dashboard").hidden=true; document.querySelector("#walkthrough").hidden=false; showChapter(Number(button.dataset.chapter)); }));
}

async function loadSql() {
  const sql = sqlFiles.find((item) => item.key === activeSql);
  const target = document.querySelector("#sql-code");
  if (!target) return;
  target.textContent = "Loading SQL from the checked-in demo draft…";
  try {
    const response = await fetch(`./sql/${sql.file}`);
    if (!response.ok) throw new Error("SQL file unavailable");
    loadedSql = await response.text();
    target.textContent = loadedSql;
  } catch {
    loadedSql = "Unable to load the checked-in SQL draft.";
    target.textContent = loadedSql;
  }
}

function showChapter(index) {
  activeChapter = Math.max(0, Math.min(chapters.length - 1, index));
  const main = document.querySelector("#chapter-content");
  main.innerHTML = renderers[activeChapter]();
  main.classList.remove("chapter-content");
  requestAnimationFrame(() => main.classList.add("chapter-content"));
  document.querySelector("#progress-bar").style.width = `${((activeChapter + 1) / chapters.length) * 100}%`;
  document.querySelector("#chapter-count").textContent = `${String(activeChapter + 1).padStart(2, "0")} / ${String(chapters.length).padStart(2, "0")}`;
  document.querySelector("#previous-button").disabled = activeChapter === 0;
  const next = document.querySelector("#next-button");
  next.disabled = activeChapter === chapters.length - 1;
  next.innerHTML = activeChapter === chapters.length - 1 ? "End of walkthrough" : '<span>Next step</span> <b>→</b>';
  drawNav();
  if (activeChapter === 4) { refreshCloudSnapshot(); }
  if (activeChapter === 5) loadSql();
  if (activeChapter === 6) refreshOutput();
  if (activeChapter === 6) document.querySelector("#chapter-content").scrollIntoView({ behavior: "smooth", block: "start" });
  document.title = `${chapters[activeChapter].title} · MAG BAYNO`;
}

document.querySelector("#previous-button").addEventListener("click", () => showChapter(activeChapter - 1));
document.querySelector("#next-button").addEventListener("click", () => showChapter(activeChapter + 1));
document.querySelector("#chapter-content").addEventListener("click", async (event) => {
  const sasJob=event.target.closest('[data-sas-job]');
  if(sasJob){const detail=document.getElementById(`sas-job-${sasJob.dataset.sasJob}`);if(detail){detail.scrollIntoView({block:'center',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});detail.focus({preventScroll:true});}}
  const tab = event.target.closest("[data-sql]");
  if (tab) {
    activeSql = tab.dataset.sql;
    document.querySelectorAll(".sql-tab").forEach((button) => button.setAttribute("aria-selected", String(button === tab)));
    const sql = sqlFiles.find((item) => item.key === activeSql);
    document.querySelector(".sql-meta span:first-child").textContent = sql.file;
    const tag = document.querySelector(".sql-meta .tag");
    tag.textContent = sql.status;
    tag.className = `tag ${activeSql === "insert" ? "orange" : "green"}`;
    await loadSql();
  }
  if (event.target.closest("#refresh-cloud")) { refreshCloudSnapshot(); }
  if (event.target.closest("#refresh-db")) { refreshOutput(); }
  if (event.target.closest("#copy-sql")) {
    const button = event.target.closest("#copy-sql");
    try {
      await navigator.clipboard.writeText(loadedSql);
      button.textContent = "Copied";
      setTimeout(() => { button.textContent = "Copy SQL"; }, 1300);
    } catch { button.textContent = "Select text"; }
  }
});

document.addEventListener("keydown", (event) => {
  if (event.target.closest("button, a, textarea, input, pre")) return;
  if (event.key === "ArrowRight") showChapter(activeChapter + 1);
  if (event.key === "ArrowLeft") showChapter(activeChapter - 1);
});

showChapter(0);

let lastCloudOverview = null;
let cloudRefreshBusy = false;
let magChatMessages = [];
let magChatPendingAction = null;
let magChatBusy = false;

async function apiRequest(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { ...(options.body ? { "content-type": "application/json" } : {}), ...(options.headers || {}) },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status}).`);
  return payload;
}

async function refreshOutput() {
  const status = document.querySelector("#live-db-status");
  const badge = document.querySelector("#live-db-badge");
  const body = document.querySelector("#live-output-table");
  const count = document.querySelector("#live-output-count");
  if (!status || !badge || !body || !count) return;
  status.textContent = "Reading PostgreSQL…";
  try {
    const data = await apiRequest("/api/demo/rows");
    const columns = ["CARR", "FLT_NBR", "FIRST_LEG_FLT_DT", "SCHED_DEP_TM", "DEP_AIRPT", "BAY_NO", "REC_LD_TS", "FILE_SEQ", "REC_SRC_SYS"];
    body.replaceChildren();
    for (const row of data.rows || []) {
      const tr = document.createElement("tr");
      for (const [index, column] of columns.entries()) {
        const td = document.createElement("td");
        if (index === 0) td.className = "primary-cell";
        td.textContent = row[column] == null ? "" : String(row[column]);
        tr.append(td);
      }
      body.append(tr);
    }
    const rowCount = Number(data.rowCount || 0);
    badge.className = `tag ${rowCount ? "green" : "orange"}`;
    badge.textContent = rowCount ? "LIVE · POSTGRESQL" : "LIVE TABLE · EMPTY";
    status.dataset.state = "ok";
    status.textContent = `${data.source} · checked ${new Date(data.checkedAt).toLocaleString()}`;
    count.textContent = `${rowCount} live row${rowCount === 1 ? "" : "s"} · ordered by carrier, flight, date, time, airport`;
  } catch (error) {
    badge.className = "tag orange";
    badge.textContent = "LIVE UNAVAILABLE";
    status.dataset.state = "error";
    status.textContent = error.message || "PostgreSQL could not be read.";
    body.replaceChildren();
    count.textContent = "No current database observations available.";
  }
}

function liveCard(title, lines) {
  const safeLines = lines.length ? `<ul>${lines.map((line) => `<li>${esc(line)}</li>`).join("")}</ul>` : "<p>None returned</p>";
  return `<article class="live-cloud-card"><h3>${esc(title)}</h3>${safeLines}</article>`;
}

function showCloudOverview(data) {
  lastCloudOverview = data;
  const status = document.querySelector("#live-cloud-status");
  const target = document.querySelector("#live-cloud-summary");
  if (!status || !target) return;
  const time = new Date(data.checkedAt).toLocaleString();
  status.dataset.state = "ok";
  status.textContent = `MCP read completed · ${time} · ${data.environment?.name || "environment"} / ${data.cluster?.name || "cluster"}`;
  const topics = (data.topics || []).map((name) => String(name));
  const statements = (data.statements || []).map((item) => `${item.name} · ${item.status}`);
  const connectors = (data.connectors || []).map((item) => `${item.name} · ${item.status}`);
  target.innerHTML = [
    liveCard("Topics", topics),
    liveCard("Flink statements", statements),
    liveCard("Connector status", connectors),
    liveCard("Scope", [`${data.environment?.name || "lumo-demo"} (${data.environment?.id || ""})`, `${data.cluster?.name || "lumo-demo"} (${data.cluster?.id || ""})`, `Default proposal pool ${data.computePoolId || "unknown"}`]),
  ].join("");
}

async function refreshCloudSnapshot() {
  if (cloudRefreshBusy) return;
  cloudRefreshBusy = true;
  const status = document.querySelector("#live-cloud-status");
  const button = document.querySelector("#refresh-cloud");
  if (button) { button.disabled = true; button.textContent = "Reading MCP…"; }
  if (status) { status.dataset.state = ""; status.textContent = "Reading current Confluent Cloud state through MCP…"; }
  try {
    const data = await apiRequest("/api/overview");
    showCloudOverview(data);
  } catch (error) {
    const target = document.querySelector("#live-cloud-summary");
    if (status) { status.dataset.state = "error"; status.textContent = error.message; }
    if (target) target.innerHTML = "";
  } finally {
    cloudRefreshBusy = false;
    if (button) { button.disabled = false; button.textContent = "Refresh from MCP ↻"; }
  }
}

function renderChatMessages() {
  const target=document.querySelector('#mag-chat-messages');
  if(!target)return;
  const scroller=document.querySelector('.mag-chat-scroll');
  const nearBottom=scroller.scrollHeight-scroller.scrollTop-scroller.clientHeight<90;
  for(const message of magChatMessages) {
    message.id ||= crypto.randomUUID();message.createdAt ||= Date.now();
    let article=target.querySelector(`[data-message-id="${message.id}"]`);
    if(!article) {
      article=document.createElement('article');article.className=`mag-chat-message ${message.role}`;article.dataset.messageId=message.id;
      article.innerHTML=`<span class="mag-chat-avatar" aria-hidden="true">${message.role==='user'?'You':'M'}</span><div class="mag-chat-body"><div class="mag-chat-meta"><strong>${message.role==='user'?'You':'MAG agent'}</strong><time></time></div><div class="mag-chat-activity-root"></div><div class="mag-chat-answer"></div><div class="mag-chat-message-state"></div></div>`;
      target.append(article);
    }
    const time=article.querySelector('time');time.dateTime=new Date(message.createdAt).toISOString();time.textContent=new Date(message.createdAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
    article.querySelector('.mag-chat-answer').innerHTML=formatChatText(message.text);
    article.dataset.phase=message.phase||'complete';
    const state=article.querySelector('.mag-chat-message-state');
    state.textContent=message.note||(message.phase==='working'?message.label||'Working…':message.elapsed?`${(message.elapsed/1000).toFixed(1)}s · ${message.activity?.length||0} operation${message.activity?.length===1?'':'s'}`:'');
    const root=article.querySelector('.mag-chat-activity-root');
    if(message.activity?.length) {
      let details=root.querySelector('details');
      if(!details){details=document.createElement('details');details.className='mag-chat-activity';details.open=true;details.innerHTML='<summary></summary><ol></ol>';root.append(details);}
      const running=message.activity.some(a=>a.status==='running');
      details.querySelector('summary').textContent=`Agent activity · ${message.activity.length} operation${message.activity.length===1?'':'s'}${running?' · Running':''}`;
      details.querySelector('ol').innerHTML=message.activity.map(a=>`<li data-status="${esc(a.status)}"><span class="mag-activity-icon" aria-hidden="true">${a.status==='complete'?'✓':a.status==='error'?'!':a.status==='stopped'?'■':'◌'}</span><span><strong>${esc(a.label)}</strong><small>${esc(a.source)}${a.observedAt?' · '+esc(new Date(a.observedAt).toLocaleTimeString()):''}</small></span><span class="mag-activity-duration">${({complete:'Complete',error:'Failed',stopped:'Stopped',running:'Running'})[a.status]||'Pending'}${a.durationMs!=null?' · '+(a.durationMs/1000).toFixed(1)+'s':''}</span></li>`).join('');
    }
  }
  if(nearBottom)scroller.scrollTop=scroller.scrollHeight;
}

function renderPendingAction() {
  const root = document.querySelector("#mag-chat-action-root");
  if (!root) return;
  const scroller=document.querySelector('.mag-chat-scroll');
  const nearBottom=scroller.scrollHeight-scroller.scrollTop-scroller.clientHeight<90;
  root.replaceChildren();
  if (!magChatPendingAction) return;
  const action = magChatPendingAction;
  const isDemo = ["start_demo","stop_demo"].includes(action.type);
  const card = document.createElement("section");
  card.className = "mag-chat-action";
  const title = document.createElement("h3");
  title.textContent = isDemo ? (action.type === "start_demo" ? "Start demo run" : "Stop generation") : action.type === "create_flink_statement" ? "Review Flink statement" : "Confirm statement deletion";
  card.append(title);
  const scope = document.createElement("p");
  scope.textContent = isDemo ? "VM generator · managed Confluent pipeline · verification at both destinations" : `Target: ${action.environmentName} (${action.environmentId}) · ${action.type === "create_flink_statement" ? `compute pool ${action.computePoolId}` : "Confluent Cloud"}`;
  card.append(scope);
  const name = document.createElement("p");
  name.textContent = isDemo ? (action.type === "start_demo" ? `${({valid:'Valid data',mixed:'Mixed valid and invalid details',rejected:'Rejected files',sequence:'Deterministic mixed sequence'})[action.settings.scenario]||action.settings.scenario} · ${action.settings.file_count} files · ${action.settings.detail_count} details per file · One file every ${action.settings.interval_seconds} seconds` : `Run: ${action.runId}. Published files continue processing.`) : `Statement: ${action.statementName}`;
  card.append(name);
  if (action.type === "create_flink_statement") {
    const validation = document.createElement("p");
    validation.textContent = `SQL validation passed. ${action.validation || ""}`;
    card.append(validation);
    const sql = document.createElement("pre");
    sql.textContent = action.sql;
    card.append(sql);
    const cost = document.createElement("p");
    cost.textContent = "Approving submits this statement to the existing Flink compute pool and may consume compute.";
    card.append(cost);
  } else if (!isDemo) {
    const warning = document.createElement("p");
    warning.textContent = "This stops and deletes the statement and cannot be undone. Type the exact name below to confirm.";
    card.append(warning);
    const input = document.createElement("input");
    input.id = "mag-chat-delete-confirm";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.placeholder = action.statementName;
    input.setAttribute("aria-label", `Type ${action.statementName} to confirm deletion`);
    card.append(input);
  }
  const controls = document.createElement("div");
  controls.className = "mag-chat-action-controls";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.dataset.chatAction = "cancel";
  cancel.textContent = "Cancel";
  cancel.disabled = magChatBusy;
  const approve = document.createElement("button");
  approve.type = "button";
  approve.className = "approve";
  approve.dataset.chatAction = "approve";
  approve.textContent = isDemo ? (action.type === "start_demo" ? "Start demo" : "Stop generation") : action.type === "create_flink_statement" ? "Run this statement" : "Delete statement";
  approve.disabled = magChatBusy || action.type === "delete_flink_statement";
  controls.append(cancel, approve);
  card.append(controls);
  root.append(card);
  if(nearBottom)scroller.scrollTop=scroller.scrollHeight;
}

let magChatController=null;
let magChatEpoch=0;
function setChatBusy(busy) {
  magChatBusy=busy;
  const send=document.querySelector('#mag-chat-send'),stop=document.querySelector('#mag-chat-stop');
  if(send){send.hidden=busy;send.disabled=!!magChatPendingAction;}
  if(stop)stop.hidden=!busy||!magChatController;
  const panel=document.querySelector('#mag-chat-panel');if(panel)panel.setAttribute('aria-busy',String(busy));
}
function chatStatus(text){const status=document.querySelector('#mag-chat-status');if(status)status.textContent=text;}

async function sendMagChatMessage(text) {
  const message=String(text||'').trim();
  if(!message||magChatBusy||magChatPendingAction)return;
  const input=document.querySelector('#mag-chat-input');if(input)input.value='';
  const epoch=magChatEpoch,started=Date.now();
  magChatMessages.push({role:'user',text:message});
  const history=magChatMessages.filter(m=>m.text.trim()&&!m.incomplete).slice(-14).map(m=>({role:m.role,text:m.text}));
  const reply={role:'assistant',text:'',activity:[],phase:'working',label:'Connecting to live sources',incomplete:true};
  const controller=new AbortController();magChatController=controller;
  magChatMessages.push(reply);renderChatMessages();setChatBusy(true);
  document.querySelector('#mag-chat-quick').hidden=true;
  try {
    const response=await fetch('/api/chat',{method:'POST',headers:{'content-type':'application/json',accept:'text/event-stream'},body:JSON.stringify({messages:history}),signal:controller.signal});
    await consumeChatEvents(response,(type,data)=>{
      if(epoch!==magChatEpoch)return;
      if(type==='status'){reply.label=data.label;chatStatus(data.label);}
      if(type==='tool_start'){reply.activity.push({...data,status:'running'});reply.label=data.label;chatStatus(data.label);}
      if(type==='tool_end'){const activity=reply.activity.find(a=>a.id===data.id);if(activity)Object.assign(activity,data);}
      if(type==='answer'){reply.text=data.text;reply.label='Writing the answer';}
      if(type==='approval'){magChatPendingAction=data.pendingAction;renderPendingAction();}
      if(type==='done'){reply.text=data.answer;reply.phase='complete';reply.incomplete=false;reply.elapsed=Date.now()-started;magChatPendingAction=data.pendingAction||magChatPendingAction;chatStatus(magChatPendingAction?'Reply complete. Review the approval card.':'Reply complete.');}
      renderChatMessages();
    });
  } catch(error) {
    if(epoch!==magChatEpoch)return;
    reply.phase=controller.signal.aborted?'stopped':'error';
    reply.note=controller.signal.aborted?'Reply stopped. Any partial answer is incomplete.':error.message;
    reply.incomplete=true;
    for(const activity of reply.activity)if(activity.status==='running')activity.status=controller.signal.aborted?'stopped':'error';
    chatStatus(reply.note);renderChatMessages();
  } finally {
    if(epoch===magChatEpoch){magChatController=null;setChatBusy(false);renderPendingAction();document.querySelector('#mag-chat-quick').hidden=!!magChatPendingAction;}
  }
}

function newMagChat() {
  magChatEpoch++;magChatController?.abort();magChatController=null;magChatPendingAction=null;
  magChatMessages=[{role:'assistant',text:'Ask me about the BAYNO pipeline, recent runs or destination reconciliation. I’ll check the live sources and show each operation here. Changes are prepared as cards for your review.'}];
  document.querySelector('#mag-chat-messages').replaceChildren();
  document.querySelector('#mag-chat-input').value='';
  setChatBusy(false);renderChatMessages();renderPendingAction();
  document.querySelector('#mag-chat-quick').hidden=false;chatStatus('Ready · Chat stays in this browser tab');
}

async function approveMagChatAction() {
  if (!magChatPendingAction || magChatBusy) return;
  const action = magChatPendingAction;
  const confirmInput = document.querySelector("#mag-chat-delete-confirm");
  const confirmName = confirmInput ? confirmInput.value : undefined;
  setChatBusy(true);
  const approve = document.querySelector('[data-chat-action="approve"]');
  if (approve) approve.disabled = true;
  try {
    const result = await apiRequest("/api/approve", {
      method: "POST",
      body: JSON.stringify({ approvalToken: action.token, confirmName }),
    });
    if (result.run) window.dispatchEvent(new CustomEvent("bayno-run-selected",{detail:result.run.id}));
    const outcome = result.run ? `Run ${result.run.id}: ${result.run.generation_status}. ${result.action === "stop_demo" ? "Generation stop requested; published files continue processing." : "Start queued on the VM. Watch the live demo for progress."}` : result.action === "create_flink_statement"
      ? `Confluent accepted ${result.statementName}. The statement is starting; refresh the Cloud snapshot to confirm its status.`
      : `Confluent accepted deletion of ${result.statementName}. Refresh the Cloud snapshot to confirm.`;
    magChatMessages.push({ role: "assistant", text: outcome });
    chatStatus('Action confirmed. Check live progress for delivery.');
    magChatPendingAction = null;
    renderChatMessages();
    renderPendingAction();
    const quick = document.querySelector("#mag-chat-quick");
    if (quick) quick.hidden = false;
    if (activeChapter === 4) await refreshCloudSnapshot();
    else lastCloudOverview = null;
  } catch (error) {
    magChatMessages.push({ role: "assistant", text: `The action was not confirmed: ${error.message}` });
    chatStatus('The action was not confirmed. Review the error above.');
    renderChatMessages();
    if (approve) approve.disabled = action.type === "delete_flink_statement" && (!confirmInput || confirmInput.value !== action.statementName);
  } finally {
    setChatBusy(false);
  }
}

function initMagChat() {
  const toggle = document.createElement("button");
  toggle.className = "mag-chat-toggle";
  toggle.type = "button";
  toggle.setAttribute("aria-expanded", "false");
  toggle.setAttribute("aria-controls", "mag-chat-panel");
  toggle.innerHTML = '<span class="chat-spark">✳</span><span>Ask MAG</span>';
  const panel = document.createElement("section");
  panel.className = "mag-chat-panel";
  panel.id = "mag-chat-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "MAG Confluent assistant");
  panel.hidden = true;
  panel.innerHTML = `
    <header class="mag-chat-head"><div class="mag-chat-title"><span class="mag-chat-mark">M</span><span><strong>MAG agent</strong><small><span class="mag-chat-live-dot"></span> Live · lumo-demo</small></span></div><div class="mag-chat-head-actions"><button id="mag-chat-new" type="button" aria-label="New chat" title="New chat">＋</button><button id="mag-chat-expand" type="button" aria-label="Expand chat" title="Expand chat" aria-pressed="false">↗</button><button class="mag-chat-close" type="button" aria-label="Close chat">×</button></div></header>
    <div class="mag-chat-divider">Today · BAYNO workspace</div><div class="mag-chat-scroll"><div id="mag-chat-messages" class="mag-chat-messages" role="log" aria-label="Conversation" aria-live="off"></div>
    <div id="mag-chat-action-root"></div></div>
    <div id="mag-chat-quick" class="mag-chat-quick"><button type="button" data-prompt="Check the three active consolidated Flink jobs and distinguish historical statements from current health.">Flink status</button><button type="button" data-prompt="List the topics and schemas in lumo-demo.">Topics and schemas</button><button type="button" data-prompt="Show recent demo runs and explain the latest run destination reconciliation.">Reconciliation</button></div>
    <div class="mag-chat-compose"><textarea id="mag-chat-input" rows="2" maxlength="5000" placeholder="Ask about runs, files or pipeline health…" aria-label="Message MAG assistant"></textarea><div class="mag-chat-compose-bar"><span><span class="mag-chat-agent-chip">✳ BAYNO agent</span><small>Enter to send · Shift + Enter for a new line</small></span><button id="mag-chat-stop" type="button" hidden>■ Stop reply</button><button id="mag-chat-send" class="mag-chat-send" type="button" aria-label="Send message">↑</button></div></div>
    <div class="mag-chat-foot"><span id="mag-chat-status" role="status" aria-live="polite">Ready</span><span>Actions require approval</span></div>`;
  document.body.append(toggle, panel);
  newMagChat();

  toggle.addEventListener("click", () => {
    panel.hidden = !panel.hidden;
    toggle.setAttribute("aria-expanded", String(!panel.hidden));
    if (!panel.hidden) document.querySelector("#mag-chat-input").focus();
  });
  panel.querySelector(".mag-chat-close").addEventListener("click", () => {
    panel.hidden = true;
    toggle.setAttribute("aria-expanded", "false");
  });
  document.querySelector('#mag-chat-new').addEventListener('click',()=>{newMagChat();document.querySelector('#mag-chat-input').focus();});
  document.querySelector('#mag-chat-stop').addEventListener('click',()=>magChatController?.abort());
  document.querySelector('#mag-chat-expand').addEventListener('click',event=>{const expanded=panel.classList.toggle('expanded');event.currentTarget.setAttribute('aria-pressed',String(expanded));event.currentTarget.setAttribute('aria-label',expanded?'Restore chat size':'Expand chat');event.currentTarget.title=expanded?'Restore chat size':'Expand chat';});
  panel.addEventListener('keydown',event=>{if(event.key==='Escape'){panel.hidden=true;toggle.setAttribute('aria-expanded','false');toggle.focus();}});
  document.querySelector("#mag-chat-send").addEventListener("click", () => sendMagChatMessage(document.querySelector("#mag-chat-input").value));
  document.querySelector("#mag-chat-input").addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendMagChatMessage(event.currentTarget.value);
    }
  });
  panel.addEventListener("click", (event) => {
    const prompt = event.target.closest("[data-prompt]");
    if (prompt) sendMagChatMessage(prompt.dataset.prompt);
    const action = event.target.closest("[data-chat-action]")?.dataset.chatAction;
    if (action === "cancel") {
      magChatPendingAction = null;
      renderPendingAction();
      setChatBusy(magChatBusy);
      chatStatus('Approval dismissed. No action was executed.');
      const quick = document.querySelector("#mag-chat-quick");
      if (quick) quick.hidden = false;
    }
    if (action === "approve") approveMagChatAction();
  });
  panel.addEventListener("input", (event) => {
    if (event.target.id !== "mag-chat-delete-confirm") return;
    const approve = document.querySelector('[data-chat-action="approve"]');
    if (approve && magChatPendingAction) approve.disabled = event.target.value !== magChatPendingAction.statementName || magChatBusy;
  });
}

initMagChat();


const logoutButton = document.querySelector("#logout-button");
if (logoutButton) logoutButton.addEventListener("click", async () => {
  logoutButton.disabled = true;
  try {
    await apiRequest("/api/logout", { method: "POST" });
  } finally {
    window.location.assign("/login");
  }
});
