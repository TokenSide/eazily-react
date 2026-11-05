import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase.js';
export default function MediaPreview({ media = [] }) {
 const [urls,setUrls]=useState([]);
 useEffect(()=>{let active=true;if(supabase&&media.length)supabase.storage.from('partner-media').createSignedUrls(media.map(m=>m.path),300).then(({data})=>{if(active)setUrls(data||[]);});return()=>{active=false;};},[media]);
 return <div className="seller-media">{media.map((m,i)=><figure key={m.path}>{urls[i]?.signedUrl?(m.type?.startsWith('video/')?<video controls preload="metadata" src={urls[i].signedUrl}/>:<img loading="lazy" alt={m.name} src={urls[i].signedUrl}/>):<figcaption>{m.name}</figcaption>}</figure>)}</div>;
}
