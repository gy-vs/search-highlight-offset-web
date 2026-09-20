import {useEffect,useMemo,useRef,useState} from 'react';
import {FlaskConical,Play,Save,Search} from 'lucide-react';
import {HighlightText} from './HighlightText';
import {VirtualList} from './VirtualList';
import type {FoldOptions,Range} from '../shared/textMapping';

type Summary={id:string;name:string;revision:number;updatedAt:string};
type Row=Summary&{content:string};

interface SnippetResult {
  text:string;
  ranges:Range[];
  start:number;
  end:number;
  prefixEllipsis:boolean;
  suffixEllipsis:boolean;
}

interface SearchResult {
  id:string;
  name:string;
  revision:number;
  updatedAt:string;
  nameRanges:Range[];
  snippet:SnippetResult;
  matchCount:number;
}

interface SearchResponse {
  total:number;
  results:SearchResult[];
}

const ROW_HEIGHT=76;

export default function App(){
  const [items,setItems]=useState<Summary[]>([]);
  const [selected,setSelected]=useState('alpha');
  const [row,setRow]=useState<Row|null>(null);
  const [draft,setDraft]=useState('');
  const [analysis,setAnalysis]=useState<unknown>(null);
  const [status,setStatus]=useState('Ready');
  useEffect(()=>{fetch('/api/experiments').then(r=>r.json()).then(setItems)},[]);
  useEffect(()=>{setStatus('Loading');fetch('/api/experiments/'+selected).then(r=>r.json()).then((value:Row)=>{setRow(value);setDraft(value.content);setStatus('Loaded')})},[selected]);
  async function save(){if(!row)return;setStatus('Saving');const response=await fetch('/api/experiments/'+row.id,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({content:draft,revision:row.revision})});const value=await response.json();if(!response.ok){setStatus('Revision conflict');return}setRow(value);setStatus('Saved')}
  async function analyze(){if(!row)return;setStatus('Analyzing');const response=await fetch('/api/experiments/'+row.id+'/analyze',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({content:draft})});setAnalysis(await response.json());setStatus('Ready')}
  return <main className="shell"><header className="topbar"><FlaskConical size={20}/><strong>Search Relevance Lab</strong><small>Local workspace</small></header><section className="workspace"><aside className="pane"><h2>Items</h2><div className="list">{items.map(item=><button className={item.id===selected?'active':''} onClick={()=>setSelected(item.id)} key={item.id}>{item.name}<br/><small>Revision {item.revision}</small></button>)}</div></aside><section className="pane"><div className="toolbar"><button className="primary" onClick={save}><Save size={15}/>Save</button><button onClick={analyze}><Play size={15}/>Analyze</button><span>{status}</span></div><textarea aria-label="Content" value={draft} onChange={event=>setDraft(event.target.value)}/></section><aside className="pane"><h2>Inspection</h2><span className="pill">{selected}</span><pre>{JSON.stringify(analysis??row,null,2)}</pre></aside><SearchWorkbench onOpen={setSelected}/></section></main>;
}

function SearchWorkbench({onOpen}:{onOpen:(id:string)=>void}){
  const [query,setQuery]=useState('');
  const [caseFold,setCaseFold]=useState(true);
  const [stripMarks,setStripMarks]=useState(true);
  const [turkish,setTurkish]=useState(false);
  const [results,setResults]=useState<SearchResult[]>([]);
  const [searching,setSearching]=useState(false);
  // Monotonic token: each debounced request gets a higher id, so a slow
  // earlier response can never overwrite a newer one (which would otherwise
  // leave recycled virtual rows showing the previous query's highlights).
  const requestSeq=useRef(0);

  const options:FoldOptions=useMemo(()=>({caseFold,stripMarks,turkish}),[caseFold,stripMarks,turkish]);

  // Debounced server search. The client sends flags + raw query and renders
  // the returned ranges; all folding and offset mapping lives server-side.
  useEffect(()=>{
    const seq=requestSeq.current+1;
    requestSeq.current=seq;
    setSearching(query.length>0);
    if(query.length===0){
      setResults([]);
      return;
    }
    const handle=setTimeout(()=>{
      fetch('/api/search',{
        method:'POST',
        headers:{'content-type':'application/json'},
        body:JSON.stringify({query,...options}),
      })
        .then(r=>r.json())
        .then((data:SearchResponse)=>{
          if(seq!==requestSeq.current)return;
          setResults(data.results);
        })
        .finally(()=>{
          if(seq===requestSeq.current)setSearching(false);
        });
    },120);
    return ()=>clearTimeout(handle);
  },[query,options]);

  return <section className="pane search-pane"><h2><Search size={16}/>Search workbench</h2>
    <div className="search-box">
      <input
        aria-label="Search query"
        placeholder="query (try ss, grösse, cafe, istanbul, 👨)…"
        value={query}
        onChange={event=>setQuery(event.target.value)}
      />
      <label className="toggle"><input type="checkbox" checked={caseFold} onChange={e=>setCaseFold(e.target.checked)}/>Case fold (ß→ss)</label>
      <label className="toggle"><input type="checkbox" checked={stripMarks} onChange={e=>setStripMarks(e.target.checked)}/>Strip diacritics</label>
      <label className="toggle"><input type="checkbox" checked={turkish} onChange={e=>setTurkish(e.target.checked)}/>Turkish I</label>
    </div>
    <div className="search-meta">{searching?'Searching…':`${results.length} result${results.length===1?'':'s'}`}</div>
    <VirtualList
      items={results}
      rowHeight={ROW_HEIGHT}
      rowKey={item=>item.id+':'+item.revision}
      emptyLabel={query?'No matches':'Type to search'}
      renderRow={item=>(
        <button className="result-row" onClick={()=>onOpen(item.id)}>
          <span className="result-name"><HighlightText text={item.name} ranges={item.nameRanges}/></span>
          <span className="result-snippet">
            {item.snippet.prefixEllipsis&&'…'}
            <HighlightText text={item.snippet.text} ranges={item.snippet.ranges}/>
            {item.snippet.suffixEllipsis&&'…'}
          </span>
          <small className="result-foot">{item.matchCount} match{item.matchCount===1?'':'es'} · rev {item.revision}</small>
        </button>
      )}
    />
  </section>;
}
