import test from 'node:test';
import assert from 'node:assert/strict';
import { parallelTerminalPaths } from './excitationTopology';

test('parallel terminals may coincide directly, including reversed polarity',()=>{
  assert.equal(parallelTerminalPaths([],['+','-'],['+','-']),true);
  assert.equal(parallelTerminalPaths([],['+','-'],['-','+']),true);
  assert.equal(parallelTerminalPaths([],['+','-'],['other','-']),false);
  assert.equal(parallelTerminalPaths([],['+','+'],['+','-']),false);
  assert.equal(parallelTerminalPaths([],['+','-'],['-','-']),false);
});

test('separate passive paths allow starting and field adjustment resistances',()=>{
  const edges:[string,string][]=[['F1','r1'],['r1','A1'],['F2','r2'],['r2','r3'],['r3','A2']];
  assert.equal(parallelTerminalPaths(edges,['F1','F2'],['A1','A2']),true);
  assert.equal(parallelTerminalPaths(edges,['F1','F2'],['A2','A1']),true);
  assert.equal(parallelTerminalPaths(edges.slice(1),['F1','F2'],['A1','A2']),false);
});

test('a resistor across the rails does not collapse two valid terminal paths',()=>{
  const edges:[string,string][]=[['F1','A1'],['F2','A2'],['F1','F2'],['F1','r'],['r','F2']];
  assert.equal(parallelTerminalPaths(edges,['F1','F2'],['A1','A2']),true);
});

test('a shared bottleneck fails even with cycles on both sides',()=>{
  const edges:[string,string][]=[['F1','common'],['F2','common'],['F1','F2'],['common','A1'],['common','A2'],['A1','A2']];
  assert.equal(parallelTerminalPaths(edges,['F1','F2'],['A1','A2']),false);
  assert.equal(parallelTerminalPaths([['F1','return'],['A1','return']],['F1','return'],['A1','return']),false);
});

test('the second search can reroute an initially conflicting path',()=>{
  const edges:[string,string][]=[['F1','x'],['x','A1'],['F1','y'],['y','A2'],['F2','x']];
  assert.equal(parallelTerminalPaths(edges,['F1','F2'],['A1','A2']),true);
});
