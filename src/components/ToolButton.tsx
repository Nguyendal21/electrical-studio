import type { ReactNode } from 'react';
export function ToolButton({label,children,onClick,active=false,disabled=false,className=''}:{label:string;children:ReactNode;onClick:()=>void;active?:boolean;disabled?:boolean;className?:string}){
  return <button className={`tool-button ${active?'active':''} ${className}`} aria-label={label} title={label} aria-pressed={active||undefined} disabled={disabled} onClick={onClick}>{children}</button>;
}
