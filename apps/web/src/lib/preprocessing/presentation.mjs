/** @license BSD-3-Clause */
export class ChapterOpeningController {
  constructor({session, stage, ready = () => {}, report = () => {}, isVisible = () => true}) {
    this.session=session;this.stage=stage;this.ready=ready;this.report=report;this.isVisible=isVisible;this.ticket=0;this.disposed=false;this.current=null;
  }
  async open(index) {
    if(this.disposed)throw new DOMException('Reader closed','AbortError');
    const ticket=++this.ticket;let staged=null,unmount=null;
    const check=()=>{if(this.disposed||ticket!==this.ticket)throw new DOMException('Superseded','AbortError');};
    try{
      const {result,revision,signal}=await this.session.open(index);check();
      staged=await this.stage(result,{index,revision,signal});check();
      if(!staged?.root||typeof staged.commit!=='function'||typeof staged.rollback!=='function')throw new Error('Invalid renderer stage');
      if(result.sidecar!==null){unmount=await this.session.provider.mount(staged.root,result.sidecar);if(typeof unmount!=='function')throw new Error('Preprocessor mount must return a disposer');}
      check();if(typeof staged.prepare==='function')await staged.prepare({signal,index,revision});check();
      await this.session.admitPresentation(revision,result);check();
      const previous=this.current;staged.commit();this.current={stage:staged,unmount};staged=null;unmount=null;
      try{previous?.unmount?.();}catch{}try{previous?.stage.rollback();}catch{}
      try{this.ready({index,revision,hasAnnotations:result.sidecar!==null});}catch{}
      this.session.didPresent(revision,{isVisible:this.isVisible});return result;
    }catch(error){try{unmount?.();}catch{}try{staged?.rollback?.();}catch{}if(!this.disposed&&ticket===this.ticket){try{this.report({type:'opening-failed',name:error?.name??'Error'});}catch{}}throw error;}
  }
  dispose(){if(this.disposed)return;this.disposed=true;++this.ticket;this.session.dispose();try{this.current?.unmount?.();}finally{this.current?.stage.rollback();this.current=null;}}
}
export function chapterForResume(sectionCounts, exploredCharCount) {
  if(!Array.isArray(sectionCounts)||!sectionCounts.every(n=>Number.isSafeInteger(n)&&n>=0))throw new Error('Invalid section counts');
  if(!Number.isSafeInteger(exploredCharCount)||exploredCharCount<0)throw new Error('Invalid resume location');
  if(sectionCounts.length===0)return -1;if(exploredCharCount===0)return 0;
  let total=0;for(let i=0;i<sectionCounts.length;++i){total+=sectionCounts[i];if(!Number.isSafeInteger(total))throw new Error('Character count overflow');if(exploredCharCount<total)return i;}
  return sectionCounts.length-1;
}