/** @license BSD-3-Clause */
const check=signal=>signal?.throwIfAborted();
export function createDOMChapterStage({container,sanitize,configure=()=>{},bindResources=async()=>()=>{},restore=async()=>{},report=()=>{}}) {
  if(!container?.ownerDocument||typeof sanitize!=='function'||typeof configure!=='function'||typeof bindResources!=='function'||typeof restore!=='function')throw new Error('Incomplete chapter stage composition');
  return async(result,{signal,index,revision})=>{
    check(signal);
    const root=container.ownerDocument.createElement('div');
    root.dataset.readerChapter='staged';root.setAttribute('aria-hidden','true');root.inert=true;
    let disposed=false,committed=false,prepared=false,preparing=false,releaseResources=null,revealStyle=null;
    const diagnostic=error=>{try{report({type:'stage-cleanup-failed',name:error?.name??'Error'});}catch{}};
    const rollback=()=>{if(disposed)return;disposed=true;signal?.removeEventListener('abort',abortStage);root.remove();try{releaseResources?.();}catch(error){diagnostic(error);}finally{releaseResources=null;}};
    const abortStage=()=>{if(!committed)rollback();};
    const live=()=>{check(signal);if(disposed)throw new DOMException('Chapter stage disposed','AbortError');};
    try{
      configure(root,{index,revision});
      const html=sanitize(result.html);if(typeof html!=='string')throw new Error('Chapter sanitizer must return HTML');root.innerHTML=html;
      revealStyle=new Map(['position','inset','width','visibility','opacity','pointer-events','transition'].map(name=>[name,[root.style.getPropertyValue(name),root.style.getPropertyPriority(name)]]));
      root.style.position='absolute';root.style.inset='0 auto auto 0';if(!root.style.width)root.style.width='100%';
      root.inert=true;root.style.setProperty('visibility','hidden','important');root.style.setProperty('opacity','0','important');
      root.style.setProperty('pointer-events','none','important');root.style.setProperty('transition','none','important');root.setAttribute('aria-hidden','true');
      live();container.appendChild(root);signal?.addEventListener('abort',abortStage,{once:true});live();
      return {root,
        async prepare(){live();if(prepared)return;if(preparing)throw new Error('Concurrent stage preparation');preparing=true;let cleanup=null;
          try{cleanup=await bindResources(root,{signal,index,revision,result});if(typeof cleanup!=='function')throw new Error('Resource binder must return a disposer');live();releaseResources=cleanup;cleanup=null;await restore(root,{signal,index,revision,result});live();prepared=true;}
          catch(error){try{cleanup?.();}catch(e){diagnostic(e);}rollback();throw error;}finally{preparing=false;}},
        commit(){live();if(!prepared)throw new Error('Cannot reveal an unprepared chapter');committed=true;signal?.removeEventListener('abort',abortStage);for(const [name,[value,priority]] of revealStyle)root.style.setProperty(name,value,priority);root.inert=false;root.removeAttribute('aria-hidden');root.dataset.readerChapter='visible';},
        rollback};
    }catch(error){rollback();throw error;}
  };
}