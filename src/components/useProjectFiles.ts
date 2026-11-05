import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { parseProject, serializeProject } from '../model/persistence';
import type { Project } from '../model/types';

interface NativeDocument { documentId:string; fileName:string; path:string }
interface FileBridge {
  open():Promise<(NativeDocument & {content:string})|null>;
  save(request:{documentId?:string;content:string;suggestedName:string;saveAs?:boolean;automatic?:boolean}):Promise<NativeDocument|null>;
}
interface WritableFile { write(content:string):Promise<void>; close():Promise<void>; abort?():Promise<void> }
interface BrowserFile {
  name:string;
  getFile():Promise<File>;
  createWritable():Promise<WritableFile>;
  queryPermission?(options:{mode:'readwrite'}):Promise<PermissionState>;
  requestPermission?(options:{mode:'readwrite'}):Promise<PermissionState>;
}
interface FileWindow extends Window {
  electricalFiles?:FileBridge;
  showOpenFilePicker?:(options:unknown)=>Promise<BrowserFile[]>;
  showSaveFilePicker?:(options:unknown)=>Promise<BrowserFile>;
}
type Target = {kind:'native';document:NativeDocument}|{kind:'browser';handle:BrowserFile};
const fileWindow=()=>window as FileWindow;
const pickerTypes=[{description:'Sơ đồ Electrical Studio',accept:{'application/json':['.electrical.json']}}];
const fileName=(project:Project)=>`${project.name.replace(/[^\p{L}\p{N} _-]/gu,'').slice(0,60)||'so-do'}.electrical.json`;
const cancelled=(error:unknown)=>error instanceof Error&&error.name==='AbortError';

/** Disk saves are separate from the always-on local recovery copy. Each opened
 * document gets its own generation, so delayed pickers/writes cannot adopt a
 * target belonging to a previous drawing. Writes are serialized across targets. */
export function useProjectFiles(project:Project,onError:(message:string)=>void){
  const content=useMemo(()=>{try{return serializeProject(project);}catch{return null;}},[project]);
  const current=useRef({project,content});current.current={project,content};
  const notify=useRef(onError);notify.current=onError;
  const target=useRef<Target|null>(null);
  const generation=useRef(0);
  const queue=useRef<Promise<void>>(Promise.resolve());
  const savePending=useRef(0);
  const pickerPending=useRef(false);
  const autoRef=useRef(false);
  const [autoSave,setAutoSave]=useState(false);
  const [saving,setSaving]=useState(false);
  const [savedContent,setSavedContent]=useState<string|null>(null);
  const [targetName,setTargetName]=useState('');
  const [error,setError]=useState('');
  const [downloaded,setDownloaded]=useState(false);
  const report=useCallback((message:string)=>{setError(message);notify.current(message);},[]);
  const enableAuto=useCallback((enabled:boolean)=>{autoRef.current=enabled;setAutoSave(enabled);},[]);

  const resetDocument=useCallback(()=>{
    generation.current++;target.current=null;pickerPending.current=false;
    enableAuto(false);setSavedContent(null);setTargetName('');setError('');setDownloaded(false);
  },[enableAuto]);

  const save=useCallback(async(saveAs=false,automatic=false):Promise<boolean>=>{
    const snapshot=current.current;
    if(!snapshot.content){if(!automatic)report('Sơ đồ chưa hợp lệ để lưu. Kiểm tra tên và thông số phần tử.');return false;}
    if(automatic&&!autoRef.current)return false;
    const session=generation.current;
    let destination=saveAs?null:target.current;
    const selecting=!destination;
    const api=fileWindow();
    if(!destination&&pickerPending.current)return false;
    // Open a browser picker directly in the click/keyboard gesture, before waiting
    // for any pending write. Cancel leaves the current file and dirty state intact.
    if(!destination&&!api.electricalFiles){
      if(automatic)return false;
      if(api.showSaveFilePicker){
        pickerPending.current=true;
        try{
          const handle=await api.showSaveFilePicker({suggestedName:fileName(snapshot.project),types:pickerTypes});
          if(session!==generation.current)return false;
          destination={kind:'browser',handle};
        }catch(cause){if(session===generation.current){pickerPending.current=false;if(!cancelled(cause))report(`Không thể chọn tệp: ${(cause as Error).message}`);}return false;}
      }else{
        const url=URL.createObjectURL(new Blob([snapshot.content],{type:'application/json'}));
        const anchor=document.createElement('a');anchor.href=url;anchor.download=fileName(snapshot.project);anchor.click();
        setTimeout(()=>URL.revokeObjectURL(url),1000);setDownloaded(true);setError('');
        notify.current('Đã tải bản sao. Trình duyệt này không hỗ trợ ghi đè tệp; Ctrl+S sẽ tải một bản mới.');
        return false;
      }
    }
    if(!destination)pickerPending.current=true;
    savePending.current++;setSaving(true);
    let succeeded=false;
    const task=queue.current.then(async()=>{
      if(session!==generation.current||(automatic&&!autoRef.current))return;
      // Save As may have completed while this ordinary save waited in the queue.
      // Continue saving the current document at its new location, never the old file.
      if(!saveAs&&target.current)destination=target.current;
      try{
        let written:Target;
        if(destination?.kind==='browser'){
          if(automatic&&destination.handle.queryPermission&&await destination.handle.queryPermission({mode:'readwrite'})!=='granted')throw new Error('Cần cấp lại quyền ghi tệp. Nhấn Ctrl+S để lưu.');
          const writable=await destination.handle.createWritable();
          try{
            if(session!==generation.current||(automatic&&!autoRef.current)){await writable.abort?.();return;}
            await writable.write(snapshot.content!);await writable.close();
          }catch(cause){try{await writable.abort?.();}catch{/* Keep the original write error. */}throw cause;}
          written=destination;
        }else{
          const document=await api.electricalFiles!.save({documentId:destination?.kind==='native'?destination.document.documentId:undefined,content:snapshot.content!,suggestedName:fileName(snapshot.project),saveAs,automatic});
          if(!document)return;
          written={kind:'native',document};
        }
        if(session!==generation.current)return;
        target.current=written;setTargetName(written.kind==='native'?written.document.path:written.handle.name);
        setSavedContent(snapshot.content);setError('');setDownloaded(false);succeeded=true;
      }catch(cause){
        if(session===generation.current&&!cancelled(cause)){
          if(automatic)enableAuto(false);
          report(`Không thể lưu tệp: ${(cause as Error).message}`);
        }
      }
    });
    queue.current=task.catch(()=>{});
    try{await task;}finally{if(selecting&&session===generation.current)pickerPending.current=false;savePending.current--;setSaving(savePending.current>0);}
    return succeeded;
  },[enableAuto,report]);

  const toggleAutoSave=useCallback(async()=>{
    if(autoRef.current){enableAuto(false);return;}
    const api=fileWindow();
    if(!api.electricalFiles&&!api.showSaveFilePicker){report('Trình duyệt này chưa hỗ trợ tự lưu vào tệp. Bản khôi phục trong trình duyệt vẫn được lưu tự động.');return;}
    const session=generation.current;
    const destination=target.current;
    if(destination?.kind==='browser'){
      try{
        // Opening grants read access only. Request write access in this click,
        // before a debounce or save queue loses the browser's user activation.
        const permission=destination.handle.requestPermission
          ?await destination.handle.requestPermission({mode:'readwrite'})
          :destination.handle.queryPermission?await destination.handle.queryPermission({mode:'readwrite'}):'granted';
        if(session!==generation.current||target.current!==destination)return;
        if(permission!=='granted'){report('Chưa có quyền ghi tệp. Tự lưu vẫn tắt; hãy cấp quyền ghi để bật.');return;}
        setError('');
      }catch(cause){if(session===generation.current)report(`Không thể cấp quyền tự lưu: ${(cause as Error).message}`);return;}
    }
    if(!target.current&&!await save())return;
    if(session===generation.current)enableAuto(true);
  },[enableAuto,report,save]);

  useEffect(()=>{
    if(!autoSave||!target.current||content===null||content===savedContent)return;
    const timer=setTimeout(()=>void save(false,true),900);
    return()=>clearTimeout(timer);
  },[autoSave,content,savedContent,save]);

  const open=useCallback(async(fallback:()=>void,onLoaded:(project:Project)=>Project)=>{
    const api=fileWindow(),session=generation.current;
    if(!api.electricalFiles&&!api.showOpenFilePicker){fallback();return;}
    try{
      let destination:Target,source:string;
      if(api.electricalFiles){
        const document=await api.electricalFiles.open();if(!document||session!==generation.current)return;
        destination={kind:'native',document};source=document.content;
      }else{
        const [handle]=await api.showOpenFilePicker!({multiple:false,types:pickerTypes});if(!handle)return;
        const file=await handle.getFile();if(file.size>2_000_000)throw new Error('Tệp quá lớn, giới hạn 2 MB.');
        destination={kind:'browser',handle};source=await file.text();
      }
      if(session!==generation.current)return;
      const loaded=onLoaded(parseProject(source)); // The loader resets the old file session.
      target.current=destination;
      setTargetName(destination.kind==='native'?destination.document.path:destination.handle.name);
      setSavedContent(serializeProject(loaded));setError('');
    }catch(cause){if(!cancelled(cause)&&session===generation.current)report(`Không thể mở tệp: ${(cause as Error).message}`);}
  },[report]);

  const status=error|| (saving?'Đang lưu tệp…':targetName?(content===savedContent?`Đã lưu: ${targetName}`:`Chưa lưu thay đổi: ${targetName}`):downloaded?'Đã tải bản sao; chưa có vị trí để ghi đè':'Chưa lưu vào tệp');
  return {save,open,resetDocument,toggleAutoSave,autoSave,saving,status,saved:!!targetName&&content===savedContent&&!error,error:!!error};
}
