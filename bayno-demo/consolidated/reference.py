"""Independent demo oracle; never used to write destination business data."""
import csv, hashlib, io, json, datetime
TOPICS=('bayno_processed_v2','bayno_file_results_v2','bayno_exceptions_v2')
def canonical(record):
    return json.dumps({k:v for k,v in record.items() if k!='rec_ld_ts'},sort_keys=True,separators=(',',':'),ensure_ascii=False)
def evaluate(content, filename, run_id):
    file_id=hashlib.sha256(content.encode()).hexdigest()
    base=dict(run_id=str(run_id),file_id=file_id,source_file=filename)
    lines=content.splitlines(); rows=[]; errors=[]
    for n,line in enumerate(lines,1):
        try: rows.append((n,next(csv.reader([line],strict=True))))
        except csv.Error:
            kind=line.split(',',1)[0]
            rows.append((n,[kind] if kind in ('00','01','99') else [])); errors.append((n,'CSV_PARSE_ERROR'))
    headers=[(n,r) for n,r in rows if r and r[0]=='00']; trailers=[(n,r) for n,r in rows if r and r[0]=='99']; details=[(n,r) for n,r in rows if r and r[0]=='01']
    valid=[]; invalid=[]
    for n,r in details:
        good=len(r)==7 and all(x.strip() for x in r[1:])
        try:
            if good:
                datetime.date.fromisoformat(r[3]); datetime.datetime.strptime(r[4],'%H%M')
                good=len(r[3])==10 and len(r[4])==4
        except ValueError: good=False
        (valid if good else invalid).append((n,r))
    file_error=None; h=headers[0][1] if headers else []; t=trailers[0][1] if trailers else []
    header_time_valid=True
    try:
        if len(h)!=6 or len(h[3])!=8 or len(h[4])!=6:header_time_valid=False
        else:datetime.datetime.strptime(h[3]+h[4],'%Y%m%d%H%M%S')
    except ValueError:header_time_valid=False
    declared=int(t[2]) if len(t)==3 and t[2].isdigit() else None
    if errors:file_error='CSV_PARSE_ERROR'
    elif len(headers)!=1 or headers[0][0]!=1 or len(h)!=6 or not all(h[1:]) or not header_time_valid:file_error='INVALID_HEADER'
    elif len(trailers)!=1 or trailers[0][0]!=len(lines) or len(t)!=3 or declared is None:file_error='INVALID_TRAILER'
    elif any(not r or r[0] not in ('00','01','99') for _,r in rows):file_error='FILE_STRUCTURE_ERROR'
    elif h[1]!=t[1]:file_error='SOURCE_MISMATCH'
    elif len(details)>1000:file_error='FILE_TOO_LARGE'
    elif declared!=len(details):file_error='COUNT_MISMATCH'
    elif h[1]!='FMCS0000' or h[2]!='BAYNO000':file_error='UNKNOWN_OR_DISABLED_FEED'
    elif not filename.startswith(f'{h[1]}_{h[2]}_{h[3]}{h[4]}_{h[5]}_'):file_error='FILENAME_HEADER_MISMATCH'
    pct=100*len(invalid)/len(details) if details else 0
    accepted=not file_error and pct<=20
    reason='FILE_VALIDATION_FAILED' if file_error else 'DETAIL_ERROR_THRESHOLD_EXCEEDED' if pct>20 else 'ACCEPTED_WITH_DETAIL_ERRORS' if invalid else 'OK'
    result={**base,'record_id':file_id,'status':'ACCEPTED' if accepted else 'REJECTED','reason':reason,'declared_count':declared,'actual_count':len(details),'invalid_count':len(invalid),'error_percent':format(pct,'.12f')}
    processed=[]
    if accepted:
        for n,r in valid:
            processed.append({**base,'record_id':f'{file_id}:{n}','line_number':n,'carr':r[1],'flt_nbr':r[2],'first_leg_flt_dt':r[3],'sched_dep_tm':r[4],'dep_airpt':r[5],'bay_no':r[6],'rec_src_sys':h[1],'file_sequence':h[5]})
    error_codes=dict(errors)
    exceptions=[{**base,'record_id':f'{file_id}:{n}:{error_codes.get(n,"INVALID_DETAIL")}','line_number':n,'error_code':error_codes.get(n,'INVALID_DETAIL'),'explanation':'Invalid detail: required fields, ISO date, HHMM time and field count'} for n,_ in invalid]
    if file_error: exceptions.append({**base,'record_id':f'{file_id}:0:{file_error}','line_number':0,'error_code':file_error,'explanation':file_error})
    return dict(zip(TOPICS,[processed,[result],exceptions]))
def generate(run_id,ordinal,sequence,count,scenario,now=None):
    now=now or datetime.datetime.now(datetime.timezone.utc); stamp=now.strftime('%Y%m%d%H%M%S'); seq=f'{sequence:05d}'
    name=f'FMCS0000_BAYNO000_{stamp}_{seq}_R{run_id}_O{ordinal:04d}.csv'
    if scenario=='sequence': scenario=('valid','mixed','rejected')[ (ordinal-1)%3 ]
    bad=0 if scenario=='valid' else max(1,count//10) if scenario=='mixed' else max(1,count//2)
    stream=io.StringIO(); w=csv.writer(stream,lineterminator='\n')
    w.writerow(['00','FMCS0000','BAYNO000',stamp[:8],stamp[8:],seq])
    for i in range(count):
        w.writerow(['01',['MH','AA','SQ'][i%3],f'{1000+(ordinal*count+i)%8000:05d}',now.date().isoformat(),'9999' if i<bad else f'{i%24:02d}{i%60:02d}',['KUL','SIN','BKI'][i%3],f'A{(i+ordinal)%30:02d}'])
    w.writerow(['99','FMCS0000',count]); content=stream.getvalue()
    return name,content,evaluate(content,name,run_id),scenario
