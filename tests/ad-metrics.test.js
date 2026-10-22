import {test} from 'node:test';
import assert from 'node:assert/strict';
import {empty,validate} from '../lib/domain.js';

const ad=(over={})=>({id:'a1',platform:'Amazon',periodStart:'2026-10-01',periodEnd:'2026-10-20',
 attributionWindowDays:14,adCost:5000,attributedSales:30000,source:'manual',campaign:'10月定番商品',
 updatedAt:'2026-10-20T00:00:00.000Z',...over});

test('valid ad metrics record round-trips through validate, legacy docs without adMetrics key migrate to []', () => {
 const d=empty();d.brand.Mission='m';d.adMetrics.push(ad());
 assert.equal(validate(d).adMetrics[0].platform,'Amazon');
 const legacy={goals:[],tasks:[],shipments:[],metrics:[],brand:{理念:'',起源:'',Mission:'m',Vision:'',Values:''}};
 assert.deepEqual(validate(legacy).adMetrics,[]);
});

test('platform must be Amazon or Instagram — no silent acceptance of unknown ad channels', () => {
 const d=empty();d.brand.Mission='m';d.adMetrics.push(ad({platform:'TikTok'}));
 assert.throws(()=>validate(d));
});

test('period end before start is rejected', () => {
 const d=empty();d.brand.Mission='m';d.adMetrics.push(ad({periodEnd:'2026-09-01'}));
 assert.throws(()=>validate(d));
});

test('adCost/attributedSales accept null (未取得) but reject negative values', () => {
 const d=empty();d.brand.Mission='m';d.adMetrics.push(ad({adCost:null,attributedSales:null}));
 assert.doesNotThrow(()=>validate(d));
 const neg=empty();neg.brand.Mission='m';neg.adMetrics.push(ad({adCost:-1}));
 assert.throws(()=>validate(neg));
});

test('attributionWindowDays accepts null or a bounded non-negative integer', () => {
 const d=empty();d.brand.Mission='m';d.adMetrics.push(ad({attributionWindowDays:null}));
 assert.doesNotThrow(()=>validate(d));
 const bad=empty();bad.brand.Mission='m';bad.adMetrics.push(ad({attributionWindowDays:-5}));
 assert.throws(()=>validate(bad));
 const tooLong=empty();tooLong.brand.Mission='m';tooLong.adMetrics.push(ad({attributionWindowDays:1000}));
 assert.throws(()=>validate(tooLong));
});

test('source must be manual or csv — no fabricated "api" source while Amazon Ads API is unconnected', () => {
 const d=empty();d.brand.Mission='m';d.adMetrics.push(ad({source:'api'}));
 assert.throws(()=>validate(d));
});

test('duplicate ids within adMetrics are rejected, same as every other collection', () => {
 const d=empty();d.brand.Mission='m';d.adMetrics.push(ad({id:'dup'}),ad({id:'dup',platform:'Instagram'}));
 assert.throws(()=>validate(d));
});
