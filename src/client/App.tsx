import {useEffect,useState} from 'react';
import {FlaskConical,Play,Save,Search} from 'lucide-react';
import {segments,type Range,type Snippet} from '../shared/search';
import {SnippetList} from './SnippetList';
type Summary={id:string;name:string;revision:number;updatedAt:string};
type Row=Summary&{content:string};
// Snapshot of the content exactly as it was when the server computed the
// ranges, so highlights can never drift against a later-edited draft.
type SearchState={content:string;hits:Range[];snippets:Snippet[]};
export default function App(){
  const [items,setItems]=useState<Summary[]>([]);const [selected,setSelected]=useState('alpha');const [row,setRow]=useState<Row|null>(null);const [draft,setDraft]=useState('');const [analysis,setAnalysis]=useState<unknown>(null);const [status,setStatus]=useState('Ready');
  const [query,setQuery]=useState('');const [result,setResult]=useState<SearchState|null>(null);
  useEffect(()=>{fetch('/api/experiments').then(r=>r.json()).then(setItems)},[]);
  useEffect(()=>{setStatus('Loading');setResult(null);fetch('/api/experiments/'+selected).then(r=>r.json()).then((value:Row)=>{setRow(value);setDraft(value.content);setStatus('Loaded')})},[selected]);
  async function save(){if(!row)return;setStatus('Saving');const response=await fetch('/api/experiments/'+row.id,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({content:draft,revision:row.revision})});const value=await response.json();if(!response.ok){setStatus('Revision conflict');return}setRow(value);setStatus('Saved')}
  async function analyze(){if(!row)return;setStatus('Analyzing');const response=await fetch('/api/experiments/'+row.id+'/analyze',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({content:draft})});setAnalysis(await response.json());setStatus('Ready')}
  // The server owns normalization and returns original-text UTF-16 ranges;
  // the client only slices by those structured ranges and never re-folds.
  async function search(){if(!row||!query)return;setStatus('Searching');const response=await fetch('/api/experiments/'+row.id+'/search',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({query,content:draft})});const value=await response.json();if(!response.ok){setStatus('Search failed');return}setResult({content:draft,hits:value.hits,snippets:value.snippets});setStatus(value.hits.length+' hit(s)')}
  return <main className="shell"><header className="topbar"><FlaskConical size={20}/><strong>Search Relevance Lab</strong><small>Local workspace</small></header><section className="workspace"><aside className="pane"><h2>Items</h2><div className="list">{items.map(item=><button className={item.id===selected?'active':''} onClick={()=>setSelected(item.id)} key={item.id}>{item.name}<br/><small>Revision {item.revision}</small></button>)}</div></aside><section className="pane"><div className="toolbar"><button className="primary" onClick={save}><Save size={15}/>Save</button><button onClick={analyze}><Play size={15}/>Analyze</button><span>{status}</span></div><div className="toolbar"><input aria-label="Search query" placeholder="Search (case/diacritic folding)" value={query} onChange={event=>setQuery(event.target.value)} onKeyDown={event=>{if(event.key==='Enter')search()}}/><button onClick={search}><Search size={15}/>Search</button></div><textarea aria-label="Content" value={draft} onChange={event=>setDraft(event.target.value)}/>{result&&<div className="preview" aria-label="Highlight preview">{segments(result.content,result.hits).map((segment,index)=>segment.hit?<mark key={index}>{segment.text}</mark>:<span key={index}>{segment.text}</span>)}</div>}</section><aside className="pane"><h2>Inspection</h2><span className="pill">{selected}</span>{result&&(result.snippets.length>0?<SnippetList snippets={result.snippets}/>:<p className="empty">No hits</p>)}<pre>{JSON.stringify(analysis??row,null,2)}</pre></aside></section></main>;
}
