import {describe,expect,it} from 'vitest';
import request from 'supertest';
import {createApp} from '../src/server/index';

describe('service',()=>{it('loads and conditionally updates a record',async()=>{const app=createApp();const before=await request(app).get('/api/experiments/alpha').expect(200);await request(app).put('/api/experiments/alpha').send({content:'updated',revision:before.body.revision}).expect(200);await request(app).put('/api/experiments/alpha').send({content:'stale',revision:before.body.revision}).expect(409)})});

describe('POST /api/search',()=>{
  it('maps German ß folds onto full source graphemes',async()=>{
    const app=createApp();
    const res=await request(app).post('/api/search').send({query:'grösse',caseFold:true,stripMarks:true}).expect(200);
    const grimm=res.body.results.find((r:any)=>r.id==='grimm');
    expect(grimm).toBeTruthy();
    // nameRanges are original-text UTF-16 ranges covering "Größe"
    // (5 UTF-16 units: ß is a single BMP code unit).
    const [range]=grimm.nameRanges;
    expect(range.end-range.start).toBe(5);
    expect(grimm.name.slice(range.start,range.end)).toBe('Größe');
  });

  it('treats NFD content identically to NFC and covers combining marks',async()=>{
    const app=createApp();
    const res=await request(app).post('/api/search').send({query:'cafe',caseFold:true,stripMarks:true}).expect(200);
    const cafe=res.body.results.find((r:any)=>r.id==='cafe');
    expect(cafe).toBeTruthy();
    const [range]=cafe.snippet.ranges;
    // Highlight slice must round-trip to CAFÉ.
    const sliced=cafe.snippet.text.slice(range.start,range.end);
    expect(sliced.normalize('NFC')).toContain('CAFÉ');
  });

  it('honors Turkish I option: capital dotless I only matches under Turkish rules',async()=>{
    const app=createApp();
    // Content contains "IRMAK"; Turkish folds I -> ı so "irmak" matches.
    const tr=await request(app).post('/api/search').send({query:'irmak',caseFold:true,turkish:true}).expect(200);
    expect(tr.body.results.some((r:any)=>r.id==='takim')).toBe(true);
    // Default folding turns I -> i, which cannot match dotless "ırmak".
    const plain=await request(app).post('/api/search').send({query:'irmak',caseFold:true}).expect(200);
    expect(plain.body.results.some((r:any)=>r.id==='takim')).toBe(false);
  });

  it('emoji query covers the complete ZWJ cluster',async()=>{
    const app=createApp();
    const res=await request(app).post('/api/search').send({query:'👨‍👩‍👧'}).expect(200);
    const note=res.body.results.find((r:any)=>r.id==='emoji-note');
    expect(note).toBeTruthy();
    const [range]=note.nameRanges;
    const name=note.name as string;
    expect(name.slice(range.start,range.end)).toBe('👨‍👩‍👧');
  });

  it('returns empty for a blank query',async()=>{
    const app=createApp();
    const res=await request(app).post('/api/search').send({query:''}).expect(200);
    expect(res.body.total).toBe(0);
    expect(res.body.results).toEqual([]);
  });
});
