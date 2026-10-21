import {createHash} from 'node:crypto';
export const bytesHash=bytes=>createHash('sha256').update(bytes).digest('hex');
// Fatal, streaming decoding preserves split code points and rejects malformed/truncated UTF-8.
// Raw bytes and decoded text have distinct provenance even when their UTF-8 SHA256 values coincide.
export class Utf8Capture {
  constructor(limit){this.limit=limit;this.chunks=[];this.bytes_seen=0;this.bytes_stored=0;this.text='';
    this.truncated=false;this.valid=true;this.ended=false;this.decoder=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});}
  write(chunk){
    if(this.ended||!Buffer.isBuffer(chunk))throw Error('capture state');
    this.bytes_seen+=chunk.length;
    const saved=Buffer.from(chunk.subarray(0,Math.max(0,this.limit-this.bytes_stored)));
    this.chunks.push(saved);this.bytes_stored+=saved.length;
    if(saved.length!==chunk.length){this.truncated=true;this.valid=false;throw Error('capture limit');}
    try{const text=this.decoder.decode(saved,{stream:true});this.text+=text;return text;}
    catch{this.valid=false;throw Error('invalid UTF-8');}
  }
  end(){
    if(!this.ended){this.ended=true;try{this.text+=this.decoder.decode();}catch{this.valid=false;}}
    return this.snapshot();
  }
  snapshot(){const raw=Buffer.concat(this.chunks);return {raw,text:this.text,bytes_seen:this.bytes_seen,bytes_stored:this.bytes_stored,
    truncated:this.truncated,utf8_valid:this.valid,ended:this.ended,raw_bytes_sha256:bytesHash(raw),
    decoded_utf8_sha256:bytesHash(Buffer.from(this.text,'utf8'))};}
}
