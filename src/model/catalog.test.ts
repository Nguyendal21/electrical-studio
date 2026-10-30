import test from 'node:test';
import assert from 'node:assert/strict';
import { catalog, createDevice, getDefinition } from './catalog';
import { getDeviceSize, getPortGeometry } from './geometry';

test('every external electrical and shaft terminal lies on the 10 px grid in every rotation',()=>{
  for(const definition of catalog){
    if(definition.kind==='junction')continue; // A junction is positioned by its centre.
    const device=createDevice(definition.kind,definition.kind,0,0);
    for(const rotation of [0,90,180,270] as const){
      device.rotation=rotation;
      const size=getDeviceSize(device),positions=new Set<string>();
      for(const port of definition.ports){
        const point=getPortGeometry(device,port),label=`${definition.kind}/${port.id}/${rotation}`;
        assert.ok(Math.abs(point.x/10-Math.round(point.x/10))<1e-9,`${label}: x=${point.x}`);
        assert.ok(Math.abs(point.y/10-Math.round(point.y/10))<1e-9,`${label}: y=${point.y}`);
        assert.ok(point.x>=0&&point.x<=size.width&&point.y>=0&&point.y<=size.height,`${label}: outside symbol`);
        assert.ok(point.x===0||point.x===size.width||point.y===0||point.y===size.height,`${label}: not on edge`);
        const key=`${point.x},${point.y}`;
        assert.ok(!positions.has(key),`${label}: overlaps another terminal`);positions.add(key);
      }
    }
  }
});

test('three-pole protection and motor terminals share the same 40 px pitch',()=>{
  for(const kind of ['ac3','ac_generator','breaker','thermal','contactor','induction','synchronous'] as const){
    const device=createDevice(kind,kind,0,0),definition=getDefinition(kind);
    const ids=kind.startsWith('ac')?['L1','L2','L3','N']:['induction','synchronous'].includes(kind)?['U1','V1','W1']:['1','3','5'];
    const xs=ids.map(id=>getPortGeometry(device,definition.ports.find(port=>port.id===id)!).x);
    for(let i=1;i<xs.length;i++)assert.ok(Math.abs(xs[i]-xs[i-1]-40)<1e-9,`${kind}: phase pitch`);
  }
  for(const kind of ['breaker','thermal','induction','synchronous'] as const){
    const device=createDevice(kind,kind,0,0),ports=getDefinition(kind).ports.filter(port=>port.type==='power'&&port.side==='top');
    assert.deepEqual(ports.map(port=>Math.round(getPortGeometry(device,port).x)),[30,70,110],`${kind}: aligned stack`);
  }
});

