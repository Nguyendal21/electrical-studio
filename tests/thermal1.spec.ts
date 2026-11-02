import { expect, test } from '@playwright/test';
import { createDevice } from '../src/model/catalog';

test('single-pole thermal relay offers linked contacts and can be tripped and reset',async({page})=>{
  await page.goto('/');
  const relay={...createDevice('thermal1','overload',350,200),name:'FR1'};
  await page.locator('input[type="file"]').setInputFiles({name:'thermal.electrical.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({version:2,name:'Single overload',devices:[relay],wires:[]}))});
  const symbol=page.locator('[data-thermal-state]');
  await expect(page.locator('.react-flow__handle')).toHaveCount(2);
  await symbol.dblclick();
  for(const text of ['Thêm tiếp điểm thường mở cùng tên','Thêm tiếp điểm thường đóng cùng tên','Thêm tiếp điểm chuyển đổi cùng tên'])await expect(page.getByTitle(text,{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Đóng thuộc tính',exact:true}).click();
  await page.getByRole('button',{name:'Chạy mô phỏng',exact:true}).click();
  await symbol.click();await expect(symbol).toHaveAttribute('data-thermal-state','tripped');
  await symbol.click();await expect(symbol).toHaveAttribute('data-thermal-state','reset');
});
