import { dataResponse, errorResponse, jsonBody } from './api';
import type { AgentPreparationProgress } from '@/application/agent-service';

export function createAgentPreparationApi(service:{prepare:(body:Record<string,unknown>,signal:AbortSignal,onProgress?:(event:AgentPreparationProgress)=>void)=>Promise<unknown>}) {
  return async (request:Request):Promise<Response>=>{
    try {
      const body=await jsonBody(request,1048576);
      if(!request.headers.get('accept')?.includes('application/x-ndjson'))return dataResponse(await service.prepare(body,request.signal));
      const abort=new AbortController();
      const stop=()=>abort.abort();request.signal.addEventListener('abort',stop,{once:true});if(request.signal.aborted)stop();
      const encoder=new TextEncoder();let closed=false;
      const stream=new ReadableStream<Uint8Array>({
        start(controller){
          const send=(value:unknown)=>{if(!closed&&!abort.signal.aborted)controller.enqueue(encoder.encode(JSON.stringify(value)+'\n'));};
          void (async()=>{
            try{const data=await service.prepare(body,abort.signal,progress=>send({type:'progress',...progress}));send({type:'result',data});}
            catch(error){if(!abort.signal.aborted)send({type:'error',...await errorResponse(error).json()});}
            finally{request.signal.removeEventListener('abort',stop);if(!closed){closed=true;controller.close();}}
          })();
        },
        cancel(){closed=true;stop();request.signal.removeEventListener('abort',stop);}
      });
      return new Response(stream,{headers:{'content-type':'application/x-ndjson; charset=utf-8','cache-control':'no-store','x-accel-buffering':'no'}});
    }catch(error){return errorResponse(error);}
  };
}
