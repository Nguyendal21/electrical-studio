import test from 'node:test';
import assert from 'node:assert/strict';
import { createDevice, getDefinition } from './catalog';
import { getDeviceSize, getPortGeometry, moveWireSegment, orthogonalPoints, terminalPosition } from './geometry';
import type { Point } from './types';

test('all automatic wire routes remain orthogonal and preserve both endpoints',()=>{
  const source={x:30,y:40},target={x:310,y:260};
  for(const a of ['top','right','bottom','left'])for(const b of ['top','right','bottom','left']){
    const route=orthogonalPoints(source,target,a,b);
    assert.deepEqual(route[0],source);assert.deepEqual(route.at(-1),target);
    for(let i=1;i<route.length;i++)assert.ok(route[i].x===route[i-1].x||route[i].y===route[i-1].y,`${a}/${b}`);
  }
});

test('edited routes stay orthogonal after endpoints move',()=>{
  const route=orthogonalPoints({x:33,y:40},{x:304,y:270},'bottom','top',[{x:100,y:80},{x:100,y:250}]);
  for(let i=1;i<route.length;i++)assert.ok(route[i].x===route[i-1].x||route[i].y===route[i-1].y);
});

test('six winding terminals remain distinct through all four rotations',()=>{
  const motor=createDevice('induction','m',0,0);
  const ports=getDefinition('induction').ports.filter(port=>port.type==='power');
  assert.equal(ports.length,6);
  for(const rotation of [0,90,180,270] as const){
    motor.rotation=rotation;const size=getDeviceSize(motor);
    const points=ports.map(port=>getPortGeometry(motor,port));
    assert.equal(new Set(points.map(p=>`${p.x},${p.y}`)).size,6);
    for(const p of points){assert.ok(p.x>=0&&p.x<=size.width);assert.ok(p.y>=0&&p.y<=size.height);}
  }
});

test('a junction attaches at its visible center',()=>{
  const junction=createDevice('junction','j',80,60);
  const size=getDeviceSize(junction);
  assert.deepEqual(terminalPosition(junction,'J'),{x:80+size.width/2,y:60+size.height/2});
});

function assertOrthogonal(points:Point[]){
  for(let i=1;i<points.length;i++){
    assert.ok(points[i].x===points[i-1].x||points[i].y===points[i-1].y,'every segment must remain orthogonal');
    assert.notDeepEqual(points[i],points[i-1],'duplicate points cannot accumulate');
  }
}

test('a straight split wire bends at its fixed terminals without adding short leads',()=>{
  const original=[{x:0,y:0},{x:200,y:0}],snapshot=structuredClone(original);
  const moved=moveWireSegment(original,0,{x:100,y:50});
  assert.deepEqual(moved,[{x:0,y:0},{x:0,y:50},{x:200,y:50},{x:200,y:0}]);
  assertOrthogonal(moved);assert.deepEqual(original,snapshot);
  assert.deepEqual(orthogonalPoints(original[0],original[1],'right','left',moved.slice(1,-1)),moved,'the saved route must replay exactly');
});

test('vertical, reverse and short wires retain exact endpoints without invented terminal offsets',()=>{
  for(const original of [
    [{x:30,y:20},{x:30,y:220}],
    [{x:30,y:220},{x:30,y:20}],
    [{x:220,y:30},{x:20,y:30}],
    [{x:0,y:0},{x:0,y:16}],
  ]){
    const moved=moveWireSegment(original,0,{x:80,y:80});
    assert.deepEqual(moved[0],original[0]);assert.deepEqual(moved.at(-1),original.at(-1));
    assertOrthogonal(moved);assert.equal(moved.length,4);
    if(original[0].x===original[1].x){assert.equal(moved[1].y,original[0].y);assert.equal(moved[2].y,original[1].y);}
    else {assert.equal(moved[1].x,original[0].x);assert.equal(moved[2].x,original[1].x);}
  }
});

test('all segments of a bent route, including endpoint segments, remain independently editable',()=>{
  const original=[{x:0,y:0},{x:0,y:100},{x:200,y:100},{x:200,y:300}];
  for(let index=0;index<original.length-1;index++)for(const coordinate of [-100,0,50,100,200,400]){
    const moved=moveWireSegment(original,index,{x:coordinate,y:coordinate});
    assert.deepEqual(moved[0],original[0]);assert.deepEqual(moved.at(-1),original.at(-1));assertOrthogonal(moved);
  }
});

test('collinear routing anchors do not create diagonals or redundant points during a drag',()=>{
  const route=orthogonalPoints({x:0,y:0},{x:200,y:300},'bottom','top');
  for(let index=0;index<route.length-1;index++){
    const moved=moveWireSegment(route,index,{x:100,y:150});
    assert.deepEqual(moved[0],route[0]);assert.deepEqual(moved.at(-1),route.at(-1));assertOrthogonal(moved);
    for(let i=2;i<moved.length;i++){
      const a=moved[i-2],b=moved[i-1],c=moved[i];
      assert.ok(!((a.x===b.x&&b.x===c.x)||(a.y===b.y&&b.y===c.y))||(b.x-a.x)*(c.x-b.x)+(b.y-a.y)*(c.y-b.y)<0,'forward collinear anchors are removed');
    }
  }
});

test('repeatedly moving the same central segment does not accumulate elbows',()=>{
  let route=moveWireSegment([{x:0,y:0},{x:200,y:0}],0,{x:100,y:50});
  for(let i=0;i<30;i++){
    route=moveWireSegment(route,1,{x:100,y:30+i*10});
    assert.equal(route.length,4);assertOrthogonal(route);
  }
  const reset=moveWireSegment(route,1,{x:100,y:0});
  assert.deepEqual(reset,[{x:0,y:0},{x:200,y:0}]);
});

test('facing aligned pins connect directly even when closer than the former 24px leads',()=>{
  for(const distance of [10,20,30,40,200]){
    for(const [source,target,a,b] of [
      [{x:0,y:0},{x:distance,y:0},'right','left'],
      [{x:distance,y:0},{x:0,y:0},'left','right'],
      [{x:0,y:0},{x:0,y:distance},'bottom','top'],
      [{x:0,y:distance},{x:0,y:0},'top','bottom'],
    ] as const)assert.deepEqual(orthogonalPoints(source,target,a,b),[source,target]);
  }
});

test('automatic corners stay on the 10px grid without collinear anchors or retraced leads',()=>{
  const sides=['top','right','bottom','left','none'];
  for(const target of [{x:10,y:10},{x:30,y:70},{x:-20,y:0},{x:0,y:20},{x:300,y:-100}])for(const a of sides)for(const b of sides){
    const route=orthogonalPoints({x:0,y:0},target,a,b);
    assertOrthogonal(route);
    for(const point of route){assert.ok(point.x%10===0);assert.ok(point.y%10===0);}
    for(let i=2;i<route.length;i++){
      const p=route[i-2],q=route[i-1],r=route[i];
      assert.ok(!((p.x===q.x&&q.x===r.x)||(p.y===q.y&&q.y===r.y)),`${a}/${b}: no redundant or reversed segments`);
    }
    const outward=(side:string,pin:Point,next:Point)=>side==='none'||side==='top'&&next.y<pin.y||side==='bottom'&&next.y>pin.y||side==='left'&&next.x<pin.x||side==='right'&&next.x>pin.x;
    assert.ok(outward(a,route[0],route[1]),`${a}/${b}: source departure`);
    assert.ok(outward(b,route.at(-1)!,route.at(-2)!),`${a}/${b}: target arrival`);
  }
});

test('edited and split off-grid wires preserve their actual route without forced grid snapping',()=>{
  const points=[{x:3.5,y:7.25},{x:3.5,y:43.5},{x:91.75,y:43.5},{x:91.75,y:102.25}];
  assert.deepEqual(orthogonalPoints(points[0],points.at(-1)!,'bottom','top',points.slice(1,-1)),points);
  const moved=moveWireSegment(points,1,{x:0,y:60});
  assert.deepEqual(moved,[points[0],{x:3.5,y:60},{x:91.75,y:60},points.at(-1)!]);
});
