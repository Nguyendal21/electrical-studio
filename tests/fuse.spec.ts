import { expect, test } from '@playwright/test';
import { createDevice } from '../src/model/catalog';
import type { Project } from '../src/model/types';

test('clicking a fuse breaks the circuit and clicking again replaces it',async({page})=>{
  const project:Project={version:2,name:'Fuse operation',devices:[createDevice('dc','source',100,180),createDevice('fuse','fuse',350,180),createDevice('lamp','lamp',600,180)],wires:[
    {id:'feed',from:'source',fromPort:'+',to:'fuse',toPort:'1',length:1,section:2.5},
    {id:'load',from:'fuse',fromPort:'2',to:'lamp',toPort:'1',length:1,section:2.5},
    {id:'return',from:'lamp',fromPort:'2',to:'source',toPort:'-',length:1,section:2.5},
  ]};
  await page.goto('/');
  await page.locator('input[type="file"]').setInputFiles({name:'fuse.electrical.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(project))});
  const fuse=page.locator('.react-flow__node[data-id="fuse"] [data-fuse-state]');
  const lamp=page.locator('.react-flow__node[data-id="lamp"] .equipment-node');
  await page.getByRole('button',{name:'Chạy mô phỏng',exact:true}).click();
  await expect(lamp).toHaveClass(/\blive\b/);
  await fuse.click();await expect(fuse).toHaveAttribute('data-fuse-state','blown');
  await expect(lamp).not.toHaveClass(/\blive\b/);
  await fuse.click();await expect(fuse).toHaveAttribute('data-fuse-state','intact');
  await expect(lamp).toHaveClass(/\blive\b/);
});
