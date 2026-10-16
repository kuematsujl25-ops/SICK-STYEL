// D1 bindings are server-only. Every batch is transactional; SQL never includes interpolated data.
export function createD1Store(db){
 if(!db?.prepare||!db?.batch)throw Error('D1のDBバインディングが未設定です');
 function statement(text,values=[]){const params=[];const sql=text.replace(/\$(\d+)/g,(_,n)=>{params.push(values[Number(n)-1]);return '?';});return db.prepare(sql).bind(...params);}
 const query=async(text,values=[])=>{const result=await statement(text,values).all();if(!result.success)throw Error('D1 query failed');return result.results||[];};
 const transaction=async commands=>{if(!commands.length)return [];const results=await db.batch(commands.map(([text,values=[]])=>statement(text,values)));return results.map(r=>{if(!r.success)throw Error('D1 batch failed');return r.results||[];});};
 return {query,transaction,kind:'d1',close(){},async doc(name){return (await query('SELECT body,revision FROM ss_documents WHERE name=$1',[name]))[0];},async put(name,data){return query('INSERT INTO ss_documents(name,body) VALUES ($1,$2) ON CONFLICT(name) DO UPDATE SET body=excluded.body,revision=ss_documents.revision+1 RETURNING revision',[name,JSON.stringify(data)]);}};
}
