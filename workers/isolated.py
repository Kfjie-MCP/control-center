"""One process per connection; credentials arrive only over stdin."""
import asyncio, base64, contextlib, importlib, ipaddress, json, os, pathlib, socket, sys, time

protocol=sys.stdout
sys.stdout=sys.stderr
socket.setdefaulttimeout(45)
def emit(value):
    protocol.write(json.dumps(value,ensure_ascii=False,default=str)+'\n');protocol.flush()
def dump(value):
    if hasattr(value,'model_dump'):return value.model_dump(mode='json',by_alias=True,exclude_none=True)
    return value

async def main():
    init=json.loads(sys.stdin.readline())
    service=init['service'];base=pathlib.Path(init['source']);home=pathlib.Path.cwd();downloads=home/'downloads';downloads.mkdir(exist_ok=True,mode=0o700)
    accounts=init['accounts']
    sys.path.insert(0,str(base))
    if service=='mailbridge':
        sys.path.insert(0,str(base/'upstream'/'server'))
        import config
        config.CONFIG_DIR=str(home);config.TOKEN_DIR=str(home/'tokens')
        import server as app
        cfg=object.__new__(config.Config);cfg.path='private';cfg.accounts=[config.Account({**a['credentials'],'name':a['id']}) for a in accounts];cfg.default_account=cfg.accounts[0].name
        app.cfg=lambda:cfg
        app.reload_config=lambda:None
        app.i18n.localize_server(app.server)
        tools=[t.spec() for t in app.server._tools.values()]
    elif service=='xuexitong':
        import xuexitong_mcp.chapter_resources as resources
        resources._CACHE_DIR=downloads/'temp_cache'
        import xuexitong_mcp.server as app
        from xuexitong_mcp.client import ChaoxingClient
        creds=accounts[0]['credentials'];client=ChaoxingClient(config_dir=str(home),phone=creds['phone'],password=creds['password'])
        app._client=lambda:client
        tools=[dump(t) for t in await app.mcp.list_tools() if t.name!='login']
    elif service=='agent-reach':
        import server as app
        app.CLI=str(base/'bin'/'agent-reach')
        tools=[dump(t) for t in await app.mcp.list_tools()]
    else:raise ValueError('Unsupported worker service')
    emit({'ready':True})
    for line in sys.stdin:
        req=json.loads(line);rid=req['id']
        try:
            method=req['method'];params=req.get('params') or {}
            if method=='tools/list':result={'tools':tools}
            elif method=='tools/call':
                name=params['name'];args=dict(params.get('arguments') or {})
                if name not in [t['name'] for t in tools]:raise ValueError('Unknown tool')
                # Tools cannot read/write arbitrary server paths or attach credentials.
                for key in ('dest_dir','save_dir'):
                    if key in args:args[key]=str(downloads)
                if service=='mailbridge' and name=='mail_download_attachment':args['dest_dir']=str(downloads)
                if 'out_path' in args:
                    suffix='.json' if str(args['out_path']).endswith('.json') else '.csv'
                    import uuid
                    args['out_path']=str(downloads/(uuid.uuid4().hex+suffix))
                if 'filename' in args:args['filename']=pathlib.Path(str(args['filename']).replace('\\','/')).name
                if req.get('output'):
                    output=pathlib.Path(req['output'])
                    if output.parent.parent!=downloads or not output.parent.name.startswith('.export-'):
                        raise ValueError('Invalid tool output path')
                    if service=='mailbridge' and name=='mail_export' and output.name in ('result.csv','result.json'):
                        args['out_path']=str(output)
                    elif service=='xuexitong' and name=='export_schedule_ics' and output.name=='result.ics':
                        args['save_dir']=str(output.parent)
                        args['filename']=output.name
                    else:
                        raise ValueError('Unexpected tool output path')
                if args.get('attachments'):
                    for attachment in args['attachments']:
                        path=pathlib.Path(attachment).resolve()
                        if downloads.resolve() not in path.parents or path.is_symlink():raise ValueError('Attachment outside this connection')
                if service=='mailbridge':
                    deadline=time.monotonic()+20
                    for account in cfg.accounts:
                        app.backend_for(account.name).index_deadline=deadline
                    value=await asyncio.to_thread(app.server._tools[name].handler,**args)
                    result={'content':[{'type':'text','text':json.dumps(value,ensure_ascii=False,default=str)}],'isError':False}
                else:
                    value=await app.mcp.call_tool(name,args)
                    if hasattr(value,'model_dump'):result=dump(value)
                    elif isinstance(value,tuple):result={'content':[dump(x) for x in value[0]],'structuredContent':value[1]}
                    else:result={'content':[dump(x) for x in value]}
            elif method=='resources/list':result={'resources':[]}
            elif method=='resources/templates/list':result={'resourceTemplates':[]}
            elif method=='resources/read' and service=='xuexitong':
                values=await app.mcp.read_resource(params['uri']);contents=[]
                for value in values:
                    item={'uri':params['uri'],'mimeType':value.mime_type}
                    item.update({'blob':base64.b64encode(value.content).decode()} if isinstance(value.content,bytes) else {'text':value.content});contents.append(item)
                result={'contents':contents}
            else:raise ValueError('Unsupported operation')
            emit({'id':rid,'result':result})
        except Exception as error:
            # Do not expose credentials or full upstream exception payloads.
            cause=error
            while cause.__cause__ is not None:cause=cause.__cause__
            code='UPSTREAM_ERROR';message='操作失败，请检查账号凭据、权限和请求参数。';details={}
            if getattr(cause,'code',None)=='MAIL_INDEX_PENDING':
                code='MAIL_INDEX_PENDING';message=str(cause);details={'completed':cause.completed,'total':cause.total,'retryAfterSeconds':2}
            elif isinstance(cause,TimeoutError):
                code='UPSTREAM_TIMEOUT';message='邮箱或平台响应超时，请稍后重试。'
            elif isinstance(cause,(TypeError,ValueError)):
                code='INVALID_ARGUMENTS';message='请求参数无效，请检查账号和工具参数。'
            print('MCP_DIAGNOSTIC '+json.dumps({'code':code,'errorType':type(cause).__name__}),file=sys.stderr,flush=True)
            emit({'id':rid,'result':{'content':[{'type':'text','text':message}],'structuredContent':{'error':{'code':code,'retryable':code in ('MAIL_INDEX_PENDING','UPSTREAM_TIMEOUT'),**details}},'isError':True}})

try:asyncio.run(main())
except Exception:emit({'error':'Worker initialization failed'});sys.exit(1)
