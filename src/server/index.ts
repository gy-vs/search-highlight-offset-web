import express from 'express';
import {fileURLToPath} from 'node:url';
import {searchText} from '../shared/search';

type RecordRow = {id:string;name:string;revision:number;content:string;updatedAt:string};
const rows: RecordRow[] = [
  {id:'alpha',name:'Primary query judgments',revision:3,content:'query judgments: alpha\nstate: active',updatedAt:new Date(0).toISOString()},
  {id:'beta',name:'Secondary query judgments',revision:5,content:'query judgments: beta\nstate: review',updatedAt:new Date(1000).toISOString()},
  {id:'gamma',name:'I18N folding fixtures',revision:1,content:'Straße und STRASSE sind gleich\nİstanbul und Istanbul\nCafe\u0301 vs Caf\u00e9\n👨‍👩‍👧‍👦 family reunion 😀',updatedAt:new Date(2000).toISOString()},
  {id:'delta',name:'Long judgement log',revision:2,content:'judgement log entry 01: query alpha rated relevant\njudgement log entry 02: query beta rated irrelevant\njudgement log entry 03: query gamma rated relevant\njudgement log entry 04: query Straße rated excellent\njudgement log entry 05: query delta rated irrelevant\njudgement log entry 06: query epsilon rated relevant\njudgement log entry 07: query zeta rated irrelevant',updatedAt:new Date(3000).toISOString()},
];

export function createApp(){
  const app=express();
  app.use(express.json({limit:'1mb'}));
  app.get('/api/bootstrap',(_req,res)=>res.json({family:"search-relevance",count:rows.length}));
  app.get('/api/experiments',(_req,res)=>res.json(rows.map(({content,...row})=>row)));
  app.get('/api/experiments/:id',(req,res)=>{const row=rows.find(value=>value.id===req.params.id);if(!row)return res.status(404).json({error:'not_found'});res.set('ETag',String(row.revision)).json(row)});
  app.put('/api/experiments/:id',(req,res)=>{const row=rows.find(value=>value.id===req.params.id);if(!row)return res.status(404).json({error:'not_found'});if(req.body.revision!==row.revision)return res.status(409).json({error:'revision_conflict',current:row});row.content=String(req.body.content??'');row.revision+=1;row.updatedAt=new Date().toISOString();res.json(row)});
  app.post('/api/experiments/:id/analyze',async(req,res)=>{const row=rows.find(value=>value.id===req.params.id);if(!row)return res.status(404).json({error:'not_found'});await new Promise(resolve=>setTimeout(resolve,req.params.id==='alpha'?100:20));res.json({id:row.id,revision:row.revision,lines:String(req.body.content??row.content).split(/\r?\n/).length,diagnostics:[]})});
  // Searches the record (or an unsaved draft) with case/diacritic folding and
  // returns hit ranges in ORIGINAL-text UTF-16 offsets. All normalization and
  // index mapping happens here; clients only consume the structured ranges.
  app.post('/api/experiments/:id/search',(req,res)=>{
    const row=rows.find(value=>value.id===req.params.id);
    if(!row)return res.status(404).json({error:'not_found'});
    const query=String(req.body?.query??'');
    if(!query)return res.status(400).json({error:'empty_query'});
    const content=String(req.body?.content??row.content);
    const {hits,snippets}=searchText(content,query,{
      caseFold:req.body?.caseFold!==false,
      diacriticFold:req.body?.diacriticFold!==false,
      context:req.body?.context,
    });
    res.json({id:row.id,revision:row.revision,query,hits,snippets});
  });
  return app;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){createApp().listen(4174,'127.0.0.1',()=>console.log('server http://127.0.0.1:4174'))}
