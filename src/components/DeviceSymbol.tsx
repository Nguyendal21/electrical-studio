import type { DeviceKind } from '../model/types';
import { getDefinition } from '../model/catalog';
import { SchematicSymbol } from './SchematicSymbol';

export function DeviceSymbol({kind,size=36,active=false}:{kind:DeviceKind;size?:number;active?:boolean}){
  const {width,height}=getDefinition(kind).size;
  return <svg width={size} height={size} viewBox={`-6 -6 ${width+12} ${height+12}`} aria-hidden="true"><SchematicSymbol kind={kind} active={active} position={['rheostat','potentiometer'].includes(kind)?50:0}/></svg>;
}
