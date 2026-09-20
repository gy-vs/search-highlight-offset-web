import express from 'express';
import {fileURLToPath} from 'node:url';
import {
  buildSnippet,
  findMatches,
  type FoldOptions,
  type Range,
} from '../shared/textMapping';

type RecordRow = {id:string;name:string;revision:number;content:string;updatedAt:string};
const rows: RecordRow[] = [
  {id:'alpha',name:'Primary query judgments',revision:3,content:'query judgments: alpha\nstate: active',updatedAt:new Date(0).toISOString()},
  {id:'beta',name:'Secondary query judgments',revision:5,content:'query judgments: beta\nstate: review',updatedAt:new Date(1000).toISOString()},
  // "Größe"/"maß" in NFC content ...
  {id:'grimm',name:'Größe der Maßnahmen',revision:2,content:'Die GRÖSSE der Maßnahmen ist in der Straße zu prüfen.\nBitte die FUSSSPUR nicht vergessen.',updatedAt:new Date(2000).toISOString()},
  // ... and NFD-normalized café to prove NFC/NFD equivalence.
  {id:'cafe',name:'Café résumé'.normalize('NFD'),revision:1,content:'CAFÉ'.normalize('NFD')+' — le résumé est prêt, merci de vérifier le naïf aperçu.',updatedAt:new Date(3000).toISOString()},
  // Turkish dotted/dotless I. Lowercase "ırmak" (dotless ı) only matches
  // ASCII "irmak" under Turkish folding.
  {id:'takim',name:'İstanbul takımı',revision:1,content:'İstanbul takım listesi: ırmak ilk beş oyuncu hazır, lütfen not alınız.',updatedAt:new Date(4000).toISOString()},
  // Emoji with ZWJ sequences, skin-tone modifiers and combining marks.
  {id:'emoji-note',name:'Family emoji notes 👨‍👩‍👧',revision:4,content:'Release party 🎉 with the 👨‍👩‍👧 family and 👋🏾 wave.\nTag: é-acute orphan mark check.',updatedAt:new Date(5000).toISOString()},
];

interface SearchBody {
  query?: unknown;
  caseFold?: unknown;
  stripMarks?: unknown;
  turkish?: unknown;
  limit?: unknown;
}

interface SearchResult {
  id: string;
  name: string;
  revision: number;
  updatedAt: string;
  nameRanges: Range[];
  snippet: ReturnType<typeof buildSnippet>;
  matchCount: number;
}

function asBool(value: unknown): boolean {
  return value === true || value === 'true';
}

function searchRows(rawQuery: string, options: FoldOptions, limit: number): SearchResult[] {
  const results: SearchResult[] = [];
  for (const row of rows) {
    const nameRanges = findMatches(rawQuery, row.name, options);
    const contentRanges = findMatches(rawQuery, row.content, options);
    if (nameRanges.length + contentRanges.length === 0) continue;
    results.push({
      id: row.id,
      name: row.name,
      revision: row.revision,
      updatedAt: row.updatedAt,
      nameRanges,
      snippet: buildSnippet(row.content, contentRanges),
      matchCount: nameRanges.length + contentRanges.length,
    });
    if (results.length >= limit) break;
  }
  return results;
}

export function createApp(){
  const app=express();
  app.use(express.json({limit:'1mb'}));
  app.get('/api/bootstrap',(_req,res)=>res.json({family:"search-relevance",count:rows.length}));
  app.get('/api/experiments',(_req,res)=>res.json(rows.map(({content,...row})=>row)));
  app.get('/api/experiments/:id',(req,res)=>{const row=rows.find(value=>value.id===req.params.id);if(!row)return res.status(404).json({error:'not_found'});res.set('ETag',String(row.revision)).json(row)});
  app.put('/api/experiments/:id',(req,res)=>{const row=rows.find(value=>value.id===req.params.id);if(!row)return res.status(404).json({error:'not_found'});if(req.body.revision!==row.revision)return res.status(409).json({error:'revision_conflict',current:row});row.content=String(req.body.content??'');row.revision+=1;row.updatedAt=new Date().toISOString();res.json(row)});
  app.post('/api/experiments/:id/analyze',async(req,res)=>{const row=rows.find(value=>value.id===req.params.id);if(!row)return res.status(404).json({error:'not_found'});await new Promise(resolve=>setTimeout(resolve,req.params.id==='alpha'?100:20));res.json({id:row.id,revision:row.revision,lines:String(req.body.content??row.content).split(/\r?\n/).length,diagnostics:[]})});

  // Search returns *structured ranges only*: every range is a half-open
  // UTF-16 interval of the ORIGINAL text (or of snippet.text for the
  // snippet). The client renders them verbatim and never re-normalizes.
  app.post('/api/search',(req,res)=>{
    const body=(req.body ?? {}) as SearchBody;
    const query=String(body.query ?? '');
    const options:FoldOptions={
      caseFold:asBool(body.caseFold),
      stripMarks:asBool(body.stripMarks),
      turkish:asBool(body.turkish),
    };
    const limit=Math.max(0,Math.min(100,Number(body.limit)||50));
    if(query.length===0)return res.json({query,options,total:0,results:[]});
    const results=searchRows(query,options,limit);
    res.json({query,options,total:results.length,results});
  });

  return app;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){createApp().listen(4174,'127.0.0.1',()=>console.log('server http://127.0.0.1:4174'))}
