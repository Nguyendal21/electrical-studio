import test from 'node:test';
import assert from 'node:assert/strict';
import { getDefinition } from './catalog';
import { examples } from './examples';
import { terminalPosition, wirePoints } from './geometry';
import type { Point } from './types';

function assertOnGrid(point:Point,context:string){
  assert.ok(Number.isInteger(point.x/10)&&Number.isInteger(point.y/10),`${context}: (${point.x}, ${point.y}) must lie on the 10 px grid`);
}

for(const {id,project} of examples){
  test(`${id}: example terminals and wire routes share the drawing grid`,()=>{
    for(const device of project.devices){
      for(const port of getDefinition(device.kind).ports){
        assertOnGrid(terminalPosition(device,port.id),`${device.id}.${port.id}`);
      }
    }
    for(const wire of project.wires){
      const from=project.devices.find(device=>device.id===wire.from);
      const to=project.devices.find(device=>device.id===wire.to);
      assert.ok(from&&to,`${wire.id}: both devices must exist`);
      assert.ok(getDefinition(from.kind).ports.some(port=>port.id===wire.fromPort),`${wire.id}: source terminal must exist`);
      assert.ok(getDefinition(to.kind).ports.some(port=>port.id===wire.toPort),`${wire.id}: target terminal must exist`);
      for(const point of wire.waypoints??[])assertOnGrid(point,`${wire.id} saved waypoint`);
      const route=wirePoints(project,wire);
      assert.ok(route.length>=2,`${wire.id}: must have a visible route`);
      assert.deepEqual(route[0],terminalPosition(from,wire.fromPort),`${wire.id}: starts at the source pin without an offset`);
      assert.deepEqual(route.at(-1),terminalPosition(to,wire.toPort),`${wire.id}: ends at the target pin without an offset`);
      for(const [index,point] of route.entries()){
        assertOnGrid(point,`${wire.id} route vertex ${index}`);
        if(index===0)continue;
        const previous=route[index-1];
        assert.notDeepEqual(point,previous,`${wire.id}: no zero-length segments`);
        assert.ok(point.x===previous.x||point.y===previous.y,`${wire.id}: every segment is horizontal or vertical`);
      }
    }
  });
}

test('aligned three-phase sample terminals connect directly without short extra leads',()=>{
  for(const id of ['motor-star','motor-delta']){
    const {project}=examples.find(example=>example.id===id)!;
    for(const wire of project.wires.filter(wire=>wire.id.startsWith('feed-')||wire.id.startsWith('motor-'))){
      const route=wirePoints(project,wire);
      assert.equal(route.length,2,`${id}/${wire.id}: facing pins should be joined by one segment`);
      assert.equal(route[0].x,route[1].x,`${id}/${wire.id}: stacked phase pins must align vertically`);
    }
  }
});
