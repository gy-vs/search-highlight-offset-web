import {describe, expect, it} from 'vitest';
import request from 'supertest';
import {createApp} from '../src/server/index';

// Seed content of the "gamma" record, for reference in offset assertions:
// 'Straße und STRASSE sind gleich\nİstanbul und Istanbul\nCafe\u0301(NFD) vs Caf\u00e9(NFC)\n<family emoji> family reunion 😀'
const FAMILY = '👨‍👩‍👧‍👦';

describe('service', () => {
  it('loads and conditionally updates a record', async () => {
    const app = createApp();
    const before = await request(app).get('/api/experiments/alpha').expect(200);
    await request(app).put('/api/experiments/alpha').send({content: 'updated', revision: before.body.revision}).expect(200);
    await request(app).put('/api/experiments/alpha').send({content: 'stale', revision: before.body.revision}).expect(409);
  });
});

describe('search endpoint', () => {
  it('returns original UTF-16 ranges for folded ß matches', async () => {
    const app = createApp();
    const {body} = await request(app).post('/api/experiments/gamma/search').send({query: 'strasse'}).expect(200);
    expect(body.hits).toEqual([
      {start: 0, end: 6}, // Straße
      {start: 11, end: 18}, // STRASSE
    ]);
    const content = (await request(app).get('/api/experiments/gamma')).body.content;
    expect(content.slice(body.hits[0].start, body.hits[0].end)).toBe('Straße');
    expect(content.slice(body.hits[1].start, body.hits[1].end)).toBe('STRASSE');
  });

  it('folds Turkish İ and ASCII I to the same hit space', async () => {
    const app = createApp();
    const {body} = await request(app).post('/api/experiments/gamma/search').send({query: 'istanbul'}).expect(200);
    const content = (await request(app).get('/api/experiments/gamma')).body.content;
    const slices = body.hits.map((hit: {start: number; end: number}) => content.slice(hit.start, hit.end));
    expect(slices).toEqual(['İstanbul', 'Istanbul']);
  });

  it('covers the combining mark in NFD text and matches NFC equivalently', async () => {
    const app = createApp();
    const {body} = await request(app).post('/api/experiments/gamma/search').send({query: 'cafe'}).expect(200);
    const content = (await request(app).get('/api/experiments/gamma')).body.content;
    const slices = body.hits.map((hit: {start: number; end: number}) => content.slice(hit.start, hit.end));
    expect(slices).toEqual(['Cafe\u0301', 'Caf\u00e9']);
    expect(body.hits[0].end - body.hits[0].start).toBe(5); // NFD: includes U+0301
    expect(body.hits[1].end - body.hits[1].start).toBe(4); // NFC
  });

  it('keeps emoji ZWJ clusters and surrogate pairs intact', async () => {
    const app = createApp();
    const content = (await request(app).get('/api/experiments/gamma')).body.content;
    const family = await request(app).post('/api/experiments/gamma/search').send({query: FAMILY}).expect(200);
    expect(family.body.hits).toHaveLength(1);
    const hit = family.body.hits[0];
    expect(content.slice(hit.start, hit.end)).toBe(FAMILY);
    expect(hit.end - hit.start).toBe(11);
    const smiley = await request(app).post('/api/experiments/gamma/search').send({query: '😀'}).expect(200);
    expect(smiley.body.hits[0].end - smiley.body.hits[0].start).toBe(2);
  });

  it('reports adjacent hits as separate ranges', async () => {
    const app = createApp();
    const {body} = await request(app)
      .post('/api/experiments/alpha/search')
      .send({content: 'aaaa', query: 'aa'})
      .expect(200);
    expect(body.hits).toEqual([
      {start: 0, end: 2},
      {start: 2, end: 4},
    ]);
  });

  it('trims snippets around the hit and keeps ranges relative', async () => {
    const app = createApp();
    const content = 'x'.repeat(100) + 'needle' + 'y'.repeat(100);
    const {body} = await request(app)
      .post('/api/experiments/alpha/search')
      .send({content, query: 'needle', context: 20})
      .expect(200);
    expect(body.hits).toEqual([{start: 100, end: 106}]);
    expect(body.snippets).toHaveLength(1);
    const snippet = body.snippets[0];
    expect(snippet.text).toBe(content.slice(80, 126));
    expect(snippet.ranges).toEqual([{start: 20, end: 26}]);
    expect(snippet.text.slice(20, 26)).toBe('needle');
    expect(snippet.ellipsisBefore).toBe(true);
    expect(snippet.ellipsisAfter).toBe(true);
  });

  it('rejects empty queries and unknown records', async () => {
    const app = createApp();
    await request(app).post('/api/experiments/alpha/search').send({query: ''}).expect(400);
    await request(app).post('/api/experiments/nope/search').send({query: 'x'}).expect(404);
  });
});
